import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { theme } from "../src/theme.ts";

const sourceRoot = new URL("../src/", import.meta.url);

test("components use shared styles instead of JSX inline styles or important overrides", () => {
  const violations: string[] = [];
  for (const file of readdirSync(sourceRoot, { recursive: true }).filter((name) => /\.tsx?$/.test(name))) {
    const text = readFileSync(new URL(file.replaceAll("\\", "/"), sourceRoot), "utf8");
    assert.doesNotMatch(text, /!\s*important/i, file);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "style") violations.push(file);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, []);
});

test("shared theme tokens can follow native values or explicit configuration overrides", () => {
  assert.match(theme.accent, /--armada-theme-accent/);
  assert.match(theme.accent, /--gpColor-Blue/);
  assert.match(theme.spaceMedium, /--armada-space-medium/);
  assert.match(theme.stickSize, /--armada-calibration-stick-size/);
  assert.match(theme.motion, /--armada-motion-duration/);
  assert.match(theme.supportingText, /--armada-theme-supporting-text, #969696/);
  assert.match(theme.tabText, /--armada-tab-text-size, \.9375rem/);
});

test("the fan graph fills its modal and tab typography stays independent of changing scroll ancestors", () => {
  assert.match(theme.graphWidth, /--armada-graph-max-width, 100%/);
  const styles = readFileSync(new URL("components/TabNavigation.styles.ts", sourceRoot), "utf8");
  const navigation = styles.split(".armada-tab-navigation {")[1].split(".armada-control-tabs")[0];
  assert.ok(navigation.includes("flex: 0 0 auto;"));
  assert.ok(navigation.includes("font-size: ${theme.tabText}"));
  const sharedStyles = readFileSync(new URL("styles.ts", sourceRoot), "utf8");
  assert.match(sharedStyles, /\.armada-icon\s*\{[^}]*width:\s*1\.125em;\s*height:\s*1\.125em/);
  const title = styles.split(".armada-tab-title {")[1].split(".armada-tab-title >")[0];
  assert.ok(title.includes("color: inherit"));
});

test("the selected tab delegates focus colors to its native button instead of clipping a custom ring", () => {
  const styles = readFileSync(new URL("components/TabNavigation.styles.ts", sourceRoot), "utf8");
  assert.match(styles, /\.armada-tab-selected:not\(:hover\):not\(:focus\):not\(\.gpfocus\)/);
  assert.doesNotMatch(styles, /armada-tab-navigation-focused/);
  const viewport = styles.split(".armada-tab-current {")[1].split(".armada-tab-title {")[0];
  assert.doesNotMatch(viewport, /overflow:\s*hidden/);
});

test("charging fan speed belongs to Experimental and retains the shared debounced save", () => {
  const profiles = readFileSync(new URL("tabs/Profiles.tsx", sourceRoot), "utf8");
  const experimental = readFileSync(new URL("tabs/Experimental.tsx", sourceRoot), "utf8");
  assert.doesNotMatch(profiles, /chargingFanPwm|chargingFanSpeed/);
  assert.match(experimental, /const setChargingFanPwm = useDebouncedApply\(/);
  assert.match(experimental, /config.cpuDeviceClass !== "SM8250"/);
  assert.match(experimental, /onChange=\{\(value\) => setChargingFanPwm\(percentToPwm\(value\)\)\}/);
});

test("closed drawers remove their controls instead of clipping focusable elements", () => {
  const source = readFileSync(new URL("components/AnimatedCollapse.tsx", sourceRoot), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: any = {};
  const factory = new Function("exports", "require", compiled);
  factory(exports, () => ({ jsx: (type: string, props: any) => ({ type, props }) }));
  assert.equal(exports.AnimatedCollapse({ isOpen: false, children: "focusable control" }), null);
  assert.equal(exports.AnimatedCollapse({ isOpen: true, children: "focusable control" }).props.children, "focusable control");
});
