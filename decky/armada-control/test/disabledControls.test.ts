import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { theme } from "../src/theme.ts";

const sourceRoot = new URL("../src/", import.meta.url);
const readSource = (path: string) => readFileSync(new URL(path, sourceRoot), "utf8");
const compile = (source: string) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const buttonExports: any = {};
runInNewContext(compile(readSource("components/buttonStyles.ts")), { exports: buttonExports, require: (id: string) => {
  if (id === "../theme") return { theme };
  throw new Error(`Unexpected button style import: ${id}`);
} });
const styleExports: any = {};
runInNewContext(compile(readSource("styles.ts")), { exports: styleExports, require: (id: string) => {
  if (id === "@decky/ui") return { classMap: [], gamepadSliderClasses: { SliderTrack: "native-slider-track" } };
  if (id === "./theme") return { theme };
  if (id === "./components/visualStyles") return { visualStyles: "" };
  if (id === "./components/TabNavigation.styles") return { tabNavigationStyles: "" };
  if (id === "./components/buttonStyles") return buttonExports;
  throw new Error(`Unexpected style import: ${id}`);
} });
const styles: string = styleExports.styles;
const rules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1].trim(), declarations: match[2] }));
const disabledRule = rules.find((rule) => rule.selector.endsWith("button.DialogButton:is(.Disabled, :disabled)"));
const focusedRule = rules.find((rule) => rule.selector.endsWith("button.DialogButton:is(.Disabled, :disabled):is(.gpfocus, :focus-visible, :hover)"));

test("native class-disabled and attribute-disabled buttons share appearance in every plugin container", () => {
  assert.ok(disabledRule);
  for (const scope of [
    ".armada-control-tabs .armada-control-tab-content",
    ".armada-control-tabs .armada-tab-navigation",
    ".armada-control-dialog-position .armada-control-dialog",
    ".armada-control-startup",
  ]) assert.ok(disabledRule.selector.includes(scope), scope);
  assert.ok(disabledRule.selector.startsWith(":is("));
  assert.match(disabledRule.declarations, /opacity:\s*1;/);
  assert.ok(disabledRule.declarations.includes(`background: ${theme.disabledSurface};`));
  assert.ok(disabledRule.declarations.includes(`color: ${theme.disabledText};`));
  assert.doesNotMatch(disabledRule.declarations, /pointer-events:|display:|width:|height:|padding:|transform:/);
});

test("disabled buttons use a lighter selected surface without a hover or focus outline", () => {
  assert.ok(disabledRule);
  assert.ok(focusedRule);
  assert.equal(focusedRule.selector.replace(":is(.gpfocus, :focus-visible, :hover)", ""), disabledRule.selector);
  assert.ok(focusedRule.declarations.includes(`background: ${theme.disabledSelectedSurface};`));
  assert.ok(focusedRule.declarations.includes(`color: ${theme.disabledText};`));
  for (const rule of [disabledRule, focusedRule]) {
    assert.match(rule.declarations, /outline:\s*none;/);
    assert.match(rule.declarations, /box-shadow:\s*none;/);
    assert.doesNotMatch(rule.declarations, /outline-offset:/);
  }
});

test("disabled appearance follows shared configuration tokens without inline or important overrides", () => {
  assert.match(theme.disabledText, /^var\(--armada-theme-disabled-text,/);
  assert.match(theme.disabledSurface, /^var\(--armada-theme-disabled-surface,/);
  assert.match(theme.disabledText, /#7a838d\)$/);
  assert.match(theme.disabledSelectedSurface, /^var\(--armada-theme-disabled-selected-surface,/);
  assert.match(theme.disabledOpacity, /^var\(--armada-disabled-opacity,/);
  for (const path of ["styles.ts", "theme.ts", "components/widgets.tsx", "components/buttonStyles.ts"]) {
    assert.doesNotMatch(readSource(path), /!\s*important|\bstyle=\{/i, path);
  }
  const graphRule = rules.find((rule) => rule.selector === '.afc-scope .afc-graph-focusable[aria-disabled="true"]');
  assert.ok(graphRule);
  assert.ok(graphRule.declarations.includes(`opacity: ${theme.disabledOpacity};`));
});

test("native modal scoping preserves caller classes for the shared disabled styling", () => {
  const source = readSource("components/ArmadaModalRoot.tsx");
  assert.match(source, /className=\{\["armada-control-dialog", className\]\.filter\(Boolean\)\.join\(" "\)\}/);
  assert.match(source, /modalClassName=\{\["armada-control-dialog-position", modalClassName\]\.filter\(Boolean\)\.join\(" "\)\}/);
});

test("shared button widgets forward native disabled flags and handlers unchanged", () => {
  const exports: any = {};
  const element = (type: unknown, props: any) => ({ type, props });
  runInNewContext(compile(readSource("components/widgets.tsx")), { exports, require: (id: string) => {
    if (id === "@decky/ui") return { ButtonItem: "ButtonItem", DialogButton: "DialogButton", gamepadDialogClasses: { NoMinWidth: "native-no-min-width" } };
    if (id === "react/jsx-runtime") return { jsx: element, jsxs: element };
    throw new Error(`Unexpected widget import: ${id}`);
  } });
  const onClick = () => {};
  for (const disabled of [true, false]) {
    const row = exports.ButtonRow({ disabled, onClick, children: "Action" });
    assert.equal(row.props.children.type, "ButtonItem");
    assert.equal(row.props.children.props.disabled, disabled);
    assert.equal(row.props.children.props.onClick, onClick);
    assert.equal(row.props.children.props.children, "Action");
    const compact = exports.CompactButton({ disabled, onClick, children: "Action", className: "caller-class" });
    assert.equal(compact.type, "DialogButton");
    assert.equal(compact.props.disabled, disabled);
    assert.equal(compact.props.onClick, onClick);
    assert.equal(compact.props.children, "Action");
    assert.match(compact.props.className, /native-no-min-width armada-compact-button caller-class/);
  }
});
