import { ButtonItem, DialogButton, DropdownItem, Field, PanelSection, PanelSectionRow, SliderField, ToggleField, gamepadDialogClasses } from "@decky/ui";
import type { ReactNode } from "react";
import type { ButtonItemProps, DialogButtonProps, FieldProps } from "@decky/ui";
import type { DropdownChoice } from "../types";

type Option = string | DropdownChoice;
type Separator = "standard" | "thick" | "none";

export function ControlRow({ children }: { children: ReactNode }) {
  return <PanelSectionRow>{children}</PanelSectionRow>;
}

export function ReadOnlyRow({ label, description }: Pick<FieldProps, "label" | "description">) {
  return <ControlRow><Field label={label} description={description} focusable highlightOnFocus bottomSeparator="standard" /></ControlRow>;
}

export function SupportingText({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Field className={["armada-supporting-text", className].filter(Boolean).join(" ")} description={children} bottomSeparator="none" focusable={false} highlightOnFocus={false} />;
}

export function SectionDescription({ children }: { children: ReactNode }) {
  return <SupportingText className="armada-section-description">{children}</SupportingText>;
}

export function NoticeSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <PanelSection><ControlRow>
    <Field label={title} description={children} bottomSeparator="none" focusable highlightOnFocus />
  </ControlRow></PanelSection>;
}

export function ButtonRow({ children, bottomSeparator = "standard", ...props }: ButtonItemProps) {
  return <ControlRow><ButtonItem {...props} bottomSeparator={bottomSeparator}>{children}</ButtonItem></ControlRow>;
}

export function CompactButton({ className = "", ...props }: DialogButtonProps) {
  return <DialogButton {...props} className={`${gamepadDialogClasses.NoMinWidth} armada-compact-button ${className}`} />;
}

export function SelectEdit({ label, description, value, options, onChange, disabled, placeholder, bottomSeparator = "standard" }: {
  label?: ReactNode;
  description?: ReactNode;
  value: any;
  options: Option[];
  onChange: (data: any) => void;
  disabled?: boolean;
  placeholder?: string;
  bottomSeparator?: Separator;
}) {
  const rgOptions = options.map((option) => (typeof option === "string" ? { data: option, label: option } : option));
  return <ControlRow>
    <DropdownItem
      label={label}
      description={description}
      bottomSeparator={bottomSeparator}
      layout="below"
      disabled={disabled}
      strDefaultLabel={placeholder}
      selectedOption={value}
      rgOptions={rgOptions}
      onChange={(option) => onChange(option.data)}
    />
  </ControlRow>;
}

export function ToggleRow({ label, value, onChange, disabled, description, bottomSeparator = "standard" }: {
  label: ReactNode;
  value: any;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  description?: ReactNode;
  bottomSeparator?: Separator;
}) {
  return <ControlRow>
    <ToggleField label={label} description={description} checked={!!value} disabled={disabled} onChange={onChange} bottomSeparator={bottomSeparator} />
  </ControlRow>;
}

export function SliderEdit({ label, value, min, max, step, onChange, format, disabled, showValue = true, wrapperClassName, bottomSeparator = "standard" }: {
  label: ReactNode;
  value: any;
  min: number;
  max: number;
  step: number;
  onChange: (value: any) => void;
  format?: (value: number) => any;
  disabled?: boolean;
  showValue?: boolean;
  wrapperClassName?: string;
  bottomSeparator?: Separator;
}) {
  const numeric = Number(value);
  return <ControlRow>
    <SliderField
      className={wrapperClassName}
      bottomSeparator={bottomSeparator}
      label={label}
      childrenContainerWidth="max"
      value={Number.isFinite(numeric) ? numeric : min}
      min={min}
      max={max}
      step={step}
      showValue={showValue}
      disabled={disabled}
      onChange={(next) => onChange(format ? format(next) : next)}
    />
  </ControlRow>;
}
