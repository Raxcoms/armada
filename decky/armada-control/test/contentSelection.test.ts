import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/Content.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const games = [{ appid: "1", name: "First game" }, { appid: "2", name: "Second game" }];

async function setup() {
  const slots: any[] = [];
  const effects = new Map<number, { dependencies: any[]; cleanup?: () => void }>();
  const timers = new Set<() => void>();
  let runtimeGame: typeof games[number] | null = null;
  let pending: Array<() => void> = [];
  let cursor = 0;
  let saveOptions: any;
  let tree: any;
  const exports: any = {};
  const react = {
    useState: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef: (initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (callback: () => void) => {
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
  const element = (type: string, props: any) => ({ type, props });
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
      if (id === "@decky/ui") return { Field: "Field", PanelSection: "PanelSection" };
      if (id === "./backend") return {
        getConfig: async () => ({ tweaks: { global: {}, games: {} }, installedGames: [], rgbSupported: false }),
        getInstalledGames: async () => games,
      };
      if (id === "./hooks/useDebouncedSave") return { useDebouncedSave: (options: any) => { saveOptions = options; } };
      if (id === "./hooks/useLocale") return { useLocale: () => {} };
      if (id === "./lib/games") return { currentGame: () => runtimeGame };
      if (id === "./i18n") return { t: (key: string) => key };
      if (id === "./icons") return { tabIcons: {} };
      if (id === "./styles") return { styles: "" };
      const name = id.split("/").at(-1)!;
      return { [name]: name };
    },
    window: {
      setInterval: (callback: () => void) => { timers.add(callback); return callback; },
      clearInterval: (callback: () => void) => timers.delete(callback),
    },
  });
  function render() {
    cursor = 0;
    tree = exports.Content();
    const next = pending;
    pending = [];
    for (const effect of next) effect();
  }
  async function settle() {
    await new Promise((resolve) => setImmediate(resolve));
    render();
    await new Promise((resolve) => setImmediate(resolve));
    render();
  }
  function gameSettings() {
    const navigation = tree.props.children.find((child: any) => child.type === "TabNavigation");
    return navigation.props.tabs.find((tab: any) => tab.id === "Compatibility").content.props;
  }
  render();
  await settle();
  return {
    get config() { return saveOptions.config; },
    setRuntime: (game: typeof runtimeGame) => {
      runtimeGame = game;
      for (const callback of timers) callback();
      render();
    },
    select: (selectedGame: typeof runtimeGame) => {
      gameSettings().setConfig((current: any) => ({ ...current, selectedGame }));
      render();
    },
    reload: async () => { await saveOptions.onError(); await settle(); },
  };
}

test("startup without a game preserves automatic following through runtime changes and config reload", async () => {
  const app = await setup();
  assert.equal(app.config.selectedGame, undefined);
  app.setRuntime(games[0]);
  assert.equal(app.config.game.appid, "1");
  assert.equal(app.config.selectedGame, undefined);
  await app.reload();
  assert.equal(app.config.selectedGame, undefined);
  app.setRuntime(games[1]);
  assert.equal(app.config.game.appid, "2");
  assert.equal(app.config.selectedGame, undefined);
});

test("manual selection and explicit clearing survive runtime changes and config reload", async () => {
  const app = await setup();
  app.setRuntime(games[0]);
  app.select(games[1]);
  await app.reload();
  assert.equal(app.config.selectedGame.appid, "2");
  app.setRuntime(null);
  assert.equal(app.config.selectedGame.appid, "2");
  app.select(null);
  app.setRuntime(games[0]);
  await app.reload();
  assert.equal(app.config.game.appid, "1");
  assert.equal(app.config.selectedGame, null);
});
