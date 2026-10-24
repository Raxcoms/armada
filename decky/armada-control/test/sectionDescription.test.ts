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
  const element = (type: unknown, props: unknown) => ({ type, props });
  const jsx = { jsx: element, jsxs: element, Fragment: "Fragment" };
  const exports: any = {};
  runInNewContext(compiled, { exports, require: (id: string) => {
    if (id === "@decky/ui") return { Field: "NativeField", PanelSection: "NativeSection", PanelSectionRow: "NativeRow" };
    if (id === "react/jsx-runtime") return jsx;
    throw Error(`Unexpected import: ${id}`);
  } });
  return exports;
}

test("section descriptions reuse native configuration typography without focus or row separators", () => {
  const exports = widgets();
  const text = { type: "span", props: { children: "Localized supporting text" } };
  const section = exports.SectionDescription({ children: text });
  const description = section.type(section.props);
  assert.equal(description.type, "NativeField");
  assert.equal(description.props.description, text);
  assert.equal(description.props.focusable, false);
  assert.equal(description.props.highlightOnFocus, false);
  assert.equal(description.props.bottomSeparator, "none");
  assert.equal(description.props.className, "armada-supporting-text armada-section-description");
  assert.equal(description.props.label, undefined);
  assert.equal(description.props.style, undefined);
});

test("selectable notices put the title and description in one full-width native read-only row", () => {
  const exports = widgets();
  const title = "Information";
  const text = "Information about these settings";
  const section = exports.NoticeSection({ title, children: text });
  assert.equal(section.type, "NativeSection");
  assert.equal(section.props.title, undefined);
  assert.equal(section.props.children.type, exports.ControlRow);
  const row = section.props.children.type(section.props.children.props);
  assert.equal(row.type, "NativeRow");
  const description = row.props.children;
  assert.equal(description.type, "NativeField");
  assert.equal(description.props.label, title);
  assert.equal(description.props.className, "armada-notice");
  assert.equal(description.props.description, text);
  assert.equal(description.props.focusable, true);
  assert.equal(description.props.highlightOnFocus, true);
  assert.equal(description.props.bottomSeparator, "none");
  for (const prop of ["onClick", "onActivate", "onButtonDown", "style"]) assert.equal(description.props[prop], undefined, prop);
});

test("subsections keep native controls directly beneath an accessible shared heading", () => {
  const { Subsection } = widgets();
  const controls = [{ type: "NativeControl", props: {} }];
  const section = Subsection({ title: "Localized title", children: controls });
  assert.equal(section.type, "Fragment");
  const [heading, children] = section.props.children;
  assert.equal(heading.type, "div");
  assert.equal(heading.props.className, "armada-subheader");
  assert.equal(heading.props.role, "heading");
  assert.equal(heading.props["aria-level"], 3);
  assert.equal(heading.props.children, "Localized title");
  assert.equal(children, controls);
  assert.equal(heading.props.style, undefined);
});

test("every section introduction uses the shared description while retaining its localized text", () => {
  const expected = {
    Compatibility: ["compatibility.nextLaunchNotice", "gameSettings.overrides", "gameSettings.defaultsDescription"],
    Profiles: ["profiles.fansDescription", "profiles.performanceDescription"],
    Controller: ["controller.emulationDescription"],
    Experimental: ["experimental.warning", "experimental.dualScreenDescription", "experimental.desktopDescription", "experimental.sleepDescription"],
    About: [],
  };
  for (const [file, keys] of Object.entries(expected)) {
    const text = readFileSync(new URL(`tabs/${file}.tsx`, sourceRoot), "utf8");
    const source = ts.createSourceFile(`${file}.tsx`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const descriptions: string[] = [];
    const notices: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && ["SectionDescription", "NoticeSection"].includes(node.openingElement.tagName.getText(source))) {
        const expression = node.children.find(ts.isJsxExpression)?.expression;
        if (expression && ts.isCallExpression(expression) && ts.isStringLiteral(expression.arguments[0])) {
          descriptions.push(expression.arguments[0].text);
          if (node.openingElement.tagName.getText(source) === "NoticeSection") {
            notices.push(expression.arguments[0].text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.deepEqual(descriptions, keys, file);
    assert.deepEqual(notices, file === "Compatibility" ? ["compatibility.nextLaunchNotice"] : file === "Experimental" ? ["experimental.warning"] : [], file);
  }
});
