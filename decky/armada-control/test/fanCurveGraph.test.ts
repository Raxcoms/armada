import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as fanCurve from "../src/lib/fanCurve.ts";
import { clamp } from "../src/lib/util.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../src/components/FanCurveGraph.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const GamepadButton = { BUMPER_LEFT: 5, BUMPER_RIGHT: 6, DIR_UP: 9, DIR_DOWN: 10, DIR_LEFT: 11, DIR_RIGHT: 12 };

function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...elements(tree.props?.children)];
}

function setup(initialDisabled = false) {
  let disabled = initialDisabled;
  let points = [{ temp: 40, pwm: 50 }, { temp: 70, pwm: 100 }];
  const writes: typeof points[] = [];
  const slots: any[] = [];
  let cursor = 0;
  let dirty = false;
  let pendingEffects: Array<() => void> = [];
  let tree: any;
  const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 280, height: 170 }) };
  const react = {
    useRef: (value: any) => {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useState: (value: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], (next: any) => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(slots[index], value)) { slots[index] = value; dirty = true; }
      }];
    },
    useMemo: (callback: () => any) => { cursor++; return callback(); },
    useEffect: (callback: () => void, dependencies: any[]) => {
      const index = cursor++;
      if (slots[index] && dependencies.every((value, i) => Object.is(value, slots[index][i]))) return;
      slots[index] = dependencies;
      pendingEffects.push(callback);
    },
  };
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: (type: string, props: any) => ({ type, props }), jsxs: (type: string, props: any) => ({ type, props }) };
    if (id === "@decky/ui") return { Focusable: "Focusable", GamepadButton };
    if (id === "../i18n") return { t: (key: string) => key };
    if (id === "../lib/fanCurve") return fanCurve;
    if (id === "../lib/util") return { clamp };
    throw new Error(`Unexpected import: ${id}`);
  } });
  function render() {
    do {
      dirty = false;
      cursor = 0;
      tree = exports.FanCurveGraph({ points, disabled, onChange: (next: typeof points) => { writes.push(next); points = next; } });
      elements(tree).find((element) => element.type === "svg").props.ref.current = svg;
      const effects = pendingEffects;
      pendingEffects = [];
      effects.forEach((callback) => callback());
    } while (dirty);
  }
  render();
  return {
    render, writes,
    root: () => tree.props,
    circles: () => elements(tree).filter((element) => element.props?.className === "armada-fan-graph-hit-target"),
    activePoints: () => elements(tree).filter((element) => element.props?.className === "armada-fan-graph-point" && element.props["data-active"]),
    disable: (value: boolean) => { disabled = value; render(); },
  };
}

function button(button: number) {
  const event = { detail: { button }, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  return event;
}

function pointer() {
  let captured = false;
  let captures = 0;
  let releases = 0;
  return {
    currentTarget: {
      setPointerCapture: () => { captured = true; captures++; },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => { captured = false; releases++; },
    },
    pointerId: 1, clientX: 150, clientY: 70,
    captures: () => captures, releases: () => releases,
  };
}

test("disabled graphs expose native accessibility state and do not capture controller navigation", () => {
  const app = setup(true);
  assert.equal(app.root().focusable, false);
  assert.equal(app.root()["aria-disabled"], true);
  app.root().onOKButton();
  app.render();
  assert.equal(app.root().onCancelButton, undefined);
  assert.equal(app.root().onButtonDown, undefined);
  assert.equal(app.root().onGamepadDirection, undefined);
  assert.equal(app.root().onOKActionDescription, undefined);
  assert.equal(app.root().onCancelActionDescription, undefined);
  assert.equal(app.activePoints().length, 0);
});

test("disabled graphs cannot start or commit pointer edits", () => {
  const app = setup(true);
  const event = pointer();
  app.circles()[0].props.onPointerDown(event);
  app.circles()[0].props.onPointerMove(event);
  app.circles()[0].props.onPointerUp(event);
  assert.equal(event.captures(), 0);
  assert.equal(app.writes.length, 0);
});

test("disabling during a drag releases capture and discards the temporary points", () => {
  const app = setup();
  const event = pointer();
  app.circles()[0].props.onPointerDown(event);
  app.circles()[0].props.onPointerMove(event);
  app.render();
  assert.equal(event.captures(), 1);
  assert.equal(app.activePoints().length, 1);
  app.disable(true);
  assert.equal(event.releases(), 1);
  app.circles()[0].props.onPointerUp(event);
  app.disable(false);
  app.circles()[0].props.onPointerUp(event);
  assert.equal(app.activePoints().length, 0);
  assert.equal(app.writes.length, 0);
});

test("controller editing stops when disabled and does not resume after re-enabling", () => {
  const app = setup();
  app.root().onOKButton();
  app.render();
  const direction = button(GamepadButton.DIR_UP);
  app.root().onGamepadDirection(direction);
  app.render();
  assert.equal(direction.prevented, true);
  assert.equal(direction.stopped, true);
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0][0].pwm, 55);
  app.disable(true);
  app.disable(false);
  assert.equal(app.root().focusable, true);
  assert.equal(app.root().onCancelButton, undefined);
  assert.equal(app.root().onGamepadDirection, undefined);
  assert.equal(app.root().onButtonDown, undefined);
  assert.equal(app.root().onOKActionDescription, "fanCurve.editPoint");
});

test("enabled pointer edits still commit and release capture", () => {
  const app = setup();
  const event = pointer();
  app.circles()[0].props.onPointerDown(event);
  app.circles()[0].props.onPointerMove(event);
  app.circles()[0].props.onPointerUp(event);
  assert.equal(event.releases(), 1);
  assert.equal(app.writes.length, 1);
  assert.notEqual(app.writes[0][0].temp, 40);
});
