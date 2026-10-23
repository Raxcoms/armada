import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as protonPolicy from "../src/lib/protonPolicy.ts";
import * as compatTools from "../src/lib/compatTools.ts";
import * as settingsQueue from "../src/lib/gameSettingsQueue.ts";

const experimental = "proton-experimental-arm64";
const stable = "proton_11-arm64";
const source = readFileSync(new URL("../src/lib/steamCompat.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const bootstrapCompiled = ts.transpileModule(readFileSync(new URL("../src/index.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup(tools = [experimental, stable]) {
  const details = new Map<number, any>();
  const types = new Map<number, number>();
  const listeners = new Map<number, Set<(value: any) => void>>();
  const writes: Array<[number, string]> = [];
  const launchWrites: number[] = [];
  const exports: any = {};
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "./protonPolicy") return protonPolicy;
      if (id === "./compatTools") return compatTools;
      if (id === "./gameSettingsQueue") return settingsQueue;
      if (id === "./compatManager") return {
        getCompatManagerTools: async () => { throw new Error("Discovery unavailable"); },
      };
      throw new Error(`Unexpected import: ${id}`);
    },
    window: {
      setTimeout, clearTimeout, setInterval, clearInterval,
      appStore: { GetAppOverviewByAppID: (appid: number) => ({ app_type: types.get(appid) ?? 1 }) },
      SteamClient: {
        Settings: { GetGlobalCompatTools: async () => tools.map((name) => ({ name })) },
        Apps: {
          RegisterForAppDetails: (appid: number, callback: (value: any) => void) => {
            const callbacks = listeners.get(appid) || new Set();
            listeners.set(appid, callbacks);
            callbacks.add(callback);
            callback(details.get(appid));
            return { unregister: () => callbacks.delete(callback) };
          },
          SpecifyCompatTool: async (appid: number, name: string) => {
            writes.push([appid, name]);
            const current = details.get(appid);
            current.strCompatToolName = name || stable;
            current.nCompatToolPriority = name ? 250 : 0;
            for (const callback of listeners.get(appid) || []) callback(current);
          },
          SetAppLaunchOptions: async (appid: number) => { launchWrites.push(appid); },
        },
      },
    },
  });
  function game(appid: number, tool = stable, priority = 0, type = 1) {
    types.set(appid, type);
    details.set(appid, { strCompatToolName: tool, nCompatToolPriority: priority });
    return { appid: String(appid) };
  }
  return { api: exports as typeof import("../src/lib/steamCompat.ts"), game, writes, launchWrites };
}

function bootstrap(
  api: ReturnType<typeof setup>["api"], installed: Promise<any[]>, config: any,
  history: string[] = [], readHistory: Promise<void> = Promise.resolve(),
) {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  let storedAppids = [...history];
  let plugin: any;
  const save = async (appids: string[]) => { storedAppids = [...appids]; finish(); };
  runInNewContext(bootstrapCompiled, {
    exports: {},
    require: (id: string) => {
      if (id === "@decky/api") return { definePlugin: (create: () => any) => { plugin = create(); return plugin; } };
      if (id === "./Content") return { Content: "Content" };
      if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      if (id === "./backend") return {
        getConfig: async () => config,
        getInstalledGames: () => installed,
        getCompatApplied: async () => { await readHistory; return { appids: history, protonDefault: experimental }; },
        saveCompatApplied: save,
      };
      if (id === "./lib/steamCompat") return api;
      if (id === "./lib/protonPolicy") return protonPolicy;
      if (id === "./lib/gameSettingsQueue") return settingsQueue;
      throw new Error(`Unexpected import: ${id}`);
    },
    window: {
      App: { WaitForServicesInitialized: async () => {} },
      setTimeout: (callback: () => void) => { queueMicrotask(callback); },
    },
  });
  return { finished, save, unmount: () => plugin.onDismount(), get storedAppids() { return storedAppids; } };
}

test("delayed startup preserves a new Follow Steam choice and untouched saved policies", async () => {
  const { api, game, writes } = setup();
  const games = [game(1), game(2), game(3)];
  let release!: (games: any[]) => void;
  const installed = new Promise<any[]>((resolve) => { release = resolve; });
  const startup = bootstrap(api, installed, {
    tweaks: {
      global: { windowsCompatTool: experimental },
      games: { "2": { enabled: true, steamCompatTool: api.FOLLOW_STEAM_COMPAT } },
    },
    protonDefaults: [experimental],
  });
  await settingsQueue.runGameSettingsMutation(async () => {
    await api.specifyCompatTool("1", api.FOLLOW_STEAM_COMPAT);
    api.updateGameCompatProfile("1", { enabled: true, steamCompatTool: api.FOLLOW_STEAM_COMPAT });
    api.markCompatHandled("1");
  });
  release(games);
  await startup.finished;
  assert.deepEqual(writes, [[1, ""], [3, experimental]]);
  assert.deepEqual(Array.from(api.handledGameAppids()), ["1", "2", "3"]);
});

test("cancelled inventory startup does not overwrite handled game history with an early edit", async () => {
  const { api } = setup();
  let releaseInventory!: (games: any[]) => void;
  const inventory = new Promise<any[]>((resolve) => { releaseInventory = resolve; });
  const startup = bootstrap(api, inventory, {
    tweaks: { global: { windowsCompatTool: experimental }, games: {} }, protonDefaults: [experimental],
  }, ["90", "91"]);
  api.markCompatHandled("1");
  await api.persistHandledGames(startup.save);
  startup.unmount();
  releaseInventory([]);
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.deepEqual(startup.storedAppids, ["1", "90", "91"]);
});

test("pending history persistence does not block game edits or need an installed-game inventory", async () => {
  const { api } = setup();
  let releaseHistory!: () => void;
  const history = new Promise<void>((resolve) => { releaseHistory = resolve; });
  let releaseInventory!: (games: any[]) => void;
  const inventory = new Promise<any[]>((resolve) => { releaseInventory = resolve; });
  const startup = bootstrap(api, inventory, {
    tweaks: { global: { windowsCompatTool: experimental }, games: {} }, protonDefaults: [experimental],
  }, ["90", "91"], history);
  let persistence!: Promise<void>;
  await settingsQueue.runGameSettingsMutation(async () => {
    api.markCompatHandled("1");
    persistence = api.persistHandledGames(startup.save);
  });
  api.markCompatHandled("2");
  assert.deepEqual(startup.storedAppids, ["90", "91"]);
  startup.unmount();
  releaseHistory();
  await persistence;
  releaseInventory([]);
  assert.deepEqual(startup.storedAppids, ["1", "2", "90", "91"]);
});

test("failed history reads cannot replace unknown saved IDs", async () => {
  const { api } = setup();
  let writes = 0;
  api.markCompatHandled("1");
  const pending = api.persistHandledGames(async () => { writes++; });
  api.initializeHandledGames(null);
  await pending;
  await api.persistHandledGames(async () => { writes++; });
  assert.equal(writes, 0);
});

test("failed history reads keep automatic changes disabled even after an early user choice", async () => {
  const { api, game, writes, launchWrites } = setup();
  api.setAutoApplyCompat(true);
  api.initializeHandledGames(null);
  api.configureCompatPolicy(experimental, false, [], [experimental]);
  await api.sweepInstalledGames([game(1)]);
  api.setAutoApplyCompat(true);
  await api.sweepInstalledGames([game(1), game(2)]);
  assert.deepEqual(writes, []);
  assert.deepEqual(launchWrites, [1, 1, 2]);
  await api.resetCompatToolToDefault("2", [], true);
  assert.deepEqual(writes, [[2, ""], [2, experimental]]);
});

test("post-startup persistence uses the pruned current IDs rather than the original history", async () => {
  const { api, game } = setup();
  api.initializeHandledGames(["90", "91"]);
  api.markCompatHandled("1");
  api.configureCompatPolicy(api.FOLLOW_STEAM_COMPAT, true, ["90", "91"], [experimental]);
  await api.sweepInstalledGames([game(1)]);
  api.initializeHandledGames(["90", "91"]);
  let saved: string[] = [];
  await api.persistHandledGames(async (appids) => { saved = [...appids]; });
  assert.deepEqual(saved, ["1"]);
});

test("handled history saves finish in order and snapshot IDs when their turn starts", async () => {
  const { api } = setup();
  api.initializeHandledGames([]);
  api.markCompatHandled("1");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const writes: string[][] = [];
  const first = api.persistHandledGames(async (appids) => {
    await pending;
    writes.push([...appids]);
  });
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  const latest = api.persistHandledGames(async (appids) => { writes.push([...appids]); });
  api.markCompatHandled("2");
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  assert.deepEqual(writes, []);
  release();
  await Promise.all([first, latest]);
  assert.deepEqual(writes, [["1"], ["1", "2"]]);
});

test("failed history saves do not block later IDs or factory default metadata", async () => {
  const { api } = setup();
  api.initializeHandledGames(["1"]);
  const first = api.persistHandledGames(async () => { throw new Error("write failed"); });
  const failure = assert.rejects(first, /write failed/);
  let saved: { appids: string[]; protonDefault: string } | undefined;
  const stamp = api.persistHandledGames(async (appids) => {
    saved = { appids: [...appids], protonDefault: experimental };
  });
  api.markCompatHandled("2");
  await Promise.all([failure, stamp]);
  assert.deepEqual(saved, { appids: ["1", "2"], protonDefault: experimental });
});

test("startup merges partial game edits with saved profile settings", async () => {
  const { api, game, writes } = setup();
  game(1, stable, 250);
  api.updateGameCompatProfile("1", { enabled: false });
  api.configureCompatPolicy(stable, true, [], [experimental], { "1": { steamCompatTool: stable } });
  api.updateGameCompatProfile("1", { enabled: true });
  await api.migrateWindowsCompatTool(["1"], stable, experimental);
  assert.deepEqual(writes, []);
});

test("startup preserves game deletion and does not restore a deleted profile after another edit", async () => {
  const { api, game, writes } = setup();
  game(1, stable, 250);
  game(2, stable, 250);
  api.updateGameCompatProfile("1", null);
  api.updateGameCompatProfile("1", { enabled: true });
  api.configureCompatPolicy(stable, true, [], [experimental], {
    "1": { steamCompatTool: stable }, "2": { steamCompatTool: stable },
  });
  await api.migrateWindowsCompatTool(["1", "2"], stable, experimental);
  assert.deepEqual(writes, [[1, experimental]]);
});

test("a complete profile replacement before startup excludes stale saved profiles", async () => {
  const { api, game, writes } = setup();
  for (const appid of [1, 2, 3]) game(appid, stable, 250);
  api.updateGameCompatProfile("1", { steamCompatTool: stable });
  api.setGameCompatProfiles({ "2": { steamCompatTool: stable } });
  api.configureCompatPolicy(stable, true, [], [experimental], {
    "1": { steamCompatTool: stable }, "3": { steamCompatTool: stable },
  });
  await api.migrateWindowsCompatTool(["1", "2", "3"], stable, experimental);
  assert.deepEqual(writes, [[1, experimental], [3, experimental]]);
});

test("a full game reset before startup does not restore saved profile protection", async () => {
  const { api, game, writes } = setup();
  game(1, stable, 250);
  api.setGameCompatProfiles({});
  api.configureCompatPolicy(stable, true, [], [experimental], { "1": { steamCompatTool: stable } });
  await api.migrateWindowsCompatTool(["1"], stable, experimental);
  assert.deepEqual(writes, [[1, experimental]]);
});

test("startup preserves early global tool and auto-apply choices", async () => {
  const global = setup();
  global.game(1, experimental, 250);
  global.api.setWindowsCompatTool(global.api.FOLLOW_STEAM_COMPAT);
  global.api.configureCompatPolicy(experimental, true, [], [experimental]);
  await global.api.resetCompatToolToDefault("1", undefined, true);
  assert.deepEqual(global.writes, [[1, ""]]);

  const automatic = setup();
  automatic.api.setAutoApplyCompat(false);
  automatic.api.configureCompatPolicy(experimental, true, [], [experimental]);
  await automatic.api.sweepInstalledGames([automatic.game(1)]);
  assert.deepEqual(automatic.writes, []);
  automatic.api.setAutoApplyCompat(true);
  await automatic.api.sweepInstalledGames([automatic.game(1), automatic.game(2)]);
  assert.deepEqual(automatic.writes, [[2, experimental]]);
});

test("subsequent configuration replaces policies without retaining startup-only edits", async () => {
  const { api, game, writes } = setup();
  game(1, stable, 250);
  api.updateGameCompatProfile("1", { steamCompatTool: stable });
  api.configureCompatPolicy(stable, true, [], [experimental]);
  api.configureCompatPolicy(stable, true, [], [experimental]);
  await api.migrateWindowsCompatTool(["1"], stable, experimental);
  assert.deepEqual(writes, [[1, experimental]]);
});

test("global Follow Steam leaves new games and existing overrides alone, while adding the launch wrapper", async () => {
  const { api, game, writes, launchWrites } = setup();
  api.configureCompatPolicy(api.FOLLOW_STEAM_COMPAT, true, [], [experimental]);
  await api.sweepInstalledGames([game(1), game(2, experimental, 250), game(3, "steamlinuxruntime")]);
  assert.deepEqual(writes, []);
  assert.deepEqual(launchWrites.sort(), [1, 2, 3]);
  assert.deepEqual(Array.from(api.handledGameAppids()), ["1", "2", "3"]);
  assert.equal(protonPolicy.factoryDefaultTransition(api.FOLLOW_STEAM_COMPAT, true, stable, experimental), null);
});

test("changing a named default to Follow Steam clears only matching game pins", async () => {
  const { api, game, writes } = setup();
  game(1, experimental, 250);
  game(2, stable, 250);
  game(3, experimental, 0);
  game(4, experimental, 250, 4);
  api.configureCompatPolicy(experimental, true, [], [experimental]);
  await api.migrateWindowsCompatTool(["1", "2", "3", "4"], experimental, api.FOLLOW_STEAM_COMPAT);
  assert.deepEqual(writes, [[1, ""]]);
});

test("Follow Steam can clear known pins to a missing default without tool discovery", async () => {
  const { api, game, writes } = setup([]);
  game(1, "", 0);
  game(2, stable, 250);
  game(3, "", 0);
  await api.migrateWindowsCompatTool(["1", "2", "3"], "removed-proton", api.FOLLOW_STEAM_COMPAT, ["1", "2"]);
  assert.deepEqual(writes, [[1, ""]]);
});

test("Use Default clears the mapping when the global choice is Follow Steam", async () => {
  const { api, game, writes } = setup();
  game(1, experimental, 250);
  await api.specifyCompatTool("1", api.FOLLOW_STEAM_COMPAT);
  assert.deepEqual(writes, [[1, ""]]);
  assert.equal(api.compatSelection({ tool: stable, priority: 0 }, api.FOLLOW_STEAM_COMPAT), api.FOLLOW_STEAM_COMPAT);
});

test("Follow global reports unavailable default tools without clearing the current mapping", async () => {
  const { api, game, writes } = setup([]);
  game(1, "missing-proton", 250);
  api.configureCompatPolicy("missing-proton", true, [], [experimental]);
  await assert.rejects(api.resetCompatToolToDefault("1", undefined, true), /unavailable/);
  assert.deepEqual(writes, []);
});

test("current profile policy protects restored explicit choices from queued global migrations", async () => {
  const { api, game, writes } = setup();
  game(1, stable, 250);
  api.configureCompatPolicy(stable, true, ["1"], [stable], { "1": { enabled: false, steamCompatTool: stable } });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const restoring = settingsQueue.runGameSettingsMutation(async () => {
    await pending;
    await api.specifyCompatTool("1", stable);
    api.setGameCompatProfiles({ "1": { enabled: true, steamCompatTool: stable } });
  });
  const migration = settingsQueue.runGameSettingsMutation(() => api.migrateWindowsCompatTool(["1"], stable, experimental));
  release();
  await Promise.all([restoring, migration]);
  assert.deepEqual(writes, [[1, stable]]);
});

test("startup policy does not repin saved active Follow Steam profiles", async () => {
  const { api, game, writes, launchWrites } = setup();
  api.configureCompatPolicy(experimental, true, [], [experimental], {
    "1": { enabled: true, steamCompatTool: api.FOLLOW_STEAM_COMPAT },
  });
  await api.sweepInstalledGames([game(1, stable, 0)]);
  assert.deepEqual(writes, []);
  assert.deepEqual(launchWrites, [1]);
});

test("targeted policy changes keep unrelated newer choices and the current enabled state", async () => {
  const { api, game, writes } = setup();
  game(1, stable, 250);
  game(2, stable, 250);
  api.configureCompatPolicy(stable, true, [], [stable], {
    "1": { enabled: true, steamCompatTool: stable },
  });
  api.updateGameCompatProfile("2", { steamCompatTool: stable });
  api.updateGameCompatProfile("1", { enabled: false });
  api.updateGameCompatProfile("1", { steamCompatTool: stable });
  await api.migrateWindowsCompatTool(["1", "2"], stable, experimental);
  assert.deepEqual(writes, [[1, experimental]]);
  api.updateGameCompatProfile("2", null);
  await api.migrateWindowsCompatTool(["2"], stable, experimental);
  assert.deepEqual(writes, [[1, experimental], [2, experimental]]);
});

test("resetting a game under Follow Steam clears its pin without discovery or a known pin state", async () => {
  const { api, game, writes } = setup([]);
  game(1, experimental, 250);
  api.configureCompatPolicy(api.FOLLOW_STEAM_COMPAT, true, [], [experimental]);
  assert.equal(await api.resetCompatToolToDefault("1", null), "");
  assert.deepEqual(writes, [[1, ""]]);
});

test("reset all under Follow Steam clears game pins and preserves tool apps", async () => {
  const { api, game, writes, launchWrites } = setup([]);
  game(1, experimental, 250);
  game(2, stable, 250);
  game(3, experimental, 250, 4);
  api.configureCompatPolicy(api.FOLLOW_STEAM_COMPAT, true, [], [experimental]);
  await api.resetAllGamePolicies(["1", "2", "3"], null);
  assert.deepEqual(writes, [[1, ""], [2, ""]]);
  assert.deepEqual(launchWrites.sort(), [1, 2]);
});

test("reset all reports separate game failures on separate lines", async () => {
  const { api, game } = setup([]);
  game(1, stable, 250);
  game(2, stable, 250);
  api.configureCompatPolicy("missing-proton", true, [], [experimental]);
  await assert.rejects(api.resetAllGamePolicies(["1", "2"], null, true), (error: Error) => {
    const messages = error.message.split("\n");
    assert.deepEqual(messages.map((message) => message.split(":")[0]).sort(), ["1", "2"]);
    assert.ok(messages.every((message) => message.includes("Steam compatibility settings are unavailable")));
    return true;
  });
});

test("switching away from Follow Steam migrates handled Windows games and preserves pins and Linux routes", async () => {
  const { api, game, writes } = setup();
  const games = [game(1), game(2, stable, 250), game(3, "steamlinuxruntime"), game(4, ""), game(5, stable, 0, 4)];
  api.configureCompatPolicy(api.FOLLOW_STEAM_COMPAT, false, games.map(g => g.appid), [experimental]);
  await api.migrateWindowsCompatTool(games.map(g => g.appid), api.FOLLOW_STEAM_COMPAT, experimental);
  assert.deepEqual(writes, [[1, experimental]]);
  api.setAutoApplyCompat(true);
  await api.sweepInstalledGames([...games, game(6)]);
  assert.deepEqual(writes, [[1, experimental], [6, experimental]]);
});

test("a named default round trip through Follow Steam restores its game pins", async () => {
  const { api, game, writes } = setup();
  const games = [game(1, experimental, 250), game(2, stable, 250)];
  api.configureCompatPolicy(experimental, true, games.map(g => g.appid), [experimental]);
  await api.migrateWindowsCompatTool(["1", "2"], experimental, api.FOLLOW_STEAM_COMPAT);
  await api.migrateWindowsCompatTool(["1", "2"], api.FOLLOW_STEAM_COMPAT, experimental);
  assert.deepEqual(writes, [[1, ""], [1, experimental]]);
});

test("named defaults still migrate matching pins and honor Apply to New Games", async () => {
  const { api, game, writes } = setup();
  game(1, stable, 250);
  api.configureCompatPolicy(stable, false, [], [experimental]);
  await api.migrateWindowsCompatTool(["1"], stable, experimental);
  await api.sweepInstalledGames([game(2)]);
  assert.deepEqual(writes, [[1, experimental]]);
});
