import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);

function setup() {
  const source = readFileSync(new URL("components/ArmadaModalRoot.tsx", sourceRoot), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: any = {};
  const calls: unknown[] = [];
  const scroller = { scrollTo: (options: unknown) => { calls.push(options); } };
  const element = (type: unknown, props: any) => ({ type, props });
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "@decky/ui") return { DialogHeader: "DialogHeader", Focusable: "Focusable", ModalRoot: "ModalRoot" };
    if (id === "react") return { useRef: () => ({ current: null }) };
    if (id === "../lib/scrollRegion") return { findScrollParent: () => scroller };
    if (id === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (id === "./ArmadaStyles") return { ArmadaStyles: "ArmadaStyles" };
    throw new Error(`Unexpected import: ${id}`);
  } });
  return { source, calls, title: exports.ArmadaDialogHeader({ children: "Edit Balanced" }) };
}

test("dialog titles are meaningful native focus stops without duplicate heading semantics", () => {
  const { source, title } = setup();
  assert.equal(title.type, "DialogHeader");
  const heading = title.props.children;
  assert.equal(heading.type, "Focusable");
  assert.equal(heading.props.children, "Edit Balanced");
  assert.equal(heading.props.role, undefined);
  assert.equal(heading.props["aria-level"], undefined);
  assert.equal(heading.props.focusable, true);
  assert.equal(heading.props.preferredFocus, true);
  assert.equal(heading.props.tabIndex, 0);
  assert.equal(heading.props.onClick, undefined);
  assert.equal(heading.props.onActivate, undefined);
  assert.equal(heading.props.onOKButton, undefined);
  assert.equal(heading.props.noFocusRing, undefined);
  assert.doesNotMatch(source, /requestAnimationFrame|addEventListener|hidden|<span/);
});

test("returning to the title reveals only its owning dialog and cancels old native scrolling", () => {
  const { calls, title } = setup();
  const heading = title.props.children;
  heading.props.onGamepadFocus();
  assert.equal(calls.length, 0);
  heading.props.ref.current = {};
  heading.props.onGamepadFocus();
  heading.props.onFocus();
  assert.deepEqual(calls.map((value) => JSON.parse(JSON.stringify(value))), [
    { top: 0, behavior: "auto" },
    { top: 0, behavior: "auto" },
  ]);
});

test("profile and calibration dialogs expose the shared heading before editable content", () => {
  for (const file of ["components/CreateCurveModal.tsx", "components/FanCurveEditorModal.tsx", "tabs/Power.tsx", "components/Calibration.tsx"]) {
    const source = readFileSync(new URL(file, sourceRoot), "utf8");
    const heading = source.indexOf("<ArmadaDialogHeader>");
    assert.ok(heading >= 0, file);
    assert.ok(heading < source.indexOf("<ArmadaDialogFooter"), file);
  }
});
