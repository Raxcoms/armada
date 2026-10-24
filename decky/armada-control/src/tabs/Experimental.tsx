import { toaster } from "@decky/api";
import { PanelSection } from "@decky/ui";
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  getBottomScreenActive,
  getConfig,
  setBottomScreenBrightness as applyBottomScreenBrightness,
  setBottomScreenEnabled as applyBottomScreenEnabled,
  setChargingFanPwm as applyChargingFanPwm,
  setDesktopMode as applyDesktopMode,
  setMtpEnabled as applyMtpEnabled,
  setSleepMode as applySleepMode,
  setSshEnabled as applySshEnabled,
  setSwipeGesturesEnabled as applySwipeGesturesEnabled,
} from "../backend";
import { NoticeSection, SectionDescription, SelectEdit, SliderEdit, ToggleRow } from "../components/widgets";
import { useDebouncedApply } from "../hooks/useDebouncedApply";
import { t, translateLabel } from "../i18n";
import { createConfigMutation } from "../lib/configMutation";
import { percentToPwm, pwmToPercent } from "../lib/fanCurve";
import type { Config } from "../types";

const saveSshEnabled = createConfigMutation("sshEnabled", applySshEnabled, { read: getConfig });
const saveMtpEnabled = createConfigMutation("mtpEnabled", applyMtpEnabled, { read: getConfig });
const saveBottomScreenEnabled = createConfigMutation("bottomScreenEnabled", applyBottomScreenEnabled, { read: getConfig });
const saveDesktopMode = createConfigMutation("desktopMode", applyDesktopMode, { read: getConfig });
const saveSleepMode = createConfigMutation("sleepMode", applySleepMode, { read: getConfig });
const saveSwipeGesturesEnabled = createConfigMutation("swipeGesturesEnabled", applySwipeGesturesEnabled, { read: getConfig, optimistic: false });

export function Experimental({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const [swipeGesturesSaving, setSwipeGesturesSaving] = useState(false);
  const setChargingFanPwm = useDebouncedApply(
    async () => (await getConfig()).chargingFanPwm,
    (value) => setConfig((current) => current ? { ...current, chargingFanPwm: value } : current),
    applyChargingFanPwm,
    t("settings.chargingFanSpeedError"),
    500,
  );
  const setBottomScreenBrightness = useDebouncedApply(
    async () => (await getConfig()).bottomScreenBrightness,
    (value) => setConfig((current) => current ? { ...current, bottomScreenBrightness: value } : current),
    applyBottomScreenBrightness,
    t("settings.bottomScreenBrightnessError"),
    150,
  );

  useEffect(() => {
    if (!config.bottomScreenBrightnessSupported) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const active = await getBottomScreenActive();
        if (!cancelled) {
          setConfig((current) => current && current.bottomScreenActive !== active
            ? { ...current, bottomScreenActive: active } : current);
        }
      } catch (error) {
        if (!cancelled) setConfig((current) => current && current.bottomScreenActive
          ? { ...current, bottomScreenActive: false } : current);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config.bottomScreenBrightnessSupported, setConfig]);

  const setSshEnabled = (enabled: boolean) => saveSshEnabled(config, setConfig, enabled);
  const setMtpEnabled = (enabled: boolean) => saveMtpEnabled(config, setConfig, enabled);
  const setSwipeGesturesEnabled = async (enabled: boolean) => {
    if (swipeGesturesSaving) return;
    setSwipeGesturesSaving(true);
    try {
      await saveSwipeGesturesEnabled(config, setConfig, enabled, (error) => {
        toaster.toast({ title: t("settings.swipeGesturesError"), body: String(error) });
      });
    } finally {
      setSwipeGesturesSaving(false);
    }
  };
  const setBottomScreenEnabled = (enabled: boolean) => saveBottomScreenEnabled(config, setConfig, enabled, (error) => {
    toaster.toast({ title: t("settings.bottomScreenError"), body: String(error) });
  });
  const setDesktopMode = (value: string) => saveDesktopMode(config, setConfig, value, (error) => {
    toaster.toast({ title: t("settings.desktopModeError"), body: String(error) });
  });
  const setSleepMode = (value: string) => saveSleepMode(config, setConfig, value, (error) => {
    toaster.toast({ title: t("settings.sleepModeError"), body: String(error) });
  });

  return (
    <>
      <NoticeSection kind="warning" title={t("experimental.warningTitle")}>{t("experimental.warning")}</NoticeSection>
      {config.bottomScreenSupported ? (
        <PanelSection title={t("experimental.dualScreenTitle")}>
          <SectionDescription>{t("experimental.dualScreenDescription")}</SectionDescription>
          <ToggleRow
            label={t("settings.bottomScreen")}
            description={t("settings.bottomScreenDescription")}
            value={!!config.bottomScreenEnabled}
            onChange={setBottomScreenEnabled}
          />
          {config.bottomScreenBrightnessSupported && config.bottomScreenActive ? (
            <SliderEdit
              label={t("settings.bottomScreenBrightness")}
              value={config.bottomScreenBrightness}
              min={0}
              max={100}
              step={1}
              onChange={setBottomScreenBrightness}
            />
          ) : null}
        </PanelSection>
      ) : null}
      {(config.desktopModes?.length || 0) > 1 ? (
        <PanelSection title={t("settings.desktopMode")}>
          <SectionDescription>{t("experimental.desktopDescription")}</SectionDescription>
          <SelectEdit
            value={config.desktopMode || "desktop"}
            options={(config.desktopModes || []).map((option) => ({ ...option, label: translateLabel(option.label) }))}
            onChange={setDesktopMode}
          />
        </PanelSection>
      ) : null}
      <PanelSection title={t("settings.sleepMode")}>
        <SectionDescription>{t("experimental.sleepDescription")}</SectionDescription>
        <SelectEdit
          value={config.sleepMode || "s2idle"}
          options={(config.sleepModes || []).map((option) => ({ ...option, label: translateLabel(option.label) }))}
          onChange={setSleepMode}
        />
      </PanelSection>
      <PanelSection title={t("experimental.miscellaneous")}>
        {config.cpuDeviceClass !== "SM8250" ? <SliderEdit
          label={t("settings.chargingFanSpeed")}
          value={pwmToPercent(config.chargingFanPwm)}
          min={0}
          max={100}
          step={1}
          onChange={(value) => setChargingFanPwm(percentToPwm(value))}
        /> : null}
        <ToggleRow
          label={t("settings.usbFileTransfer")}
          description={config.mtpEnabled ? t("settings.enabledUntilShutdown") : t("experimental.usbDescription")}
          value={!!config.mtpEnabled}
          onChange={setMtpEnabled}
        />
        <ToggleRow label={t("settings.enableSsh")} value={!!config.sshEnabled} onChange={setSshEnabled} />
        <ToggleRow
          label={t("settings.swipeGestures")}
          description={t("settings.swipeGesturesDescription")}
          value={config.swipeGesturesEnabled}
          disabled={swipeGesturesSaving}
          onChange={setSwipeGesturesEnabled}
        />
      </PanelSection>
    </>
  );
}
