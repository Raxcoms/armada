import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);
const source = readFileSync(new URL("components/ArmadaModalRoot.tsx", sourceRoot), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function footer(children: unknown) {
  const exports: any = {};
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "@decky/ui") return { classMap: [], DialogFooter: "DialogFooter", Focusable: "Focusable" };
      if (id === "react") return {};
      if (id === "../lib/modalScroll") return {};
      if (id === "./ArmadaStyles") return {};
      if (id === "react/jsx-runtime") return { jsx: (type: unknown, props: any) => ({ type, props }) };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  return exports.ArmadaDialogFooter({ children });
}

test("dialog actions share a native horizontal navigation group inside the native footer", () => {
  const actions = [{ type: "DialogButton", props: { children: "Save" } }, { type: "DialogButton", props: { children: "Cancel" } }];
  const root = footer(actions);
  assert.equal(root.type, "DialogFooter");
  const row = root.props.children;
  assert.equal(row.type, "Focusable");
  assert.equal(row.props["flow-children"], "row");
  assert.equal(row.props.tabIndex, -1);
  assert.equal(row.props.noFocusRing, true);
  assert.equal(row.props.className, "armada-control-dialog-footer");
  assert.equal(row.props.children, actions);
  for (const property of ["onMoveUp", "onMoveDown", "onMoveLeft", "onMoveRight", "onKeyDown", "onCancel", "preferredFocus", "style"]) {
    assert.equal(row.props[property], undefined, property);
  }
});

test("the shared footer preserves pending-save, cancel and conditional calibration actions unchanged", () => {
  const clicked: string[] = [];
  const actions = {
    type: "Fragment",
    props: { children: [
      { type: "DialogButton", props: { children: "Save", disabled: true, onClick: () => clicked.push("save") } },
      { type: "DialogButton", props: { children: "Close", disabled: false, onClick: () => clicked.push("close") } },
    ] },
  };
  const row = footer(actions).props.children;
  assert.equal(row.props.children, actions);
  assert.equal(row.props.children.props.children[0].props.disabled, true);
  row.props.children.props.children[1].props.onClick();
  assert.deepEqual(clicked, ["close"]);
});

test("every custom editor and confirmation footer uses the shared native row", () => {
  const expected = {
    "components/Calibration.tsx": 1,
    "components/CreateCurveModal.tsx": 1,
    "components/FanCurveEditorModal.tsx": 1,
    "tabs/Power.tsx": 1,
    "tabs/Compatibility.tsx": 4,
  };
  for (const [file, count] of Object.entries(expected)) {
    const text = readFileSync(new URL(file, sourceRoot), "utf8");
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let footers = 0;
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node)) {
        assert.notEqual(node.tagName.getText(tree), "DialogFooter", file);
        if (node.tagName.getText(tree) === "ArmadaDialogFooter") footers++;
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.equal(footers, count, file);
  }
});

test("footer sizing remains shared and does not replace native button focus or input handling", () => {
  const styles = readFileSync(new URL("styles.ts", sourceRoot), "utf8");
  assert.match(styles, /\.armada-control-dialog-footer\s*\{\s*width:\s*100%;\s*min-width:\s*0;\s*display:\s*flex;\s*flex-direction:\s*row;/);
  assert.match(styles, /\.armada-control-dialog-footer\s*>\s*\*\s*\{\s*flex:\s*1 1 0;/);
  assert.doesNotMatch(source, /onMoveLeft|onMoveRight|onKeyDown|addEventListener|querySelectorAll|\.focus\(/);
});
