import { DialogButton, DialogControlsSection, DialogControlsSectionHeader, Field, SliderField, TextField, ToggleField } from "@decky/ui";
import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { AnimatedCollapse } from "./AnimatedCollapse";
import { FanCurveGraph } from "./FanCurveGraph";
import { SupportingText } from "./widgets";
import { useSelectedFanCurve } from "../hooks/useSelectedFanCurve";
import { t, translateLabel } from "../i18n";
import { buildFanStopPoints, CURVE_PWM_MAX, CURVE_PWM_MIN, CURVE_TEMP_MAX, CURVE_TEMP_MIN, percentToPwm, pwmToPercent, restoreFanStopPoints } from "../lib/fanCurve";
import type { CurvePoint } from "../lib/fanCurve";
import { clamp, update } from "../lib/util";
import type { CurvesState, FanSettings } from "../types";

const DEFAULT_FAN_STOP_TEMP = 60;

export function FanCurveEditor({ state, setState, selected, currentTemp, disabled = false }: {
  state: CurvesState;
  setState: Dispatch<SetStateAction<CurvesState | null>>;
  selected: string;
  currentTemp?: number | null;
  disabled?: boolean;
}) {
  const { curveName, curve, points, factoryCurve, commitPoints, setPoint, removePoint, addPoint, belowMinPoint, fixMinPwm } =
    useSelectedFanCurve(state, setState, selected);
  const [showPoints, setShowPoints] = useState(false);
  const beforeFanStop = useRef<CurvePoint[] | null>(null);
  if (!curve) return <Field label={t("fanCurve.noneFound")} bottomSeparator="none" />;

  const usedBy = Object.values(state.profiles || {}).filter((profile) => profile.fan_curve === curveName);
  const fanStopEnabled = points[0]?.pwm === 0;
  const lastStoppedPoint = points.findIndex((point) => point.pwm !== 0);
  const stopUntil = fanStopEnabled ? points[(lastStoppedPoint === -1 ? points.length : lastStoppedPoint) - 1].temp : DEFAULT_FAN_STOP_TEMP;
  const setSetting = (key: keyof FanSettings, value: number) => {
    setState((current) => current ? update(current, ["fanCurves", curveName, key], value) : current);
  };
  const toggleFanStop = (enabled: boolean) => {
    if (enabled) {
      beforeFanStop.current = points;
      commitPoints(buildFanStopPoints(DEFAULT_FAN_STOP_TEMP, points));
    } else {
      commitPoints(beforeFanStop.current || restoreFanStopPoints(points));
      beforeFanStop.current = null;
    }
  };
  return <>
    <DialogControlsSection>
      {!factoryCurve ? <TextField
        label={t("fanCurve.name")}
        value={curve.label}
        disabled={disabled}
        onChange={(event) => setState((current) => current ? update(current, ["fanCurves", curveName, "label"], event.target.value.slice(0, 80)) : current)}
      /> : null}
      <SupportingText>
        {usedBy.length
          ? t("fanCurve.usedBy", { profiles: usedBy.map((profile) => translateLabel(profile.label)).join(", ") })
          : t("fanCurve.unassigned")}
      </SupportingText>
      <DialogControlsSectionHeader>{t("power.fanCurve")}</DialogControlsSectionHeader>
      <FanCurveGraph points={points} onChange={commitPoints} currentTemp={currentTemp} />
      <SupportingText>{t("fanCurve.advancedEditInstructions", { min: CURVE_PWM_MIN, max: CURVE_PWM_MAX })}</SupportingText>
      {belowMinPoint ? <DialogButton disabled={disabled} onClick={fixMinPwm}>{t("fanCurve.belowMinimumWarning")}</DialogButton> : null}
      <ToggleField label={t("fanCurve.stop")} description={t("fanCurve.stopDescription")} checked={fanStopEnabled} onChange={toggleFanStop} disabled={disabled} />
      {fanStopEnabled ? <>
        <PointNumber
          label={t("fanCurve.stopUntil")}
          value={stopUntil}
          min={CURVE_TEMP_MIN}
          max={CURVE_TEMP_MAX - 1}
          disabled={disabled}
          onChange={(temp) => commitPoints(buildFanStopPoints(temp, beforeFanStop.current || restoreFanStopPoints(points)))}
        />
        <SupportingText>{t("fanCurve.stopMinimumDescription")}</SupportingText>
      </> : null}
      <DialogButton disabled={disabled} onClick={() => setShowPoints((current) => !current)}>
        {showPoints ? t("fanCurve.hidePoints") : t("fanCurve.editPoints")}
      </DialogButton>
      <AnimatedCollapse isOpen={showPoints}>
        <div className="afc-points-drawer">
          {points.map((point, index) => <div className="afc-point-row" key={index}>
            <PointNumber label={`P${index + 1}: ${t("fanCurve.temperature")}`} value={point.temp} min={CURVE_TEMP_MIN} max={CURVE_TEMP_MAX} disabled={disabled} onChange={(value) => setPoint(index, "temp", value)} />
            <PointNumber label={`PWM (${CURVE_PWM_MIN}-${CURVE_PWM_MAX})`} value={point.pwm} min={CURVE_PWM_MIN} max={CURVE_PWM_MAX} disabled={disabled} onChange={(value) => setPoint(index, "pwm", value)} />
            <DialogButton disabled={disabled || points.length < 2} onClick={() => removePoint(index)}>{t("common.delete")}</DialogButton>
          </div>)}
          <DialogButton disabled={disabled} onClick={addPoint}>{t("fanCurve.addPoint")}</DialogButton>
        </div>
      </AnimatedCollapse>
    </DialogControlsSection>
    <DialogControlsSection>
      <DialogControlsSectionHeader>{t("fanCurve.responsiveness")}</DialogControlsSectionHeader>
      <SliderField label={t("fanCurve.rampUp")} description={t("fanCurve.rampUpDescription")} value={curve.ramp_up} min={1} max={255} step={1} showValue disabled={disabled} onChange={(value) => setSetting("ramp_up", value)} />
      <SliderField label={t("fanCurve.rampDown")} description={t("fanCurve.rampDownDescription")} value={curve.ramp_down} min={1} max={255} step={1} showValue disabled={disabled} onChange={(value) => setSetting("ramp_down", value)} />
      <SliderField label={t("fanCurve.temperatureSmoothing")} description={t("fanCurve.temperatureSmoothingDescription")} value={Math.round(curve.smoothing * 100)} min={0} max={99} step={1} showValue disabled={disabled} onChange={(value) => setSetting("smoothing", value / 100)} />
      <SliderField label={t("fanCurve.minimumSpeed")} description={t("fanCurve.minimumSpeedDescription")} value={fanStopEnabled ? 0 : pwmToPercent(curve.min_pwm)} min={0} max={100} step={1} showValue disabled={disabled || fanStopEnabled} onChange={(value) => setSetting("min_pwm", percentToPwm(value))} />
    </DialogControlsSection>
  </>;
}

function PointNumber({ label, value, min, max, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <TextField
    label={label}
    value={draft ?? String(value)}
    disabled={disabled}
    mustBeNumeric
    rangeMin={min}
    rangeMax={max}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => {
      if (draft === null) return;
      const next = Number(draft);
      if (draft.trim() && Number.isFinite(next)) onChange(clamp(Math.round(next), min, max));
      setDraft(null);
    }}
  />;
}
