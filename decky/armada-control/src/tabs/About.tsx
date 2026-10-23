import { toaster } from "@decky/api";
import { PanelSection } from "@decky/ui";
import { useRef, useState } from "react";
import { getSleepLogsStatus, setSleepLogsEnabled } from "../backend";
import { ButtonRow, ReadOnlyRow, SupportingText, ToggleRow } from "../components/widgets";
import { useBackendState } from "../hooks/useBackendState";
import { readAfterPendingApplies } from "../hooks/useDebouncedApply";
import { t } from "../i18n";
import type { Config } from "../types";

const readSleepLogsStatus = () => readAfterPendingApplies(getSleepLogsStatus);

export function About({ config }: { config: Config }) {
  const [saving, setSaving] = useState(false);
  const view = useRef<HTMLDivElement>(null);
  const { value: logs, setValue: setLogs, error, refresh } = useBackendState(readSleepLogsStatus, 10000, saving, view, true);

  const setEnabled = async (enabled: boolean) => {
    if (!logs || saving) return;
    setSaving(true);
    try {
      const saved = await readAfterPendingApplies(() => setSleepLogsEnabled(enabled));
      setLogs((current) => current ? { ...current, enabled: saved } : current);
    } catch (error) {
      toaster.toast({ title: t("settings.sleepLogsError"), body: String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={view}>
      <PanelSection title={t("settings.system")}>
        <ReadOnlyRow label={t("settings.osVersion")} description={config.osVersion || t("common.unknown")} />
        <ReadOnlyRow label={t("settings.ablVersion")} description={config.ablVersion || t("common.unknown")} />
      </PanelSection>
      <PanelSection title={t("about.localLogs")}>
        {error ? <SupportingText className="armada-note-error">{t("about.loadingError")}: {error}</SupportingText> : null}
        {error ? <ButtonRow layout="below" onClick={() => { void refresh(); }}>{t("common.retry")}</ButtonRow> : null}
        {!logs && !error ? <SupportingText>{t("common.loading")}</SupportingText> : null}
        {logs ? <>
          <ReadOnlyRow label={t("about.logDirectory")} description={logs.directory || t("common.unknown")} />
          <ToggleRow
            label={t("settings.sleepLogs")}
            description={t("about.sleepLogsDescription")}
            value={logs.enabled}
            disabled={saving}
            onChange={(enabled) => { void setEnabled(enabled); }}
          />
        </> : null}
      </PanelSection>
    </div>
  );
}
