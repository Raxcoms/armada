import { useRef, useState } from "react";
import { fanCurveChanges } from "../lib/profileDraft";
import { clone } from "../lib/util";
import type { CurvesState, FanCurve } from "../types";

interface UseFanCurvesSaveOptions {
  working: CurvesState | null;
  saved: CurvesState | null;
  setSaved: (next: CurvesState) => void;
  setWorking: (next: CurvesState) => void;
  save: (fanCurves: Record<string, FanCurve>, deleted: string[]) => Promise<CurvesState>;
  onSaved?: (next: CurvesState) => void;
}

export function useFanCurvesSave({ working, saved, setSaved, setWorking, save, onSaved }: UseFanCurvesSaveOptions) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);

  const changes = saved && working ? fanCurveChanges(working, saved) : null;
  const dirty = !!changes && (Object.keys(changes.changed).length > 0 || changes.deleted.length > 0);

  const persist = async (fanCurves: Record<string, FanCurve>, deleted: string[]) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = await save(fanCurves, deleted);
      setSaveError("");
      setWorking(clone(next));
      setSaved(next);
      onSaved?.(next);
      return true;
    } catch (error) {
      setSaveError(String(error));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSave = () => working && changes ? persist(changes.changed, changes.deleted) : Promise.resolve(false);
  const handleDelete = (ids: string[]) => persist({}, ids);

  const handleRevert = () => {
    if (!saved) return;
    setSaveError("");
    setWorking(clone(saved));
  };

  return { dirty, saving, saveError, handleSave, handleDelete, handleRevert };
}
