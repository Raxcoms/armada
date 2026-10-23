import { Field, PanelSection, gamepadDialogClasses, showModal } from "@decky/ui";
import { useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getFansState } from "../backend";
import { CreateCurveModal } from "../components/CreateCurveModal";
import { FanCurveEditorModal } from "../components/FanCurveEditorModal";
import { ButtonRow, SectionDescription } from "../components/widgets";
import { useBackendState } from "../hooks/useBackendState";
import { t, translateLabel } from "../i18n";
import { titleCase } from "../lib/util";
import type { Config, CurvesState, FanCurve } from "../types";
import { PowerProfileEditorModal } from "./Power";

export function Profiles({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const view = useRef<HTMLDivElement>(null);
  const { value: curves, setValue: setCurves, error, refresh } = useBackendState(getFansState, 10000, false, view);
  const latestConfig = useRef(config);
  latestConfig.current = config;

  const fanSaved = (next: CurvesState) => {
    setCurves(next);
    setConfig((current) => current ? { ...current, power: { ...current.power, fan_curves: next.fanCurves } } : current);
  };
  const editFan = (id: string, createdCurve?: FanCurve) => {
    if (!curves) return;
    showModal(<FanCurveEditorModal initial={curves} curveId={id} createdCurve={createdCurve} onSaved={fanSaved} />);
  };
  const createFan = () => {
    if (!curves) return;
    showModal(<CreateCurveModal
      initial={curves}
      initialBaseCurve={curves.profiles[curves.activeProfile]?.fan_curve || ""}
      onCreated={editFan}
    />);
  };
  const editPower = (profileId: string) => showModal(<PowerProfileEditorModal
    profileId={profileId}
    getLatestConfig={() => latestConfig.current}
    setConfig={setConfig}
    onSaved={(next) => setCurves((current) => current ? {
      ...current,
      profiles: { ...current.profiles, [profileId]: next.power.profiles[profileId] },
    } : current)}
  />);

  // Native fields register navigation nodes even when they cannot be focused.
  if (!curves && !error) return <div ref={view}>
    <PanelSection title={t("profiles.fans")}>
      <div className={gamepadDialogClasses.FieldDescription} role="status">{t("common.loading")}</div>
    </PanelSection>
  </div>;

  return <div ref={view}>
    <PanelSection title={t("profiles.fans")}>
      <SectionDescription>{t("profiles.fansDescription")}</SectionDescription>
      {error ? <>
        <Field label={t("profiles.loadingError")} description={error} bottomSeparator="none" />
        <ButtonRow layout="below" onClick={() => { void refresh(); }}>{t("common.retry")}</ButtonRow>
      </> : !curves ? null : <>
        {Object.entries(curves.fanCurves).map(([id, curve]) => <ButtonRow key={id} layout="below" onClick={() => editFan(id)}>
          {translateLabel(curve.label || titleCase(id))}
        </ButtonRow>)}
        <ButtonRow layout="below" disabled={!Object.keys(curves.fanCurves).length} onClick={createFan}>{t("fanCurve.create")}</ButtonRow>
      </>}
    </PanelSection>
    <PanelSection title={t("profiles.performance")}>
      <SectionDescription>{t("profiles.performanceDescription")}</SectionDescription>
      {Object.entries(config.power.profiles).map(([id, profile]) => <ButtonRow key={id} layout="below" onClick={() => editPower(id)}>
        {translateLabel(profile.label || titleCase(id))}
      </ButtonRow>)}
    </PanelSection>
  </div>;
}
