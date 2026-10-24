import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { theme } from "../src/theme.ts";

const source = readFileSync(new URL("../src/styles.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports: any = {};
runInNewContext(compiled, { exports, require: (id: string) => {
  if (id === "@decky/ui") return {
    gamepadSliderClasses: { SliderTrack: "native-slider-track" },
    classMap: [
      { PanelSection: "native-section", PanelSectionTitle: "native-section-title", PanelSectionRow: "native-row" },
      { PanelSection: "alternate-section", PanelSectionTitle: "alternate-section-title", PanelSectionRow: "alternate-row" },
      { Field: "native-field", FieldDescription: "native-description", WithBottomSeparatorStandard: "native-separator" },
      { Field: "alternate-field", FieldDescription: "alternate-description", WithBottomSeparatorStandard: "alternate-separator" },
      { PanelSection: "incomplete-section" },
      { OtherClass: "unrelated-class" },
    ],
  };
  if (id === "./theme") return { theme };
  if (id === "./components/visualStyles") return { visualStyles: "" };
  if (id === "./components/buttonStyles") return { disabledButtonStyles: "" };
  if (id === "./components/TabNavigation.styles") {
    const headerSource = readFileSync(new URL("../src/components/TabNavigation.styles.ts", import.meta.url), "utf8");
    const headerExports: any = {};
    runInNewContext(ts.transpileModule(headerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      exports: headerExports, require: () => ({ theme }),
    });
    return headerExports;
  }
  throw Error(`Unexpected import: ${id}`);
} });

test("section dividers use native classes and skip first sections and untitled continuations", () => {
  const selector = ".armada-control-tab-content .native-section ~ .native-section:has(> .native-section-title)";
  assert.ok(exports.styles.includes(selector));
  const rule = exports.styles.slice(exports.styles.indexOf(selector)).split("}")[0];
  assert.ok(rule.includes(`border-block-start: 1px solid ${theme.separator}`));
  assert.ok(rule.includes(`padding-block-start: ${theme.spaceLarge}`));
  assert.doesNotMatch(rule, /\b(?:width|margin-inline|padding-inline):/);
  assert.doesNotMatch(rule, /\bposition:\s*absolute/);
});

test("dividers support multiple native section variants without styling unrelated classes", () => {
  assert.ok(exports.styles.includes(".armada-control-tab-content .alternate-section ~ .alternate-section:has(> .alternate-section-title)"));
  assert.ok(exports.styles.includes(".armada-control-tab-content .native-section ~ .native-section:has(> .native-section-title)"));
  assert.ok(!exports.styles.includes("incomplete-section"));
  assert.ok(!exports.styles.includes("unrelated-class"));
  assert.ok(!exports.styles.includes("undefined"));
});

test("section and tab-header strokes share the same configurable color and thickness", () => {
  assert.ok(exports.styles.includes(`border-bottom: 1px solid ${theme.separator}`));
  assert.ok(exports.styles.includes(`border-block-start: 1px solid ${theme.separator}`));
});

test("section margins do not stack with the shared divider spacing or page footer inset", () => {
  for (const section of ["native-section", "alternate-section"]) {
    assert.ok(exports.styles.includes(`.armada-control-tab-content .${section} {\n        margin-block-end: 0;`));
  }
  assert.ok(exports.styles.includes(`padding-block-end: ${theme.spaceMedium}`));
});

test("introductory notices use compact spacing above the native row", () => {
  const selector = ".armada-tab-panels:has(> .armada-control-tab-content > :is(.native-section, .alternate-section):first-child .armada-notice)";
  assert.ok(exports.styles.includes(selector));
  const rule = exports.styles.slice(exports.styles.indexOf(selector)).split("}")[0];
  assert.ok(rule.includes("padding-block-start: 0;"));
  assert.ok(exports.styles.includes(`padding-block-start: ${theme.spaceLarge};`));
});

test("native option dividers are only suppressed on trailing controls in a section or dialog group", () => {
  assert.ok(exports.styles.includes(":is(.native-row, .alternate-row):not(:has(~ :not(.armada-supporting-text)))"));
  assert.ok(exports.styles.includes(".armada-control-dialog .DialogControlsSection > :is(.native-field, .alternate-field):not(:has(~ :not(.armada-supporting-text)))::after"));
  assert.ok(exports.styles.includes(".armada-control-dialog .DialogControlsSection > :is(.native-row, .alternate-row):not(:has(~ :not(.armada-supporting-text))) :is(.native-field, .alternate-field)::after"));
  assert.ok(exports.styles.includes("content: none;"));
  assert.ok(!exports.styles.includes(".armada-control-tabs :is(.native-field, .alternate-field)::after"));
});

test("native descriptions share the supporting color and section titles keep only the native description gap", () => {
  for (const description of ["native-description", "alternate-description"]) {
    assert.ok(exports.styles.includes(`.armada-control-tabs .${description}`));
    assert.ok(exports.styles.includes(`.armada-control-dialog .${description}`));
  }
  assert.ok(exports.styles.includes(`color: ${theme.supportingText}`));
  assert.ok(exports.styles.includes(".native-section-title:has(+ .armada-section-description, + * .armada-section-description)"));
  assert.match(exports.styles, /\.armada-section-description\.armada-supporting-text\s*\{\s*padding-block-start: 0;/);
});
