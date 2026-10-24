import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as scrollRegion from "../src/lib/scrollRegion.ts";

const source = readFileSync(new URL("../src/lib/modalScroll.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const modalScroll: any = {};
runInNewContext(compiled, { exports: modalScroll, require: (id: string) => {
  if (id === "./scrollRegion") return scrollRegion;
  throw new Error(`Unexpected import: ${id}`);
} });
const { revealModalFocus, revealModalStart } = modalScroll;

class TestElement {
  parentElement: TestElement | null;
  children: TestElement[] = [];
  ownerDocument: any;
  classes: Set<string>;
  overflowY: string;
  top: number;
  scale: number;
  clientHeight: number;
  clientTop = 0;
  offsetHeight: number;
  scrollHeight = 1600;
  scrollTop = 0;
  pendingAnimation: number | undefined;
  calls: ScrollToOptions[] = [];

  constructor(document: any, options: { parent?: TestElement; className?: string; top?: number; height?: number; overflow?: string; scale?: number } = {}) {
    this.ownerDocument = document;
    this.parentElement = options.parent || null;
    this.parentElement?.children.push(this);
    this.classes = new Set((options.className || "").split(" "));
    this.overflowY = options.overflow || "visible";
    this.top = options.top || 0;
    this.scale = options.scale || this.parentElement?.scale || 1;
    this.clientHeight = options.height || 80;
    this.offsetHeight = this.clientHeight;
  }

  matches(selector: string) {
    return selector.split(",").some((value) => value.trim() === "*" || this.classes.has(value.trim().slice(1)));
  }

  closest(selector: string): TestElement | null {
    for (let element: TestElement | null = this; element; element = element.parentElement) {
      if (element.matches(selector)) return element;
    }
    return null;
  }

  contains(target: TestElement) {
    for (let element: TestElement | null = target; element; element = element.parentElement) {
      if (element === this) return true;
    }
    return false;
  }

  querySelectorAll(selector: string): TestElement[] {
    return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }

  getBoundingClientRect() {
    let offset = 0;
    for (let element = this.parentElement; element; element = element.parentElement) offset += element.scrollTop;
    const top = 20 + (this.top - offset) * this.scale;
    return { top, bottom: top + this.clientHeight * this.scale, height: this.clientHeight * this.scale };
  }

  scrollTo(options: ScrollToOptions) {
    this.calls.push({ ...options });
    this.scrollTop = Math.max(0, options.top || 0);
    this.pendingAnimation = undefined;
  }
}

function setup(scale = 1) {
  const document: any = {
    body: {}, documentElement: {},
    defaultView: { getComputedStyle: (element: TestElement) => ({ overflowY: element.overflowY }) },
  };
  const outside = new TestElement(document, { height: 800, overflow: "auto", scale });
  const modal = new TestElement(document, { parent: outside, className: "armada-control-dialog", height: 400, overflow: "auto" });
  const boundary = new TestElement(document, { parent: modal });
  const add = (options: ConstructorParameters<typeof TestElement>[1] = {}) => new TestElement(document, { parent: boundary, ...options });
  return { document, outside, modal, boundary, add };
}

function reveal(boundary: TestElement | null, target: TestElement | undefined, fieldSelector = ".native-field") {
  return revealModalFocus(boundary as unknown as HTMLElement | null, target as unknown as HTMLElement | undefined, fieldSelector);
}

function start(target: TestElement | null) {
  return revealModalStart(target as unknown as HTMLElement | null);
}

test("modal focus reveals the entire native field including its label and supporting text", () => {
  const { modal, boundary, add } = setup();
  const field = add({ className: "native-field", top: 600, height: 100 });
  const input = add({ parent: field, top: 640, height: 20 });
  assert.equal(reveal(boundary, input), true);
  assert.deepEqual(modal.calls, [{ top: 300, behavior: "instant" }]);
  assert.equal(field.getBoundingClientRect().bottom, modal.getBoundingClientRect().bottom);
});

test("native text inputs reveal their label and description without requiring a Field class", () => {
  for (const selector of [".native-field", ""]) {
    const { modal, boundary, add } = setup();
    const group = add({ className: "DialogInputLabelGroup", top: 600, height: 120 });
    const label = add({ parent: group, top: 600, height: 20 });
    const input = add({ parent: group, top: 650, height: 20 });
    const description = add({ parent: group, top: 680, height: 40 });
    assert.equal(reveal(boundary, input, selector), true);
    assert.deepEqual(modal.calls, [{ top: 320, behavior: "instant" }]);
    assert.ok(label.getBoundingClientRect().top >= modal.getBoundingClientRect().top);
    assert.equal(description.getBoundingClientRect().bottom, modal.getBoundingClientRect().bottom);
  }
});

test("rapid modal focus changes cancel old native motion and reveal the current field", () => {
  const { modal, boundary, add } = setup();
  const last = add({ className: "native-field", top: 600, height: 100 });
  const first = add({ className: "native-field", top: 80, height: 100 });
  reveal(boundary, last);
  modal.pendingAnimation = 600;
  reveal(boundary, first);
  assert.deepEqual(modal.calls, [{ top: 300, behavior: "instant" }, { top: 80, behavior: "instant" }]);
  assert.equal(first.getBoundingClientRect().top, modal.getBoundingClientRect().top);
  assert.equal(modal.pendingAnimation, undefined);
});

test("visible modal fields still cancel a pending native scroll", () => {
  const { modal, boundary, add } = setup();
  modal.pendingAnimation = 500;
  const field = add({ className: "native-field", top: 40 });
  assert.equal(reveal(boundary, field), true);
  assert.deepEqual(modal.calls, [{ top: 0, behavior: "instant" }]);
  assert.equal(modal.pendingAnimation, undefined);
});

test("footer focus reveals the full horizontal action row rather than one button", () => {
  const { modal, boundary, add } = setup();
  modal.scrollHeight = 764;
  const footer = add({ className: "armada-control-dialog-footer", top: 700, height: 64 });
  const button = add({ parent: footer, top: 715, height: 28 });
  assert.equal(reveal(boundary, button), true);
  assert.deepEqual(modal.calls, [{ top: 364, behavior: "instant" }]);
  assert.equal(footer.getBoundingClientRect().bottom, modal.getBoundingClientRect().bottom);
});

test("nested modal scroll regions reveal the focused field from inside out without scrolling QAM", () => {
  const { modal, boundary, outside, add } = setup();
  const body = add({ top: 300, height: 240, overflow: "auto" });
  const field = add({ parent: body, className: "native-field", top: 1000 });
  assert.equal(reveal(boundary, field), true);
  assert.deepEqual(body.calls, [{ top: 540, behavior: "instant" }]);
  assert.deepEqual(modal.calls, [{ top: 140, behavior: "instant" }]);
  assert.equal(field.getBoundingClientRect().bottom, body.getBoundingClientRect().bottom);
  assert.equal(field.getBoundingClientRect().bottom, modal.getBoundingClientRect().bottom);
  assert.deepEqual(outside.calls, []);
});

test("modal scrolling accounts for Steam window scaling", () => {
  const { modal, boundary, add } = setup(1.5);
  const field = add({ className: "native-field", top: 600 });
  assert.equal(reveal(boundary, field), true);
  assert.deepEqual(modal.calls, [{ top: 280, behavior: "instant" }]);
  assert.equal(field.getBoundingClientRect().bottom, modal.getBoundingClientRect().bottom);
});

test("returning to a modal title resets its body and outer scroll regions immediately", () => {
  const { modal, boundary, outside, add } = setup();
  const heading = add({ className: "armada-control-dialog-heading", top: 0, height: 40 });
  const body = add({ top: 60, height: 300, overflow: "scroll" });
  const nested = add({ parent: body, className: "armada-control-dialog", top: 200, overflow: "auto" });
  modal.scrollTop = 100;
  body.scrollTop = 180;
  nested.scrollTop = 120;
  modal.pendingAnimation = 600;
  body.pendingAnimation = 400;
  assert.equal(reveal(boundary, heading), true);
  assert.deepEqual(modal.calls, [{ top: 0, behavior: "instant" }]);
  assert.deepEqual(body.calls, [{ top: 0, behavior: "instant" }]);
  assert.equal(modal.pendingAnimation, undefined);
  assert.equal(body.pendingAnimation, undefined);
  assert.equal(nested.scrollTop, 120);
  assert.deepEqual(nested.calls, []);
  assert.deepEqual(outside.calls, []);
});

test("modal boundaries ignore dropdown portals and nested confirmation owners", () => {
  const { document, modal, boundary, add } = setup();
  const portal = new TestElement(document, { className: "native-field", top: 700 });
  const nested = add({ className: "armada-control-dialog", top: 100, overflow: "auto" });
  const nestedBoundary = add({ parent: nested });
  const field = add({ parent: nestedBoundary, className: "native-field", top: 700 });
  assert.equal(reveal(boundary, portal), false);
  assert.equal(reveal(boundary, field), false);
  assert.deepEqual(modal.calls, []);
  assert.deepEqual(nested.calls, []);
  assert.equal(reveal(nestedBoundary, field), true);
  assert.equal(nested.calls.length, 1);
  assert.deepEqual(modal.calls, []);
});

test("unowned targets and dialogs without a native scroll region use native fallback", () => {
  const { document, modal, boundary, outside, add } = setup();
  modal.overflowY = "visible";
  const field = add({ className: "native-field", top: 700 });
  assert.equal(reveal(boundary, field), false);
  assert.equal(reveal(boundary, undefined), false);
  assert.equal(reveal(null, field), false);
  assert.equal(start(field), false);
  assert.equal(start(null), false);
  const detached = new TestElement(document, { className: "armada-control-dialog-heading" });
  assert.equal(start(detached), false);
  assert.deepEqual(modal.calls, []);
  assert.deepEqual(outside.calls, []);
});

test("Steam's outer modal position scrolls when the content root has no overflow", () => {
  const { document, outside } = setup();
  const position = new TestElement(document, { parent: outside, className: "armada-control-dialog-position", height: 400, overflow: "auto" });
  const modal = new TestElement(document, { parent: position, className: "armada-control-dialog", height: 900 });
  const boundary = new TestElement(document, { parent: modal });
  const field = new TestElement(document, { parent: boundary, className: "native-field", top: 600, height: 100 });
  assert.equal(reveal(boundary, field), true);
  assert.deepEqual(position.calls, [{ top: 300, behavior: "instant" }]);
  assert.equal(field.getBoundingClientRect().bottom, position.getBoundingClientRect().bottom);
  position.pendingAnimation = 600;
  const heading = new TestElement(document, { parent: boundary, className: "armada-control-dialog-heading" });
  assert.equal(start(heading), true);
  assert.deepEqual(position.calls.at(-1), { top: 0, behavior: "instant" });
  assert.equal(position.pendingAnimation, undefined);
  assert.deepEqual(outside.calls, []);
});

test("a nested confirmation scrolls only its own outer position", () => {
  const { document, outside } = setup();
  const parentPosition = new TestElement(document, { parent: outside, className: "armada-control-dialog-position", overflow: "auto" });
  const parent = new TestElement(document, { parent: parentPosition, className: "armada-control-dialog" });
  const parentBoundary = new TestElement(document, { parent });
  const position = new TestElement(document, { parent: parentBoundary, className: "armada-control-dialog-position", height: 300, overflow: "auto" });
  position.scrollHeight = 660;
  const modal = new TestElement(document, { parent: position, className: "armada-control-dialog" });
  const boundary = new TestElement(document, { parent: modal });
  const footer = new TestElement(document, { parent: boundary, className: "armada-control-dialog-footer", top: 600, height: 60 });
  assert.equal(reveal(parentBoundary, footer), false);
  assert.equal(reveal(boundary, footer), true);
  assert.equal(position.scrollTop, 360);
  assert.deepEqual(parentPosition.calls, []);
  start(parentBoundary);
  assert.equal(position.scrollTop, 360);
  assert.deepEqual(parentPosition.calls, [{ top: 0, behavior: "instant" }]);
});

test("footer focus reveals the modal end beyond its native padding and margins", () => {
  const { document, outside } = setup(1.5);
  const position = new TestElement(document, { parent: outside, className: "armada-control-dialog-position", height: 400, overflow: "auto" });
  position.scrollHeight = 832;
  const modal = new TestElement(document, { parent: position, className: "armada-control-dialog", height: 808 });
  const boundary = new TestElement(document, { parent: modal });
  const footer = new TestElement(document, { parent: boundary, className: "armada-control-dialog-footer", top: 700, height: 80 });
  const button = new TestElement(document, { parent: footer, top: 720, height: 40 });
  assert.equal(reveal(boundary, button), true);
  assert.equal(position.scrollTop, 432);
  assert.equal(position.scrollTop, position.scrollHeight - position.clientHeight);
  assert.ok(footer.getBoundingClientRect().bottom < position.getBoundingClientRect().bottom);
  assert.deepEqual(outside.calls, []);
});
