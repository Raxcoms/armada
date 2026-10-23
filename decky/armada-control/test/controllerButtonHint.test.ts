import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/ControllerButtonHint.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup(values: unknown[]) {
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "@decky/ui") return { findModuleExport: (match: (value: unknown) => boolean) => values.find(match) };
    if (id === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
    throw Error(`Unexpected import: ${id}`);
  } });
  return exports.ControllerButtonHint;
}

test("header reuses Steam's button glyphs and discovered enum without export names or asset paths", () => {
  function nativeGlyph() { return ["#ControllerButton_L1", "#ControllerButton_R1"]; }
  const Hint = setup([{}, () => null, { LeftBumper: 12, RightBumper: 13 }, nativeGlyph]);
  for (const [side, code] of [["left", 12], ["right", 13]]) {
    const view = Hint({ side });
    assert.equal(view.props["aria-hidden"], "true");
    assert.equal(view.props.children.type, nativeGlyph);
    assert.equal(view.props.children.props.button, code);
    assert.equal(view.props.children.props.additionalClassName, "armada-tab-bumper-glyph");
  }
});

test("unavailable or incomplete native glyph support falls back without breaking navigation", () => {
  function nativeGlyph() { return ["#ControllerButton_L1", "#ControllerButton_R1"]; }
  for (const values of [[], [nativeGlyph], [{ LeftBumper: 12, RightBumper: 13 }], [nativeGlyph, { LeftBumper: 12, RightBumper: NaN }]]) {
    const Hint = setup(values);
    assert.equal(Hint({ side: "left" }).props.children.props.children, "‹");
    assert.equal(Hint({ side: "right" }).props.children.props.children, "›");
  }
});
