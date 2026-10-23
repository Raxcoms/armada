import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as motion from "../src/lib/tabCarouselMotion.ts";
import type { MotionRect } from "../src/lib/tabCarouselMotion.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../src/hooks/useTabCarouselMotion.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function setup(zoom = 1, lineHeight = 22) {
  const hooks: any[] = [];
  const effects = new Map<number, { dependencies: any[]; cleanup?: () => void }>();
  let cursor = 0;
  let pending: Array<() => void> = [];
  const animated: any[] = [];
  let resize!: () => void;
  let mediaChanged!: () => void;
  const media = {
    matches: false,
    addEventListener: (_: string, callback: () => void) => { mediaChanged = callback; },
    removeEventListener: () => {},
  };
  const attributes = new Set<string>();
  const window = {
    getComputedStyle: (node: any) => ({ ...node.computed, ...node.visualStyle }),
    matchMedia: () => media,
    ResizeObserver: class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} },
  };
  function node(rect: MotionRect, kind: string) {
    const result: any = {
      rect, visual: null, visualStyle: {}, kind,
      dataset: {}, classList: { contains: (name: string) => kind === "ghost" && name === "armada-tab-ghost" },
      computed: { opacity: "1", color: "rgb(255, 255, 255)", backgroundColor: "transparent", clipPath: "none" },
      get offsetWidth() { return result.rect.width; },
      get offsetHeight() { return result.rect.height; },
      getBoundingClientRect: () => {
        const current = result.visual || result.rect;
        return { left: 100 + current.left * zoom, top: 80 + current.top * zoom, width: current.width * zoom, height: current.height * zoom };
      },
      animate: (frames: any[], options: any) => {
        let resolve!: () => void;
        let reject!: () => void;
        const animation: any = {
          node: result, frames, options, cancelled: false,
          finished: new Promise<void>((done, fail) => { resolve = done; reject = fail; }),
          cancel: () => { animation.cancelled = true; result.visual = null; result.visualStyle = {}; reject(new Error("cancelled")); },
          finish: () => resolve(),
        };
        animated.push(animation);
        return animation;
      },
    };
    return result;
  }
  const header: any = node({ left: 0, top: 0, width: 300, height: 48 }, "header");
  header.ownerDocument = { defaultView: window };
  header.computed = { animationDuration: "0.35s", animationTimingFunction: "ease-in-out" };
  header.hasAttribute = (name: string) => attributes.has(name);
  header.setAttribute = (name: string) => attributes.add(name);
  header.removeAttribute = (name: string) => attributes.delete(name);
  function view(id: string, left: number, width: number, selected = false, ghost = false) {
    const height = selected ? lineHeight + 8 : 26;
    const shell = node({ left, top: 23 - height / 2, width, height }, ghost ? "ghost" : "button");
    shell.dataset.tabId = id;
    shell.computed.backgroundColor = selected ? "rgb(50, 50, 50)" : "transparent";
    const surface = node({ ...shell.rect }, "surface");
    const radius = `${height / 2}px`;
    const previous = !selected && !ghost && left < header.rect.width / 2;
    const next = !selected && !ghost && left > header.rect.width / 2;
    const corners = {
      borderTopLeftRadius: previous ? "0px" : radius,
      borderTopRightRadius: next ? "0px" : radius,
      borderBottomRightRadius: next ? "0px" : radius,
      borderBottomLeftRadius: previous ? "0px" : radius,
    };
    Object.assign(shell.computed, corners);
    Object.assign(surface.computed, corners);
    const icon = node({ left: left + (selected ? 8 : 4), top: 14, width: 18, height: 18 }, "icon");
    const label = node({ left: selected ? left + 30 : left + width, top: 23 - lineHeight / 2, width: selected ? width - 38 : 0, height: lineHeight }, "label");
    label.computed.opacity = selected ? "1" : "0";
    return { shell, surface, icon, label };
  }
  const views = { current: {
    previous: view("about", 43, 26), current: view("games", 70, 160, true), next: view("profiles", 231, 26),
    ghost: { shell: null, surface: null, icon: null, label: null } as any,
  } };
  const left = { current: node({ left: 16, top: 11, width: 24, height: 24 }, "edge") };
  const right = { current: node({ left: 260, top: 11, width: 24, height: 24 }, "edge") };
  const exports: any = {};
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "../lib/tabCarouselMotion") return motion;
      if (id === "react") return {
        useRef: (initial: any) => {
          const index = cursor++;
          if (!(index in hooks)) hooks[index] = { current: initial };
          return hooks[index];
        },
        useLayoutEffect: (callback: () => (() => void) | undefined, dependencies: any[]) => {
          const index = cursor++;
          const previous = effects.get(index);
          if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
          pending.push(() => {
            previous?.cleanup?.();
            effects.set(index, { dependencies, cleanup: callback() });
          });
        },
      };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  let prepare!: (direction: number, target: string) => void;
  function render(active: string, labels = "labels") {
    cursor = 0;
    prepare = exports.useTabCarouselMotion({ current: header }, views, left, right, active, labels);
    const callbacks = pending;
    pending = [];
    callbacks.forEach((callback) => callback());
  }
  function advance() {
    prepare(1, "profiles");
    views.current = {
      previous: view("games", 43, 26), current: view("profiles", 95, 110, true), next: view("rgb", 231, 26), ghost: view("about", 0, 26, false, true),
    };
    render("profiles");
  }
  render("games");
  return {
    animated, views, header, media, render, advance, resize: () => resize(), mediaChanged: () => mediaChanged(),
    prepare: (direction: number, target: string) => prepare(direction, target), view,
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.(); },
  };
}

test("next morphs the center into the inward-rounded previous tab and the next tab into its pill", () => {
  const app = setup();
  app.advance();
  const surfaces = app.animated.filter((entry) => entry.node.kind === "surface");
  assert.equal(surfaces.length, 4);
  assert.equal(surfaces[0].frames[0].width, "160px");
  assert.equal(surfaces[0].frames[1].width, "26px");
  assert.equal(surfaces[1].frames[0].width, "26px");
  assert.equal(surfaces[1].frames[1].width, "110px");
  assert.equal(surfaces[0].frames[1].borderTopLeftRadius, "0px");
  assert.equal(surfaces[0].frames[1].borderBottomLeftRadius, "0px");
  assert.equal(surfaces[0].frames[1].borderTopRightRadius, "13px");
  assert.equal(surfaces[0].frames[1].borderBottomRightRadius, "13px");
  assert.equal(surfaces[1].frames[0].borderTopLeftRadius, "13px");
  assert.equal(surfaces[1].frames[0].borderBottomLeftRadius, "13px");
  assert.equal(surfaces[1].frames[0].borderTopRightRadius, "0px");
  assert.equal(surfaces[1].frames[0].borderBottomRightRadius, "0px");
  for (const corner of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]) {
    assert.equal(surfaces[1].frames[1][corner], "15px");
  }
  assert.ok(app.animated.every((entry) => entry.options.duration === 350));
  assert.ok(app.animated.filter((entry) => entry.node.kind === "icon").every((entry) => !entry.frames[0].transform.includes("scale")));
  assert.equal(app.header.hasAttribute("data-moving"), true);
  app.unmount();
});

test("previous mirrors the asymmetric tab corners and keeps the selected pill round", () => {
  const app = setup();
  app.prepare(-1, "about");
  app.views.current = {
    previous: app.view("experimental", 43, 26), current: app.view("about", 95, 110, true),
    next: app.view("games", 231, 26), ghost: app.view("profiles", 0, 26, false, true),
  };
  app.render("about");
  const surfaces = app.animated.filter((entry) => entry.node.kind === "surface");
  assert.equal(surfaces[1].frames[0].borderTopLeftRadius, "0px");
  assert.equal(surfaces[1].frames[0].borderBottomLeftRadius, "0px");
  assert.equal(surfaces[1].frames[0].borderTopRightRadius, "13px");
  assert.equal(surfaces[1].frames[0].borderBottomRightRadius, "13px");
  assert.equal(surfaces[2].frames[1].borderTopLeftRadius, "13px");
  assert.equal(surfaces[2].frames[1].borderBottomLeftRadius, "13px");
  assert.equal(surfaces[2].frames[1].borderTopRightRadius, "0px");
  assert.equal(surfaces[2].frames[1].borderBottomRightRadius, "0px");
  app.unmount();
});

test("geometry stays in CSS pixels under host zoom rather than using hardcoded travel distances", () => {
  const normal = setup();
  const scaled = setup(0.96);
  normal.advance();
  scaled.advance();
  const expected = normal.animated[3].frames[0];
  const actual = scaled.animated[3].frames[0];
  assert.ok(Math.abs(Number.parseFloat(actual.width) - Number.parseFloat(expected.width)) < 0.001);
  assert.ok(Math.abs(Number.parseFloat(actual.transform.slice(10)) - Number.parseFloat(expected.transform.slice(10))) < 0.001);
  normal.unmount();
  scaled.unmount();
});

test("labels and icons keep their baseline through pill morphs and reversals at different text sizes and zoom", () => {
  const verticalShift = (transform: string) => Number(transform.match(/,\s*([\d.e+-]+)px\)/)![1]);
  for (const zoom of [0.96, 1, 1.25]) {
    for (const lineHeight of [19.6, 22.4, 28]) {
      const app = setup(zoom, lineHeight);
      app.prepare(1, "profiles");
      app.views.current = {
        previous: app.view("games", 43, 26), current: app.view("profiles", 90, 158, true), next: app.view("rgb", 231, 26), ghost: app.view("about", 0, 26, false, true),
      };
      app.render("profiles", "Config. de jogos|Perfis|RGB");
      const forward = [...app.animated];
      assert.ok(forward.filter((animation) => ["label", "icon"].includes(animation.node.kind))
        .every((animation) => animation.frames.every((frame: any) => Math.abs(verticalShift(frame.transform)) < 0.001)));
      const moving = app.views.current.previous;
      moving.label.visual = { ...moving.label.rect, left: 90, width: 60 };
      moving.label.visualStyle = { opacity: ".5" };
      moving.icon.visual = { ...moving.icon.rect, left: 66 };
      app.prepare(-1, "games");
      app.views.current = {
        previous: app.view("about", 43, 26), current: app.view("games", 70, 160, true), next: app.view("profiles", 231, 26), ghost: app.view("rgb", 0, 26, false, true),
      };
      app.render("games", "Config. de jogos|Perfis|RGB");
      const reversed = app.animated.slice(forward.length);
      assert.ok(reversed.filter((animation) => ["label", "icon"].includes(animation.node.kind))
        .every((animation) => animation.frames.every((frame: any) => Math.abs(verticalShift(frame.transform)) < 0.001)));
      assert.ok(reversed.some((animation) => Math.abs(Number.parseFloat(animation.frames[0].transform.slice(10))) > 1));
      app.unmount();
    }
  }
});

test("hidden circle labels use the selected title's line height and vertical center without transform overrides", () => {
  const styles = readFileSync(new URL("../src/components/TabNavigation.styles.ts", import.meta.url), "utf8").replace(/\$\{[^}]*\}/g, "TOKEN");
  assert.match(styles, /\.armada-tab-title\s*\{[^}]*line-height:\s*1\.4/);
  const circleTitle = styles.match(/\.armada-tab-ghost \.armada-tab-title\s*\{([^}]*)\}/)![1];
  assert.doesNotMatch(circleTitle, /line-height/);
  assert.match(styles, /\.armada-tab-ghost \.armada-tab-label\s*\{[^}]*top:\s*50%;\s*translate:\s*0 -50%/);
});

test("rapid reversal captures in-flight shapes and restores the departing tab from its moving ghost", () => {
  const app = setup();
  app.advance();
  const oldAnimations = [...app.animated];
  const moving = app.views.current.previous;
  moving.surface.visual = { left: 59, top: 9, width: 93, height: 28 };
  moving.surface.visualStyle = {
    borderTopLeftRadius: "7px", borderTopRightRadius: "16px",
    borderBottomRightRadius: "15px", borderBottomLeftRadius: "6px",
  };
  moving.icon.visual = { left: 66, top: 14, width: 18, height: 18 };
  moving.label.visual = { left: 87, top: 12, width: 60, height: 22 };
  moving.label.visualStyle = { opacity: ".5" };
  app.views.current.ghost.surface.visual = { left: 28, top: 10, width: 26, height: 26 };
  app.prepare(-1, "games");
  app.views.current = {
    previous: app.view("about", 43, 26), current: app.view("games", 70, 160, true), next: app.view("profiles", 231, 26), ghost: app.view("rgb", 0, 26, false, true),
  };
  app.render("games");
  const currentSurface = app.animated.slice(oldAnimations.length).filter((entry) => entry.node.kind === "surface")[1];
  assert.equal(currentSurface.frames[0].width, "93px");
  assert.equal(currentSurface.frames[0].transform, "translate(-11px, 1px)");
  assert.equal(currentSurface.frames[0].borderTopLeftRadius, "7px");
  assert.equal(currentSurface.frames[0].borderTopRightRadius, "16px");
  assert.equal(currentSurface.frames[0].borderBottomRightRadius, "15px");
  assert.equal(currentSurface.frames[0].borderBottomLeftRadius, "6px");
  const previousSurface = app.animated.slice(oldAnimations.length).filter((entry) => entry.node.kind === "surface")[0];
  assert.equal(previousSurface.frames[0].transform, "translate(-15px, 0px)");
  assert.ok(oldAnimations.every((entry) => entry.cancelled));
  app.unmount();
});

test("finished motion cleans up and a later reversal enters from the bumper, not a hidden ghost", async () => {
  const app = setup();
  app.advance();
  const previous = [...app.animated];
  previous.forEach((animation) => animation.finish());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.header.hasAttribute("data-moving"), false);
  assert.ok(previous.every((animation) => animation.cancelled));
  app.prepare(-1, "games");
  app.views.current = {
    previous: app.view("about", 43, 26), current: app.view("games", 70, 160, true), next: app.view("profiles", 231, 26), ghost: app.view("rgb", 0, 26, false, true),
  };
  app.render("games");
  const entering = app.animated.slice(previous.length).find((animation) => animation.node.kind === "surface");
  assert.equal(entering.frames[0].transform, "translate(-28px, 0px)");
  app.unmount();
});

test("reduced motion, locale changes and responsive layout changes settle without delaying tab content", () => {
  const app = setup();
  app.media.matches = true;
  app.advance();
  assert.equal(app.animated.length, 0);
  assert.equal(app.header.hasAttribute("data-moving"), false);
  app.media.matches = false;
  app.prepare(-1, "games");
  app.render("games");
  assert.equal(app.header.hasAttribute("data-moving"), true);
  app.render("games", "Config. de jogos|Perfis|RGB");
  assert.equal(app.header.hasAttribute("data-moving"), false);
  app.prepare(1, "profiles");
  app.render("profiles", "Config. de jogos|Perfis|RGB");
  app.views.current.current.shell.rect.width = 140;
  app.resize();
  assert.equal(app.header.hasAttribute("data-moving"), false);
  app.unmount();
});

test("measured boundaries mirror entry and exit, and time tokens support seconds or milliseconds", () => {
  const snapshot: motion.TabMotionSnapshot = {
    surface: { left: 100, top: 8, width: 150, height: 30 }, icon: { left: 108, top: 12, width: 18, height: 18 },
    corners: { borderTopLeftRadius: "15px", borderTopRightRadius: "15px", borderBottomRightRadius: "15px", borderBottomLeftRadius: "15px" },
    label: { left: 130, top: 12, width: 112, height: 22 }, labelWidth: 112, labelOpacity: 1, opacity: 1, background: "white", color: "black",
  };
  assert.equal(motion.atBoundary(snapshot, { left: 16, top: 10, width: 24, height: 24 }).icon.left, 19);
  assert.equal(motion.atBoundary(snapshot, { left: 260, top: 10, width: 24, height: 24 }).icon.left, 263);
  const boundary = motion.atBoundary(snapshot, { left: 16, top: 10, width: 24, height: 24 });
  assert.equal(boundary.label.top, 11);
  assert.equal(boundary.label.top + boundary.label.height / 2, boundary.icon.top + boundary.icon.height / 2);
  assert.equal(motion.cssDuration("200ms"), 200);
  assert.equal(motion.cssDuration(".35s"), 350);
  assert.equal(motion.cssDuration("0s"), 0);
});

test("the six tab icons have distinct shapes and share native text color", () => {
  const source = readFileSync(new URL("../src/icons.tsx", import.meta.url), "utf8");
  const icons: any = {};
  const element = (type: any, props: any) => ({ type, props });
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: icons, require: () => ({ jsx: element, jsxs: element, Fragment: "Fragment" }) });
  const selected = ["Compatibility", "Power", "RGB", "Controller", "Experimental", "About"].map((key) => icons.tabIcons[key]);
  assert.equal(new Set(selected.map((icon) => JSON.stringify(icon.props.path))).size, 6);
  assert.ok(selected.every((icon) => icon.type(icon.props).props.stroke === "currentColor"));
  assert.equal(icons.tabIcons.Compatibility.props.path.props.children[0].type, "rect");
  assert.equal(icons.tabIcons.Controller.props.path.props.children[0].type, "path");
});
