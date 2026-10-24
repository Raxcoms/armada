import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const expected = {
  "components/ArmadaModalRoot.tsx": ["confirmText"],
  "components/CreateCurveModal.tsx": ["fanCurve.create"],
  "components/FanCurveEditorModal.tsx": ["common.saveChanges"],
  "components/Calibration.tsx": ["calibration.save", "calibration.start"],
  "tabs/Power.tsx": ["common.saveChanges"],
  "tabs/Compatibility.tsx": ["compatibility.resetAllGames", "compatibility.resetGame", "compatibility.restartGameMode", "common.save"],
};

for (const [file, labels] of Object.entries(expected)) {
  test(`${file} uses native primary controls only for its main dialog actions`, () => {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const primary: ts.JsxElement[] = [];
    const secondary: ts.JsxElement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const name = node.openingElement.tagName.getText(tree);
        if (name === "DialogButtonPrimary") primary.push(node);
        if (name === "DialogButton") secondary.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    const importsNative = tree.statements.some((node) => ts.isImportDeclaration(node)
      && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@decky/ui"
      && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some((item) => item.name.text === "DialogButtonPrimary"));
    assert.ok(importsNative);
    assert.equal(primary.length, labels.length);
    for (const label of labels) {
      assert.ok(primary.some((button) => button.getText(tree).includes(label)), label);
      assert.ok(secondary.every((button) => !button.getText(tree).includes(label)), label);
    }
    for (const button of primary) {
      assert.ok(button.openingElement.attributes.properties.some((property) => ts.isJsxAttribute(property)
        && property.name.getText(tree) === "onClick"));
      assert.ok(!button.getText(tree).includes('t("common.cancel")'));
      assert.ok(!button.getText(tree).includes('t("common.close")'));
      assert.ok(!button.getText(tree).includes('t("common.resetToDefault")'));
    }
  });
}
