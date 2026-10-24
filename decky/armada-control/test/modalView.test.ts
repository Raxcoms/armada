import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function setup() {
  const source = readFileSync(new URL("../src/components/useModalView.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: any = {};
  const slots: any[] = [];
  const effects = new Map<number, any[]>();
  let pending: Array<() => void> = [];
  let cursor = 0;
  let notifications = 0;
  let unsubscribe: (() => void) | undefined;
  const element = (type: any, props: any) => ({ type, props });
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "react/jsx-runtime") return { jsx: element };
    if (id === "react") return {
      useState: (initial: () => any) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial();
        return [slots[index]];
      },
      useLayoutEffect: (effect: () => void, dependencies: any[]) => {
        const index = cursor++;
        const previous = effects.get(index);
        if (previous && dependencies.every((value, i) => Object.is(value, previous[i]))) return;
        effects.set(index, dependencies);
        pending.push(effect);
      },
      useSyncExternalStore: (subscribe: (listener: () => void) => () => void, getSnapshot: () => any) => {
        unsubscribe ??= subscribe(() => { notifications++; });
        return getSnapshot();
      },
    };
    throw new Error(`Unexpected import: ${id}`);
  } });
  return {
    render: (content: any) => { cursor = 0; return exports.useModalView(content); },
    commit: () => { const current = pending; pending = []; for (const effect of current) effect(); },
    read: (view: any) => view.type(view.props),
    unmountModal: () => { unsubscribe?.(); unsubscribe = undefined; },
    get notifications() { return notifications; },
  };
}

const content = (value: number) => ({ type: "ArmadaModalRoot", props: { value } });

test("modal content starts current and publishes changes without replacing the modal view", () => {
  const app = setup();
  const initial = content(1);
  const view = app.render(initial);
  assert.equal(app.read(view), initial);
  app.commit();
  assert.equal(app.notifications, 0);

  for (const value of [2, 3]) {
    const next = content(value);
    assert.equal(app.render(next), view);
    assert.notEqual(app.read(view), next);
    app.commit();
    assert.equal(app.read(view), next);
  }
  assert.equal(app.notifications, 2);
});

test("modal subscriptions detach on close and reopen with the latest published content", () => {
  const app = setup();
  const view = app.render(content(1));
  app.commit();
  app.read(view);
  app.unmountModal();

  const next = content(2);
  app.render(next);
  app.commit();
  assert.equal(app.notifications, 0);
  assert.equal(app.read(view), next);

  app.render(next);
  app.commit();
  assert.equal(app.notifications, 0);
  const latest = content(3);
  app.render(latest);
  app.commit();
  assert.equal(app.notifications, 1);
  assert.equal(app.read(view), latest);
});
