import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createConfigMutation } from "../src/lib/configMutation.ts";

const sourceRoot = new URL("../src/", import.meta.url);
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(file, sourceRoot), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup() {
  let config: any = {
    controllerType: "deck-uhid", controllerTypes: [], calibratedAt: null,
    sshEnabled: false, mtpEnabled: false,
    bottomScreenSupported: true, bottomScreenEnabled: false, bottomScreenBrightnessSupported: false,
    desktopMode: "desktop", desktopModes: [{ data: "desktop" }, { data: "mobile" }],
    sleepMode: "s2idle", sleepModes: [], swipeGesturesEnabled: true,
    chargingFanPwm: 50, power: { profiles: { balanced: { fan_curve: "balanced" } } },
  };
  let swipeSaving = false;
  let stored = { ...config };
  let reads = 0;
  const recoveries: Promise<any>[] = [];
  let calibration: ((state: any) => void) | undefined;
  const calls: Array<{ name: string; value: unknown; result: ReturnType<typeof deferred<any>> }> = [];
  const toasts: unknown[] = [];
  const modules = new Map<string, any>();
  const setConfig = (next: any) => { config = typeof next === "function" ? next(config) : next; };
  const element = (type: any, props: any) => ({ type, props });
  function load(file: string): any {
    if (modules.has(file)) return modules.get(file);
    const exports: any = {};
    modules.set(file, exports);
    runInNewContext(compile(file), {
      exports,
      require: (id: string) => {
        if (id === "react") return { useEffect: () => {}, useState: () => [swipeSaving, (next: boolean) => { swipeSaving = next; }] };
        if (id === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
        if (id === "@decky/api") return { toaster: { toast: (toast: unknown) => toasts.push(toast) } };
        if (id === "@decky/ui") return { PanelSection: "PanelSection" };
        if (id === "../backend") return new Proxy({}, { get: (_target, name: string) => (value: unknown) => {
          if (name === "getConfig") {
            reads++;
            return recoveries.shift() ?? Promise.resolve({ ...stored });
          }
          const result = deferred<any>();
          calls.push({ name, value, result });
          return result.promise.then((applied) => {
            const field = name.slice(3, 4).toLowerCase() + name.slice(4);
            stored = { ...stored, [field]: applied };
            return applied;
          });
        } });
        if (id === "../components/widgets") return Object.fromEntries(["ButtonRow", "NoticeSection", "ReadOnlyRow", "SectionDescription", "SelectEdit", "SliderEdit", "ToggleRow"].map((name) => [name, name]));
        if (id === "../components/Calibration") return { openCalibration: (changed: (state: any) => void) => { calibration = changed; } };
        if (id === "../hooks/useDebouncedApply") return { useDebouncedApply: () => () => {} };
        if (id === "../i18n") return { t: (key: string) => key, translateLabel: (label: string) => label, getCurrentLocale: () => "en" };
        if (id === "../lib/fanCurve") return { pwmToPercent: (value: number) => value, percentToPwm: (value: number) => value };
        if (id === "../lib/configMutation") return load("lib/configMutation.ts");
        throw new Error(`Unexpected import ${id}`);
      },
    });
    return exports;
  }
  function nodes(node: any): any[] {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== "object") return [];
    return [node, ...nodes(node.props?.children)];
  }
  function render(tab: "Controller" | "Experimental") {
    return nodes(load(`tabs/${tab}.tsx`)[tab]({ config, setConfig }));
  }
  const controller = () => render("Controller").find((node) => node.type === "SelectEdit");
  const experimental = (label: string) => render("Experimental").find((node) => node.props?.label === label);
  const select = (section: string) => {
    const panel = render("Experimental").find((node) => node.type === "PanelSection" && node.props.title === section);
    return nodes(panel).find((node) => node.type === "SelectEdit");
  };
  return {
    calls, toasts, controller, experimental, select, render, setConfig,
    get config() { return config; },
    get reads() { return reads; },
    store: (next: any) => { stored = { ...stored, ...next }; },
    recovery: (result: Promise<any>) => { recoveries.push(result); },
    reopen: () => { swipeSaving = false; },
    calibrate: (date: string) => {
      render("Controller").find((node) => node.type === "ButtonRow").props.onClick();
      calibration?.({ calibratedAt: date });
    },
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test("controller choices serialize across reopening and older responses cannot replace the latest choice", async () => {
  const app = setup();
  const first = app.controller().props.onChange("xbox");
  await app.settle();
  app.reopen();
  const latest = app.controller().props.onChange("dualsense");
  await app.settle();
  assert.equal(app.calls.length, 1);
  assert.equal(app.config.controllerType, "dualsense");
  app.calls[0].result.resolve("xbox");
  await first;
  await app.settle();
  assert.equal(app.config.controllerType, "dualsense");
  assert.equal(app.calls[1].value, "dualsense");
  app.calls[1].result.resolve("dualsense");
  await latest;
  assert.equal(app.config.controllerType, "dualsense");
});

test("failed controller changes roll back to the last confirmed value rather than a pending choice", async () => {
  const app = setup();
  const first = app.controller().props.onChange("xbox");
  await app.settle();
  app.reopen();
  const latest = app.controller().props.onChange("dualsense");
  app.calls[0].result.reject(new Error("first failed"));
  await first;
  await app.settle();
  assert.equal(app.config.controllerType, "dualsense");
  app.calls[1].result.reject(new Error("latest failed"));
  await latest;
  assert.equal(app.config.controllerType, "deck-uhid");
});

test("late controller reconciliation preserves calibration and unrelated parent config", async () => {
  const app = setup();
  const pending = app.controller().props.onChange("xbox");
  await app.settle();
  app.reopen();
  app.calibrate("2026-10-23T12:00:00Z");
  app.setConfig((current: any) => ({ ...current, sshEnabled: true, power: { ...current.power, marker: "newer" } }));
  app.calls[0].result.resolve("xbox");
  await pending;
  assert.equal(app.config.calibratedAt, "2026-10-23T12:00:00Z");
  assert.equal(app.config.sshEnabled, true);
  assert.equal(app.config.power.marker, "newer");
  assert.equal(app.config.controllerType, "xbox");
});

test("a failed latest selection restores the last successful backend response", async () => {
  const app = setup();
  const first = app.controller().props.onChange("xbox");
  await app.settle();
  const latest = app.controller().props.onChange("dualsense");
  app.calls[0].result.resolve("xbox-applied");
  await first;
  await app.settle();
  app.calls[1].result.reject(new Error("latest failed"));
  await latest;
  assert.equal(app.config.controllerType, "xbox-applied");
  const retry = app.controller().props.onChange("dualsense");
  await app.settle();
  app.calls[2].result.resolve("dualsense");
  await retry;
  assert.equal(app.config.controllerType, "dualsense");
});

test("failure recovery respects externally changed config and reconciles only the selected field", async () => {
  const app = setup();
  const first = app.controller().props.onChange("xbox");
  await app.settle();
  app.calls[0].result.resolve("xbox");
  await first;
  assert.equal(app.reads, 0);
  app.store({ controllerType: "external-controller", sshEnabled: false });
  app.setConfig((current: any) => ({ ...current, sshEnabled: true }));
  const latest = app.controller().props.onChange("dualsense");
  await app.settle();
  app.calls[1].result.reject(new Error("write failed"));
  await latest;
  assert.equal(app.reads, 1);
  assert.equal(app.config.controllerType, "external-controller");
  assert.equal(app.config.sshEnabled, true);
});

test("failed recovery falls back to the last backend-confirmed value instead of an optimistic snapshot", async () => {
  const app = setup();
  const first = app.controller().props.onChange("xbox");
  await app.settle();
  app.calls[0].result.resolve("confirmed-xbox");
  await first;
  const recovery = deferred<any>();
  app.recovery(recovery.promise);
  const latest = app.controller().props.onChange("dualsense");
  await app.settle();
  app.calls[1].result.reject(new Error("write failed"));
  await app.settle();
  recovery.reject(new Error("read failed"));
  await latest;
  assert.equal(app.config.controllerType, "confirmed-xbox");
});

test("recovery reads finish before later writes and superseded errors do not change the latest intent", async () => {
  const app = setup();
  const recovery = deferred<any>();
  app.recovery(recovery.promise);
  const first = app.select("settings.desktopMode").props.onChange("mobile");
  await app.settle();
  app.calls[0].result.reject(new Error("old failed"));
  await app.settle();
  app.reopen();
  const latest = app.select("settings.desktopMode").props.onChange("desktop");
  await app.settle();
  assert.equal(app.calls.length, 1);
  assert.equal(app.config.desktopMode, "desktop");
  recovery.resolve({ desktopMode: "recovered-mobile" });
  await first;
  await app.settle();
  assert.equal(app.calls.length, 2);
  assert.equal(app.toasts.length, 0);
  assert.equal(app.config.desktopMode, "desktop");
  app.calls[1].result.resolve("desktop");
  await latest;
  assert.equal(app.config.desktopMode, "desktop");
});

for (const [label, field, backend] of [
  ["settings.enableSsh", "sshEnabled", "setSshEnabled"],
  ["settings.bottomScreen", "bottomScreenEnabled", "setBottomScreenEnabled"],
]) {
  test(`${field} changes retain the latest choice and confirmed rollback across reopening`, async () => {
    const app = setup();
    const first = app.experimental(label).props.onChange(true);
    await app.settle();
    app.reopen();
    const latest = app.experimental(label).props.onChange(false);
    await app.settle();
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].name, backend);
    app.calls[0].result.reject(new Error("old write failed"));
    await first;
    await app.settle();
    assert.equal(app.config[field], false);
    assert.equal(app.toasts.length, 0);
    app.calls[1].result.reject(new Error("latest write failed"));
    await latest;
    assert.equal(app.config[field], false);
    assert.equal(app.toasts.length, field === "bottomScreenEnabled" ? 1 : 0);
  });
}

test("desktop selection keeps native error feedback without letting an older save win", async () => {
  const app = setup();
  const first = app.select("settings.desktopMode").props.onChange("mobile");
  await app.settle();
  app.reopen();
  const latest = app.select("settings.desktopMode").props.onChange("desktop");
  app.calls[0].result.resolve("mobile");
  await first;
  await app.settle();
  assert.equal(app.config.desktopMode, "desktop");
  app.calls[1].result.reject(new Error("latest write failed"));
  await latest;
  assert.equal(app.config.desktopMode, "mobile");
  assert.equal(app.toasts.length, 1);
});

test("swipe gestures retain their busy lock and wait for confirmation across reopening", async () => {
  const app = setup();
  const first = app.experimental("settings.swipeGestures").props.onChange(false);
  await app.settle();
  assert.equal(app.config.swipeGesturesEnabled, true);
  assert.equal(app.experimental("settings.swipeGestures").props.disabled, true);
  await app.experimental("settings.swipeGestures").props.onChange(true);
  assert.equal(app.calls.length, 1);
  app.reopen();
  const latest = app.experimental("settings.swipeGestures").props.onChange(true);
  app.calls[0].result.resolve(false);
  await first;
  await app.settle();
  assert.equal(app.calls.length, 2);
  assert.equal(app.config.swipeGesturesEnabled, true);
  app.calls[1].result.reject(new Error("latest write failed"));
  await latest;
  assert.equal(app.config.swipeGesturesEnabled, false);
  assert.equal(app.toasts.length, 1);
});

test("independent config fields and parent owners do not share state or block each other", async () => {
  const app = setup();
  const other = setup();
  const controller = app.controller().props.onChange("xbox");
  const ssh = app.experimental("settings.enableSsh").props.onChange(true);
  const otherController = other.controller().props.onChange("dualsense");
  await app.settle();
  assert.deepEqual(app.calls.map((call) => call.name), ["setControllerType", "setSshEnabled"]);
  assert.equal(other.calls.length, 1);
  app.calls[1].result.resolve(true);
  await ssh;
  assert.equal(app.config.controllerType, "xbox");
  assert.equal(app.config.sshEnabled, true);
  other.calls[0].result.resolve("dualsense");
  await otherController;
  app.calls[0].result.reject(new Error("controller failed"));
  await controller;
  assert.equal(app.config.controllerType, "deck-uhid");
  assert.equal(app.config.sshEnabled, true);
  assert.equal(other.config.controllerType, "dualsense");
});

test("one shared setting updater isolates separate parent owners and never recreates unloaded config", async () => {
  const writes: Array<ReturnType<typeof deferred<string>>> = [];
  const save = createConfigMutation("controllerType", () => {
    const request = deferred<string>();
    writes.push(request);
    return request.promise;
  });
  let firstConfig: any = { controllerType: "first-owner" };
  let secondConfig: any = { controllerType: "second-owner" };
  const firstSetter: any = (update: (value: any) => any) => { firstConfig = update(firstConfig); };
  const secondSetter: any = (update: (value: any) => any) => { secondConfig = update(secondConfig); };
  const first = save(firstConfig, firstSetter, "xbox");
  const second = save(secondConfig, secondSetter, "dualsense");
  await Promise.resolve();
  assert.equal(writes.length, 2);
  firstConfig = null;
  writes[0].resolve("xbox");
  writes[1].reject(new Error("second failed"));
  await Promise.all([first, second]);
  assert.equal(firstConfig, null);
  assert.equal(secondConfig.controllerType, "second-owner");
});

for (const outcome of ["success", "failure"] as const) {
  test(`delayed React ${outcome} reconciliation cannot make a stale render the next rollback value`, async () => {
    let config: any = { controllerType: "deck-uhid" };
    const updates: Array<(current: any) => any> = [];
    const requests: Array<ReturnType<typeof deferred<string>>> = [];
    const save = createConfigMutation("controllerType", () => {
      const request = deferred<string>();
      requests.push(request);
      return request.promise;
    });
    const setConfig: any = (update: (current: any) => any) => { updates.push(update); };
    const flush = () => { while (updates.length) config = updates.shift()!(config); };
    const first = save(config, setConfig, "first-choice");
    await Promise.resolve();
    flush();
    assert.equal(config.controllerType, "first-choice");
    if (outcome === "success") requests[0].resolve("confirmed-first");
    else requests[0].reject(new Error("first failed"));
    await first;
    const latest = save(config, setConfig, "second-choice");
    await Promise.resolve();
    requests[1].reject(new Error("second failed"));
    await latest;
    flush();
    assert.equal(config.controllerType, outcome === "success" ? "confirmed-first" : "deck-uhid");
  });
}
