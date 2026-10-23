import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { adjacentTab } from "../src/lib/tabNavigation.ts";
import * as scrollRegion from "../src/lib/scrollRegion.ts";

const source = readFileSync(new URL("../src/components/TabNavigation.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const headerStyleSource = readFileSync(new URL("../src/components/TabNavigation.styles.ts", import.meta.url), "utf8");
const styles = `${readFileSync(new URL("../src/styles.ts", import.meta.url), "utf8")}\n${headerStyleSource}`.replace(/\$\{[^}]*\}/g, "TOKEN");
const widgetSource = ts.transpileModule(readFileSync(new URL("../src/components/widgets.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const stickySource = ts.transpileModule(readFileSync(new URL("../src/hooks/useStickyHeader.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const hintSource = ts.transpileModule(readFileSync(new URL("../src/components/ControllerButtonHint.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const GamepadButton = { OK: 1, CANCEL: 2, BUMPER_LEFT: 5, BUMPER_RIGHT: 6, DIR_UP: 9, DIR_DOWN: 10, DIR_LEFT: 11, DIR_RIGHT: 12 };

interface Element {
  type: string | ((props: any) => any);
  props: any;
  key?: string;
  rendered?: any;
}

interface Frame {
  slots: any[];
  effects: Map<number, { dependencies: any[]; cleanup?: () => void }>;
}

function allElements(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(allElements);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...allElements(tree.rendered), ...allElements(tree.props?.children)];
}

function setup(initial = "games", visible = ["games", "profiles", "rgb", "controller", "experimental", "about"], contentReady = true) {
  let active = initial;
  let tree: any;
  let frame: Frame;
  let cursor = 0;
  let effects: Array<() => void> = [];
  const focusTargets: string[] = [];
  const nativeFocus: Array<{ target: string; button: number; empty: boolean }> = [];
  const motions: Array<{ direction: number; target: string }> = [];
  const panelElements = new Map<string, any>();
  const properties = new Map<string, string>();
  const nativeTitle = { offsetHeight: 32 };
  const observed: unknown[] = [];
  let observeResize: (() => void) | undefined;
  let observerDisconnected = false;
  const changes: string[] = [];
  const mounted = new Map<string, number>();
  const unmounted: string[] = [];
  const frames = new Map<string, Frame>();
  const target = {};
  const portalTarget = {};
  const header: any = { offsetHeight: 48, focus: () => { focusTargets.push("header"); } };
  const root: any = {
    contains: (node: unknown) => node === target || node === root,
    closest: (selector: string) => {
      assert.equal(selector, '[role="tabpanel"]');
      return { querySelector: (titleSelector: string) => {
        assert.equal(titleSelector, ".decky-native-title");
        return nativeTitle;
      } };
    },
    style: {
      setProperty: (key: string, value: string) => { properties.set(key, value); },
      removeProperty: (key: string) => { properties.delete(key); },
    },
  };
  const element = (type: Element["type"], props: any, key?: string): Element => ({ type, props, key });
  const effect = (callback: () => (() => void) | undefined, dependencies: any[]) => {
    const owner = frame;
    const index = cursor++;
    const previous = owner.effects.get(index);
    if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
    effects.push(() => {
      previous?.cleanup?.();
      owner.effects.set(index, { dependencies, cleanup: callback() });
    });
  };
  const react = {
    useState: (initialValue: any) => {
      const owner = frame;
      const index = cursor++;
      if (!(index in owner.slots)) owner.slots[index] = initialValue;
      return [owner.slots[index], (value: any) => { owner.slots[index] = value; }];
    },
    useRef: (initialValue: any) => {
      const index = cursor++;
      if (!(index in frame.slots)) frame.slots[index] = { current: initialValue };
      return frame.slots[index];
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  function PendingSave({ id }: { id: string }) {
    react.useEffect(() => {
      mounted.set(id, (mounted.get(id) || 0) + 1);
      return () => { unmounted.push(id); };
    }, []);
    return element("PendingSaveContent", { id });
  }
  const tabs = visible.map((id) => ({ id, title: id, icon: element("Icon", { id }), content: element(PendingSave, { id }) }));
  const exports: any = {};
  const widgets: any = {};
  const sticky: any = {};
  const hints: any = {};
  const Observer = class {
    constructor(callback: () => void) { observeResize = callback; }
    observe(element: unknown) { observed.push(element); }
    disconnect() { observerDisconnected = true; }
  };
  header.ownerDocument = { defaultView: { ResizeObserver: Observer } };
  const native = {
    DialogButton: "DialogButton", Focusable: "Focusable", GamepadButton,
    NavEntryPositionPreferences: { FIRST: 0 }, staticClasses: { Title: "decky-native-title" }, classMap: [{ Field: "native-field" }],
    gamepadDialogClasses: { NoMinWidth: "native-no-min-width" },
    findModuleExport: () => undefined,
  };
  runInNewContext(hintSource, { exports: hints, require: (id: string) => {
    if (id === "@decky/ui") return native;
    if (id === "react/jsx-runtime") return { jsx: element, jsxs: element };
    throw new Error(`Unexpected hint import: ${id}`);
  } });
  runInNewContext(widgetSource, { exports: widgets, require: (id: string) => {
    if (id === "@decky/ui") return native;
    if (id === "react/jsx-runtime") return { jsx: element, jsxs: element };
    throw new Error(`Unexpected widget import: ${id}`);
  } });
  runInNewContext(stickySource, { exports: sticky, ResizeObserver: class { constructor() { throw new Error("Use the rendered window's observer"); } }, require: (id: string) => {
    if (id === "@decky/ui") return native;
    if (id === "react") return react;
    if (id === "../lib/scrollRegion") return scrollRegion;
    throw new Error(`Unexpected sticky header import: ${id}`);
  } });
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
      if (id === "@decky/ui") return native;
      if (id === "./widgets") return widgets;
      if (id === "./ControllerButtonHint") return hints;
      if (id === "../hooks/useStickyHeader") return sticky;
      if (id === "../hooks/useTabCarouselMotion") return { useTabCarouselMotion: () => (direction: number, target: string) => { motions.push({ direction, target }); } };
      if (id === "../i18n") return { t: (key: string) => key };
      if (id === "../lib/tabNavigation") return { adjacentTab };
      throw new Error(`Unexpected import: ${id}`);
    },
  });

  function render() {
    const present = new Set<string>();
    const expand = (node: any, path: string): any => {
      if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${child?.key ?? index}`));
      if (!node || typeof node !== "object") return node;
      if (typeof node.type === "function") {
        const identity = `${path}/${node.type.name}/${node.key || ""}`;
        present.add(identity);
        frame = frames.get(identity) || { slots: [], effects: new Map() };
        frames.set(identity, frame);
        cursor = 0;
        return { ...node, rendered: expand(node.type(node.props), `${identity}/rendered`) };
      }
      if (node.type === "Focusable" && (node.props.ref || node.props.navRef)) {
        let nativeElement: any = root;
        if (node.props.role === "navigation") nativeElement = header;
        if (node.props.role === "tabpanel") {
          const id = node.props["aria-label"];
          nativeElement = panelElements.get(id) || {};
          panelElements.set(id, nativeElement);
          nativeElement.focus = () => { throw new Error("Use Steam's navigation handle rather than DOM focus"); };
        }
        if (node.props.navRef) {
          const name = node.props.role === "navigation" ? "header" : node.props["aria-label"];
          const handle = { TakeFocus: (button: number) => {
            assert.equal(button, 10);
            nativeFocus.push({ target: name, button, empty: name !== "header" && !contentReady });
            focusTargets.push(name);
            return true;
          } };
          if (typeof node.props.navRef === "function") node.props.navRef(handle);
          else node.props.navRef.current = handle;
        }
        if (typeof node.props.ref === "function") node.props.ref(nativeElement);
        else if (node.props.ref) node.props.ref.current = nativeElement;
      }
      return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/${node.key || ""}/children`) } };
    };
    tree = expand(element(exports.TabNavigation, {
      tabs, activeTab: active, onShowTab: (id: string) => { active = id; changes.push(id); },
    }), "root");
    for (const [identity, owner] of frames) {
      if (present.has(identity)) continue;
      for (const current of owner.effects.values()) current.cleanup?.();
      frames.delete(identity);
    }
    const pending = effects;
    effects = [];
    pending.forEach((callback) => callback());
    return tree;
  }
  const navigation = () => allElements(tree).find((node) => node.type === "Focusable")!;
  const panels = () => allElements(tree).filter((node) => node.props?.role === "tabpanel");
  function press(button: number, options: { outside?: boolean; prevented?: boolean } = {}) {
    let consumed = false;
    let stopped = false;
    const event = {
      detail: { button }, target: options.outside ? portalTarget : target,
      defaultPrevented: !!options.prevented,
      preventDefault: () => { consumed = true; }, stopPropagation: () => { stopped = true; },
    };
    navigation().props.onButtonDown(event);
    render();
    return { consumed, stopped };
  }
  render();
  return {
    render, press, changes, mounted, unmounted, panels, focusTargets, nativeFocus, motions, properties, nativeTitle, header, root, observed,
    get active() { return active; },
    get observerDisconnected() { return observerDisconnected; },
    buttons: () => allElements(tree).filter((node) => node.type === "DialogButton" && !node.props.className.includes("armada-tab-selected")),
    selectedButton: () => allElements(tree).find((node) => node.type === "DialogButton" && node.props.className.includes("armada-tab-selected"))!,
    elements: () => allElements(tree),
    resize: () => observeResize?.(),
    unmount: () => {
      for (const owner of frames.values()) {
        for (const current of owner.effects.values()) current.cleanup?.();
      }
    },
  };
}

test("handled bumpers wrap the visible navigation and consume only their own events", () => {
  const app = setup();
  assert.deepEqual(app.press(GamepadButton.BUMPER_LEFT), { consumed: true, stopped: true });
  assert.equal(app.active, "about");
  assert.deepEqual(app.press(GamepadButton.BUMPER_RIGHT), { consumed: true, stopped: true });
  assert.equal(app.active, "games");
  assert.deepEqual(app.press(GamepadButton.DIR_DOWN), { consumed: false, stopped: false });
  assert.deepEqual(app.press(GamepadButton.DIR_UP), { consumed: false, stopped: false });
  assert.deepEqual(app.press(GamepadButton.CANCEL), { consumed: false, stopped: false });
  assert.deepEqual(app.press(GamepadButton.BUMPER_RIGHT, { prevented: true }), { consumed: false, stopped: false });
  assert.deepEqual(app.changes, ["about", "games"]);
});

test("events from modal portals outside the plugin root cannot change its active tab", () => {
  const app = setup();
  assert.deepEqual(app.press(GamepadButton.BUMPER_LEFT, { outside: true }), { consumed: false, stopped: false });
  assert.deepEqual(app.press(GamepadButton.BUMPER_RIGHT, { outside: true }), { consumed: false, stopped: false });
  assert.equal(app.active, "games");
  assert.deepEqual(app.changes, []);
});

test("native focus scrolling is scoped to the plugin and falls back when its scroll owner is unavailable", () => {
  const app = setup();
  const root = app.elements().find((node) => node.props?.className === "armada-control-tabs")!;
  assert.equal(root.props.scrollIntoViewWhenChildFocused, "force");
  assert.equal(root.props.fnScrollIntoViewHandler({}), false);
  assert.equal(root.props.fnScrollIntoViewHandler({ Element: {} }), false);
  assert.equal(root.props.fnScrollIntoViewHandler({ Element: app.root }), false);
});

test("the native scroll adapter reveals whole fields and resets the panel when focus returns to the header", () => {
  let cleanup: (() => void) | undefined;
  const properties = new Map<string, string>();
  const style = {
    setProperty: (name: string, value: string) => { properties.set(name, value); },
    getPropertyValue: (name: string) => properties.get(name) || "",
    getPropertyPriority: () => "",
    removeProperty: (name: string) => { properties.delete(name); },
  };
  const calls: ScrollToOptions[] = [];
  const document: any = {
    body: {}, documentElement: {},
    defaultView: {
      getComputedStyle: () => ({ overflowY: "auto", scrollPaddingTop: "auto", scrollPaddingBottom: "auto" }),
      ResizeObserver: class { observe() {} disconnect() {} },
    },
  };
  const scroller: any = {
    ownerDocument: document, parentElement: document.body, style,
    scrollTop: 300, offsetHeight: 400, clientHeight: 400, clientTop: 0,
    getBoundingClientRect: () => ({ top: 20, height: 400 }),
    scrollTo: (options: ScrollToOptions) => { scroller.scrollTop = options.top; calls.push({ ...options }); },
  };
  const header: any = {
    ownerDocument: document, offsetHeight: 48,
    getBoundingClientRect: () => ({ bottom: 100 }),
    contains: (target: unknown) => target === header,
  };
  const field = {
    getBoundingClientRect: () => ({ top: 620 - scroller.scrollTop, bottom: 700 - scroller.scrollTop, height: 80 }),
  };
  const input = { closest: (selector: string) => {
    assert.equal(selector, ".native-field");
    return field;
  } };
  const root: any = {
    ownerDocument: document, parentElement: scroller, style,
    closest: () => ({ querySelector: () => ({ offsetHeight: 32 }) }),
    contains: (target: unknown) => target === header || target === input || target === field,
  };
  const exports: any = {};
  runInNewContext(stickySource, { exports, require: (id: string) => {
    if (id === "@decky/ui") return { classMap: [{ Field: "native-field" }], staticClasses: { Title: "native-title" } };
    if (id === "react") return { useLayoutEffect: (callback: () => () => void) => { cleanup = callback(); } };
    if (id === "../lib/scrollRegion") return scrollRegion;
    throw new Error(`Unexpected scroll adapter import: ${id}`);
  } });
  const reveal = exports.useStickyHeader({ current: root }, { current: header });
  assert.equal(reveal(header), true);
  assert.equal(scroller.scrollTop, 0);
  assert.equal(reveal(input), true);
  assert.equal(scroller.scrollTop, 280);
  assert.equal(field.getBoundingClientRect().bottom, 420);
  assert.equal(reveal({}), false);
  assert.deepEqual(calls, [{ top: 0, behavior: "instant" }, { top: 280, behavior: "instant" }]);
  cleanup?.();
});

test("only the active panel is mounted so native focus cannot enter hidden controls", () => {
  const app = setup();
  assert.equal(app.panels().length, 1);
  assert.equal(app.panels()[0].props["aria-label"], "games");
  app.press(GamepadButton.BUMPER_RIGHT);
  app.press(GamepadButton.BUMPER_RIGHT);
  app.press(GamepadButton.BUMPER_LEFT);
  assert.equal(app.panels().length, 1);
  assert.equal(app.panels()[0].props["aria-label"], "profiles");
  assert.equal(app.panels()[0].props.hidden, undefined);
  assert.deepEqual(app.unmounted, ["games", "profiles", "rgb"]);
  assert.equal(app.mounted.get("profiles"), 2);
});

test("native header buttons choose the displayed neighbors and skip unsupported tabs", () => {
  const app = setup("profiles", ["games", "profiles", "controller", "experimental", "about"]);
  assert.ok(app.buttons().every((button) => button.props.focusable === false));
  assert.deepEqual(app.buttons().map((button) => button.props.onOKActionDescription), ["games", "controller"]);
  app.buttons()[1].props.onClick();
  app.render();
  assert.equal(app.active, "controller");
  app.buttons()[0].props.onClick();
  app.render();
  assert.equal(app.active, "profiles");
  app.buttons()[0].props.onClick();
  app.render();
  app.buttons()[0].props.onClick();
  app.render();
  assert.equal(app.active, "about");
});

test("header arrows switch tabs directly without creating side-icon navigation stops", () => {
  const app = setup("games", ["games", "profiles", "about"]);
  const header = () => app.elements().find((node) => node.props?.role === "navigation")!;
  const direction = (property: string) => {
    const consumed = header().props[property]();
    app.render();
    return consumed;
  };
  assert.equal(header().props.tabIndex, -1);
  assert.equal(header().props.focusable, undefined);
  assert.equal(header().props.onGamepadDirection, undefined);
  assert.equal(direction("onMoveLeft"), true);
  assert.equal(app.active, "about");
  assert.equal(direction("onMoveRight"), true);
  assert.equal(app.active, "games");
  assert.deepEqual(app.focusTargets, []);
});

test("the selected pill is the only native header navigation button", () => {
  const app = setup();
  const header = app.elements().find((node) => node.props?.role === "navigation")!;
  assert.equal(header.props.focusClassName, undefined);
  assert.equal(header.props.onMoveUp, undefined);
  assert.equal(header.props.onCancelButton, undefined);
  assert.equal(header.props.onButtonDown, undefined);
  assert.equal(app.selectedButton().props.focusable, undefined);
  assert.equal(app.selectedButton().props["aria-label"], "games");
  assert.equal(app.selectedButton().props.onOKActionDescription, "games");
  assert.ok(app.buttons().every((button) => button.props.focusable === false));
  assert.equal(app.elements().filter((node) => node.type === "DialogButton").length, 3);
});

test("Down and native selected-button activation enter the current panel after arrow switching", () => {
  const app = setup();
  const header = () => app.elements().find((node) => node.props?.role === "navigation")!;
  header().props.onMoveRight();
  app.render();
  assert.equal(app.active, "profiles");
  assert.deepEqual(app.focusTargets, []);
  assert.equal(header().props.onMoveDown(), true);
  assert.deepEqual(app.focusTargets, ["profiles"]);
  header().props.onMoveRight();
  app.render();
  app.selectedButton().props.onClick();
  assert.equal(app.active, "rgb");
  assert.deepEqual(app.focusTargets, ["profiles", "rgb"]);
});

test("header entry preserves native empty-panel focus for asynchronously loaded tab controls", () => {
  const app = setup("games", ["games", "profiles"], false);
  const header = () => app.elements().find((node) => node.props?.role === "navigation")!;
  header().props.onMoveRight();
  app.render();
  assert.equal(header().props.onMoveDown(), true);
  assert.deepEqual(app.nativeFocus, [{ target: "profiles", button: GamepadButton.DIR_DOWN, empty: true }]);
  assert.equal(app.panels()[0].props.focusableIfEmpty, true);
  assert.equal(app.panels()[0].props.onGamepadFocus, undefined);
});

test("native footer bumper hints name the current visible neighbors", () => {
  const app = setup("games", ["games", "profiles", "controller", "about"]);
  const legend = () => app.elements().find((node) => node.props?.className === "armada-control-tabs")!.props.actionDescriptionMap;
  assert.equal(legend()[GamepadButton.BUMPER_LEFT], "about");
  assert.equal(legend()[GamepadButton.BUMPER_RIGHT], "profiles");
  app.press(GamepadButton.BUMPER_RIGHT);
  assert.equal(legend()[GamepadButton.BUMPER_LEFT], "games");
  assert.equal(legend()[GamepadButton.BUMPER_RIGHT], "controller");
});

test("bumper and header changes navigate immediately to the first native input", () => {
  const app = setup();
  assert.deepEqual(app.focusTargets, []);
  app.press(GamepadButton.BUMPER_RIGHT);
  assert.deepEqual(app.focusTargets, ["profiles"]);
  assert.ok(app.panels().every((panel) => panel.type === "Focusable"
    && panel.props.tabIndex === -1 && panel.props.navEntryPreferPosition === 0 && panel.props.focusableIfEmpty));
  app.buttons()[1].props.onClick();
  app.render();
  assert.deepEqual(app.focusTargets, ["profiles", "rgb"]);
  assert.deepEqual(app.nativeFocus, [
    { target: "profiles", button: GamepadButton.DIR_DOWN, empty: false },
    { target: "rgb", button: GamepadButton.DIR_DOWN, empty: false },
  ]);
});

test("empty panels retain native focus so asynchronously mounted inputs inherit it", () => {
  const app = setup("profiles", ["games", "profiles", "rgb"], false);
  app.press(GamepadButton.BUMPER_RIGHT);
  assert.equal(app.active, "rgb");
  assert.deepEqual(app.focusTargets, ["rgb"]);
  assert.equal(app.panels()[0].props.focusableIfEmpty, true);
  assert.equal(app.panels()[0].props.onGamepadFocus, undefined);
  assert.deepEqual(app.press(GamepadButton.BUMPER_RIGHT), { consumed: true, stopped: true });
  assert.equal(app.active, "games");
  assert.deepEqual(app.focusTargets, ["rgb", "games"]);
  assert.ok(app.nativeFocus.every((entry) => entry.empty));
  const header = app.elements().find((node) => node.props?.role === "navigation")!;
  assert.equal(header.type, "Focusable");
  assert.equal(header.props.navEntryPreferPosition, 0);
});

test("the carousel uses the QAM scroll owner and measures the scoped native title", () => {
  const app = setup();
  assert.equal(app.properties.get("--armada-native-title-height"), "32px");
  assert.equal(app.properties.get("--armada-tab-scroll-inset"), "80px");
  assert.deepEqual(app.observed, [app.nativeTitle, app.header]);
  app.nativeTitle.offsetHeight = 46;
  app.header.offsetHeight = 52;
  app.resize();
  assert.equal(app.properties.get("--armada-native-title-height"), "46px");
  assert.equal(app.properties.get("--armada-tab-scroll-inset"), "98px");
  assert.ok(app.buttons().every((button) => button.props.className.includes("native-no-min-width") && button.props.className.includes("armada-compact-button")));
  assert.ok(app.elements().every((node) => node.props?.children !== "L1" && node.props?.children !== "R1"));
  assert.ok(app.elements().every((node) => node.type !== "ScrollPanel" && node.type !== "ScrollPanelGroup"));
  assert.doesNotMatch(styles, /\b(?:height|max-height):\s*\d+(?:vh|dvh)/);
  assert.doesNotMatch(styles, /armada-tab-panels\s*\{[^}]*overflow/);
  assert.doesNotMatch(styles, /armada-(?:tab-navigation|control-dialog-footer)\s*>\s*button/);
  assert.match(styles, /position:\s*sticky/);
  assert.doesNotMatch(styles, /scroll-margin-block-start/);
  app.unmount();
  assert.equal(app.observerDisconnected, true);
  assert.equal(app.properties.has("--armada-native-title-height"), false);
  assert.equal(app.properties.has("--armada-tab-scroll-inset"), false);
});

test("header indicators are decorative and title sizing does not stretch the pill", () => {
  const app = setup();
  assert.equal(app.elements().filter((node) => node.props?.className === "armada-tab-bumper"
    && node.props["aria-hidden"] === "true").length, 2);
  assert.equal(app.buttons().length, 2);
  const current = app.elements().find((node) => node.props?.className === "armada-tab-current")!;
  assert.equal(current.props["aria-live"], "polite");
  assert.match(styles, /grid-template-columns:\s*auto auto minmax\(0, 1fr\) auto auto/);
  assert.match(styles, /\.armada-tab-title\s*\{[^}]*flex:\s*0 1 auto;[^}]*width:\s*fit-content;[^}]*max-width:\s*100%/);
  assert.match(styles, /\.armada-tab-label\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/);
  assert.match(styles, /\.armada-tab-neighbor:not\(:hover\):not\(:focus\):not\(\.gpfocus\)\s*\{\s*background:\s*TOKEN/);
  assert.match(styles, /\.armada-tab-panels\s*\{[^}]*padding-block-start:\s*TOKEN/);
});

test("tab labels and icons share their typography token independently of native button fonts", () => {
  assert.match(styles, /\.armada-tab-navigation\s*\{[^}]*padding-inline:\s*TOKEN/);
  assert.match(headerStyleSource, /\.armada-tab-title\s*\{[\s\S]*?font-size:\s*\$\{theme\.tabText\};/);
  assert.match(styles, /\.armada-tab-title\s*\{[^}]*font-size:\s*TOKEN;[^}]*text-transform:\s*none/);
  assert.match(styles, /\.armada-compact-button\s*\{[^}]*font-size:\s*inherit/);
  assert.match(headerStyleSource, /\.armada-tab-navigation\s*\{[\s\S]*?padding-inline:\s*\$\{theme\.spaceLarge\}/);
});

test("title pills have shared horizontal padding without reducing native icon button targets", () => {
  assert.match(headerStyleSource, /\.armada-tab-title\s*\{[\s\S]*?padding-block:\s*\$\{theme\.spaceSmall\};\s*padding-inline:\s*\$\{theme\.spaceMedium\}/);
  assert.match(styles, /\.armada-tab-navigation\s*\{[^}]*gap:\s*calc\(TOKEN \/ 4\)/);
  assert.match(headerStyleSource, /\.armada-tab-neighbor \.armada-tab-title,[\s\S]*?padding:\s*\$\{theme\.spaceSmall\}/);
});

test("neighbor tabs round only the side facing the active tab", () => {
  const app = setup();
  const previous = app.elements().find((node) => node.props?.className?.includes("armada-tab-previous"))!;
  const next = app.elements().find((node) => node.props?.className?.includes("armada-tab-next"))!;
  assert.equal(previous.props["data-tab-id"], "about");
  assert.equal(next.props["data-tab-id"], "profiles");
  assert.equal(previous.props.focusable, false);
  assert.equal(next.props.focusable, false);
  assert.match(headerStyleSource, /\.armada-tab-previous\s*\{\s*--armada-tab-corners:\s*0 var\(--armada-tab-pill-radius\) var\(--armada-tab-pill-radius\) 0/);
  assert.match(headerStyleSource, /\.armada-tab-next\s*\{\s*--armada-tab-corners:\s*var\(--armada-tab-pill-radius\) 0 0 var\(--armada-tab-pill-radius\)/);
  assert.match(headerStyleSource, /\.armada-tab-neighbor::before,\s*\.armada-tab-neighbor::after\s*\{\s*border-radius:\s*inherit/);
});

test("header motion follows clicks and bumpers through wrapping and rapid reversals", () => {
  const app = setup();
  const header = () => app.elements().find((node) => node.props?.role === "navigation")!;
  assert.equal(header().props["data-direction"], undefined);
  app.press(GamepadButton.BUMPER_LEFT);
  assert.equal(header().props["data-direction"], -1);
  assert.equal(app.selectedButton().props["data-tab-id"], "about");
  app.buttons()[1].props.onClick();
  app.render();
  assert.equal(header().props["data-direction"], 1);
  assert.equal(app.selectedButton().props["data-tab-id"], "games");
  app.press(GamepadButton.BUMPER_RIGHT);
  app.press(GamepadButton.BUMPER_RIGHT);
  app.press(GamepadButton.BUMPER_LEFT);
  assert.equal(app.active, "profiles");
  assert.equal(header().props["data-direction"], -1);
  assert.equal(app.selectedButton().props["data-tab-id"], "profiles");
  const outgoing = app.elements().filter((node) => node.props?.className === "armada-tab-ghost");
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].props["aria-hidden"], "true");
  assert.ok(allElements(outgoing[0]).every((node) => node.type !== "Focusable" && node.type !== "DialogButton"));
  assert.equal(app.panels().length, 1);
  assert.equal(app.panels()[0].props["aria-label"], "profiles");
  app.render();
  assert.equal(app.selectedButton().props["data-tab-id"], "profiles");
  assert.deepEqual(app.motions, [
    { direction: -1, target: "about" }, { direction: 1, target: "games" },
    { direction: 1, target: "profiles" }, { direction: 1, target: "rgb" }, { direction: -1, target: "profiles" },
  ]);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.armada-tab-navigation\s*\{\s*animation-duration:\s*0s/);
});
