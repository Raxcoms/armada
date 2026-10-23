import { SteamSpinner } from "@decky/ui";
import { useRef } from "react";
import type { ComponentProps, ComponentType } from "react";
import { usePanelHeight } from "../hooks/usePanelHeight";
import { t } from "../i18n";

// Decky omits Steam's size and footer options from its types.
const PanelSpinner = SteamSpinner as ComponentType<ComponentProps<typeof SteamSpinner> & {
  size: "small" | "medium";
  showFooter: boolean;
}>;

export function LoadingState({ label = t("common.loading") }: { label?: string }) {
  const root = useRef<HTMLDivElement>(null);
  usePanelHeight(root);
  return <div ref={root} className="armada-loading-state" role="status" aria-live="polite" aria-busy>
    <PanelSpinner className="armada-loading-spinner" size="small" background="transparent" showFooter>{label}</PanelSpinner>
  </div>;
}
