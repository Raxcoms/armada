import { PanelSection } from "@decky/ui";
import type { Dispatch, SetStateAction } from "react";
import { getConfig, setControllerType as applyControllerType } from "../backend";
import { openCalibration } from "../components/Calibration";
import { ButtonRow, ReadOnlyRow, SectionDescription, SelectEdit } from "../components/widgets";
import { getCurrentLocale, t, translateLabel } from "../i18n";
import { createConfigMutation } from "../lib/configMutation";
import type { Config } from "../types";

const saveControllerType = createConfigMutation("controllerType", applyControllerType, { read: getConfig });

export function Controller({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const setControllerType = (value: string) => saveControllerType(config, setConfig, value);
  const calibratedAt = config.calibratedAt ? new Date(config.calibratedAt) : null;
  const calibratedDate = calibratedAt && Number.isFinite(calibratedAt.getTime())
    ? new Intl.DateTimeFormat(getCurrentLocale(), { dateStyle: "medium" }).format(calibratedAt)
    : t("common.unknown");
  const startCalibration = () => openCalibration((state) => {
    setConfig((current) => current ? { ...current, calibratedAt: state.calibratedAt ?? null } : current);
  });

  return (
    <>
      <PanelSection title={t("controller.emulationTitle")}>
        <SectionDescription>{t("controller.emulationDescription")}</SectionDescription>
        <SelectEdit
          label={t("settings.emulation")}
          value={config.controllerType || "deck-uhid"}
          options={(config.controllerTypes || []).map((option) => ({ ...option, label: translateLabel(option.label) }))}
          onChange={setControllerType}
        />
      </PanelSection>
      <PanelSection title={t("controller.calibrationTitle")}>
        <ReadOnlyRow label={t("controller.lastCalibrated")} description={calibratedDate} />
        <ButtonRow layout="below" onClick={startCalibration}>{t("calibration.start")}</ButtonRow>
      </PanelSection>
    </>
  );
}
