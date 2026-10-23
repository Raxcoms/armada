import { DialogBody, DialogButton, DialogControlsSection, DialogControlsSectionHeader, Dropdown, Field, SliderField } from "@decky/ui";
import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { savePowerConfig } from "../backend";
import { ArmadaDialogFooter, ArmadaDialogHeader, ArmadaModalRoot } from "../components/ArmadaModalRoot";
import { t, translateLabel } from "../i18n";
import { updateGpuLimit } from "../lib/profileDraft";
import { clone, titleCase } from "../lib/util";
import type { Config, PowerProfile } from "../types";

export function PowerProfileEditorModal({ profileId, getLatestConfig, setConfig, onSaved, closeModal }: {
  profileId: string;
  getLatestConfig: () => Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
  onSaved: (next: Config) => void;
  closeModal?: () => void;
}) {
  const [initial] = useState(() => clone(getLatestConfig()));
  const [profile, setProfile] = useState(() => clone(initial.power.profiles[profileId]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(initial.power.profiles[profileId]);
  const fanCurves = Object.entries(initial.power.fan_curves).map(([data, curve]) => ({ data, label: translateLabel(curve.label || titleCase(data)) }));
  const supportsUnderclock = !!initial.power.underclocks?.[initial.cpuDeviceClass];
  const setValue = (key: keyof PowerProfile, value: string) => {
    if (!busy.current) setProfile((current) => ({ ...current, [key]: value }));
  };
  const setGpu = (key: "gpu_min" | "gpu_max", value: number) => {
    if (!busy.current) setProfile((current) => updateGpuLimit(current, key, (value / 100).toFixed(2)));
  };
  const cancel = () => { if (!busy.current) closeModal?.(); };
  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const latest = getLatestConfig();
      const next = await savePowerConfig({ ...latest.power, profiles: { ...latest.power.profiles, [profileId]: clone(profile) } });
      setConfig((current) => current ? {
        ...current,
        power: { ...current.power, profiles: { ...current.power.profiles, [profileId]: next.power.profiles[profileId] } },
      } : current);
      onSaved(next);
      closeModal?.();
    } catch (error) {
      setError(String(error));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return <ArmadaModalRoot bAllowFullSize bDisableBackgroundDismiss={saving} bCancelDisabled={saving} onCancel={cancel}>
    <ArmadaDialogHeader>{t("profiles.editPerformance", { profile: translateLabel(profile.label || titleCase(profileId)) })}</ArmadaDialogHeader>
    <DialogBody className="afc-scope">
      {error ? <div className="afc-error" role="alert">{error}</div> : null}
      <DialogControlsSection>
        <DialogControlsSectionHeader>{t("profiles.cpuSettings")}</DialogControlsSectionHeader>
        {initial.perf?.governors?.length ? <Field label={t("power.cpuGovernor")} bottomSeparator="standard" childrenLayout="below">
          <Dropdown selectedOption={profile.cpu_governor} rgOptions={initial.perf.governors.map((data) => ({ data, label: translateLabel(titleCase(data)) }))} disabled={saving} onChange={(option) => setValue("cpu_governor", String(option.data))} />
        </Field> : null}
        {supportsUnderclock ? <Field label={t("power.cpuUnderclock")} bottomSeparator="standard" childrenLayout="below">
          <Dropdown selectedOption={profile.cpu_underclock || ""} rgOptions={["none", "small", "medium", "large"].map((data) => ({ data, label: translateLabel(titleCase(data)) }))} disabled={saving} onChange={(option) => setValue("cpu_underclock", String(option.data))} />
        </Field> : <SliderField label={t("power.cpuMax")} value={Math.round(Number(profile.cpu_max || 0) * 100)} min={35} max={100} step={1} showValue disabled={saving} onChange={(value) => setValue("cpu_max", (value / 100).toFixed(2))} />}
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>{t("profiles.gpuSettings")}</DialogControlsSectionHeader>
        <SliderField label={t("power.gpuMin")} value={Math.round(Number(profile.gpu_min || 0) * 100)} min={0} max={100} step={1} showValue disabled={saving} onChange={(value) => setGpu("gpu_min", value)} />
        <SliderField label={t("power.gpuMax")} value={Math.round(Number(profile.gpu_max || 0) * 100)} min={35} max={100} step={1} showValue disabled={saving} onChange={(value) => setGpu("gpu_max", value)} />
      </DialogControlsSection>
      <DialogControlsSection>
        <DialogControlsSectionHeader>{t("profiles.otherSettings")}</DialogControlsSectionHeader>
        <Field label={t("power.fanCurve")} bottomSeparator="standard" childrenLayout="below">
          <Dropdown selectedOption={profile.fan_curve} rgOptions={fanCurves} disabled={saving} onChange={(option) => setValue("fan_curve", String(option.data))} />
        </Field>
        <DialogButton disabled={saving || !initial.powerDefaults?.profiles[profileId]} onClick={() => setProfile(clone(initial.powerDefaults.profiles[profileId]))}>{t("common.resetToDefault")}</DialogButton>
      </DialogControlsSection>
    </DialogBody>
    <ArmadaDialogFooter>
      <DialogButton disabled={saving || !dirty} onClick={() => { void save(); }}>{saving ? t("common.saving") : t("common.saveChanges")}</DialogButton>
      <DialogButton disabled={saving} onClick={cancel}>{t("common.cancel")}</DialogButton>
    </ArmadaDialogFooter>
  </ArmadaModalRoot>;
}
