import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as envPresets from "../src/lib/envPresets.ts";
import { clone } from "../src/lib/util.ts";

const source = readFileSync(new URL("../src/tabs/Compatibility.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const policyCompiled = ts.transpileModule(readFileSync(new URL("../src/lib/gameSettings.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const queueCompiled = ts.transpileModule(readFileSync(new URL("../src/lib/gameSettingsQueue.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modalViewCompiled = ts.transpileModule(readFileSync(new URL("../src/components/useModalView.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const advancedCompiled = ts.transpileModule(readFileSync(new URL("../src/lib/advancedSettings.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const FOLLOW_STEAM_COMPAT = "__steam_default__";
const USE_DEFAULT_COMPAT = "__armada_default__";
const games = [{ appid: "1", name: "First game" }, { appid: "2", name: "Second game" }];

interface Element {
  type: string | ((props: any) => any);
  props: any;
  key?: string;
  rendered?: any;
}

interface Frame {
  slots: any[];
  effects: Map<number, { dependencies: any[]; cleanup?: () => void }>;
  active: boolean;
}

function allElements(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(allElements);
  if (!tree || typeof tree !== "object") return [];
  const children = Object.prototype.hasOwnProperty.call(tree, "rendered") ? tree.rendered : tree.props?.children;
  return [tree, ...allElements(children)];
}

function setup(overrides: Record<string, any> = {}, initialResolution = "Native") {
  let config: any = {
    installedGames: clone(games), game: games[0], selectedGame: games[0],
    tweaks: { global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" }, games: { "1": { enabled: true } } },
    fexProfiles: { default: { label: "Default", config: { Multiblock: "1" } }, fast: { label: "Fast", config: { Multiblock: "0" } } },
    protonDefaults: ["stable"], envPresets: [], turnipDrivers: [],
    ...overrides,
  };
  const modals: Element[] = [];
  const modalEntries: Array<{ element: Element; open: boolean; Close: () => void }> = [];
  const modalTrees: any[] = [];
  const advancedWrites: any[] = [];
  let advancedResponse: () => Promise<void> = async () => {};
  let reapplied = 0;
  let restarted = 0;
  const resolutionWrites: Array<[number, string]> = [];
  const launchResets: string[] = [];
  const resolutions = new Map<number, string | Promise<string>>();
  const compatStates = new Map<string, any>();
  const compatWrites: Array<[string, string]> = [];
  const frames = new Map<string, Frame>();
  let frame: Frame;
  let cursor = 0;
  let tree: any;
  let globalResolution = initialResolution;
  let pendingEffects: Array<() => void> = [];
  let pendingLayoutEffects: Array<() => void> = [];
  let rootMounted = true;
  const exports: any = {};
  const setConfig = (value: any) => { config = typeof value === "function" ? value(config) : value; };
  const saveTweaksNow = async (update: (current: any) => any) => {
    advancedWrites.push(clone(update(config.tweaks)));
    await advancedResponse();
    config = { ...config, tweaks: update(config.tweaks) };
    return config;
  };
  const componentNames = ["DialogBody", "DialogButton", "DialogControlsSection", "DialogControlsSectionHeader", "DialogFooter", "Dropdown", "Field", "PanelSection", "TextField"];
  const element = (type: Element["type"], props: any, key?: string) => ({ type, props, key });
  const effectHook = (pending: () => Array<() => void>) => (effect: () => (() => void) | undefined, dependencies: any[]) => {
    const owner = frame;
    const index = cursor++;
    const previous = owner.effects.get(index);
    if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
    pending().push(() => {
      previous?.cleanup?.();
      owner.effects.set(index, { dependencies, cleanup: effect() });
    });
  };
  const react = {
    useState: (initial: any) => {
      const owner = frame;
      const index = cursor++;
      if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial;
      return [owner.slots[index], (value: any) => {
        if (owner.active) owner.slots[index] = typeof value === "function" ? value(owner.slots[index]) : value;
      }];
    },
    useRef: (initial: any) => {
      const index = cursor++;
      if (!(index in frame.slots)) frame.slots[index] = { current: initial };
      return frame.slots[index];
    },
    useEffect: effectHook(() => pendingEffects),
    useLayoutEffect: effectHook(() => pendingLayoutEffects),
    useSyncExternalStore: (subscribe: (listener: () => void) => () => void, getSnapshot: () => any) => {
      react.useEffect(() => subscribe(() => {}), [subscribe]);
      return getSnapshot();
    },
  };
  const apps = {
    GetResolutionOverrideForApp: async (appid: number) => resolutions.get(appid) ?? "Default",
    SetAppResolutionOverride: async (appid: number, value: string) => { resolutionWrites.push([appid, value]); resolutions.set(appid, value); },
    RegisterForAppOverviewChanges: () => ({ unregister: () => {} }),
  };
  const compat = {
    FOLLOW_STEAM_COMPAT, USE_DEFAULT_COMPAT,
    defaultWindowsCompatTool: () => "stable",
    getProtonTools: async () => [{ id: "stable", label: "Stable" }, { id: "preview", label: "Preview" }],
    getAppCompatTools: async () => [],
    resolveCompatState: async (appid: string) => compatStates.get(appid) ?? { tool: "", priority: 0 },
    compatSelection: (state: any, defaultTool: string) => !state.tool || state.priority < 250
      ? FOLLOW_STEAM_COMPAT : state.tool === defaultTool ? USE_DEFAULT_COMPAT : state.tool,
    specifyCompatTool: async (appid: string, tool: string) => {
      compatWrites.push([appid, tool]);
      compatStates.set(appid, { tool: tool === FOLLOW_STEAM_COMPAT ? "" : tool, priority: tool && tool !== FOLLOW_STEAM_COMPAT ? 250 : 0 });
    },
    persistHandledGames: (save: (appids: string[]) => Promise<unknown>) => save([]), markCompatHandled: () => {},
    setAutoApplyCompat: () => {}, setWindowsCompatTool: () => {},
    setGameCompatProfiles: () => {},
    updateGameCompatProfile: () => {},
    migrateWindowsCompatTool: async () => {},
    resetCompatToolToDefault: async (appid: string) => { compatStates.set(appid, { tool: "", priority: 0 }); return ""; },
    resetLaunchOptionsForGame: async (appid: string) => { launchResets.push(appid); return true; },
    resolveProfileAppids: async (appids: string[]) => appids,
    resetAllGamePolicies: async () => {},
  };
  const gamePolicy: any = {};
  runInNewContext(policyCompiled, { exports: gamePolicy, require: () => compat });
  const queue: any = {};
  runInNewContext(queueCompiled, { exports: queue });
  const advanced: any = {};
  runInNewContext(advancedCompiled, { exports: advanced, require: () => ({ clone }) });
  const modalView: any = {};
  runInNewContext(modalViewCompiled, { exports: modalView, require: (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: element, jsxs: element };
    throw new Error(`Unexpected import: ${id}`);
  } });
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
      if (id === "@decky/ui") return { ...Object.fromEntries(componentNames.map((name) => [name, name])), DialogButtonPrimary: "DialogButton", showModal: (modal: Element, _parent: unknown, options?: { fnOnClose?: () => void }) => {
        const entry = { element: modal, open: true, Close: () => {
          if (!entry.open) return;
          entry.open = false;
          options?.fnOnClose?.();
        } };
        modals.push(modal);
        modalEntries.push(entry);
        return entry;
      } };
      if (id === "../components/widgets") return {
        ...Object.fromEntries(["ButtonRow", "ControlRow", "NoticeSection", "SectionDescription", "SelectEdit", "SliderEdit", "SupportingText", "ToggleRow"].map((name) => [name, name])),
        Subsection: ({ title, children }: any) => element("Fragment", { children: [
          element("div", { className: "armada-subheader", role: "heading", "aria-level": 3, children: title }), children,
        ] }),
      };
      if (id === "../components/ArmadaModalRoot") return { ArmadaModalRoot: "ArmadaModalRoot", ArmadaDialogHeader: "ArmadaDialogHeader", ArmadaDialogFooter: "ArmadaDialogFooter" };
      if (id === "../components/useModalView") return modalView;
      if (id === "../i18n") return {
        t: (key: string, values?: Record<string, string>) => values ? `${key}:${Object.values(values).join(":")}` : key,
        translateLabel: (label: string) => label, getCurrentLocale: () => "en",
      };
      if (id === "../lib/util") return { clone };
      if (id === "../lib/envPresets") return envPresets;
      if (id === "../lib/games") return { availableGames: (current: any) => [...current.installedGames] };
      if (id === "../lib/steamCompat") return compat;
      if (id === "../lib/gameSettings") return gamePolicy;
      if (id === "../lib/gameSettingsQueue") return queue;
      if (id === "../lib/advancedSettings") return advanced;
      if (id === "../lib/steamSettings") return {
        getGlobalResolution: () => globalResolution,
        setGlobalResolution: async (value: string) => { globalResolution = value; return value; },
      };
      if (id === "../backend") return {
        getCompatMappedAppids: async () => [], saveCompatApplied: async () => {},
        reapplyPerf: async () => { reapplied++; }, restartGameMode: async () => { restarted++; },
      };
      throw new Error(`Unexpected import: ${id}`);
    },
    window: { SteamClient: { Apps: apps }, setTimeout, clearTimeout },
  });

  function render() {
    const mounted = new Set<string>();
    const expand = (node: any, path: string): any => {
      if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`));
      if (!node || typeof node !== "object") return node;
      if (typeof node.type === "function") {
        const identity = `${path}/${node.type.name}/${node.key || ""}`;
        mounted.add(identity);
        frame = frames.get(identity) || { slots: [], effects: new Map(), active: true };
        frames.set(identity, frame);
        cursor = 0;
        return { ...node, rendered: expand(node.type(node.props), `${identity}/rendered`) };
      }
      return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/children`) } };
    };
    tree = rootMounted ? expand(element(exports.Compatibility, { config, setConfig, saveTweaksNow }), "root") : null;
    const layoutEffects = pendingLayoutEffects;
    pendingLayoutEffects = [];
    for (const effect of layoutEffects) effect();
    modalEntries.forEach((entry, index) => {
      modalTrees[index] = entry.open ? expand({ ...entry.element, props: { ...entry.element.props, closeModal: entry.Close } }, `modal/${index}`) : null;
    });
    for (const [identity, owner] of frames) {
      if (mounted.has(identity)) continue;
      owner.active = false;
      for (const effect of owner.effects.values()) effect.cleanup?.();
      frames.delete(identity);
    }
    const effects = pendingEffects;
    pendingEffects = [];
    for (const effect of effects) effect();
    return tree;
  }
  function editor(appid: string | null) {
    const node = allElements(tree).find((node) => typeof node.type === "function"
      && Object.prototype.hasOwnProperty.call(node.props, "game") && (node.props.game?.appid ?? null) === appid);
    assert.ok(node, `Missing settings editor for ${appid ?? "defaults"}`);
    return node;
  }
  function control(appid: string | null, type: string, label: string) {
    const node = allElements(editor(appid).rendered).find((node) => node.type === type
      && (node.props.label === label || node.props.children === label));
    assert.ok(node, `Missing ${type}: ${label}`);
    return node;
  }
  function modalControl(type: string, label?: string, index = modalEntries.length - 1) {
    const node = allElements(modalTrees[index]).find((node) => node.type === type
      && (label === undefined || node.props.label === label || node.props.children === label));
    assert.ok(node, `Missing modal ${type}: ${label}`);
    return node;
  }
  render();
  return {
    render, editor, control, modalControl, modals, resolutions, compatStates, resolutionWrites, launchResets, compatWrites, apps, compat, setConfig, advancedWrites,
    respondAdvanced: (response: () => Promise<void>) => { advancedResponse = response; },
    get reapplied() { return reapplied; },
    get restarted() { return restarted; },
    get config() { return config; },
    elements: () => allElements(tree),
    modalElements: (index = modalEntries.length - 1) => allElements(modalTrees[index]),
    modalOpen: (index = modalEntries.length - 1) => modalEntries[index]?.open ?? false,
    closeModal: (index = modalEntries.length - 1) => { modalEntries[index].Close(); render(); },
    unmount: () => { rootMounted = false; render(); },
    select: (appid: string) => {
      const selector = allElements(tree).find((node) => node.type === "SelectEdit" && node.props.label === undefined);
      assert.ok(selector);
      selector.props.onChange(appid);
      render();
    },
    settle: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      render();
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
  };
}

test("clearing the selected game stays cleared while another game is running", () => {
  const app = setup();
  app.select("");
  assert.equal(app.config.selectedGame, null);
  assert.equal(app.config.game.appid, "1");
  assert.equal(app.elements().filter((node) => typeof node.type === "function" && "game" in node.props).length, 1);
  assert.ok(app.editor(null));
  app.render();
  assert.equal(app.elements().some((node) => node.props.className === "armada-empty-game"), false);
  assert.equal(app.elements().some((node) => node.props.children === "gameSettings.chooseGame"), false);
});

test("automatic selection follows newly running games until the user chooses a target", () => {
  const app = setup({ game: null, selectedGame: undefined });
  assert.equal(app.elements().find((node) => node.type === "SelectEdit" && !node.props.label)?.props.value, "");
  app.config.game = games[0];
  app.render();
  assert.ok(app.editor("1"));
  app.config.game = games[1];
  app.render();
  assert.ok(app.editor("2"));
  app.select("1");
  app.config.game = null;
  app.render();
  assert.ok(app.editor("1"));
});

test("the inherited resolution label matches the actual default option", () => {
  for (const resolution of ["Default", "Native", "1280x720", "960x540"]) {
    const app = setup({}, resolution);
    const defaults = app.control(null, "SelectEdit", "compatibility.gameResolution");
    const selectedDefault = defaults.props.options.find((option: any) => option.data === defaults.props.value);
    const inherited = app.control("1", "SelectEdit", "compatibility.gameResolution").props.options.find((option: any) => option.data === "Default");
    assert.equal(inherited.label, `gameSettings.inherit:${selectedDefault.label}`);
  }
});

test("selected game and default settings are rendered together and edit separate tweak maps", () => {
  const app = setup();
  assert.ok(app.elements().find((node) => node.props.title === "gameSettings.perGame"));
  assert.ok(app.elements().find((node) => node.props.title === "gameSettings.defaults"));
  app.control("1", "SelectEdit", "compatibility.fexPreset").props.onChange("fast");
  app.control(null, "SelectEdit", "compatibility.fexPreset").props.onChange("custom");
  assert.equal(app.config.tweaks.games["1"].fexProfile, "fast");
  assert.equal(app.config.tweaks.global.fexProfile, "custom");
  assert.equal(app.config.tweaks.games["1"].name, "First game");
  assert.equal(app.config.tweaks.games["2"], undefined);
});

test("choosing inherited FEX settings removes overrides and tracks subsequent default changes", () => {
  const app = setup({
    tweaks: { global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" }, games: {
      "1": { fexProfile: "custom", fexConfig: { Multiblock: "0" }, scheduler: "eevdf" },
    } },
  });
  app.control("1", "SelectEdit", "compatibility.fexPreset").props.onChange("");
  assert.equal("fexProfile" in app.config.tweaks.games["1"], false);
  assert.equal("fexConfig" in app.config.tweaks.games["1"], false);
  assert.equal(app.config.tweaks.games["1"].scheduler, "eevdf");
  app.render();
  app.control(null, "SelectEdit", "compatibility.fexPreset").props.onChange("fast");
  app.render();
  const inherited = app.control("1", "SelectEdit", "compatibility.fexPreset");
  assert.equal(inherited.props.value, "");
  assert.equal(inherited.props.options[0].label, "gameSettings.inherit:Fast");
});

test("disabling and restoring an inherited environment variable only changes its game tombstone", () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, env: { GLOBAL_OPTION: "1" } },
    games: { "1": { env: { LOCAL_OPTION: "2" } } },
  } });
  app.control("1", "ToggleRow", "GLOBAL_OPTION=1").props.onChange(false);
  assert.equal(app.config.tweaks.games["1"].env.GLOBAL_OPTION, null);
  assert.equal(app.config.tweaks.games["1"].env.LOCAL_OPTION, "2");
  assert.equal(app.config.tweaks.global.env.GLOBAL_OPTION, "1");
  app.render();
  app.control("1", "ToggleRow", "GLOBAL_OPTION=1").props.onChange(true);
  assert.equal("GLOBAL_OPTION" in app.config.tweaks.games["1"].env, false);
});

test("CPU settings stay inline and environment sections are always expanded for each target", () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, cores: "all", env: { GLOBAL_OPTION: "1" } },
    games: { "1": { enabled: true, cores: "0-1", wineTopology: false, env: { LOCAL_OPTION: "2" } } },
  } });
  for (const appid of ["1", null]) {
    const nodes = allElements(app.editor(appid).rendered);
    assert.equal(nodes.filter((node) => node.type === "SelectEdit" && node.props.label === "compatibility.gameCpuCores").length, 1);
    assert.ok(app.control(appid, "ToggleRow", "compatibility.wineCpuTopology"));
    const main = nodes.find((node) => node.type === "PanelSection"
      && allElements(node).some((child) => child.type === "SelectEdit" && child.props.label === "compatibility.gameCpuCores"));
    assert.ok(main);
    const contents = allElements(main);
    const headings = contents.filter((node) => node.props.className === "armada-subheader"
      && ["profiles.cpuSettings", "compatibility.fexSettings", "compatibility.environment", "compatibility.advanced"].includes(node.props.children)).map((node) => node.props.children);
    assert.deepEqual(Array.from(headings), ["profiles.cpuSettings", "compatibility.environment", "compatibility.advanced"]);
    assert.equal(nodes.some((node) => node.type === "PanelSection" && node.props.title === "compatibility.environment"), false);
    assert.ok(contents.some((node) => node.type === "ButtonRow" && node.props.children === "compatibility.addCustomVariable"));
    const buttons = contents.filter((node) => node.type === "ButtonRow");
    assert.deepEqual(Array.from(buttons.slice(-2), (node) => node.props.children), [
      "compatibility.advancedSettings", appid ? "common.resetToDefault" : "compatibility.resetAllGames",
    ]);
    assert.equal(app.control(appid, "ToggleRow", "compatibility.wineCpuTopology").props.description, "compatibility.wineCpuTopologyDescription");
    assert.ok(app.control(appid, "ButtonRow", "compatibility.addCustomVariable"));
    assert.equal(nodes.filter((node) => node.type === "ButtonRow" && node.props.children === "compatibility.advancedSettings").length, 1);
    for (const label of ["options.performance", "compatibility.hostThunks", "compatibility.environment", "compatibility.drivers"]) {
      assert.equal(nodes.some((node) => node.type === "ButtonRow" && node.props.children === label), false);
    }
  }
  assert.ok(app.control("1", "ToggleRow", "GLOBAL_OPTION=1"));
  app.control("1", "ToggleRow", "compatibility.wineCpuTopology").props.onChange(true);
  app.render();
  app.control(null, "SelectEdit", "compatibility.gameCpuCores").props.onChange("all");
  assert.equal(app.config.tweaks.games["1"].cores, "0-1");
  assert.equal(app.config.tweaks.games["1"].wineTopology, true);
  assert.equal(app.config.tweaks.global.cores, "all");
  assert.equal(app.config.tweaks.global.wineTopology, undefined);
  const defaultButtons = allElements(app.editor(null).rendered).filter((node) => node.type === "ButtonRow");
  assert.equal(defaultButtons.at(-1)?.props.children, "compatibility.resetAllGames");
});

test("custom FEX settings stay between their selector and the environment subsection", () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" },
    games: { "1": { enabled: true, fexProfile: "custom", fexConfig: { Multiblock: "1" } } },
  } });
  const nodes = allElements(app.editor("1").rendered);
  const headings = nodes.filter((node) => node.props.className === "armada-subheader");
  assert.deepEqual(Array.from(headings, (node) => node.props.children), [
    "compatibility.fexSettings", "profiles.cpuSettings", "compatibility.environment", "compatibility.advanced",
  ]);
  const selector = app.control("1", "SelectEdit", "compatibility.fexPreset");
  assert.ok(nodes.indexOf(selector) < nodes.indexOf(headings[0]));
  const fexSettings = nodes.find((node) => typeof node.type === "function" && node.props.title === "compatibility.fexSettings");
  assert.ok(fexSettings);
  assert.ok(allElements(fexSettings).some((node) => node.type === "ToggleRow"));
  selector.props.onChange("default");
  app.render();
  assert.equal(allElements(app.editor("1").rendered).some((node) => node.props.className === "armada-subheader"
    && node.props.children === "compatibility.fexSettings"), false);
});
test("an open environment editor merges newer variables into its original game target", () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT },
    games: { "1": { enabled: true, env: { LOCAL_OPTION: "1", OTHER_OPTION: "2" } }, "2": { enabled: true } },
  } });
  const row = allElements(app.editor("1").rendered).find((node) => node.type === "ButtonRow"
    && allElements(node.props.children).some((child) => child.props.children === "LOCAL_OPTION=1"));
  assert.ok(row);
  row.props.onClick();
  app.render();
  app.modalControl("TextField", "common.value").props.onChange({ target: { value: "updated" } });
  app.setConfig((current: any) => ({ ...current, tweaks: { ...current.tweaks, games: {
    ...current.tweaks.games, "1": { ...current.tweaks.games["1"], env: { LOCAL_OPTION: "1", OTHER_OPTION: "newer", ADDED_OPTION: "3" } },
  } } }));
  app.select("2");
  app.modalControl("DialogButton", "common.save").props.onClick();
  app.render();
  assert.deepEqual({ ...app.config.tweaks.games["1"].env }, { LOCAL_OPTION: "updated", OTHER_OPTION: "newer", ADDED_OPTION: "3" });
  assert.equal(app.config.selectedGame.appid, "2");
  assert.equal(app.config.tweaks.games["2"].env, undefined);
  assert.equal(app.modalOpen(), false);
});

test("Advanced opens expanded sections with conditional drivers and target-specific controls", () => {
  const app = setup({ turnipDrivers: [{ id: "stable", label: "Stable" }, { id: "preview", label: "Preview" }] });
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  const nodes = app.modalElements();
  const sectionTitles = nodes.filter((node) => node.type === "DialogControlsSectionHeader").map((node) => node.props.children);
  assert.deepEqual(Array.from(sectionTitles), ["options.performance", "compatibility.drivers", "compatibility.hostThunks"]);
  assert.equal(nodes.filter((node) => node.type === "SelectEdit" && node.props.label === "compatibility.gamescopeCpuCores").length, 1);
  assert.equal(nodes.some((node) => node.type === "ToggleRow" && node.props.label === "compatibility.wineCpuTopology"), false);
  assert.equal(nodes.some((node) => node.type === "ToggleRow" && node.props.label === "compatibility.vulkanRealtimeQueue"), false);
  assert.ok(app.modalControl("ToggleRow", "Host Vulkan"));
  assert.ok(app.modalControl("SelectEdit", "Turnip"));
  assert.equal(nodes.some((node) => node.type === "ButtonRow"), false);
  const footer = nodes.find((node) => node.type === "ArmadaDialogFooter");
  const actions = allElements(footer).filter((node) => node.type === "DialogButton");
  assert.deepEqual(Array.from(actions, (node) => node.props.children), ["common.saveChanges", "common.cancel", "common.resetToDefault", "compatibility.reapplyRunningGame"]);
  app.modalControl("DialogButton", "common.cancel").props.onClick();
  app.render();
  assert.equal(app.modalOpen(), false);
  app.control(null, "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  assert.ok(app.modalControl("ToggleRow", "compatibility.vulkanRealtimeQueue"));
  const performanceSection = app.modalElements().find((node) => node.type === "DialogControlsSection"
    && allElements(node).some((child) => child.type === "DialogControlsSectionHeader" && child.props.children === "options.performance"));
  const performanceControls = allElements(performanceSection);
  assert.equal(performanceControls.some((node) => node.props.className === "armada-subheader"), false);
  assert.equal(performanceControls.some((node) => node.type === "SelectEdit" && node.props.label === "compatibility.gameCpuCores"), false);
  assert.ok(app.modalControl("SelectEdit", "compatibility.gamescopeCpuCores"));
  for (const label of ["compatibility.gameProcessPriority", "compatibility.gamescopeProcessPriority"]) {
    assert.equal(app.modalControl("SliderEdit", label).props.description, "compatibility.processPriorityDescription");
  }
  const controls = performanceControls.filter((node) => ["SelectEdit", "SliderEdit", "ToggleRow"].includes(String(node.type)));
  assert.deepEqual(Array.from(controls, (node) => node.props.label), [
    "compatibility.gameProcessPriority", "compatibility.gamescopeProcessPriority",
    "compatibility.gamescopeCpuCores", "compatibility.cpuScheduler", "compatibility.vulkanRealtimeQueue",
  ]);
  assert.equal(app.modalElements().some((node) => node.props.children === "compatibility.reapplyRunningGame"), false);
  app.select("2");
  assert.equal(app.modalOpen(), true);
  const singleDriver = setup({ turnipDrivers: [{ id: "stable", label: "Stable" }] });
  singleDriver.control(null, "ButtonRow", "compatibility.advancedSettings").props.onClick();
  singleDriver.render();
  assert.equal(singleDriver.modalElements().some((node) => node.props.children === "compatibility.drivers"), false);
});

test("Advanced keeps consecutive edits isolated until Save and preserves unrelated updates", async () => {
  const app = setup();
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.modalControl("ToggleRow", "Host Vulkan").props.onChange(false);
  app.render();
  assert.equal(app.modalControl("ToggleRow", "Host Vulkan").props.value, false);
  app.control(null, "SelectEdit", "compatibility.fexPreset").props.onChange("fast");
  app.setConfig((current: any) => ({ ...current, sshEnabled: true, tweaks: { ...current.tweaks, games: { ...current.tweaks.games, "2": { nice: -4 } } } }));
  app.render();
  app.modalControl("ToggleRow", "Host OpenGL").props.onChange(false);
  app.render();
  app.modalControl("SelectEdit", "compatibility.cpuScheduler").props.onChange("eevdf");
  app.render();
  assert.equal(app.config.tweaks.games["1"].thunks, undefined);
  assert.equal(app.config.tweaks.games["1"].scheduler, undefined);
  assert.equal(app.advancedWrites.length, 0);
  assert.equal(app.modalControl("ToggleRow", "Host Vulkan").props.value, false);
  assert.equal(app.modalControl("ToggleRow", "Host OpenGL").props.value, false);
  assert.equal(app.config.tweaks.games["2"].nice, -4);
  assert.equal(app.config.tweaks.global.fexProfile, "fast");
  assert.equal(app.config.sshEnabled, true);
  app.modalControl("SelectEdit", "compatibility.gamescopeCpuCores").props.onChange("custom");
  app.render();
  app.modalControl("TextField", "compatibility.customCores").props.onChange({ target: { value: "0-1" } });
  app.render();
  assert.equal(app.config.tweaks.games["1"].gamescopeCores, undefined);
  app.modalControl("SelectEdit", "compatibility.gamescopeCpuCores").props.onChange("all");
  app.render();
  app.modalControl("SelectEdit", "compatibility.gamescopeCpuCores").props.onChange("custom");
  app.render();
  assert.equal(app.modalControl("TextField", "compatibility.customCores").props.value, "");
  assert.equal(app.modalControl("DialogButton", "common.saveChanges").props.disabled, true);
  assert.ok(app.modalElements().some((node) => node.type === "SupportingText" && node.props.children === "compatibility.enterCores"));
  app.modalControl("SelectEdit", "compatibility.gamescopeCpuCores").props.onChange("all");
  app.render();
  app.modalControl("DialogButton", "common.saveChanges").props.onClick();
  await app.settle();
  assert.deepEqual({ ...app.config.tweaks.games["1"].thunks }, { Vulkan: false, GL: false });
  assert.equal(app.config.tweaks.games["1"].scheduler, "eevdf");
  assert.equal(app.config.tweaks.games["1"].gamescopeCores, "all");
  assert.equal(app.config.tweaks.games["2"].nice, -4);
  assert.equal(app.config.tweaks.global.fexProfile, "fast");
  assert.equal(app.config.sshEnabled, true);
  assert.equal(app.modalOpen(), false);
});

for (const inherited of [false, true]) {
  test(`Advanced thunk Save preserves newer ${inherited ? "inherited" : "per-game"} module settings`, async () => {
    const initialThunks = { Vulkan: true, GL: true };
    const app = setup({ tweaks: {
      global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, thunks: initialThunks },
      games: { "1": { enabled: true, ...(inherited ? {} : { thunks: initialThunks }) } },
    } });
    app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
    app.render();
    app.modalControl("ToggleRow", "Host Vulkan").props.onChange(false);
    app.render();
    app.setConfig((current: any) => {
      const tweaks = clone(current.tweaks);
      const target = inherited ? tweaks.global : tweaks.games["1"];
      target.thunks = { ...target.thunks, GL: false, WaylandClient: false };
      return { ...current, tweaks };
    });
    app.render();
    app.modalControl("DialogButton", "common.saveChanges").props.onClick();
    await app.settle();
    assert.deepEqual({ ...app.config.tweaks.games["1"].thunks }, { Vulkan: false, GL: false, WaylandClient: false });
    assert.equal(app.config.tweaks.global.thunks.Vulkan, true);
    assert.equal(app.modalOpen(), false);
  });
}

test("Advanced Restore followed by edits replaces old thunk settings and clears other overrides", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, thunks: { Vulkan: true, GL: true } },
    games: { "1": { enabled: true, cores: "all", nice: -5, scheduler: "eevdf", thunks: { Vulkan: false, GL: false, asound: false } } },
  } });
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.modalControl("DialogButton", "common.resetToDefault").props.onClick();
  app.render();
  app.modalControl("ToggleRow", "Host Vulkan").props.onChange(false);
  app.render();
  app.modalControl("DialogButton", "common.saveChanges").props.onClick();
  await app.settle();
  assert.deepEqual({ ...app.config.tweaks.games["1"].thunks }, { Vulkan: false, GL: true });
  assert.equal(app.config.tweaks.games["1"].nice, undefined);
  assert.equal(app.config.tweaks.games["1"].scheduler, undefined);
  assert.equal(app.config.tweaks.games["1"].cores, "all");
  assert.equal(app.modalOpen(), false);
});

test("Advanced Cancel and Back discard drafts, and target changes and unmount close the editor", () => {
  const app = setup({ tweaks: { global: { windowsCompatTool: FOLLOW_STEAM_COMPAT }, games: { "1": { enabled: true }, "2": { enabled: true } } } });
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  assert.equal(app.modals.length, 1);
  app.modalControl("ToggleRow", "Host Vulkan").props.onChange(false);
  app.render();
  app.closeModal();
  assert.equal(app.modalOpen(), false);
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  assert.equal(app.modalControl("ToggleRow", "Host Vulkan").props.value, true);
  app.modalControl("ToggleRow", "Host OpenGL").props.onChange(false);
  app.render();
  app.modalControl("ArmadaModalRoot").props.onCancel();
  app.render();
  assert.equal(app.modalOpen(), false);
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  assert.equal(app.modalControl("ToggleRow", "Host OpenGL").props.value, true);
  app.select("2");
  assert.equal(app.modalOpen(), false);
  app.control("2", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  assert.equal(app.modalControl("ToggleRow", "Host Vulkan").props.value, true);
  app.unmount();
  assert.equal(app.modalOpen(), false);
  assert.equal(app.config.tweaks.games["2"].thunks, undefined);
  assert.equal(app.config.tweaks.games["1"].thunks, undefined);
  assert.equal(app.advancedWrites.length, 0);
});

test("disabling the game profile closes its Advanced modal before the transition finishes", async () => {
  const app = setup();
  await app.settle();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const readResolution = app.apps.GetResolutionOverrideForApp;
  app.apps.GetResolutionOverrideForApp = async (appid) => { await pending; return readResolution(appid); };
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(false);
  app.render();
  assert.equal(app.modalOpen(), false);
  release();
  await app.settle();
  assert.equal(app.config.tweaks.games["1"].enabled, false);
});

test("Advanced Restore clears only its own overrides after Save and preserves inline settings", async () => {
  const performance = { cores: "0-1", wineTopology: false, nice: -5, gamescopeCores: "2-3", gamescopeNice: -2, scheduler: "eevdf" };
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, cores: "all", nice: -1 },
    games: { "1": { enabled: true, ...performance, env: { LOCAL_OPTION: "1" }, thunks: { Vulkan: false }, turnipDriver: "preview" } },
  } });
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.control("1", "TextField", "compatibility.customCoresDescription").props.onChange({ target: { value: "99" } });
  app.modalControl("TextField", "compatibility.customCores").props.onChange({ target: { value: "99" } });
  app.render();
  assert.equal(app.config.tweaks.games["1"].cores, "0-1");
  assert.equal(app.config.tweaks.games["1"].gamescopeCores, "2-3");
  const footer = app.modalElements().find((node) => node.type === "ArmadaDialogFooter");
  assert.ok(allElements(footer).some((node) => node.props.children === "common.resetToDefault"));
  app.modalControl("DialogButton", "common.resetToDefault").props.onClick();
  app.render();
  assert.equal(app.config.tweaks.games["1"].nice, -5);
  assert.equal(app.config.tweaks.games["1"].thunks.Vulkan, false);
  assert.equal(app.advancedWrites.length, 0);
  assert.equal(app.modalElements().some((node) => node.type === "TextField" && node.props.label === "compatibility.customCores"), false);
  app.modalControl("DialogButton", "common.saveChanges").props.onClick();
  await app.settle();
  for (const key of ["nice", "gamescopeCores", "gamescopeNice", "scheduler", "thunks", "turnipDriver"]) {
    assert.equal(key in app.config.tweaks.games["1"], false, key);
  }
  assert.equal(app.config.tweaks.games["1"].cores, "0-1");
  assert.equal(app.config.tweaks.games["1"].wineTopology, false);
  assert.equal(app.config.tweaks.games["1"].env.LOCAL_OPTION, "1");
  assert.equal(app.config.tweaks.games["1"].enabled, true);
  assert.equal(app.config.tweaks.global.nice, -1);
  assert.equal(app.control("1", "TextField", "compatibility.customCoresDescription").props.value, "99");
  assert.equal(app.modalOpen(), false);
});

test("running-game reapply uses current tweaks and disappears when another game starts", async () => {
  const app = setup();
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.modalControl("SelectEdit", "compatibility.cpuScheduler").props.onChange("eevdf");
  app.render();
  assert.equal(app.modalControl("DialogButton", "compatibility.reapplyRunningGame").props.disabled, true);
  app.modalControl("DialogButton", "common.cancel").props.onClick();
  app.render();
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.control(null, "SelectEdit", "compatibility.fexPreset").props.onChange("fast");
  app.render();
  app.modalControl("DialogButton", "compatibility.reapplyRunningGame").props.onClick();
  await app.settle();
  assert.equal(app.reapplied, 1);
  assert.deepEqual(app.advancedWrites[0], clone(app.config.tweaks));
  assert.equal(app.config.tweaks.games["1"].scheduler, undefined);
  assert.equal(app.modalControl("Field", "common.status").props.description, "compatibility.appliedToRunningGame");
  app.setConfig((current: any) => ({ ...current, game: games[1] }));
  app.render();
  assert.equal(app.modalElements().some((node) => node.props.children === "compatibility.reapplyRunningGame"), false);
});

test("the default realtime queue setting persists latest tweaks when restart is confirmed", async () => {
  const app = setup();
  app.control(null, "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.modalControl("ToggleRow", "compatibility.vulkanRealtimeQueue").props.onChange(true);
  app.render();
  assert.equal(app.config.tweaks.global.gamescopeVulkanRealtime, undefined);
  assert.equal(app.restarted, 0);
  assert.equal(app.modals.length, 1);
  app.modalControl("DialogButton", "common.saveChanges").props.onClick();
  await app.settle();
  assert.equal(app.config.tweaks.global.gamescopeVulkanRealtime, true);
  assert.equal(app.config.tweaks.games["1"].gamescopeVulkanRealtime, undefined);
  app.control("1", "SelectEdit", "compatibility.fexPreset").props.onChange("fast");
  app.render();
  app.modalControl("DialogButton", "compatibility.restartGameMode").props.onClick();
  await app.settle();
  assert.equal(app.restarted, 1);
  assert.deepEqual(app.advancedWrites[1], clone(app.config.tweaks));
  assert.equal(app.advancedWrites[1].games["1"].fexProfile, "fast");
});

test("Advanced default Restore uses factory settings and stays disabled on older backends", async () => {
  const app = setup({
    tweaksDefaults: { global: { nice: 0, thunks: { Vulkan: true }, gamescopeVulkanRealtime: false }, games: {} },
    tweaks: { global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, nice: -3, thunks: { Vulkan: false }, cores: "all", env: { GLOBAL_OPTION: "1" } }, games: { "1": { enabled: true, nice: -5 } } },
  });
  app.control(null, "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.modalControl("DialogButton", "common.resetToDefault").props.onClick();
  app.render();
  assert.equal(app.modalControl("ToggleRow", "Host Vulkan").props.value, true);
  assert.equal(app.config.tweaks.global.nice, -3);
  assert.equal(app.advancedWrites.length, 0);
  app.modalControl("DialogButton", "common.cancel").props.onClick();
  app.render();
  app.control(null, "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  assert.equal(app.modalControl("ToggleRow", "Host Vulkan").props.value, false);
  app.modalControl("DialogButton", "common.resetToDefault").props.onClick();
  app.render();
  app.modalControl("DialogButton", "common.saveChanges").props.onClick();
  await app.settle();
  assert.equal(app.config.tweaks.global.nice, 0);
  assert.equal(app.config.tweaks.global.thunks.Vulkan, true);
  assert.equal(app.config.tweaks.global.cores, "all");
  assert.equal(app.config.tweaks.global.env.GLOBAL_OPTION, "1");
  assert.equal(app.config.tweaks.games["1"].nice, -5);
  assert.equal(app.modalOpen(), false);
  assert.equal(app.modals.length, 2);
  const legacy = setup();
  legacy.control(null, "ButtonRow", "compatibility.advancedSettings").props.onClick();
  legacy.render();
  assert.equal(legacy.modalControl("DialogButton", "common.resetToDefault").props.disabled, true);
});

test("failed Advanced saves retain the draft and retries merge current state without duplicate saves", async () => {
  const app = setup();
  app.respondAdvanced(async () => { throw new Error("write failed"); });
  app.control("1", "ButtonRow", "compatibility.advancedSettings").props.onClick();
  app.render();
  app.modalControl("ToggleRow", "Host Vulkan").props.onChange(false);
  app.render();
  app.modalControl("DialogButton", "common.saveChanges").props.onClick();
  await app.settle();
  assert.equal(app.modalOpen(), true);
  assert.equal(app.modalControl("ToggleRow", "Host Vulkan").props.value, false);
  assert.equal(app.config.tweaks.games["1"].thunks, undefined);
  assert.ok(app.modalElements().some((node) => node.type === "SupportingText" && node.props.children === "Error: write failed"));
  let release!: () => void;
  app.respondAdvanced(() => new Promise<void>((resolve) => { release = resolve; }));
  const save = app.modalControl("DialogButton", "common.saveChanges").props.onClick;
  save();
  save();
  app.render();
  assert.equal(app.advancedWrites.length, 2);
  assert.equal(app.modalControl("DialogButton", "common.cancel").props.disabled, true);
  assert.equal(app.modalControl("DialogButton", "common.resetToDefault").props.disabled, true);
  app.modalControl("ArmadaModalRoot").props.onCancel();
  assert.equal(app.modalOpen(), true);
  app.setConfig((current: any) => ({ ...current, sshEnabled: true, tweaks: { ...current.tweaks, games: {
    ...current.tweaks.games, "1": { ...current.tweaks.games["1"], nice: -7, env: { NEW_OPTION: "1" } }, "2": { nice: -4 },
  } } }));
  app.render();
  release();
  await app.settle();
  assert.equal(app.modalOpen(), false);
  assert.equal(app.config.tweaks.games["1"].thunks.Vulkan, false);
  assert.equal(app.config.tweaks.games["1"].env.NEW_OPTION, "1");
  assert.equal(app.config.tweaks.games["1"].nice, -7);
  assert.equal(app.config.tweaks.games["2"].nice, -4);
  assert.equal(app.config.sshEnabled, true);
});

test("resetting one game preserves defaults and other games", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "fast" },
    games: { "1": { scheduler: "eevdf" }, "2": { nice: -5 } },
  } });
  const defaults = clone(app.config.tweaks.global);
  app.control("1", "ButtonRow", "common.resetToDefault").props.onClick();
  assert.equal(app.config.tweaks.games["1"].scheduler, "eevdf");
  app.modals.at(-1)!.props.onConfirm();
  await app.settle();
  assert.equal(app.config.tweaks.games["1"], undefined);
  assert.equal(app.config.tweaks.games["2"].nice, -5);
  assert.deepEqual(app.config.tweaks.global, defaults);
  assert.deepEqual(app.launchResets, ["1"]);
  assert.deepEqual(app.resolutionWrites, [[1, "Default"]]);
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, false);
});

test("reset all clears game overrides and resolutions without replacing global defaults", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "fast" },
    games: { "1": { nice: -5 }, "2": { scheduler: "eevdf" } },
  } });
  const defaults = clone(app.config.tweaks.global);
  app.control(null, "ButtonRow", "compatibility.resetAllGames").props.onClick();
  app.modals.at(-1)!.props.onConfirm();
  await app.settle();
  assert.equal(Object.keys(app.config.tweaks.games).length, 0);
  assert.deepEqual(app.config.tweaks.global, defaults);
  assert.deepEqual(app.resolutionWrites.sort((a, b) => a[0] - b[0]), [[1, "Default"], [2, "Default"]]);
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, false);
  assert.equal(allElements(app.editor("1").rendered).some((node) => node.type === "SelectEdit"), false);
});

test("late resolution and compatibility responses cannot replace the newly selected game's values", async () => {
  const app = setup({ selectedGame: null });
  let finishResolution!: (value: string) => void;
  let finishCompat!: (value: any) => void;
  app.resolutions.set(1, new Promise((resolve) => { finishResolution = resolve; }));
  app.compatStates.set("1", new Promise((resolve) => { finishCompat = resolve; }));
  app.resolutions.set(2, "960x540");
  app.compatStates.set("2", { tool: "preview", priority: 250 });
  app.select("1");
  app.select("2");
  await app.settle();
  finishResolution("1280x720");
  finishCompat({ tool: "stable", priority: 250 });
  await app.settle();
  assert.equal(app.config.selectedGame.appid, "2");
  assert.equal(app.control("2", "SelectEdit", "compatibility.gameResolution").props.value, "960x540");
  assert.equal(app.control("2", "SelectEdit", "compatibility.tool").props.value, "preview");
});

test("a new game's toggle is off until per-game settings are enabled", async () => {
  const app = setup({ tweaks: { global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" }, games: {} } });
  await app.settle();
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, false);
  assert.equal(allElements(app.editor("1").rendered).some((node) => node.type === "SelectEdit"), false);
  assert.ok(app.control(null, "SelectEdit", "compatibility.fexPreset"));
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(true);
  await app.settle();
  assert.equal(app.config.tweaks.games["1"].enabled, true);
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, true);
  assert.ok(app.control("1", "SelectEdit", "compatibility.fexPreset"));
});

test("turning per-game settings off preserves overrides and turning them on restores native selections", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" },
    games: { "1": { fexProfile: "fast", nice: -5 }, "2": { scheduler: "lavd" } },
  } });
  app.resolutions.set(1, "960x540");
  app.compatStates.set("1", { tool: "preview", priority: 250 });
  await app.settle();
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, true);
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(false);
  await app.settle();
  assert.equal(app.config.tweaks.games["1"].enabled, false);
  assert.equal(app.config.tweaks.games["1"].steamCompatTool, "preview");
  assert.equal(app.config.tweaks.games["1"].steamResolution, "960x540");
  assert.equal(app.config.tweaks.games["1"].fexProfile, "fast");
  assert.equal(app.config.tweaks.games["2"].scheduler, "lavd");
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, false);
  assert.equal(allElements(app.editor("1").rendered).some((node) => node.type === "SelectEdit"), false);
  app.control(null, "SelectEdit", "compatibility.fexPreset").props.onChange("custom");
  app.render();
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(true);
  await app.settle();
  assert.equal(app.config.tweaks.games["1"].enabled, true);
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, true);
  assert.equal(app.config.tweaks.games["1"].nice, -5);
  assert.equal(app.config.tweaks.global.fexProfile, "custom");
  assert.equal(app.control("1", "SelectEdit", "compatibility.tool").props.value, "preview");
  assert.equal(app.control("1", "SelectEdit", "compatibility.gameResolution").props.value, "960x540");
});

test("late per-game toggle responses change the original target without replacing another game or newer defaults", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" },
    games: { "1": { fexProfile: "fast" }, "2": { nice: -2 } },
  } });
  let finish!: (value: string) => void;
  app.resolutions.set(1, new Promise((resolve) => { finish = resolve; }));
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(false);
  app.select("2");
  app.control(null, "SelectEdit", "compatibility.fexPreset").props.onChange("custom");
  app.render();
  finish("1280x720");
  await app.settle();
  assert.equal(app.config.selectedGame.appid, "2");
  assert.equal(app.config.tweaks.games["1"].enabled, false);
  assert.equal(app.config.tweaks.games["1"].steamResolution, "1280x720");
  assert.equal(app.config.tweaks.games["2"].nice, -2);
  assert.equal(app.config.tweaks.games["2"].enabled, undefined);
  assert.equal(app.config.tweaks.global.fexProfile, "custom");
});

test("a failed toggle change keeps the per-game profile enabled and its settings visible", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" },
    games: { "1": { enabled: true, fexProfile: "fast" }, "2": { nice: -2 } },
  } });
  app.resolutions.set(1, "1280x720");
  app.compatStates.set("1", { tool: "preview", priority: 250 });
  await app.settle();
  const saved = clone(app.config.tweaks);
  const write = app.apps.SetAppResolutionOverride;
  app.apps.SetAppResolutionOverride = async (appid, value) => {
    if (appid === 1 && value === "Default") throw new Error("toggle failed");
    await write(appid, value);
  };
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(false);
  await app.settle();
  assert.deepEqual(app.config.tweaks, saved);
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, true);
  assert.ok(app.control("1", "SelectEdit", "compatibility.fexPreset"));
  assert.equal(app.resolutions.get(1), "1280x720");
  assert.equal(app.compatStates.get("1").tool, "preview");
  assert.ok(app.elements().some((node) => node.type === "SupportingText" && String(node.props.children).includes("toggle failed")));
});

test("a pending resolution save completes before disabling per-game settings and remains saved for restoration", async () => {
  const app = setup();
  await app.settle();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const write = app.apps.SetAppResolutionOverride;
  app.apps.SetAppResolutionOverride = async (appid, value) => {
    if (value === "1280x720") await pending;
    await write(appid, value);
  };
  const saving = app.control("1", "SelectEdit", "compatibility.gameResolution").props.onChange("1280x720");
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(false);
  await app.settle();
  assert.equal(app.config.tweaks.games["1"].enabled, true);
  release();
  await saving;
  await app.settle();
  assert.equal(app.config.tweaks.games["1"].enabled, false);
  assert.equal(app.config.tweaks.games["1"].steamResolution, "1280x720");
  assert.equal(app.resolutions.get(1), "Default");
});

test("a pending Proton save cannot re-enable per-game settings after the editor is unmounted", async () => {
  const app = setup();
  await app.settle();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const specify = app.compat.specifyCompatTool;
  app.compat.specifyCompatTool = async (appid, tool) => {
    if (tool === "preview") await pending;
    await specify(appid, tool);
  };
  const saving = app.control("1", "SelectEdit", "compatibility.tool").props.onChange("preview");
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(false);
  app.select("2");
  release();
  await saving;
  await app.settle();
  assert.equal(app.config.tweaks.games["1"].enabled, false);
  assert.equal(app.config.tweaks.games["1"].steamCompatTool, "preview");
  assert.equal(app.compatStates.get("1").tool, "");
  assert.equal(app.config.selectedGame.appid, "2");
});

test("reset waits for pending native saves instead of allowing them to recreate a deleted profile", async () => {
  const app = setup();
  await app.settle();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const write = app.apps.SetAppResolutionOverride;
  app.apps.SetAppResolutionOverride = async (appid, value) => {
    if (value === "1280x720") await pending;
    await write(appid, value);
  };
  const saving = app.control("1", "SelectEdit", "compatibility.gameResolution").props.onChange("1280x720");
  app.control("1", "ButtonRow", "common.resetToDefault").props.onClick();
  app.modals.at(-1)!.props.onConfirm();
  release();
  await saving;
  await app.settle();
  assert.equal(app.config.tweaks.games["1"], undefined);
  assert.equal(app.resolutions.get(1), "Default");
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, false);
});

test("failed native resets retain saved game settings and show the error", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" },
    games: { "1": { fexProfile: "fast", enabled: true }, "2": { nice: -4 } },
  } });
  app.resolutions.set(1, "1280x720");
  await app.settle();
  const original = clone(app.config.tweaks.games);
  const write = app.apps.SetAppResolutionOverride;
  app.apps.SetAppResolutionOverride = async (appid, value) => {
    if (appid === 1 && value === "Default") throw new Error("native reset failed");
    await write(appid, value);
  };
  app.control("1", "ButtonRow", "common.resetToDefault").props.onClick();
  app.modals.at(-1)!.props.onConfirm();
  await app.settle();
  assert.deepEqual(app.config.tweaks.games, original);
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, true);
  assert.ok(app.elements().some((node) => node.type === "SupportingText" && String(node.props.children).includes("native reset failed")));
  app.control(null, "ButtonRow", "compatibility.resetAllGames").props.onClick();
  app.modals.at(-1)!.props.onConfirm();
  await app.settle();
  assert.deepEqual(app.config.tweaks.games, original);
  assert.ok(app.elements().some((node) => node.type === "SupportingText" && String(node.props.children).includes("native reset failed")));
});

test("reset all drains every native worker after a failure before releasing subsequent edits", async () => {
  const app = setup({ tweaks: {
    global: { windowsCompatTool: FOLLOW_STEAM_COMPAT, fexProfile: "default" },
    games: { "1": { enabled: true }, "2": { enabled: true } },
  } });
  await app.settle();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const write = app.apps.SetAppResolutionOverride;
  app.apps.SetAppResolutionOverride = async (appid, value) => {
    if (value === "Default") {
      if (appid === 1) throw new Error("first reset failed");
      if (appid === 2) await pending;
    }
    await write(appid, value);
  };
  app.control(null, "ButtonRow", "compatibility.resetAllGames").props.onClick();
  app.modals.at(-1)!.props.onConfirm();
  await app.settle();
  app.select("2");
  let saved = false;
  const saving = app.control("2", "SelectEdit", "compatibility.gameResolution").props.onChange("1280x720")
    .then(() => { saved = true; });
  await app.settle();
  assert.equal(saved, false);
  release();
  await saving;
  await app.settle();
  assert.equal(app.resolutions.get(2), "1280x720");
  assert.equal(app.config.tweaks.games["2"].steamResolution, "1280x720");
  assert.ok(app.config.tweaks.games["1"]);
});

for (const selectedGame of [null, games[0]]) {
  test(`the next-launch notice appears once in the first information section ${selectedGame ? "with" : "without"} a selected game`, () => {
    const app = setup({ selectedGame });
    const sections = app.elements().filter((node) => ["NoticeSection", "PanelSection"].includes(node.type));
    assert.equal(sections[0].type, "NoticeSection");
    assert.equal(sections[0].props.title, "common.information");
    assert.equal(sections[0].props.children, "compatibility.nextLaunchNotice");
    const notices = app.elements().filter((node) => node.type === "NoticeSection"
      && node.props.children === "compatibility.nextLaunchNotice");
    assert.equal(notices.length, 1);
    const defaults = sections.find((node) => node.props.title === "gameSettings.defaults");
    assert.equal(defaults?.props.children.props.children, "gameSettings.defaultsDescription");
  });
}

test("per-game toggle transitions do not show resetting labels and only enabled profiles offer Restore", async () => {
  const app = setup({ tweaks: { global: { windowsCompatTool: FOLLOW_STEAM_COMPAT }, games: {
    "1": { enabled: false, fexProfile: "fast" },
  } } });
  await app.settle();
  assert.equal(allElements(app.editor("1").rendered).some((node) => node.type === "ButtonRow" && node.props.children === "common.resetToDefault"), false);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const reset = app.compat.resetCompatToolToDefault;
  app.compat.resetCompatToolToDefault = async (appid) => { await pending; return reset(appid); };
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(true);
  await app.settle();
  assert.equal(app.elements().some((node) => node.props.children === "common.resetting"), false);
  assert.equal(app.control(null, "ButtonRow", "compatibility.resetAllGames").props.disabled, true);
  assert.equal(allElements(app.editor("1").rendered).some((node) => node.type === "ButtonRow" && node.props.children === "common.resetToDefault"), false);
  finish();
  await app.settle();
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, true);
  assert.ok(app.control("1", "ButtonRow", "common.resetToDefault"));
  app.control("1", "ToggleRow", "gameSettings.usePerGame").props.onChange(false);
  await app.settle();
  assert.equal(app.control("1", "ToggleRow", "gameSettings.usePerGame").props.value, false);
  assert.equal(allElements(app.editor("1").rendered).some((node) => node.type === "ButtonRow" && node.props.children === "common.resetToDefault"), false);
});
