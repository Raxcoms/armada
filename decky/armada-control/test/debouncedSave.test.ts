import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(initial = { global: { nice: 0 }, games: {} } as any, recover?: () => Promise<unknown>) {
  const source = readFileSync(new URL("../src/hooks/useDebouncedSave.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: any = {};
  const slots: any[] = [];
  const effects = new Map<number, { dependencies: any[]; cleanup?: () => void }>();
  const timers = new Map<number, () => void>();
  const calls: Array<{ value: any; result: ReturnType<typeof deferred> }> = [];
  const errors: unknown[] = [];
  const snapshot = { current: JSON.stringify(initial) };
  let config: any = { tweaks: structuredClone(initial), marker: "original" };
  let pending: Array<() => void> = [];
  let cursor = 0;
  let timerId = 0;
  let saveNow: (update: (value: any) => any) => Promise<any>;
  const setConfig = (update: any) => { config = typeof update === "function" ? update(config) : update; };
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id !== "react") throw new Error(`Unexpected import: ${id}`);
    return {
      useRef: (initial: any) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useCallback: (callback: any) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = callback;
        return slots[index];
      },
      useEffect: (effect: () => (() => void) | undefined, dependencies: any[]) => {
        const index = cursor++;
        const previous = effects.get(index);
        if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
        pending.push(() => {
          previous?.cleanup?.();
          effects.set(index, { dependencies, cleanup: effect() });
        });
      },
    };
  }, window: {
    setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  } });
  function render() {
    cursor = 0;
    saveNow = exports.useDebouncedSave({ config, field: "tweaks", snapshot, setConfig,
      save: (value: any) => {
        const result = deferred();
        calls.push({ value: structuredClone(value), result });
        return result.promise;
      }, onError: async (error: unknown) => { errors.push(error); await recover?.(); },
    });
    const current = pending;
    pending = [];
    for (const effect of current) effect();
  }
  render();
  return {
    calls, errors, snapshot, render,
    get config() { return config; },
    get timers() { return timers.size; },
    save: (update: (value: any) => any) => saveNow(update),
    edit: (update: (config: any) => any) => { config = update(config); render(); },
    flush: () => { const current = [...timers.values()]; timers.clear(); for (const run of current) run(); },
    succeed: (index: number, tweaks = calls[index].value) => calls[index].result.resolve({ tweaks, marker: "backend" }),
    settle: async () => { await new Promise((resolve) => setImmediate(resolve)); render(); },
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.(); },
  };
}

const changeNice = (nice: number) => (tweaks: any) => ({ ...tweaks, global: { ...tweaks.global, nice } });

test("manual saving cancels debounce and never commits a failed draft", async () => {
  const app = setup();
  const saving = app.save(changeNice(-5));
  const failed = assert.rejects(saving, /save failed/);
  await app.settle();
  assert.equal(app.config.tweaks.global.nice, 0);
  assert.equal(app.calls[0].value.global.nice, -5);
  app.calls[0].result.reject(new Error("save failed"));
  await failed;
  await app.settle();
  assert.equal(app.config.tweaks.global.nice, 0);
  assert.equal(app.timers, 0);
  assert.equal(app.errors.length, 0);
});

test("manual saving waits for an automatic save and computes its update from the latest config", async () => {
  const app = setup();
  app.edit((current) => ({ ...current, tweaks: { ...current.tweaks, global: { ...current.tweaks.global, env: { A: "1" } } } }));
  app.flush();
  await app.settle();
  const saving = app.save(changeNice(-4));
  app.edit((current) => ({ ...current, tweaks: { ...current.tweaks, games: { "1": { name: "Latest game" } } } }));
  await app.settle();
  assert.equal(app.calls.length, 1);
  app.succeed(0);
  await app.settle();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].value.global.env.A, "1");
  assert.equal(app.calls[1].value.games["1"].name, "Latest game");
  assert.equal(app.calls[1].value.global.nice, -4);
  app.succeed(1);
  await saving;
  assert.equal(app.config.tweaks.global.nice, -4);
  assert.equal(app.config.marker, "original");
});

test("successful manual saves merge changed leaves and preserve newer unrelated edits", async () => {
  const app = setup({ global: { nice: 0, scheduler: "old", thunks: { Vulkan: true, GL: true } }, games: { "1": { nice: 1 } } });
  const saving = app.save((tweaks) => {
    delete tweaks.global.scheduler;
    tweaks.global.nice = -3;
    tweaks.global.thunks.Vulkan = false;
    return tweaks;
  });
  await app.settle();
  app.edit((current) => ({ ...current, marker: "newer", tweaks: { ...current.tweaks,
    global: { ...current.tweaks.global, thunks: { ...current.tweaks.global.thunks, GL: false }, env: { NEW: "1" } },
    games: { ...current.tweaks.games, "2": { nice: 2 } },
  } }));
  app.succeed(0);
  await saving;
  assert.equal(app.config.tweaks.global.nice, -3);
  assert.equal("scheduler" in app.config.tweaks.global, false);
  assert.equal(app.config.tweaks.global.thunks.Vulkan, false);
  assert.equal(app.config.tweaks.global.thunks.GL, false);
  assert.equal(app.config.tweaks.global.env.NEW, "1");
  assert.equal(app.config.tweaks.games["2"].nice, 2);
  assert.equal(app.config.marker, "newer");
  assert.equal(app.timers, 1);
  app.flush();
  await app.settle();
  app.succeed(1);
  await app.settle();
});

test("failed manual saves resume pending automatic edits without persisting the failed draft", async () => {
  const app = setup();
  app.edit((current) => ({ ...current, tweaks: { ...current.tweaks, global: { ...current.tweaks.global, env: { KEEP: "1" } } } }));
  assert.equal(app.timers, 1);
  const saving = app.save(changeNice(-7));
  const failed = assert.rejects(saving, /manual failed/);
  assert.equal(app.timers, 0);
  await app.settle();
  app.calls[0].result.reject(new Error("manual failed"));
  await failed;
  assert.equal(app.timers, 1);
  app.flush();
  await app.settle();
  assert.equal(app.calls[1].value.global.nice, 0);
  assert.equal(app.calls[1].value.global.env.KEEP, "1");
  app.succeed(1);
  await app.settle();
});

test("automatic saves preserve edits made during their request and stop retrying identical failures", async () => {
  const app = setup();
  app.edit((current) => ({ ...current, tweaks: changeNice(-1)(current.tweaks) }));
  app.flush();
  await app.settle();
  app.edit((current) => ({ ...current, tweaks: changeNice(-2)(current.tweaks) }));
  app.succeed(0, { global: { nice: -1, normalized: true }, games: {} });
  await app.settle();
  assert.equal(app.config.tweaks.global.nice, -2);
  assert.equal(app.config.tweaks.global.normalized, true);
  app.flush();
  await app.settle();
  app.calls[1].result.reject(new Error("auto failed"));
  await app.settle();
  assert.equal(app.errors.length, 1);
  assert.equal(app.timers, 0);
});

test("queued manual saves run in order and use the preceding confirmed result", async () => {
  const app = setup();
  const first = app.save(changeNice(-1));
  const second = app.save((tweaks) => ({ ...tweaks, global: { ...tweaks.global, scheduler: `after-${tweaks.global.nice}` } }));
  await app.settle();
  assert.equal(app.calls.length, 1);
  app.succeed(0);
  await first;
  await app.settle();
  assert.equal(app.calls[1].value.global.nice, -1);
  assert.equal(app.calls[1].value.global.scheduler, "after--1");
  app.succeed(1);
  await second;
  assert.equal(app.config.tweaks.global.scheduler, "after--1");
  assert.equal(app.timers, 0);
});

test("a newer edit to the same setting survives a completed manual save", async () => {
  const app = setup();
  const saving = app.save(changeNice(-4));
  await app.settle();
  app.edit((current) => ({ ...current, tweaks: changeNice(-8)(current.tweaks) }));
  app.succeed(0);
  await saving;
  assert.equal(app.config.tweaks.global.nice, -8);
  assert.equal(app.timers, 1);
  app.unmount();
  assert.equal(app.timers, 0);
});

test("manual saves wait for automatic failure recovery before reading their baseline", async () => {
  const recovery = deferred();
  const app = setup(undefined, () => recovery.promise);
  app.edit((current) => ({ ...current, tweaks: changeNice(-1)(current.tweaks) }));
  app.flush();
  await app.settle();
  app.calls[0].result.reject(new Error("automatic failed"));
  await app.settle();
  const saving = app.save((tweaks) => ({ ...tweaks, global: { ...tweaks.global, nice: tweaks.global.nice - 2 } }));
  await app.settle();
  assert.equal(app.calls.length, 1);
  app.edit((current) => ({ ...current, tweaks: changeNice(0)(current.tweaks) }));
  recovery.resolve(undefined);
  await app.settle();
  assert.equal(app.calls[1].value.global.nice, -2);
  app.succeed(1);
  await saving;
  assert.equal(app.config.tweaks.global.nice, -2);
});
