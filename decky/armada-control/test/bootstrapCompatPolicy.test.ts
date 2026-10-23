import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { factoryDefaultTransition } from "../src/lib/protonPolicy.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../src/index.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const queueCompiled = ts.transpileModule(readFileSync(new URL("../src/lib/gameSettingsQueue.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

async function setup(changeBeforeConfigure = false) {
  let revision = 0;
  let start!: () => void;
  let finishSweep!: () => void;
  const sweeping = new Promise<void>((resolve) => { finishSweep = resolve; });
  const migrations: string[][] = [];
  const saved: Array<string | undefined> = [];
  const queue: any = {};
  runInNewContext(queueCompiled, { exports: queue });
  runInNewContext(compiled, {
    exports: {},
    require: (id: string) => {
      if (id === "@decky/api") return { definePlugin: (create: () => any) => create() };
      if (id === "./Content") return { Content: "Content" };
      if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (id === "./backend") return {
        getConfig: async () => ({ tweaks: { global: {}, games: {} }, protonDefaults: ["new-factory"] }),
        getInstalledGames: async () => [],
        getCompatApplied: async () => ({ appids: [], protonDefault: "old-factory" }),
        saveCompatApplied: async (_appids: string[], defaultTool?: string) => { saved.push(defaultTool); },
      };
      if (id === "./lib/steamCompat") return {
        configureCompatPolicy: () => { revision++; },
        getCompatPolicyRevision: () => revision,
        defaultWindowsCompatTool: () => "new-factory",
        getProtonTools: async () => [],
        handledGameAppids: () => [],
        initializeHandledGames: () => {},
        persistHandledGames: (save: (appids: string[]) => Promise<unknown>) => save([]),
        registerDownloadWatcher: () => () => {},
        sweepInstalledGames: () => sweeping,
        migrateWindowsCompatTool: async (_appids: string[], oldTool: string, newTool: string) => {
          migrations.push([oldTool, newTool]);
          revision++;
        },
      };
      if (id === "./lib/protonPolicy") return { factoryDefaultTransition };
      if (id === "./lib/gameSettingsQueue") return queue;
      throw new Error(`Unexpected import ${id}`);
    },
    window: {
      App: { WaitForServicesInitialized: async () => { if (changeBeforeConfigure) revision++; } },
      setTimeout: (callback: () => void) => { start = callback; },
    },
  });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  await settle();
  start();
  await settle();
  return {
    migrations, saved, finishSweep, settle,
    changeGlobal: () => { revision++; },
    block: (pending: Promise<void>) => queue.runGameSettingsMutation(() => pending),
  };
}

test("bootstrap factory migration still runs when the global policy is unchanged", async () => {
  const app = await setup();
  app.finishSweep();
  await app.settle();
  assert.deepEqual(app.migrations, [["old-factory", "new-factory"]]);
  assert.deepEqual(app.saved, ["new-factory"]);
});

test("a user global choice invalidates stale bootstrap work after the installed-game sweep", async () => {
  const app = await setup();
  app.changeGlobal();
  app.finishSweep();
  await app.settle();
  assert.deepEqual(app.migrations, []);
  assert.deepEqual(app.saved, [undefined]);
});

test("a global choice before initial configuration also invalidates the factory migration", async () => {
  const app = await setup(true);
  app.finishSweep();
  await app.settle();
  assert.deepEqual(app.migrations, []);
  assert.deepEqual(app.saved, [undefined]);
});

test("bootstrap checks the revision inside its queue even when a choice changes away and back", async () => {
  const app = await setup();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const blocked = app.block(pending);
  app.finishSweep();
  await app.settle();
  app.changeGlobal();
  app.changeGlobal();
  release();
  await blocked;
  await app.settle();
  assert.deepEqual(app.migrations, []);
  assert.deepEqual(app.saved, [undefined]);
});
