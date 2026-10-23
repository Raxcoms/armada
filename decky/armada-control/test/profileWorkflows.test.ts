import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as fanCurve from "../src/lib/fanCurve.ts";
import * as profileDraft from "../src/lib/profileDraft.ts";
import * as util from "../src/lib/util.ts";

interface Element {
  type: string | ((props: any) => any);
  props: any;
  key?: string;
  rendered?: any;
}

function elements(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...elements(tree.rendered), ...elements(tree.props?.children)];
}

function setup() {
  const curve = { label: "Moderate", curve: "40:50,70:100,90:255", ramp_up: 5, ramp_down: 4, smoothing: 0.5, min_pwm: 40 };
  const profile = { label: "Balanced", cpu_max: "1.00", cpu_governor: "schedutil", cpu_underclock: "small", gpu_min: "0.00", gpu_max: "1.00", fan_curve: "moderate" };
  let config: any = {
    power: { profiles: { balanced: profile, eco: { ...profile, label: "Eco" } }, fan_curves: { moderate: curve }, general: { default_profile: "balanced" }, underclocks: { TEST: {} }, fan: {} },
    powerDefaults: { profiles: { balanced: { ...profile, cpu_underclock: "none" } } },
    cpuDeviceClass: "TEST", chargingFanPwm: 50, perf: { governors: ["schedutil"] }, sshEnabled: false,
  };
  const initial = {
    fanCurves: { moderate: curve, custom: { ...curve, label: "Custom", ramp_up: 8 } },
    factoryFanCurves: { moderate: { ...curve, ramp_up: 3, min_pwm: 30 } },
    fanSettings: { ramp_up: 10, ramp_down: 9, smoothing: 0.7, min_pwm: 60 },
    factoryFanSettings: { ramp_up: 3, ramp_down: 4, smoothing: 0.5, min_pwm: 30 },
    profiles: { balanced: { label: "Balanced", fan_curve: "moderate" } }, activeProfile: "balanced", currentTemp: null,
  };
  const fanWrites: Array<{ changes: any; deleted: string[] }> = [];
  const powerWrites: any[] = [];
  const modals: Element[] = [];
  let closed = 0;
  let fanReads = 0;
  let fanResult: (() => Promise<any>) | undefined;
  let fansResult: (() => Promise<any>) | undefined;
  let powerResult: (() => Promise<any>) | undefined;
  let root: Element;
  let tree: any;
  const frames = new Map<string, any[]>();
  let slots: any[];
  let cursor = 0;
  let pendingEffects: Array<() => void> = [];
  const componentNames = ["ConfirmModal", "DialogBody", "DialogButton", "DialogControlsSection", "DialogControlsSectionHeader", "DialogFooter", "DialogHeader", "Dropdown", "Field", "Focusable", "PanelSection", "SliderField", "TextField", "ToggleField"];
  const element = (type: Element["type"], props: any, key?: string): Element => ({ type, props, key });
  const react = {
    useState: (initial: any) => {
      const owner = slots;
      const index = cursor++;
      if (!(index in owner)) owner[index] = typeof initial === "function" ? initial() : initial;
      return [owner[index], (next: any) => { owner[index] = typeof next === "function" ? next(owner[index]) : next; }];
    },
    useRef: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: (value: () => any) => value(),
    useCallback: (callback: any, dependencies: any[]) => {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect: (effect: () => void, dependencies: any[]) => {
      const owner = slots;
      const index = cursor++;
      const previous = owner[index];
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      const current = { dependencies, cleanup: undefined as any };
      owner[index] = current;
      pendingEffects.push(() => {
        previous?.cleanup?.();
        current.cleanup = effect();
      });
    },
  };
  const setConfig = (next: any) => { config = typeof next === "function" ? next(config) : next; };
  const backend = {
    getConfig: async () => util.clone(config),
    getFansState: async () => {
      fanReads += 1;
      return fansResult ? fansResult() : util.clone(initial);
    },
    setChargingFanPwm: async (value: number) => value,
    saveFanCurves: async (changes: any, deleted: string[]) => {
      fanWrites.push({ changes: util.clone(changes), deleted: [...deleted] });
      if (fanResult) return fanResult();
      const next = util.clone(initial);
      Object.assign(next.fanCurves, changes);
      for (const id of deleted) delete (next.fanCurves as any)[id];
      return next;
    },
    savePowerConfig: async (power: any) => {
      powerWrites.push(util.clone(power));
      return powerResult ? powerResult() : { ...util.clone(config), power: util.clone(power) };
    },
  };
  const modules = new Map<string, any>();
  function load(path: string): any {
    if (modules.has(path)) return modules.get(path);
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const exports: any = {};
    modules.set(path, exports);
    runInNewContext(compiled, {
      exports,
      window: { document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} }, setInterval: () => 1, clearInterval: () => {}, addEventListener: () => {}, removeEventListener: () => {} },
      document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
      require: (id: string): any => {
        if (id === "react") return react;
        if (id === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
        if (id === "@decky/ui") return { ...Object.fromEntries(componentNames.map((name) => [name, name])), gamepadDialogClasses: { FieldDescription: "native-description" }, showModal: (modal: Element) => modals.push(modal) };
        if (id === "../backend") return backend;
        if (id === "../i18n") return { t: (key: string) => key, translateLabel: (label: string) => label };
        if (id === "../lib/fanCurve") return fanCurve;
        if (id === "../lib/profileDraft") return profileDraft;
        if (id === "../lib/util") return util;
        if (id === "../hooks/useCurrentTemp") return { useCurrentTemp: () => 55 };
        if (id === "../hooks/useDebouncedApply") return { useDebouncedApply: () => () => {} };
        if (id.endsWith("/widgets")) return Object.fromEntries(["ButtonRow", "SectionDescription", "SliderEdit"].map((name) => [name, name]));
        if (id.endsWith("/ArmadaModalRoot")) return { ArmadaModalRoot: "ArmadaModalRoot", ArmadaDialogHeader: "ArmadaDialogHeader", ArmadaDialogFooter: "ArmadaDialogFooter" };
        if (id === "./AnimatedCollapse") return { AnimatedCollapse: "AnimatedCollapse" };
        const directory = path.slice(0, path.lastIndexOf("/"));
        const resolved: string[] = [];
        for (const part of `${directory}/${id}`.split("/")) {
          if (part === "..") resolved.pop();
          else if (part !== ".") resolved.push(part);
        }
        const target = resolved.join("/");
        return load(`${target}.${target.includes("/hooks/") || target.startsWith("hooks/") ? "ts" : "tsx"}`);
      },
    });
    return exports;
  }
  function render() {
    const expand = (node: any, path: string): any => {
      if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${index}`));
      if (!node || typeof node !== "object") return node;
      if (typeof node.type === "function") {
        const identity = `${path}/${node.type.name}/${node.key || ""}`;
        slots = frames.get(identity) || [];
        frames.set(identity, slots);
        cursor = 0;
        return { ...node, rendered: expand(node.type(node.props), `${identity}/rendered`) };
      }
      return { ...node, props: { ...node.props, children: expand(node.props?.children, `${path}/children`) } };
    };
    tree = expand(root, "root");
    const effects = pendingEffects;
    pendingEffects = [];
    for (const effect of effects) effect();
  }
  const mount = (node: Element) => {
    root = { ...node, props: { ...node.props, closeModal: () => { closed += 1; } } };
    render();
  };
  const control = (type: string, label?: string) => {
    const node = elements(tree).find((node) => node.type === type && (!label || node.props.label === label || node.props.children === label));
    assert.ok(node, `Missing ${type}: ${label}`);
    return node.props;
  };
  return {
    fanWrites, powerWrites, modals, initial, setConfig, render, mount, control,
    get nodes() { return elements(tree); },
    get config() { return config; }, get closed() { return closed; }, get fanReads() { return fanReads; },
    failFan: (result: () => Promise<any>) => { fanResult = result; },
    respondFans: (result: () => Promise<any>) => { fansResult = result; },
    respondPower: (result: () => Promise<any>) => { powerResult = result; },
    fan: (curveId = "moderate") => mount(element(load("components/FanCurveEditorModal.tsx").FanCurveEditorModal, { initial, curveId, onSaved: () => {} })),
    graph: (points: fanCurve.CurvePoint[]) => mount(element(load("components/FanCurveGraph.tsx").FanCurveGraph, { points, onChange: () => {} })),
    power: () => mount(element(load("tabs/Power.tsx").PowerProfileEditorModal, { profileId: "balanced", getLatestConfig: () => config, setConfig, onSaved: () => {} })),
    profiles: () => mount(element(load("tabs/Profiles.tsx").Profiles, { config, setConfig })),
    settle: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
  };
}

test("profile loading leaves native navigation empty until the first fan row is ready", async () => {
  const app = setup();
  let finish!: (value: any) => void;
  app.respondFans(() => new Promise((resolve) => { finish = resolve; }));
  app.profiles();
  assert.equal(app.control("div", "common.loading").role, "status");
  assert.equal(app.nodes.filter((node) => ["Field", "ButtonRow", "SectionDescription"].includes(String(node.type))).length, 0);
  finish(app.initial);
  await app.settle();
  assert.equal(app.nodes.find((node) => node.type === "ButtonRow")?.props.children, "Moderate");
});

test("the fan library can retry failures without reloading the plugin", async () => {
  const app = setup();
  app.respondFans(async () => { throw new Error("temporarily unavailable"); });
  app.profiles();
  await app.settle();
  assert.equal(app.control("Field", "profiles.loadingError").description, "Error: temporarily unavailable");
  assert.equal(app.fanReads, 1);
  app.control("ButtonRow", "common.retry").onClick();
  app.render();
  await app.settle();
  assert.equal(app.fanReads, 2);
  assert.equal(app.control("Field", "profiles.loadingError").description, "Error: temporarily unavailable");

  let finish!: (next: any) => void;
  app.respondFans(() => new Promise((resolve) => { finish = resolve; }));
  app.control("ButtonRow", "common.retry").onClick();
  app.render();
  app.render();
  assert.equal(app.control("div", "common.loading").role, "status");
  assert.equal(app.fanReads, 3);
  finish(app.initial);
  await app.settle();
  app.control("ButtonRow", "Moderate").onClick();
  assert.equal(app.modals.at(-1)?.props.curveId, "moderate");
  assert.equal(app.fanWrites.length, 0);
});

test("an older fan library retry cannot overwrite a newer successful response", async () => {
  const app = setup();
  app.respondFans(async () => { throw new Error("unavailable"); });
  app.profiles();
  await app.settle();
  const retry = app.control("ButtonRow", "common.retry").onClick;
  let finishOld!: (next: any) => void;
  app.respondFans(() => new Promise((resolve) => { finishOld = resolve; }));
  retry();
  app.render();
  app.respondFans(async () => ({ ...app.initial, fanCurves: { moderate: { ...app.initial.fanCurves.moderate, label: "Newest" } } }));
  retry();
  app.render();
  await app.settle();
  app.control("ButtonRow", "Newest");
  finishOld(app.initial);
  await app.settle();
  app.control("ButtonRow", "Newest");
  assert.equal(app.fanReads, 3);
});

test("legacy equal-temperature points sort by PWM so the graph and editor agree on Fan Stop", () => {
  const legacy = "40:100,40:0,90:255";
  const unsorted = [{ temp: 40, pwm: 100 }, { temp: 40, pwm: 0 }, { temp: 90, pwm: 255 }];
  assert.deepEqual(fanCurve.parseCurve(legacy), [{ temp: 40, pwm: 0 }, { temp: 40, pwm: 100 }, { temp: 90, pwm: 255 }]);
  assert.equal(fanCurve.formatCurve(unsorted), "40:0,40:100,90:255");
  const app = setup();
  app.graph(unsorted);
  assert.match(app.control("path").d, /^M 26 152 L 108 152 /);
  assert.equal(app.control("text", "fanCurve.stopped").children, "fanCurve.stopped");
  app.initial.fanCurves.moderate.curve = legacy;
  app.fan();
  assert.equal(app.control("ToggleField", "fanCurve.stop").checked, true);
  assert.equal(app.control("SliderField", "fanCurve.minimumSpeed").value, 0);
  assert.equal(app.initial.fanCurves.moderate.min_pwm, 40);
});

test("duplicate-temperature save errors keep the numeric edit and modal open", async () => {
  const app = setup();
  const message = "Fan curve moderate has duplicate temperature 40";
  app.failFan(async () => { throw new Error(message); });
  app.fan();
  app.control("DialogButton", "fanCurve.editPoints").onClick();
  app.render();
  app.control("TextField", "P2: fanCurve.temperature").onChange({ target: { value: "40" } });
  app.render();
  app.control("TextField", "P2: fanCurve.temperature").onBlur();
  app.render();
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  assert.equal(app.fanWrites[0].changes.moderate.curve, "40:50,40:100,90:255");
  assert.equal(app.closed, 0);
  assert.equal(app.control("TextField", "P2: fanCurve.temperature").value, "40");
  assert.equal(app.control("div").children, `Error: ${message}`);
  assert.equal(app.control("DialogButton", "common.saveChanges").disabled, false);
  assert.equal(app.initial.fanCurves.moderate.curve, "40:50,70:100,90:255");
});

test("Cancel discards a fan draft without any writes", () => {
  const app = setup();
  app.fan();
  app.control("SliderField", "fanCurve.rampUp").onChange(12);
  app.render();
  assert.equal(app.control("SliderField", "fanCurve.rampUp").value, 12);
  app.control("DialogButton", "common.cancel").onClick();
  assert.equal(app.closed, 1);
  assert.equal(app.fanWrites.length, 0);
  assert.equal(app.initial.fanCurves.moderate.ramp_up, 5);
});

test("Save writes only the fixed fan target and closes after persistence", async () => {
  const app = setup();
  app.fan();
  app.control("SliderField", "fanCurve.rampDown").onChange(11);
  app.render();
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  assert.equal(app.closed, 1);
  assert.deepEqual(Object.keys(app.fanWrites[0].changes), ["moderate"]);
  assert.equal(app.fanWrites[0].changes.moderate.ramp_down, 11);
  assert.deepEqual(app.fanWrites[0].deleted, []);
  assert.equal(app.initial.fanCurves.custom.ramp_up, 8);
});

test("failed fan saves keep the edited draft open and show the error", async () => {
  const app = setup();
  app.failFan(async () => { throw new Error("write failed"); });
  app.fan();
  app.control("SliderField", "fanCurve.rampUp").onChange(12);
  app.render();
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  assert.equal(app.closed, 0);
  assert.equal(app.control("SliderField", "fanCurve.rampUp").value, 12);
  assert.match(app.control("div").children?.toString() || "", /write failed/);
});

test("a pending fan save rejects duplicate requests and dialog cancellation", async () => {
  const app = setup();
  let finish!: (next: any) => void;
  app.failFan(() => new Promise((resolve) => { finish = resolve; }));
  app.fan();
  app.control("SliderField", "fanCurve.rampUp").onChange(12);
  app.render();
  const save = app.control("DialogButton", "common.saveChanges").onClick;
  save();
  save();
  app.control("ArmadaModalRoot").onCancel();
  assert.equal(app.fanWrites.length, 1);
  assert.equal(app.closed, 0);
  finish(app.initial);
  await app.settle();
  assert.equal(app.closed, 1);
});

test("Create opens a temporary resolved clone and Cancel writes nothing", async () => {
  const app = setup();
  app.profiles();
  await app.settle();
  app.control("ButtonRow", "fanCurve.create").onClick();
  app.mount(app.modals.at(-1)!);
  app.control("TextField", "fanCurve.name").onChange({ target: { value: "Quiet game" } });
  app.render();
  app.control("DialogButton", "fanCurve.create").onClick();
  assert.equal(app.fanWrites.length, 0);
  app.mount(app.modals.at(-1)!);
  assert.equal(app.control("TextField", "fanCurve.name").value, "Quiet game");
  assert.equal(app.control("SliderField", "fanCurve.rampUp").value, 5);
  assert.equal(app.control("SliderField", "fanCurve.minimumSpeed").value, fanCurve.pwmToPercent(40));
  app.control("DialogButton", "common.cancel").onClick();
  assert.equal(app.fanWrites.length, 0);
  assert.equal("quiet_game" in app.initial.fanCurves, false);
});

test("saving a new profile writes its cloned settings under a stable ID", async () => {
  const app = setup();
  app.profiles();
  await app.settle();
  app.control("ButtonRow", "fanCurve.create").onClick();
  app.mount(app.modals.at(-1)!);
  app.control("TextField", "fanCurve.name").onChange({ target: { value: "Quiet game" } });
  app.render();
  app.control("DialogButton", "fanCurve.create").onClick();
  app.mount(app.modals.at(-1)!);
  app.control("TextField", "fanCurve.name").onChange({ target: { value: "Renamed later" } });
  app.render();
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  assert.deepEqual(Object.keys(app.fanWrites[0].changes), ["quiet_game"]);
  assert.deepEqual(app.fanWrites[0].changes.quiet_game, { ...app.initial.fanCurves.moderate, label: "Renamed later" });
});

test("factory reset restores points and all responsiveness settings only after Save", async () => {
  const app = setup();
  app.fan();
  app.control("DialogButton", "fanCurve.resetFactory").onClick();
  app.render();
  assert.equal(app.control("SliderField", "fanCurve.rampUp").value, 3);
  assert.equal(app.control("SliderField", "fanCurve.minimumSpeed").value, fanCurve.pwmToPercent(30));
  assert.equal(app.fanWrites.length, 0);
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  assert.deepEqual(app.fanWrites[0].changes.moderate, app.initial.factoryFanCurves.moderate);
});

test("custom deletion requires confirmation and assigned profiles stay protected", async () => {
  const app = setup();
  app.fan("custom");
  app.control("DialogButton", "fanCurve.delete").onClick();
  assert.equal(app.fanWrites.length, 0);
  assert.equal(app.modals.at(-1)?.type, "ConfirmModal");
  app.modals.at(-1)!.props.onOK();
  await app.settle();
  assert.deepEqual(app.fanWrites[0], { changes: {}, deleted: ["custom"] });
  const assigned = setup();
  assigned.initial.profiles.balanced.fan_curve = "custom";
  assigned.fan("custom");
  assert.equal(assigned.control("DialogButton", "fanCurve.delete").disabled, true);
});

test("Fan Stop saves the selected curve with its minimum preserved across reopen", async () => {
  const app = setup();
  app.fan();
  app.control("ToggleField", "fanCurve.stop").onChange(true);
  app.render();
  assert.equal(app.control("SliderField", "fanCurve.minimumSpeed").value, 0);
  assert.equal(app.control("SliderField", "fanCurve.minimumSpeed").disabled, true);
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  const saved = app.fanWrites[0].changes.moderate;
  assert.equal(saved.min_pwm, 40);
  assert.equal("custom" in app.fanWrites[0].changes, false);
  const reopened = setup();
  reopened.initial.fanCurves.moderate = saved;
  reopened.fan();
  reopened.control("ToggleField", "fanCurve.stop").onChange(false);
  reopened.render();
  assert.equal(reopened.control("SliderField", "fanCurve.minimumSpeed").value, fanCurve.pwmToPercent(40));
});

test("performance Save merges newer profiles and preserves unrelated frontend state", async () => {
  const app = setup();
  app.power();
  app.control("SliderField", "power.gpuMin").onChange(80);
  app.render();
  app.setConfig((current: any) => ({ ...current, sshEnabled: true, power: { ...current.power, profiles: { ...current.power.profiles, eco: { ...current.power.profiles.eco, cpu_underclock: "large" } } } }));
  app.respondPower(async () => ({ ...app.config, sshEnabled: false, power: app.powerWrites[0] }));
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  assert.equal(app.powerWrites[0].profiles.balanced.gpu_min, "0.80");
  assert.equal(app.powerWrites[0].profiles.eco.cpu_underclock, "large");
  assert.equal(app.config.power.profiles.eco.cpu_underclock, "large");
  assert.equal(app.config.sshEnabled, true);
  assert.equal(app.closed, 1);
});

test("performance Cancel makes no writes and a pending Save cannot run twice", async () => {
  const cancelled = setup();
  cancelled.power();
  cancelled.control("SliderField", "power.gpuMin").onChange(80);
  cancelled.control("ArmadaModalRoot").onCancel();
  assert.equal(cancelled.powerWrites.length, 0);
  assert.equal(cancelled.config.power.profiles.balanced.gpu_min, "0.00");
  const app = setup();
  let finish!: (next: any) => void;
  app.respondPower(() => new Promise((resolve) => { finish = resolve; }));
  app.power();
  app.control("SliderField", "power.gpuMin").onChange(80);
  app.render();
  const save = app.control("DialogButton", "common.saveChanges").onClick;
  save();
  save();
  assert.equal(app.powerWrites.length, 1);
  app.control("ArmadaModalRoot").onCancel();
  assert.equal(app.closed, 0);
  finish({ ...app.config, power: app.powerWrites[0] });
  await app.settle();
  assert.equal(app.closed, 1);
});

test("failed performance saves retain the draft without changing shared config", async () => {
  const app = setup();
  app.respondPower(async () => { throw new Error("write failed"); });
  app.power();
  app.control("SliderField", "power.gpuMin").onChange(80);
  app.render();
  app.control("DialogButton", "common.saveChanges").onClick();
  await app.settle();
  assert.equal(app.closed, 0);
  assert.equal(app.control("SliderField", "power.gpuMin").value, 80);
  assert.equal(app.config.power.profiles.balanced.gpu_min, "0.00");
  assert.match(app.control("div").children?.toString() || "", /write failed/);
});
