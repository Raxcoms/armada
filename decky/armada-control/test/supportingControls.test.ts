import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);

function widgets() {
  const source = readFileSync(new URL("components/widgets.tsx", sourceRoot), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "@decky/ui") return Object.fromEntries(["ButtonItem", "DropdownItem", "Field", "PanelSectionRow", "SliderField", "ToggleField"].map((name) => [name, name]));
    if (id === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    if (id === "../icons") return { noticeIcons: {} };
    throw Error(`Unexpected import: ${id}`);
  } });
  return exports;
}

test("standalone supporting text shares native description typography without extra focus or dividers", () => {
  const { SupportingText } = widgets();
  const text = { type: "span", props: { children: "Help below a control" } };
  const field = SupportingText({ children: text });
  assert.equal(field.type, "Field");
  assert.equal(field.props.description, text);
  assert.equal(field.props.className, "armada-supporting-text");
  assert.equal(field.props.label, undefined);
  assert.equal(field.props.focusable, false);
  assert.equal(field.props.highlightOnFocus, false);
  assert.equal(field.props.bottomSeparator, "none");
});

test("read-only rows share the same native row bounds and highlight as other controls", () => {
  const { ReadOnlyRow, ControlRow } = widgets();
  const row = ReadOnlyRow({ label: "Version", description: "2026.10" });
  assert.equal(row.type, ControlRow);
  assert.equal(row.props.children.type, "Field");
  assert.equal(row.props.children.props.focusable, true);
  assert.equal(row.props.children.props.highlightOnFocus, true);
  assert.equal(row.props.children.props.bottomSeparator, "standard");
  assert.equal(row.props.children.props.onClick, undefined);
});

test("shared controls use native option dividers unless explicitly suppressed", () => {
  const components = widgets();
  const controls = [
    ["ButtonRow", { children: "Apply" }],
    ["SelectEdit", { label: "Selection", value: "first", options: ["first"], onChange: () => {} }],
    ["ToggleRow", { label: "Enabled", value: true, onChange: () => {} }],
    ["SliderEdit", { label: "Speed", value: 50, min: 0, max: 100, step: 1, onChange: () => {} }],
  ] as const;
  for (const [name, props] of controls) {
    assert.equal(components[name](props).props.children.props.bottomSeparator, "standard", name);
    assert.equal(components[name]({ ...props, bottomSeparator: "none" }).props.children.props.bottomSeparator, "none", name);
  }
});

test("selector supporting text uses the native dropdown description", () => {
  const { SelectEdit } = widgets();
  const description = { type: "span", props: { children: "Follow Steam's selection" } };
  const control = SelectEdit({ label: "Proton", description, value: "steam", options: ["steam"], onChange: () => {} }).props.children;
  assert.equal(control.type, "DropdownItem");
  assert.equal(control.props.description, description);
  assert.equal(control.props.bottomSeparator, "standard");
});

test("slider supporting text uses the native slider description", () => {
  const { SliderEdit } = widgets();
  const description = { type: "span", props: { children: "Priority details" } };
  const control = SliderEdit({ label: "Priority", description, value: 0, min: -20, max: 19, step: 1, onChange: () => {} }).props.children;
  assert.equal(control.type, "SliderField");
  assert.equal(control.props.description, description);
  assert.equal(control.props.bottomSeparator, "standard");
});

test("fan editor help uses the same supporting component while controls retain native dividers", () => {
  for (const file of ["CreateCurveModal", "FanCurveEditor", "FanCurveEditorModal"]) {
    const text = readFileSync(new URL(`components/${file}.tsx`, sourceRoot), "utf8");
    assert.doesNotMatch(text, /className="afc-note"/, file);
    assert.match(text, /<SupportingText>/, file);
  }
  const text = readFileSync(new URL("components/RgbLighting.tsx", sourceRoot), "utf8");
  const source = ts.createSourceFile("RgbLighting.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const toggles: ts.JsxSelfClosingElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "ToggleRow") toggles.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(toggles.length, 2);
  assert.match(toggles[0].getText(source), /bottomSeparator="standard"/);
  assert.doesNotMatch(toggles[1].getText(source), /bottomSeparator=/);
});
