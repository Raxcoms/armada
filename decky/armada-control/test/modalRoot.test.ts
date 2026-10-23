import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);
const source = readFileSync(new URL("components/ArmadaModalRoot.tsx", sourceRoot), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup() {
  const exports: any = {};
  const scrollCalls: unknown[][] = [];
  let handled = true;
  const element = (type: unknown, props: any) => ({ type, props });
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "@decky/ui") return {
      classMap: [{ Field: "PanelField" }, { Field: "DialogField" }, { Field: "PanelField" }, {}],
      DialogBody: "DialogBody", DialogButton: "DialogButton", DialogFooter: "DialogFooter",
      DialogHeader: "DialogHeader", Focusable: "Focusable", ModalRoot: "ModalRoot",
    };
    if (id === "react") return { useRef: () => ({ current: null }) };
    if (id === "../lib/modalScroll") return {
      revealModalFocus: (...args: unknown[]) => { scrollCalls.push(args); return handled; },
      revealModalStart: () => {},
    };
    if (id === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (id === "./ArmadaStyles") return { ArmadaStyles: "ArmadaStyles" };
    throw new Error(`Unexpected import: ${id}`);
  } });
  return { ...exports, scrollCalls, setHandled: (value: boolean) => { handled = value; } };
}

test("modal scrolling uses one native navigation boundary without changing native layout or props", () => {
  const { ArmadaModalRoot } = setup();
  const children = [{ type: "DialogBody" }, { type: "DialogFooter" }];
  const closeModal = () => {};
  const root = ArmadaModalRoot({ children, className: "editor", closeModal, bAllowFullSize: true });
  assert.equal(root.type, "ModalRoot");
  assert.equal(root.props.className, "armada-control-dialog editor");
  assert.equal(root.props.closeModal, closeModal);
  assert.equal(root.props.bAllowFullSize, true);
  const [styles, boundary] = root.props.children;
  assert.equal(styles.type, "ArmadaStyles");
  assert.equal(boundary.type, "Focusable");
  assert.equal(boundary.props.className, "armada-control-dialog-scroll");
  assert.equal(boundary.props["flow-children"], "column");
  assert.equal(boundary.props.tabIndex, -1);
  assert.equal(boundary.props.noFocusRing, true);
  assert.equal(boundary.props.scrollIntoViewWhenChildFocused, "force");
  assert.equal(boundary.props.children, children);
  for (const key of ["focusable", "preferredFocus", "focusableIfEmpty", "style", "onFocus", "onGamepadFocus", "onMoveUp", "onMoveDown", "onKeyDown"]) {
    assert.equal(boundary.props[key], undefined, key);
  }
  const stylesSource = readFileSync(new URL("styles.ts", sourceRoot), "utf8");
  assert.match(stylesSource, /\.armada-control-dialog-scroll\s*\{\s*display:\s*contents;/);
});

test("native focus scrolling delegates the actual target and all native field classes with fallback intact", () => {
  const { ArmadaModalRoot, scrollCalls, setHandled } = setup();
  const boundary = ArmadaModalRoot({ children: "Content" }).props.children[1];
  const owner = {};
  const target = {};
  boundary.props.ref.current = owner;
  const reveal = boundary.props.fnScrollIntoViewHandler;
  assert.equal(reveal({ Element: target }), true);
  assert.equal(scrollCalls[0][0], owner);
  assert.equal(scrollCalls[0][1], target);
  assert.equal(scrollCalls[0][2], ".PanelField, .DialogField");
  setHandled(false);
  assert.equal(reveal({}), false);
  assert.equal(scrollCalls[1][1], undefined);
  boundary.props.ref.current = null;
  assert.equal(reveal({ Element: target }), false);
  assert.equal(scrollCalls[2][0], null);
});

function confirmation() {
  const components = setup();
  const calls: string[] = [];
  const closeModal = () => calls.push("close");
  const root = components.ArmadaConfirmModal({
    title: "Delete curve", description: "Delete this custom curve?", confirmText: "Delete", cancelText: "Cancel",
    onConfirm: () => calls.push("confirm"), closeModal,
  });
  return { ...components, root, calls, closeModal };
}

test("confirmations share the native heading, body and horizontal footer", () => {
  const { root, ArmadaModalRoot, ArmadaDialogHeader, ArmadaDialogFooter } = confirmation();
  assert.equal(root.type, ArmadaModalRoot);
  const [heading, body, footer] = root.props.children;
  assert.equal(heading.type, ArmadaDialogHeader);
  assert.equal(heading.props.children, "Delete curve");
  assert.equal(body.type, "DialogBody");
  assert.equal(body.props.children, "Delete this custom curve?");
  assert.equal(footer.type, ArmadaDialogFooter);
  const row = ArmadaDialogFooter(footer.props).props.children;
  assert.equal(row.props["flow-children"], "row");
  const [confirm, cancel] = row.props.children;
  assert.equal(confirm.type, "DialogButton");
  assert.equal(confirm.props.children, "Delete");
  assert.equal(cancel.type, "DialogButton");
  assert.equal(cancel.props.children, "Cancel");
});

test("confirmation action runs once before dismissal, while cancel and Back never confirm", () => {
  const { root, calls } = confirmation();
  const [confirm, cancel] = root.props.children[2].props.children;
  confirm.props.onClick();
  assert.deepEqual(calls, ["confirm", "close"]);
  calls.length = 0;
  cancel.props.onClick();
  assert.deepEqual(calls, ["close"]);
  calls.length = 0;
  root.props.onCancel();
  assert.deepEqual(calls, ["close"]);
});

test("native confirmation submission leaves exactly one dismissal to the native root", () => {
  const { root, calls, closeModal } = confirmation();
  assert.equal(root.props.closeModal, closeModal);
  root.props.onOK();
  assert.deepEqual(calls, ["confirm"]);
  root.props.closeModal();
  assert.deepEqual(calls, ["confirm", "close"]);
});

test("game and curve dialogs place a visible starting focus stop before their scrollable body and actions", () => {
  const dialogs = {
    "tabs/Compatibility.tsx": ["ConfirmResetAllModal", "ConfirmResetGameModal", "ConfirmGameModeRestartModal", "EnvVarModal"],
    "components/CreateCurveModal.tsx": ["CreateCurveModal"],
  };
  for (const [file, names] of Object.entries(dialogs)) {
    const text = readFileSync(new URL(file, sourceRoot), "utf8");
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const name of names) {
      const fn = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
      const returned = fn?.body?.statements.find(ts.isReturnStatement)?.expression;
      const root = returned && ts.isParenthesizedExpression(returned) ? returned.expression : returned;
      assert.ok(root && ts.isJsxElement(root), name);
      const sections = root.children.filter(ts.isJsxElement);
      assert.deepEqual(sections.map((section) => section.openingElement.tagName.getText(tree)), ["ArmadaDialogHeader", "DialogBody", "ArmadaDialogFooter"], name);
      const title = sections[0].children.find(ts.isJsxExpression)?.expression;
      assert.ok(title && ts.isCallExpression(title), name);
      assert.equal(title.expression.getText(tree), "t", name);
      assert.ok(title.arguments[0] && ts.isStringLiteral(title.arguments[0]) && title.arguments[0].text, name);
    }
  }
});
