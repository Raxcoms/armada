import { DialogBody, DialogButton, DialogButtonPrimary, showModal } from "@decky/ui";
import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { saveFanCurves } from "../backend";
import { useCurrentTemp } from "../hooks/useCurrentTemp";
import { useFanCurvesSave } from "../hooks/useFanCurvesSave";
import { t, translateLabel } from "../i18n";
import { parseCurve } from "../lib/fanCurve";
import { resolveFanCurve } from "../lib/profileDraft";
import { clone, titleCase } from "../lib/util";
import type { CurvesState, FanCurve } from "../types";
import { ArmadaConfirmModal, ArmadaDialogFooter, ArmadaDialogHeader, ArmadaModalRoot } from "./ArmadaModalRoot";
import { FanCurveEditor } from "./FanCurveEditor";
import { SupportingText } from "./widgets";

export function FanCurveEditorModal({ initial, curveId, createdCurve, onSaved, closeModal }: {
  initial: CurvesState;
  curveId: string;
  createdCurve?: FanCurve;
  onSaved: (next: CurvesState) => void;
  closeModal?: () => void;
}) {
  const [state, setState] = useState(() => {
    const next = clone(initial);
    if (createdCurve) next.fanCurves[curveId] = clone(createdCurve);
    return next;
  });
  const [saved, setSaved] = useState(() => clone(initial));
  const [resetVersion, setResetVersion] = useState(0);
  const busy = useRef(false);
  const { dirty, saving, saveError, handleSave, handleDelete } = useFanCurvesSave({
    working: state,
    saved,
    setSaved,
    setWorking: setState,
    save: (changes, deleted) => saveFanCurves(Object.fromEntries(Object.entries(changes).map(([id, curve]) => [id, { ...curve, label: curve.label.trim() }])), deleted),
    onSaved,
  });
  const currentTemp = useCurrentTemp();
  const curve = state.fanCurves[curveId];
  const label = translateLabel(curve?.label || titleCase(curveId));
  const custom = !initial.factoryFanCurves[curveId];
  const assigned = Object.values(state.profiles).some((profile) => profile.fan_curve === curveId);
  const valid = !!curve?.label.trim() && parseCurve(curve?.curve).length > 0;
  const edit: Dispatch<SetStateAction<CurvesState | null>> = (value) => {
    if (busy.current) return;
    setState((current) => (typeof value === "function" ? value(current) : value) || current);
  };
  const cancel = () => { if (!busy.current) closeModal?.(); };
  const persist = async (remove = false) => {
    if (busy.current || (!remove && !valid)) return;
    busy.current = true;
    try {
      const success = await (remove ? handleDelete([curveId]) : handleSave());
      if (success) closeModal?.();
    } finally {
      busy.current = false;
    }
  };
  const confirmDelete = () => showModal(<ArmadaConfirmModal
    title={t("fanCurve.delete")}
    description={t("profiles.deleteDescription", { profile: label })}
    confirmText={t("common.delete")}
    cancelText={t("common.cancel")}
    onConfirm={() => { void persist(true); }}
  />);

  return <ArmadaModalRoot bAllowFullSize bDisableBackgroundDismiss={saving} bCancelDisabled={saving} onCancel={cancel}>
    <ArmadaDialogHeader>{t("profiles.editFan", { profile: label })}</ArmadaDialogHeader>
    <DialogBody className="afc-scope">
      {saveError ? <div className="afc-error" role="alert">{saveError}</div> : null}
      {!curve?.label.trim() ? <SupportingText>{t("profiles.nameRequired")}</SupportingText> : null}
      <FanCurveEditor key={resetVersion} state={state} setState={edit} selected={curveId} currentTemp={currentTemp} disabled={saving} />
      {custom && assigned ? <SupportingText>{t("profiles.assignedDelete")}</SupportingText> : null}
    </DialogBody>
    <ArmadaDialogFooter>
      <DialogButtonPrimary onClick={() => { void persist(); }} disabled={!dirty || !valid || saving}>
        {saving ? t("common.saving") : t("common.saveChanges")}
      </DialogButtonPrimary>
      <DialogButton onClick={cancel} disabled={saving}>{t("common.cancel")}</DialogButton>
      {!custom ? <DialogButton disabled={saving} onClick={() => {
        const defaults = resolveFanCurve(initial.factoryFanCurves[curveId], initial.factoryFanSettings);
        setState((current) => ({ ...current, fanCurves: { ...current.fanCurves, [curveId]: defaults } }));
        setResetVersion((current) => current + 1);
      }}>{t("fanCurve.resetFactory")}</DialogButton> : !createdCurve ? <DialogButton disabled={saving || assigned} onClick={confirmDelete}>{t("fanCurve.delete")}</DialogButton> : null}
    </ArmadaDialogFooter>
  </ArmadaModalRoot>;
}
