import { classMap, DialogBody, DialogButton, DialogFooter, DialogHeader, Focusable, ModalRoot } from "@decky/ui";
import type { FocusableProps, ModalRootProps } from "@decky/ui";
import { useRef } from "react";
import type { ComponentType, ReactNode, RefAttributes } from "react";
import { revealModalFocus, revealModalStart } from "../lib/modalScroll";
import { ArmadaStyles } from "./ArmadaStyles";

const FocusableHeading = Focusable as ComponentType<FocusableProps & RefAttributes<HTMLDivElement> & { focusable: boolean }>;

// Steam exposes focus scrolling on Focusable, not the native modal's form.
const ModalNavigation = Focusable as ComponentType<FocusableProps & RefAttributes<HTMLDivElement> & {
  scrollIntoViewWhenChildFocused: "force";
  fnScrollIntoViewHandler: (target: { Element?: HTMLElement }) => boolean;
}>;

const fieldSelector = [...new Set(classMap.map((classes) => classes.Field).filter(Boolean))]
  .map((name) => `.${name}`).join(", ");

export function ArmadaDialogFooter({ children }: { children: ReactNode }) {
  return <DialogFooter>
    <Focusable className="armada-control-dialog-footer" flow-children="row" tabIndex={-1} noFocusRing>{children}</Focusable>
  </DialogFooter>;
}

export function ArmadaDialogHeader({ children }: { children: ReactNode }) {
  const heading = useRef<HTMLDivElement>(null);
  const showStart = () => { revealModalStart(heading.current); };
  return <DialogHeader>
    <FocusableHeading ref={heading} className="armada-control-dialog-heading" focusable tabIndex={0} preferredFocus onGamepadFocus={showStart} onFocus={showStart}>{children}</FocusableHeading>
  </DialogHeader>;
}

export function ArmadaModalRoot({ children, className = "", modalClassName = "", ...props }: ModalRootProps) {
  const boundary = useRef<HTMLDivElement>(null);
  return (
    <ModalRoot
      {...props}
      className={["armada-control-dialog", className].filter(Boolean).join(" ")}
      modalClassName={["armada-control-dialog-position", modalClassName].filter(Boolean).join(" ")}
    >
      <ArmadaStyles />
      <ModalNavigation
        ref={boundary}
        className="armada-control-dialog-scroll"
        flow-children="column"
        tabIndex={-1}
        noFocusRing
        scrollIntoViewWhenChildFocused="force"
        fnScrollIntoViewHandler={(target) => revealModalFocus(boundary.current, target.Element, fieldSelector)}
      >{children}</ModalNavigation>
    </ModalRoot>
  );
}

export function ArmadaConfirmModal({ title, description, confirmText, cancelText, onConfirm, closeModal }: {
  title: ReactNode;
  description: ReactNode;
  confirmText: ReactNode;
  cancelText: ReactNode;
  onConfirm: () => void;
  closeModal?: () => void;
}) {
  const confirm = () => {
    onConfirm();
    closeModal?.();
  };
  return <ArmadaModalRoot closeModal={closeModal} onCancel={closeModal} onOK={onConfirm}>
    <ArmadaDialogHeader>{title}</ArmadaDialogHeader>
    <DialogBody>{description}</DialogBody>
    <ArmadaDialogFooter>
      <DialogButton onClick={confirm}>{confirmText}</DialogButton>
      <DialogButton onClick={closeModal}>{cancelText}</DialogButton>
    </ArmadaDialogFooter>
  </ArmadaModalRoot>;
}
