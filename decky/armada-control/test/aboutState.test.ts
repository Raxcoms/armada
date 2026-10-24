import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../src/tabs/About.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const queueCompiled = ts.transpileModule(readFileSync(new URL("../src/hooks/useDebouncedApply.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const widgetsCompiled = ts.transpileModule(readFileSync(new URL("../src/components/widgets.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup() {
  let saving = false;
  let tree: any;
  let response: Promise<boolean> = Promise.resolve(true);
  const writes: boolean[] = [];
  const toasts: unknown[] = [];
  const hookCalls: unknown[][] = [];
  let retries = 0;
  let reads = 0;
  let persisted: any;
  const state: any = {
    value: null,
    error: "",
    setValue: (next: any) => { state.value = typeof next === "function" ? next(state.value) : next; },
    refresh: async () => { retries++; },
  };
  const queue: any = {};
  runInNewContext(queueCompiled, { exports: queue, require: () => ({}) });
  const widgets: any = {};
  runInNewContext(widgetsCompiled, {
    exports: widgets,
    require: (id: string) => {
      if (id === "@decky/ui") return { Field: "Field", PanelSectionRow: "PanelSectionRow" };
      if (id === "../icons") return { noticeIcons: {} };
      if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }) };
      throw new Error(`Unexpected widgets import ${id}`);
    },
  });
  const exports: any = {};
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "react") return {
        useRef: () => ({ current: null }),
        useState: () => [saving, (next: boolean) => { saving = next; }],
      };
      if (id === "react/jsx-runtime") return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (id === "@decky/api") return { toaster: { toast: (toast: unknown) => { toasts.push(toast); } } };
      if (id === "@decky/ui") return { Field: "Field", PanelSection: "PanelSection" };
      if (id === "../components/widgets") return { ButtonRow: "ButtonRow", SupportingText: "SupportingText", ToggleRow: "ToggleRow", ReadOnlyRow: widgets.ReadOnlyRow };
      if (id === "../backend") return {
        getSleepLogsStatus: async () => { reads++; return persisted ?? state.value; },
        setSleepLogsEnabled: (enabled: boolean) => {
          writes.push(enabled);
          return response.then((applied) => {
            persisted = { ...(persisted ?? state.value), enabled: applied };
            return applied;
          });
        },
      };
      if (id === "../hooks/useBackendState") return { useBackendState: (...args: unknown[]) => { hookCalls.push(args); return state; } };
      if (id === "../hooks/useDebouncedApply") return queue;
      if (id === "../i18n") return { t: (key: string) => key };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  function render() {
    tree = exports.About({ config: { osVersion: "20261022", ablVersion: "1.2" } });
  }
  function nodes(node: any): any[] {
    if (Array.isArray(node)) return node.flatMap((item) => nodes(item));
    if (!node || typeof node !== "object") return [];
    if (typeof node.type === "function") return [node, ...nodes(node.type(node.props))];
    return [node, ...nodes(node.props?.children)];
  }
  render();
  return {
    state, render, nodes: () => nodes(tree), writes, toasts, hookCalls,
    get retries() { return retries; },
    get reads() { return reads; },
    response: (next: Promise<boolean>) => { response = next; },
    toggle: () => nodes(tree).find((node) => node.type === "ToggleRow"),
    reopen: () => { saving = false; render(); },
    settle: async () => { await new Promise((resolve) => setImmediate(resolve)); render(); },
  };
}

test("About initially shows neutral loading instead of a false toggle or unknown directory", () => {
  const app = setup();
  assert.equal(app.toggle(), undefined);
  assert.ok(app.nodes().some((node) => node.type === "SupportingText" && node.props.children === "common.loading"));
  assert.equal(app.nodes().some((node) => node.props.label === "about.logDirectory"), false);
  assert.equal(app.hookCalls[0][4], true);
  assert.deepEqual(app.writes, []);
});

test("About read-only information is natively focusable and has no activation behavior", () => {
  const app = setup();
  app.state.value = { enabled: true, directory: "/var/home/armada/Documents/sleep-logs" };
  app.render();
  const fields = app.nodes().filter((node) => node.type === "Field");
  assert.deepEqual(fields.map((node) => node.props.label), ["settings.osVersion", "settings.ablVersion", "about.logDirectory"]);
  for (const field of fields) {
    assert.equal(field.props.focusable, true);
    assert.equal(field.props.highlightOnFocus, true);
    assert.equal(field.props.bottomSeparator, "standard");
    assert.equal(field.props.onClick, undefined);
    assert.equal(field.props.onActivate, undefined);
  }
  assert.equal(fields[2].props.description, "/var/home/armada/Documents/sleep-logs");
  assert.equal(app.nodes().filter((node) => node.type === "PanelSectionRow").length, 3);
  assert.equal(app.toggle().props.value, true);
  assert.deepEqual(app.writes, []);
});

test("About initial errors offer Retry without showing fabricated values", async () => {
  const app = setup();
  app.state.error = "offline";
  app.render();
  assert.equal(app.toggle(), undefined);
  assert.equal(app.nodes().some((node) => node.props.label === "about.logDirectory"), false);
  assert.ok(app.nodes().some((node) => node.type === "SupportingText" && node.props.className === "armada-note-error"));
  app.nodes().find((node) => node.type === "ButtonRow").props.onClick();
  await app.settle();
  assert.equal(app.retries, 1);
});

test("About retains the last valid toggle and directory during refresh errors", () => {
  const app = setup();
  app.state.value = { enabled: true, directory: "/custom/sleep logs" };
  app.state.error = "temporary read error";
  app.render();
  assert.equal(app.toggle().props.value, true);
  assert.equal(app.nodes().find((node) => node.props.label === "about.logDirectory").props.description, "/custom/sleep logs");
  assert.ok(app.nodes().some((node) => node.type === "ButtonRow"));
});

test("About changes cached status only after a successful write and preserves it on failure", async () => {
  const app = setup();
  app.state.value = { enabled: true, directory: "/logs" };
  app.render();
  let finish!: (value: boolean) => void;
  app.response(new Promise((resolve) => { finish = resolve; }));
  app.toggle().props.onChange(false);
  app.render();
  assert.equal(app.toggle().props.value, true);
  assert.equal(app.toggle().props.disabled, true);
  finish(false);
  await app.settle();
  assert.equal(app.toggle().props.value, false);
  assert.equal(app.toggle().props.disabled, false);
  app.response(Promise.reject(new Error("write failed")));
  app.toggle().props.onChange(true);
  await app.settle();
  assert.equal(app.toggle().props.value, false);
  assert.equal(app.toasts.length, 1);
  assert.deepEqual(app.writes, [false, true]);
});

test("a reopened About refresh waits for an earlier write instead of caching its pre-write state", async () => {
  const app = setup();
  app.state.value = { enabled: true, directory: "/logs" };
  app.render();
  let finish!: (value: boolean) => void;
  app.response(new Promise((resolve) => { finish = resolve; }));
  app.toggle().props.onChange(false);
  app.state.setValue = () => {};
  app.reopen();
  const read = app.hookCalls.at(-1)![0] as () => Promise<any>;
  let completed = false;
  const refreshing = read().then((value) => { completed = true; return value; });
  await app.settle();
  assert.equal(completed, false);
  assert.equal(app.reads, 0);
  finish(false);
  const refreshed = await refreshing;
  assert.equal(refreshed.enabled, false);
  assert.equal(refreshed.directory, "/logs");
  assert.equal(app.reads, 1);
});
