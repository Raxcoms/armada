export function findScrollParent(element: HTMLElement): HTMLElement | null {
  const document = element.ownerDocument;
  for (let parent = element.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
    const overflow = document.defaultView?.getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return null;
}

export function revealScrollRegion(scroller: HTMLElement, target: HTMLElement, visibleTop: number) {
  const viewport = scroller.getBoundingClientRect();
  const bounds = target.getBoundingClientRect();
  const scale = (scroller.offsetHeight ? viewport.height / scroller.offsetHeight : 1) || 1;
  const top = Math.max(viewport.top + scroller.clientTop * scale, visibleTop);
  const bottom = viewport.top + (scroller.clientTop + scroller.clientHeight) * scale;
  let offset = scroller.scrollTop;
  if (bounds.top < top || bounds.height > bottom - top) offset += (bounds.top - top) / scale;
  else if (bounds.bottom > bottom) offset += (bounds.bottom - bottom) / scale;
  // Steam's smooth scroller cancels its old animation on an immediate scroll.
  scroller.scrollTo({ top: Math.max(0, offset), behavior: "instant" });
}

export function bindScrollPadding(element: HTMLElement) {
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  const saved = new Map<string, { value: string; priority: string; baseline: number | string; applied?: string }>();
  for (const edge of ["top", "bottom"] as const) {
    const property = `scroll-padding-${edge}`;
    const native = (edge === "top" ? computed?.scrollPaddingTop : computed?.scrollPaddingBottom)?.trim() || "auto";
    const pixels = native.endsWith("px") ? Number(native.slice(0, -2)) : Number.NaN;
    saved.set(property, {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
      baseline: native === "auto" || native === "0" ? 0 : Number.isFinite(pixels) ? pixels : native,
    });
  }
  return {
    set(edge: "top" | "bottom", value: number) {
      const property = `scroll-padding-${edge}`;
      const original = saved.get(property)!;
      const inset = Math.max(0, value);
      const applied = typeof original.baseline === "number"
        ? `${Math.max(original.baseline, inset)}px`
        : `max(${original.baseline}, ${inset}px)`;
      element.style.setProperty(property, applied);
      // CSS math may be normalized by the browser.
      original.applied = element.style.getPropertyValue(property);
    },
    restore() {
      for (const [property, original] of saved) {
        if (original.applied === undefined || element.style.getPropertyValue(property) !== original.applied) continue;
        if (original.value) element.style.setProperty(property, original.value, original.priority);
        else element.style.removeProperty(property);
      }
    },
  };
}
