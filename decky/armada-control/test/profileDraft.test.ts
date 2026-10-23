import assert from "node:assert/strict";
import test from "node:test";
import { buildFanStopPoints, formatCurve, parseCurve, restoreFanStopPoints, slugifyCurveName } from "../src/lib/fanCurve.ts";
import { fanCurveChanges, resolveFanCurve, updateGpuLimit } from "../src/lib/profileDraft.ts";
import type { CurvesState, FanCurve, PowerProfile } from "../src/types.ts";

const settings = { ramp_up: 5, ramp_down: 4, smoothing: 0.5, min_pwm: 40 };
const curve = { ...settings, label: "Moderate", curve: "40:50,70:100,90:255" };
const state: CurvesState = {
  fanCurves: { moderate: curve },
  factoryFanCurves: { moderate: curve },
  fanSettings: settings,
  factoryFanSettings: settings,
  profiles: { balanced: { label: "Balanced", fan_curve: "moderate" } },
  activeProfile: "balanced",
  currentTemp: null,
};

test("custom IDs stay valid for names starting with numbers or underscores", () => {
  assert.equal(slugifyCurveName("123 Quiet"), "curve_123_quiet");
  assert.equal(slugifyCurveName("_Quiet_"), "quiet");
  assert.equal(slugifyCurveName(""), "");
  assert.match(slugifyCurveName("123 " + "long name ".repeat(8)), /^[a-z][a-z0-9_]{0,31}$/);
});

test("resolves inherited fan settings without replacing explicit zero values", () => {
  const legacy = { label: "Legacy", curve: curve.curve, smoothing: 0, min_pwm: 0 } as FanCurve;
  assert.deepEqual(resolveFanCurve(legacy, settings), { ...settings, ...legacy });
  assert.equal(legacy.ramp_up, undefined);
});

test("a new profile copies the resolved settings without changing its base", () => {
  const copy = { ...resolveFanCurve(curve, settings), label: "Custom" };
  copy.min_pwm = 80;
  copy.ramp_up = 8;
  assert.equal(curve.min_pwm, 40);
  assert.equal(curve.ramp_up, 5);
  assert.equal(copy.curve, curve.curve);
  assert.equal(copy.ramp_down, curve.ramp_down);
  assert.equal(copy.smoothing, curve.smoothing);
});

test("fan saves contain only changed curves and explicit deletions", () => {
  const custom = { ...curve, label: "Renamed", ramp_up: 7 };
  const saved = { ...state, fanCurves: { moderate: curve, unused: curve } };
  const working = { ...state, fanCurves: { moderate: curve, custom } };
  assert.deepEqual(fanCurveChanges(working, saved), { changed: { custom }, deleted: ["unused"] });
  assert.deepEqual(fanCurveChanges(state, structuredClone(state)), { changed: {}, deleted: [] });
});

test("Fan Stop keeps the configured minimum and other curves intact after reopening", () => {
  const stopped = { ...curve, curve: formatCurve(buildFanStopPoints(60, parseCurve(curve.curve))) };
  const reopened = structuredClone(stopped);
  assert.equal(reopened.min_pwm, 40);
  assert.equal(parseCurve(reopened.curve)[0].pwm, 0);
  assert.equal(curve.curve, "40:50,70:100,90:255");
  const restored = restoreFanStopPoints(parseCurve(reopened.curve));
  assert.ok(restored.every((point) => point.pwm > 0));
  assert.equal(reopened.min_pwm, curve.min_pwm);
});

test("Fan Stop boundaries retain a nonzero point at the upper temperature limit", () => {
  const points = buildFanStopPoints(120, [{ temp: 120, pwm: 255 }]);
  assert.deepEqual(points, [{ temp: 119, pwm: 0 }, { temp: 120, pwm: 255 }]);
  assert.equal(new Set(points.map((point) => point.temp)).size, points.length);
});

test("GPU edits keep both limits in range without changing the saved profile", () => {
  const profile = { gpu_min: "0.20", gpu_max: "0.60" } as PowerProfile;
  assert.deepEqual(updateGpuLimit(profile, "gpu_min", "0.80"), { gpu_min: "0.80", gpu_max: "0.80" });
  assert.deepEqual(updateGpuLimit(profile, "gpu_max", "0.10"), { gpu_min: "0.10", gpu_max: "0.10" });
  assert.deepEqual(profile, { gpu_min: "0.20", gpu_max: "0.60" });
});
