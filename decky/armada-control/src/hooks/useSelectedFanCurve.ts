import type { Dispatch, SetStateAction } from "react";
import { CURVE_PWM_MAX, CURVE_PWM_MIN, CURVE_TEMP_MAX, DEFAULT_POINT, formatCurve, parseCurve } from "../lib/fanCurve";
import type { CurvePoint } from "../lib/fanCurve";
import { resolveFanCurve } from "../lib/profileDraft";
import { clamp, clone, update } from "../lib/util";
import type { CurvesState, FanCurve } from "../types";

export interface SelectedFanCurve {
  names: string[];
  curveName: string;
  curve: FanCurve | undefined;
  points: CurvePoint[];
  factoryCurve: FanCurve | undefined;
  commitPoints: (next: CurvePoint[]) => void;
  resetCurve: () => void;
  setPoint: (index: number, key: "temp" | "pwm", value: number) => void;
  removePoint: (index: number) => void;
  addPoint: () => void;
  belowMinPoint: boolean;
  fixMinPwm: () => void;
}

export function useSelectedFanCurve(
  state: CurvesState,
  setState: Dispatch<SetStateAction<CurvesState | null>>,
  selected: string,
): SelectedFanCurve {
  const names = Object.keys(state.fanCurves || {}).sort();
  const curveName = names.includes(selected) ? selected : "";
  const curve = curveName ? resolveFanCurve(state.fanCurves[curveName], state.fanSettings) : undefined;
  const points = curve ? parseCurve(curve.curve) : [];
  const factory = curveName ? state.factoryFanCurves?.[curveName] : undefined;
  const factoryCurve = factory ? resolveFanCurve(factory, state.factoryFanSettings) : undefined;

  const commitPoints = (nextPoints: CurvePoint[]) => {
    if (!curveName) return;
    setState((current) =>
      current ? update(current, ["fanCurves", curveName, "curve"], formatCurve(nextPoints)) : current,
    );
  };

  const resetCurve = () => {
    if (!curveName || !factoryCurve) return;
    setState((current) => (current ? update(current, ["fanCurves", curveName], clone(factoryCurve)) : current));
  };

  const setPoint = (index: number, key: "temp" | "pwm", value: number) => {
    commitPoints(points.map((point, i) => (i === index ? { ...point, [key]: value } : point)));
  };

  const removePoint = (index: number) => {
    commitPoints(points.filter((_, i) => i !== index));
  };

  const addPoint = () => {
    const usedTemps = new Set(points.map((point) => point.temp));
    let temp = DEFAULT_POINT.temp;
    while (usedTemps.has(temp) && temp < CURVE_TEMP_MAX) temp += 1;
    if (usedTemps.has(temp)) return;
    commitPoints([...points, { ...DEFAULT_POINT, temp }]);
  };

  const fanStopEnabled = points[0]?.pwm === 0;
  const belowMinPoint = !fanStopEnabled && points.some((point) => point.pwm < (curve?.min_pwm ?? 0));

  const fixMinPwm = () => {
    if (!points.length) return;
    const lowestPwm = clamp(Math.min(...points.map((point) => point.pwm)), CURVE_PWM_MIN, CURVE_PWM_MAX);
    setState((current) => (current ? update(current, ["fanCurves", curveName, "min_pwm"], lowestPwm) : current));
  };

  return {
    names,
    curveName,
    curve,
    points,
    factoryCurve,
    commitPoints,
    resetCurve,
    setPoint,
    removePoint,
    addPoint,
    belowMinPoint,
    fixMinPwm,
  };
}
