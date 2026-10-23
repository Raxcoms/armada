import type { CurvesState, FanCurve, FanSettings, PowerProfile } from "../types";

export function resolveFanCurve(curve: FanCurve, fallback: FanSettings): FanCurve {
  return {
    ...curve,
    ramp_up: curve.ramp_up ?? fallback.ramp_up,
    ramp_down: curve.ramp_down ?? fallback.ramp_down,
    smoothing: curve.smoothing ?? fallback.smoothing,
    min_pwm: curve.min_pwm ?? fallback.min_pwm,
  };
}

export function fanCurveChanges(working: CurvesState, saved: CurvesState) {
  const changed = Object.fromEntries(Object.entries(working.fanCurves).filter(([id, curve]) =>
    JSON.stringify(curve) !== JSON.stringify(saved.fanCurves[id]),
  ));
  const deleted = Object.keys(saved.fanCurves).filter((id) => !working.fanCurves[id]);
  return { changed, deleted };
}

export function updateGpuLimit(profile: PowerProfile, key: "gpu_min" | "gpu_max", value: string): PowerProfile {
  const next = { ...profile, [key]: value };
  if (key === "gpu_min" && Number(value) > Number(next.gpu_max)) next.gpu_max = value;
  if (key === "gpu_max" && Number(value) < Number(next.gpu_min)) next.gpu_min = value;
  return next;
}
