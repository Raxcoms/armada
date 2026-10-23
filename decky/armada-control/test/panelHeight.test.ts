import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { findScrollParent } from "../src/lib/scrollRegion.ts";

const property = "--armada-panel-available-height";

function setup({ scale = 1, scrollTop = 0, overflow = "auto", missingRoot = false } = {}) {
  const values = new Map<string, string>([["color", "white"]]);
  const writes: string[] = [];
  const observers: Array<{ observed: unknown[]; disconnected: boolean; resize: () => void }> = [];
  const document: any = { body: {}, documentElement: {} };
  document.defaultView = {
    getComputedStyle: (element: any) => element.computed,
    ResizeObserver: class {
      observed: unknown[] = [];
      disconnected = false;
      resize: () => void;
      constructor(resize: () => void) { this.resize = resize; observers.push(this); }
      observe(element: unknown) { this.observed.push(element); }
      disconnect() { this.disconnected = true; }
    },
  };
  const layout = { offset: 48, scale };
  const scroller: any = {
    ownerDocument: document, parentElement: document.body,
    computed: { overflowY: overflow },
    clientHeight: 500, offsetHeight: 504, clientTop: 2, scrollTop,
    getBoundingClientRect: () => ({ top: 20, height: scroller.offsetHeight * layout.scale }),
  };
  const wrapper: any = {
    ownerDocument: document, parentElement: scroller, computed: { overflowY: "visible" },
  };
  const root: any = {
    ownerDocument: document, parentElement: wrapper,
    getBoundingClientRect: () => ({
      top: 20 + (layout.offset - scroller.scrollTop + scroller.clientTop) * layout.scale,
    }),
    style: {
      setProperty: (key: string, value: string) => { writes.push(key); values.set(key, value); },
      removeProperty: (key: string) => { writes.push(key); values.delete(key); },
    },
  };
  let cleanup: (() => void) | undefined;
  const exports: any = {};
  const compiled = ts.transpileModule(readFileSync(new URL("../src/hooks/usePanelHeight.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "react") return { useLayoutEffect: (effect: () => (() => void) | undefined) => { cleanup = effect(); } };
    if (id === "../lib/scrollRegion") return { findScrollParent };
    throw new Error(`Unexpected import: ${id}`);
  } });
  exports.usePanelHeight({ current: missingRoot ? null : root });
  return { values, writes, observers, layout, scroller, wrapper, root, cleanup: () => cleanup?.() };
}

test("panel height fills the native viewport below its title without changing other styles", () => {
  const panel = setup();
  assert.equal(panel.values.get(property), "452px");
  assert.equal(panel.values.get("color"), "white");
  assert.deepEqual(panel.writes, [property]);
  assert.deepEqual(panel.observers[0].observed, [panel.wrapper, panel.scroller]);
  assert.equal(panel.observers[0].observed.includes(panel.root), false);
});

test("native viewport and title resizing update the available height", () => {
  const panel = setup();
  panel.scroller.clientHeight = 620;
  panel.observers[0].resize();
  assert.equal(panel.values.get(property), "572px");
  panel.layout.offset = 72;
  panel.observers[0].resize();
  assert.equal(panel.values.get(property), "548px");
  panel.layout.offset = 800;
  panel.observers[0].resize();
  assert.equal(panel.values.get(property), "0px");
});

test("scaled viewport measurements retain native CSS pixel sizing", () => {
  const panel = setup({ scale: 1.5 });
  assert.equal(panel.values.get(property), "452px");
  panel.layout.scale = 2;
  panel.observers[0].resize();
  assert.equal(panel.values.get(property), "452px");
});

test("an existing scroll offset does not turn hidden title space into extra panel height", () => {
  const panel = setup({ scrollTop: 120, scale: 1.5 });
  assert.equal(panel.values.get(property), "452px");
  assert.equal(panel.scroller.scrollTop, 120);
  panel.scroller.scrollTop = 240;
  panel.observers[0].resize();
  assert.equal(panel.values.get(property), "452px");
  assert.equal(panel.scroller.scrollTop, 240);
});

test("missing roots and native scroll parents keep the CSS fallback without an observer", () => {
  for (const options of [{ missingRoot: true }, { overflow: "visible" }]) {
    const panel = setup(options);
    assert.deepEqual(panel.writes, []);
    assert.equal(panel.observers.length, 0);
    panel.cleanup();
  }
});

test("the owning window supplies observation and cleanup removes only the measured property", () => {
  const panel = setup();
  assert.equal(panel.observers.length, 1);
  panel.cleanup();
  assert.equal(panel.observers[0].disconnected, true);
  assert.equal(panel.values.has(property), false);
  assert.equal(panel.values.get("color"), "white");
  assert.deepEqual(panel.writes, [property, property]);
});
