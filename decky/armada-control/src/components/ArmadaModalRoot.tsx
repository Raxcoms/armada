import { DialogFooter, DialogHeader, Focusable, ModalRoot } from "@decky/ui";
import type { FocusableProps, ModalRootProps } from "@decky/ui";
import { useRef } from "react";
import type { ComponentType, ReactNode, RefAttributes } from "react";
import { findScrollParent } from "../lib/scrollRegion";
import { ArmadaStyles } from "./ArmadaStyles";

const FocusableHeading = Focusable as ComponentType<FocusableProps & RefAttributes<HTMLDivElement> & { focusable: boolean }>;

export function ArmadaDialogFooter({ children }: { children: ReactNode }) {
  return <DialogFooter>
    <Focusable className="armada-control-dialog-footer" flow-children="row" tabIndex={-1} noFocusRing>{children}</Focusable>
  </DialogFooter>;
}

export function ArmadaDialogHeader({ children }: { children: ReactNode }) {
  const heading = useRef<HTMLDivElement>(null);
  const showStart = () => {
    const scroller = heading.current && findScrollParent(heading.current);
    // Cancel an older native smooth scroll when navigation returns to the title.
    scroller?.scrollTo({ top: 0, behavior: "auto" });
  };
  return <DialogHeader>
    <FocusableHeading ref={heading} focusable tabIndex={0} preferredFocus onGamepadFocus={showStart} onFocus={showStart}>{children}</FocusableHeading>
  </DialogHeader>;
}

export function ArmadaModalRoot({ children, className = "", ...props }: ModalRootProps) {
  return (
    <ModalRoot {...props} className={["armada-control-dialog", className].filter(Boolean).join(" ")}>
      <ArmadaStyles />
      {children}
    </ModalRoot>
  );
}
