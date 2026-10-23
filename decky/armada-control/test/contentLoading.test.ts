import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function compile(path: string) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

const contentSource = compile("../src/Content.tsx");
const loadingSource = compile("../src/components/LoadingState.tsx");
const element = (type: string, props: any) => ({ type, props });
const jsxRuntime = { jsx: element, jsxs: element, Fragment: "Fragment" };

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const slots: any[] = [];
  const requests: ReturnType<typeof deferred>[] = [];
  const effects = new Map<number, { dependencies: any[]; effect: () => (() => void) | undefined; cleanup?: () => void }>();
  let pending: Array<() => void> = [];
  let cursor = 0;
  let writes = 0;
  let saveOptions: any;
  let tree: any;
  const exports: any = {};
  runInNewContext(contentSource, {
    exports,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "react") return {
        useState: (initial: any) => {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], (next: any) => { writes++; slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
        },
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
            effects.set(index, { dependencies, effect, cleanup: effect() });
          });
        },
      };
      if (id === "@decky/ui") return { PanelSection: "PanelSection" };
      if (id === "./backend") return {
        getConfig: () => {
          const request = deferred();
          requests.push(request);
          return request.promise;
        },
        getInstalledGames: async () => [],
      };
      if (id === "./components/widgets") return { SupportingText: "SupportingText", ButtonRow: "ButtonRow" };
      if (id === "./hooks/useDebouncedSave") return { useDebouncedSave: (options: any) => { saveOptions = options; } };
      if (id === "./hooks/useLocale") return { useLocale: () => {} };
      if (id === "./lib/games") return { currentGame: () => null };
      if (id === "./i18n") return { t: (key: string) => key };
      if (id === "./icons") return { tabIcons: {} };
      const name = id.split("/").at(-1)!;
      return { [name]: name };
    },
    window: { setInterval: () => 1, clearInterval: () => {} },
  });
  function render() {
    cursor = 0;
    tree = exports.Content();
    const next = pending;
    pending = [];
    next.forEach((effect) => effect());
    return tree;
  }
  async function settle() {
    await new Promise((resolve) => setImmediate(resolve));
    render();
    await new Promise((resolve) => setImmediate(resolve));
    render();
  }
  render();
  return {
    requests,
    render,
    settle,
    get tree() { return tree; },
    get config() { return saveOptions.config; },
    get snapshot() { return saveOptions.snapshot.current; },
    get writes() { return writes; },
    get state() { return tree.props.children[1]; },
    reload: () => saveOptions.onError(),
    resolve: (index: number, marker = "loaded") => requests[index].resolve({
      tweaks: { global: { marker }, games: {} }, installedGames: [], rgbSupported: false,
    }),
    replayEffects: () => {
      for (const effect of effects.values()) effect.cleanup?.();
      for (const effect of effects.values()) effect.cleanup = effect.effect();
    },
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.(); },
  };
}

test("initial loading includes shared styles and a localized untitled loading state", () => {
  const app = setup();
  assert.equal(app.tree.type, "div");
  assert.equal(app.tree.props.className, "armada-control-startup");
  assert.equal(app.tree.props.children[0].type, "ArmadaStyles");
  assert.equal(app.state.type, "LoadingState");
  assert.equal(app.state.props.label, "common.loadingSettings");
  assert.doesNotMatch(JSON.stringify(app.tree), /Armada Control/);
  app.unmount();
});

test("loading indicator uses the native spinner with an accessible status", () => {
  const exports: any = {};
  runInNewContext(loadingSource, {
    exports,
    require: (id: string) => {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "@decky/ui") return { SteamSpinner: "SteamSpinner" };
      if (id === "react") return { useRef: () => ({ current: null }) };
      if (id === "../hooks/usePanelHeight") return { usePanelHeight: () => {} };
      if (id === "../i18n") return { t: (key: string) => key };
      throw new Error(id);
    },
  });
  const status = exports.LoadingState({});
  assert.equal(status.type, "div");
  assert.equal(status.props.role, "status");
  assert.equal(status.props["aria-busy"], true);
  assert.equal(status.props["aria-live"], "polite");
  const spinner = status.props.children;
  assert.equal(spinner.type, "SteamSpinner");
  assert.equal(spinner.props.background, "transparent");
  assert.equal(spinner.props.size, "small");
  assert.equal(spinner.props.showFooter, true);
  assert.equal(spinner.props.children, "common.loading");
});

test("a failed initial load provides a native retry and clears the error while retrying", async () => {
  const app = setup();
  app.requests[0].reject(new Error("connection unavailable"));
  await app.settle();
  assert.equal(app.state.type, "PanelSection");
  assert.equal(app.state.props.title, undefined);
  assert.equal(app.state.props.children[0].props.role, "alert");
  const error = app.state.props.children[0].props.children;
  assert.equal(error.type, "SupportingText");
  assert.match(error.props.children.join(""), /common.loadError: Error: connection unavailable/);
  const retry = app.state.props.children[1];
  assert.equal(retry.type, "ButtonRow");
  assert.equal(retry.props.children, "common.retry");
  retry.props.onClick();
  app.render();
  assert.equal(app.requests.length, 2);
  assert.equal(app.state.type, "LoadingState");
  app.resolve(1);
  await app.settle();
  assert.equal(app.state.type, "TabNavigation");
  assert.equal(app.config.tweaks.global.marker, "loaded");
  app.unmount();
});

test("only the latest successful config request updates config and saved snapshot", async () => {
  const app = setup();
  const newer = app.reload();
  app.resolve(1, "newer");
  await newer;
  await app.settle();
  app.resolve(0, "older");
  await app.settle();
  assert.equal(app.config.tweaks.global.marker, "newer");
  assert.equal(JSON.parse(app.snapshot).global.marker, "newer");
  app.unmount();
});

test("a stale failure cannot replace the newer request's loading or success state", async () => {
  const app = setup();
  const newer = app.reload();
  app.requests[0].reject(new Error("older failure"));
  await app.settle();
  assert.equal(app.state.type, "LoadingState");
  app.resolve(1);
  await newer;
  await app.settle();
  assert.equal(app.state.type, "TabNavigation");
  app.unmount();
});

test("StrictMode effect replay rejects the old load while preserving later save recovery", async () => {
  const app = setup();
  app.replayEffects();
  assert.equal(app.requests.length, 2);
  app.resolve(0, "discarded mount");
  await app.settle();
  assert.equal(app.state.type, "LoadingState");
  app.resolve(1, "active mount");
  await app.settle();
  assert.equal(app.config.tweaks.global.marker, "active mount");
  const recovery = app.reload();
  app.resolve(2, "recovered");
  await recovery;
  await app.settle();
  assert.equal(app.state.type, "TabNavigation");
  assert.equal(app.config.tweaks.global.marker, "recovered");
  app.unmount();
});

test("unmount ignores in-flight loading responses and later save recovery", async () => {
  const app = setup();
  app.unmount();
  const before = app.writes;
  app.resolve(0);
  await new Promise((resolve) => setImmediate(resolve));
  await app.reload();
  assert.equal(app.writes, before);
  assert.equal(app.requests.length, 1);
  assert.equal(app.snapshot, "");
});

test("unmount ignores in-flight loading failures", async () => {
  const app = setup();
  app.unmount();
  const before = app.writes;
  app.requests[0].reject(new Error("connection lost"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.writes, before);
});
