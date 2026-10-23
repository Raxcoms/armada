import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const USE_DEFAULT_COMPAT = "__armada_default__";
const FOLLOW_STEAM_COMPAT = "__steam_default__";
const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/gameSettings.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const api: any = {};
runInNewContext(compiled, { exports: api, require: () => ({ USE_DEFAULT_COMPAT, FOLLOW_STEAM_COMPAT }) });

function steamSettings() {
  const state = { tool: "preview", priority: 250, resolution: "960x540", failResolution: false };
  const writes: string[] = [];
  return {
    state,
    writes,
    io: {
      readCompat: async () => ({ tool: state.tool, priority: state.priority }),
      readResolution: async () => state.resolution,
      selectCompat: async (tool: string) => {
        state.tool = tool === USE_DEFAULT_COMPAT ? "stable" : tool;
        state.priority = 250;
        writes.push(`tool:${state.tool}`);
      },
      restoreCompat: async (compat: { tool: string; priority: number }) => {
        Object.assign(state, compat);
        writes.push("rollback");
      },
      writeResolution: async (resolution: string) => {
        if (state.failResolution) {
          state.failResolution = false;
          throw new Error("resolution failed");
        }
        state.resolution = resolution;
        writes.push(`resolution:${resolution}`);
      },
      compatSelection: (compat: { tool: string }) => compat.tool === "stable" ? USE_DEFAULT_COMPAT : compat.tool,
    },
  };
}

test("new games follow global; legacy tweak and Steam overrides keep their existing active behavior", () => {
  assert.equal(api.gameProfileEnabled({}, FOLLOW_STEAM_COMPAT, "Default"), false);
  assert.equal(api.gameProfileEnabled({ name: "Game" }, USE_DEFAULT_COMPAT, "Default"), false);
  assert.equal(api.gameProfileEnabled({ nice: -5 }, USE_DEFAULT_COMPAT, "Default"), true);
  assert.equal(api.gameProfileEnabled({}, "preview", "Default"), true);
  assert.equal(api.gameProfileEnabled({}, FOLLOW_STEAM_COMPAT, "1280x720"), true);
  assert.equal(api.gameProfileEnabled({ enabled: true }, FOLLOW_STEAM_COMPAT, "Default"), true);
  assert.equal(api.gameProfileEnabled({ enabled: false, nice: -5 }, "preview", "960x540"), false);
});

test("following global suspends native Steam overrides without deleting saved per-game settings", async () => {
  const steam = steamSettings();
  const settings = { fexProfile: "fast", env: { GLOBAL: null, LOCAL: "1" }, nice: -5 };
  const patch = await api.changeGameProfile(settings, false, steam.io);
  const saved = { ...settings, ...patch };
  assert.equal(saved.enabled, false);
  assert.equal(saved.steamCompatTool, "preview");
  assert.equal(saved.steamResolution, "960x540");
  assert.deepEqual(saved.env, settings.env);
  assert.equal(saved.nice, -5);
  assert.equal(steam.state.tool, "stable");
  assert.equal(steam.state.resolution, "Default");
  const restored = await api.changeGameProfile(saved, true, steam.io);
  assert.equal(restored.enabled, true);
  assert.equal(steam.state.tool, "preview");
  assert.equal(steam.state.resolution, "960x540");
});

test("a saved explicit Proton choice remains explicit even when it matches the current default", async () => {
  const steam = steamSettings();
  steam.state.tool = "stable";
  const patch = await api.changeGameProfile({ enabled: true, steamCompatTool: "stable" }, false, steam.io);
  assert.equal(patch.steamCompatTool, "stable");
});

test("restoring a profile with inherited Steam choices uses the current defaults", async () => {
  const steam = steamSettings();
  const patch = await api.changeGameProfile({ enabled: false, steamCompatTool: USE_DEFAULT_COMPAT, steamResolution: "Default" }, true, steam.io);
  assert.equal(patch.steamCompatTool, USE_DEFAULT_COMPAT);
  assert.equal(steam.state.tool, "stable");
  assert.equal(steam.state.resolution, "Default");
});

test("a failed transition restores native mappings and leaves the saved profile unchanged", async () => {
  const steam = steamSettings();
  steam.state.failResolution = true;
  const settings = { enabled: true, nice: -5 };
  await assert.rejects(api.changeGameProfile(settings, false, steam.io), /resolution failed/);
  assert.deepEqual(settings, { enabled: true, nice: -5 });
  assert.equal(steam.state.tool, "preview");
  assert.equal(steam.state.resolution, "960x540");
  assert.ok(steam.writes.includes("rollback"));
});

test("unknown Steam mappings abort a transition before changing either setting", async () => {
  const steam = steamSettings();
  await assert.rejects(api.changeGameProfile({}, false, { ...steam.io, readCompat: async () => null }), /unavailable/);
  assert.deepEqual(steam.writes, []);
});
