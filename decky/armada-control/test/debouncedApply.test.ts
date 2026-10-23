import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function setup() {
  const source = readFileSync(new URL("../src/hooks/useDebouncedApply.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const timers = new Map<number, () => void>();
  const exports: any = {};
  let slots: any[] = [];
  let cleanup: Array<() => void> = [];
  let cursor = 0;
  let timerId = 0;
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "@decky/api") return { toaster: { toast: () => {} } };
      if (id === "react") return {
        useRef: (value: any) => { const index = cursor++; return slots[index] ??= { current: value }; },
        useEffect: (effect: () => (() => void)) => { cleanup.push(effect()); },
      };
      throw new Error(`Unexpected import: ${id}`);
    },
    window: {
      setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: (id: number) => { timers.delete(id); },
    },
  });
  return {
    mount: (read: () => Promise<any>, show: (value: any) => void, apply: (value: any) => Promise<any>) => {
      slots = [];
      cursor = 0;
      cleanup = [];
      return exports.useDebouncedApply(read, show, apply, "error", 100);
    },
    unmount: () => { for (const close of cleanup) close(); },
    flush: () => { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); },
    read: (reader: () => Promise<any>) => exports.readAfterPendingApplies(reader),
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test("unmount flushes the latest structured RGB update instead of losing it", async () => {
  const app = setup();
  const writes: any[] = [];
  const update = app.mount(async () => null, () => {}, async (value) => { writes.push(value); return value; });
  update({ color: "FF0000", brightness: 20 });
  update({ color: "FF0000", brightness: 70 });
  app.unmount();
  app.flush();
  await app.settle();
  assert.deepEqual(writes, [{ color: "FF0000", brightness: 70 }]);
});

test("reopened panels read after the outgoing panel's pending save", async () => {
  const app = setup();
  let saved = { color: "000000", brightness: 20 };
  let finish!: () => void;
  const update = app.mount(async () => saved, () => {}, (value) => new Promise((resolve) => {
    finish = () => { saved = value; resolve(saved); };
  }));
  update({ color: "FF0000", brightness: 70 });
  app.unmount();
  let loaded = false;
  const next = app.read(async () => { loaded = true; return saved; });
  await app.settle();
  assert.equal(loaded, false);
  finish();
  assert.deepEqual(await next, { color: "FF0000", brightness: 70 });
});

test("late slider responses cannot replace newer edits", async () => {
  const app = setup();
  const shown: number[] = [];
  let finish!: (value: number) => void;
  const update = app.mount(async () => 0, (value) => shown.push(value), (value) => value === 1
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(value));
  update(1);
  app.flush();
  await app.settle();
  update(2);
  app.flush();
  finish(1);
  await app.settle();
  assert.deepEqual(shown, [1, 2, 2]);
});
