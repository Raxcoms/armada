import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import { findScrollParent } from "../lib/scrollRegion";

export function usePanelHeight(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = root.current;
    const scroller = element && findScrollParent(element);
    if (!element || !scroller) return;
    const update = () => {
      const viewport = scroller.getBoundingClientRect();
      const scale = (scroller.offsetHeight ? viewport.height / scroller.offsetHeight : 1) || 1;
      const start = (element.getBoundingClientRect().top - viewport.top) / scale + scroller.scrollTop - scroller.clientTop;
      const height = Math.max(0, scroller.clientHeight - start);
      element.style.setProperty("--armada-panel-available-height", `${height}px`);
    };
    update();
    const Observer = element.ownerDocument.defaultView?.ResizeObserver || ResizeObserver;
    const observer = new Observer(update);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      observer.observe(parent);
      if (parent === scroller) break;
    }
    return () => {
      observer.disconnect();
      element.style.removeProperty("--armada-panel-available-height");
    };
  }, [root]);
}
