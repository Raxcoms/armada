import { PanelSection, Spinner } from "@decky/ui";
import { t } from "../i18n";
import { SupportingText } from "./widgets";

export function LoadingState({ label = t("common.loading") }: { label?: string }) {
  return <PanelSection>
    <div className="armada-loading-state" role="status" aria-live="polite" aria-busy>
      <Spinner className="armada-loading-spinner" aria-hidden="true" />
      <SupportingText>{label}</SupportingText>
    </div>
  </PanelSection>;
}
