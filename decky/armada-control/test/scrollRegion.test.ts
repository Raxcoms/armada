import assert from "node:assert/strict";
import test from "node:test";
import { bindScrollPadding, findScrollParent, isLastFocusableRegion, revealScrollRegion } from "../src/lib/scrollRegion.ts";

function focusRegion(scale = 1) {
  const calls: ScrollToOptions[] = [];
  let current = 0;
  let animationTarget: number | undefined;
  const scroller = {
    clientHeight: 400, clientTop: 0, offsetHeight: 400,
    get scrollTop() { return current; },
    getBoundingClientRect: () => ({ top: 20, height: 400 * scale }),
    scrollTo: (options: ScrollToOptions) => {
      calls.push(options);
      animationTarget = undefined;
      current = Math.max(0, options.top || 0);
    },
  } as HTMLElement;
  const target = (top: number, height = 80) => ({
    getBoundingClientRect: () => ({
      top: 20 + (top - current) * scale,
      bottom: 20 + (top + height - current) * scale,
      height: height * scale,
    }),
  }) as HTMLElement;
  return {
    scroller, calls, target,
    animateTo: (offset: number) => { animationTarget = offset; },
    get animationTarget() { return animationTarget; },
  };
}

test("native focus scrolling keeps the full final field visible below the sticky header", () => {
  const region = focusRegion();
  region.animateTo(120);
  revealScrollRegion(region.scroller, region.target(600), 100);
  assert.deepEqual(region.calls, [{ top: 280, behavior: "instant" }]);
  assert.equal(region.animationTarget, undefined);
  assert.equal(region.target(600).getBoundingClientRect().bottom, 420);
});

test("rapid native focus changes cancel old motion and use only the current field bounds", () => {
  const region = focusRegion();
  revealScrollRegion(region.scroller, region.target(600), 100);
  region.animateTo(650);
  revealScrollRegion(region.scroller, region.target(140), 100);
  assert.deepEqual(region.calls, [{ top: 280, behavior: "instant" }, { top: 60, behavior: "instant" }]);
  assert.equal(region.target(140).getBoundingClientRect().top, 100);
  assert.equal(region.animationTarget, undefined);
  region.animateTo(500);
  revealScrollRegion(region.scroller, region.target(140), 100);
  assert.deepEqual(region.calls.at(-1), { top: 60, behavior: "instant" });
  assert.equal(region.animationTarget, undefined);
});

test("fields taller than the visible panel keep their label at the start", () => {
  const region = focusRegion();
  revealScrollRegion(region.scroller, region.target(500, 500), 100);
  assert.equal(region.target(500, 500).getBoundingClientRect().top, 100);
});

test("focus visibility uses transformed bounds without scaling the scroll distance twice", () => {
  const region = focusRegion(1.5);
  revealScrollRegion(region.scroller, region.target(600), 140);
  assert.equal(region.scroller.scrollTop, 280);
  revealScrollRegion(region.scroller, region.target(140), 140);
  assert.equal(region.scroller.scrollTop, 60);
  assert.equal(region.target(140).getBoundingClientRect().top, 140);
});

test("final fields reveal the native end including plugin and section padding", () => {
  for (const scale of [1, 1.5]) {
    const region = focusRegion(scale);
    Object.defineProperty(region.scroller, "scrollHeight", { value: 738 });
    const field = region.target(600);
    revealScrollRegion(region.scroller, field, 20 + 80 * scale, true);
    assert.deepEqual(region.calls, [{ top: 338, behavior: "instant" }]);
    assert.equal(region.scroller.scrollTop, region.scroller.scrollHeight - region.scroller.clientHeight);
    assert.ok(field.getBoundingClientRect().top >= 20 + 80 * scale);
    const viewportBottom = 20 + 400 * scale;
    assert.equal(viewportBottom - field.getBoundingClientRect().bottom, 58 * scale);
  }
});

test("end scrolling does not hide a focused field behind the sticky header", () => {
  const region = focusRegion();
  Object.defineProperty(region.scroller, "scrollHeight", { value: 1600 });
  const field = region.target(600);
  revealScrollRegion(region.scroller, field, 100, true);
  assert.equal(region.scroller.scrollTop, 520);
  assert.equal(field.getBoundingClientRect().top, 100);
  assert.ok(field.getBoundingClientRect().bottom <= 420);
});

test("an oversized final field retains its label rather than jumping to the document end", () => {
  const region = focusRegion();
  Object.defineProperty(region.scroller, "scrollHeight", { value: 1600 });
  const field = region.target(500, 500);
  revealScrollRegion(region.scroller, field, 100, true);
  assert.equal(field.getBoundingClientRect().top, 100);
  assert.equal(region.scroller.scrollTop, 420);
});

test("final-region detection follows visible native focus stops and includes disabled native buttons", () => {
  const candidate = (options: { tabIndex?: number; disabled?: boolean; hidden?: boolean; visible?: boolean } = {}) => ({
    tabIndex: options.tabIndex ?? 0,
    matches: (selector: string) => selector === ":disabled" && !!options.disabled,
    getClientRects: () => options.visible === false ? [] : [{}],
    closest: () => options.hidden ? {} : null,
  });
  const first = candidate();
  const last = candidate();
  const ignored = [candidate({ tabIndex: -1 }), candidate({ disabled: true }), candidate({ hidden: true }), candidate({ visible: false })];
  const container = { querySelectorAll: () => [first, last, ...ignored] } as unknown as HTMLElement;
  const firstRegion = { contains: (target: unknown) => target === first } as HTMLElement;
  const lastRegion = { contains: (target: unknown) => target === last } as HTMLElement;
  assert.equal(isLastFocusableRegion(container, firstRegion), false);
  assert.equal(isLastFocusableRegion(container, lastRegion), true);
  assert.equal(isLastFocusableRegion({ querySelectorAll: () => ignored } as unknown as HTMLElement, lastRegion), false);
});

function setup() {
  const values = new Map<string, { value: string; priority: string }>();
  const document: any = {
    body: {}, documentElement: {},
    defaultView: { getComputedStyle: (element: any) => element.computed },
  };
  const scroller: any = {
    ownerDocument: document,
    parentElement: document.body,
    computed: { overflowY: "auto", scrollPaddingTop: "48px", scrollPaddingBottom: "16px" },
    style: {
      getPropertyValue: (key: string) => values.get(key)?.value || "",
      getPropertyPriority: (key: string) => values.get(key)?.priority || "",
      setProperty: (key: string, value: string, priority = "") => { values.set(key, { value, priority }); },
      removeProperty: (key: string) => { values.delete(key); },
    },
  };
  return { document, scroller, values };
}

test("scroll regions use the owner's native overflow ancestor even before content overflows", () => {
  const { document, scroller } = setup();
  const wrapper: any = { ownerDocument: document, parentElement: scroller, computed: { overflowY: "visible" } };
  const control: any = { ownerDocument: document, parentElement: wrapper };
  assert.equal(findScrollParent(control), scroller);
});

test("scroll discovery never selects the Steam document or page root", () => {
  const { document } = setup();
  document.body.computed = { overflowY: "auto" };
  assert.equal(findScrollParent({ ownerDocument: document, parentElement: document.body } as HTMLElement), null);
});

test("sticky bounds preserve larger native padding and update measured sizes without compounding", () => {
  const { scroller, values } = setup();
  const padding = bindScrollPadding(scroller);
  padding.set("top", 81);
  assert.equal(values.get("scroll-padding-top")?.value, "81px");
  padding.set("top", 60);
  assert.equal(values.get("scroll-padding-top")?.value, "60px");
  padding.set("bottom", 0);
  assert.equal(values.get("scroll-padding-bottom")?.value, "16px");
  padding.set("top", 20);
  assert.equal(values.get("scroll-padding-top")?.value, "48px");
  padding.restore();
  assert.equal(values.size, 0);
});

test("unmount restores original inline padding and does not overwrite a newer owner's change", () => {
  const { scroller, values } = setup();
  scroller.style.setProperty("scroll-padding-top", "52px", "important");
  const padding = bindScrollPadding(scroller);
  padding.set("top", 90);
  padding.restore();
  assert.deepEqual(values.get("scroll-padding-top"), { value: "52px", priority: "important" });
  const next = bindScrollPadding(scroller);
  next.set("top", 90);
  scroller.style.setProperty("scroll-padding-top", "100px");
  next.restore();
  assert.equal(values.get("scroll-padding-top")?.value, "100px");
});

test("percentage native padding remains responsive instead of being treated as pixels", () => {
  const { scroller, values } = setup();
  scroller.clientHeight = 600;
  scroller.computed.scrollPaddingTop = "10%";
  const padding = bindScrollPadding(scroller);
  padding.set("top", 48);
  assert.equal(values.get("scroll-padding-top")?.value, "max(10%, 48px)");
  scroller.clientHeight = 1200;
  padding.set("top", 60);
  assert.equal(values.get("scroll-padding-top")?.value, "max(10%, 60px)");
  padding.restore();
  assert.equal(values.size, 0);
});

test("native calc and clamp expressions retain their length-percentage configuration without compounding", () => {
  const { scroller, values } = setup();
  scroller.computed.scrollPaddingTop = "calc(10% + 2px)";
  scroller.computed.scrollPaddingBottom = "clamp(16px, 8%, 80px)";
  const padding = bindScrollPadding(scroller);
  padding.set("top", 48);
  padding.set("bottom", 24);
  assert.equal(values.get("scroll-padding-top")?.value, "max(calc(10% + 2px), 48px)");
  assert.equal(values.get("scroll-padding-bottom")?.value, "max(clamp(16px, 8%, 80px), 24px)");
  padding.set("top", 60);
  assert.equal(values.get("scroll-padding-top")?.value, "max(calc(10% + 2px), 60px)");
});

test("auto and empty native padding use only the nonnegative measured inset", () => {
  const { scroller, values } = setup();
  scroller.computed.scrollPaddingTop = "auto";
  scroller.computed.scrollPaddingBottom = "";
  const padding = bindScrollPadding(scroller);
  padding.set("top", 48);
  padding.set("bottom", 16);
  assert.equal(values.get("scroll-padding-top")?.value, "48px");
  assert.equal(values.get("scroll-padding-bottom")?.value, "16px");
  padding.set("top", -10);
  assert.equal(values.get("scroll-padding-top")?.value, "0px");
});

test("percentage cleanup restores original priorities and leaves a later native expression alone", () => {
  const { scroller, values } = setup();
  scroller.computed.scrollPaddingTop = "10%";
  scroller.style.setProperty("scroll-padding-top", "10%", "important");
  const padding = bindScrollPadding(scroller);
  padding.set("top", 48);
  padding.restore();
  assert.deepEqual(values.get("scroll-padding-top"), { value: "10%", priority: "important" });
  const next = bindScrollPadding(scroller);
  next.set("top", 60);
  scroller.style.setProperty("scroll-padding-top", "calc(12% + 4px)");
  next.restore();
  assert.equal(values.get("scroll-padding-top")?.value, "calc(12% + 4px)");
});

test("cleanup compares the browser's serialized CSS math rather than the assigned string", () => {
  const { scroller, values } = setup();
  scroller.computed.scrollPaddingTop = "calc(10% + 2px)";
  const write = scroller.style.setProperty;
  scroller.style.setProperty = (key: string, value: string, priority = "") => {
    write(key, value.replace("max(calc(10% + 2px), ", "max(10% + 2px, "), priority);
  };
  const padding = bindScrollPadding(scroller);
  padding.set("top", 48);
  assert.equal(values.get("scroll-padding-top")?.value, "max(10% + 2px, 48px)");
  padding.restore();
  assert.equal(values.has("scroll-padding-top"), false);
});
