import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function setup(read: () => Promise<any>, separateWindow = false, cached = false) {
  const compiled = ts.transpileModule(readFileSync(new URL("../src/hooks/useBackendState.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const slots: any[] = [];
  const effects = new Map<number, { dependencies: any[]; cleanup?: () => void }>();
  const listeners = new Map<string, () => void>();
  let pending: Array<() => void> = [];
  let cursor = 0;
  let state: any;
  let paused = false;
  const react = {
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: (callback: any, dependencies: any[]) => {
      const index = cursor++;
      if (!slots[index] || !dependencies.every((value, i) => Object.is(value, slots[index].dependencies[i]))) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect: (effect: () => (() => void), dependencies: any[]) => {
      const index = cursor++;
      const previous = effects.get(index);
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      pending.push(() => { previous?.cleanup?.(); effects.set(index, { dependencies, cleanup: effect() }); });
    },
  };
  const events = {
    hidden: false,
    addEventListener: (name: string, listener: () => void) => { listeners.set(name, listener); },
    removeEventListener: (name: string) => { listeners.delete(name); },
    setInterval: (listener: () => void) => { listeners.set("tick", listener); return 1; },
    clearInterval: () => { listeners.delete("tick"); },
  };
  const exports: any = {};
  Object.assign(events, { document: events });
  const host = separateWindow ? { current: { ownerDocument: { defaultView: events } } } : undefined;
  const fallback = separateWindow ? {
    document: { hidden: true },
    addEventListener: () => { throw new Error("Use the rendered window's events"); },
    setInterval: () => { throw new Error("Use the rendered window's timers"); },
  } : events;
  runInNewContext(compiled, { exports, window: fallback, document: fallback.document, require: () => react });
  function render() {
    cursor = 0;
    state = exports.useBackendState(read, 10000, paused, host, cached);
    const next = pending;
    pending = [];
    next.forEach((effect) => effect());
  }
  render();
  return {
    get state() { return state; }, events, listeners, render,
    pause: (value: boolean) => { paused = value; render(); },
    emit: (name: string) => { listeners.get(name)?.(); },
    settle: async () => { await new Promise((resolve) => setImmediate(resolve)); render(); },
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.(); },
    remount: (nextRead = read) => {
      for (const effect of effects.values()) effect.cleanup?.();
      slots.length = 0;
      effects.clear();
      read = nextRead;
      render();
    },
    changeRead: (nextRead: typeof read) => { read = nextRead; render(); },
  };
}

test("shared backend state refreshes configuration on focus and polling", async () => {
  let directory = "/first";
  const app = setup(async () => ({ directory }));
  await app.settle();
  assert.equal(app.state.value.directory, "/first");
  directory = "/changed";
  app.emit("focus");
  await app.settle();
  assert.equal(app.state.value.directory, "/changed");
  app.events.hidden = true;
  directory = "/hidden";
  app.emit("tick");
  await app.settle();
  assert.equal(app.state.value.directory, "/changed");
  app.events.hidden = false;
  app.emit("visibilitychange");
  await app.settle();
  assert.equal(app.state.value.directory, "/hidden");
  app.unmount();
  assert.equal(app.listeners.size, 0);
});

test("saved changes and paused writes reject older read responses", async () => {
  let finish!: (value: any) => void;
  const app = setup(() => new Promise((resolve) => { finish = resolve; }));
  app.state.setValue({ enabled: true });
  finish({ enabled: false });
  await app.settle();
  assert.equal(app.state.value.enabled, true);
  app.pause(true);
  app.emit("tick");
  await app.settle();
  assert.equal(app.state.value.enabled, true);
});

test("configuration refresh uses the visible QAM window rather than the hidden shared context", async () => {
  let reads = 0;
  const app = setup(async () => ++reads, true);
  await app.settle();
  app.emit("tick");
  await app.settle();
  assert.equal(app.state.value, 2);
  app.unmount();
  assert.equal(app.listeners.size, 0);
});

test("failed refreshes retain the last good state and can recover", async () => {
  let failing = false;
  const app = setup(async () => { if (failing) throw new Error("unavailable"); return { directory: "/logs" }; });
  await app.settle();
  failing = true;
  app.emit("focus");
  await app.settle();
  assert.equal(app.state.value.directory, "/logs");
  assert.match(app.state.error, /unavailable/);
  failing = false;
  await app.state.refresh();
  app.render();
  assert.equal(app.state.error, "");
});

test("opt-in cache reopens on the last confirmed state and still refreshes changed configuration", async () => {
  let directory = "/first";
  const app = setup(async () => ({ directory }), false, true);
  assert.equal(app.state.value, null);
  await app.settle();
  directory = "/changed";
  app.remount();
  assert.equal(app.state.value.directory, "/first");
  await app.settle();
  assert.equal(app.state.value.directory, "/changed");
});

test("cached state is isolated by read function even when the reader changes before a remount", async () => {
  const first = async () => ({ directory: "/first" });
  let finish!: (value: any) => void;
  const second = () => new Promise((resolve) => { finish = resolve; });
  const app = setup(first, false, true);
  await app.settle();
  app.changeRead(second);
  assert.equal(app.state.value, null);
  finish({ directory: "/second" });
  await app.settle();
  app.remount(first);
  assert.equal(app.state.value.directory, "/first");
});

test("an unmounted stale response cannot replace a newer cached read", async () => {
  let calls = 0;
  let finish!: (value: any) => void;
  const app = setup(() => ++calls === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({ enabled: true }), false, true);
  app.remount();
  await app.settle();
  finish({ enabled: false });
  await app.settle();
  app.remount();
  assert.equal(app.state.value.enabled, true);
});

test("confirmed mutations update cached state and reject a pending older read", async () => {
  let calls = 0;
  let finish!: (value: any) => void;
  const app = setup(() => ++calls === 1 ? Promise.resolve({ enabled: true }) : new Promise((resolve) => { finish = resolve; }), false, true);
  await app.settle();
  app.emit("focus");
  app.state.setValue((current: any) => ({ ...current, enabled: false }));
  finish({ enabled: true });
  await app.settle();
  app.remount();
  assert.equal(app.state.value.enabled, false);
});

test("refresh failures retain cached data and a first-load failure does not populate it", async () => {
  let failing = false;
  const app = setup(async () => { if (failing) throw new Error("read failed"); return { directory: "/logs" }; }, false, true);
  await app.settle();
  failing = true;
  app.emit("focus");
  await app.settle();
  assert.equal(app.state.value.directory, "/logs");
  assert.match(app.state.error, /read failed/);
  app.remount();
  assert.equal(app.state.value.directory, "/logs");
  app.remount(async () => { throw new Error("different endpoint failed"); });
  await app.settle();
  assert.equal(app.state.value, null);
  assert.match(app.state.error, /different endpoint failed/);
});

test("an older unmounted mutation callback cannot replace a newer cache owner", async () => {
  const app = setup(async () => ({ enabled: true }), false, true);
  await app.settle();
  const oldSetValue = app.state.setValue;
  app.remount();
  await app.settle();
  oldSetValue({ enabled: false });
  app.remount();
  assert.equal(app.state.value.enabled, true);
});
