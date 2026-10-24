import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type { Config } from "../types";

export type SaveNow<T> = (update: (current: T) => T) => Promise<Config>;

type SavedField = "power" | "tweaks";

interface DebouncedSaveOptions<K extends SavedField> {
  config: Config | null;
  field: K;
  snapshot: MutableRefObject<string>;
  save: (value: Config[K]) => Promise<Config>;
  setConfig: Dispatch<SetStateAction<Config | null>>;
  onError?: (error: unknown) => void | Promise<void>;
  delay?: number;
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// Apply saved changes only where a newer local edit has not replaced the baseline.
function reconcile<T>(before: T, saved: T, current: T): T {
  if (equal(before, saved)) return current;
  if (equal(before, current)) return saved;
  if (!isRecord(saved) || !isRecord(current) || (!isRecord(before) && before !== undefined)) return current;
  const baseline: Record<string, unknown> = isRecord(before) ? before : {};
  const next: Record<string, unknown> = { ...current };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(saved)])) {
    const hadBefore = Object.prototype.hasOwnProperty.call(baseline, key);
    const hasSaved = Object.prototype.hasOwnProperty.call(saved, key);
    const hasCurrent = Object.prototype.hasOwnProperty.call(current, key);
    if (!hasSaved) {
      if (hadBefore && hasCurrent && equal(baseline[key], current[key])) delete next[key];
    } else if (!hasCurrent) {
      if (!hadBefore) next[key] = saved[key];
    } else {
      next[key] = reconcile(baseline[key], saved[key], current[key]);
    }
  }
  return next as T;
}

export function useDebouncedSave<K extends SavedField>(options: DebouncedSaveOptions<K>): SaveNow<Config[K]> {
  const latest = useRef(options);
  latest.current = options;
  const currentConfig = useRef(options.config);
  currentConfig.current = options.config;
  const timer = useRef<number | undefined>(undefined);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const manualPending = useRef(0);
  const failed = useRef<string | null>(null);
  const mounted = useRef(true);
  const clearTimer = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const schedule = () => {
    clearTimer();
    const config = currentConfig.current;
    const { field, snapshot, delay = 900 } = latest.current;
    if (!mounted.current || manualPending.current || !config || !snapshot.current) return;
    const value = JSON.stringify(config[field]);
    if (value === snapshot.current || value === failed.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      const request = tail.current.then(() => persist()).catch(async (error) => {
        if (!manualPending.current) await latest.current.onError?.(error);
      });
      tail.current = request.catch(() => {});
      void tail.current.finally(schedule);
    }, delay);
  };
  const persist = async (update?: (current: Config[K]) => Config[K]): Promise<Config> => {
    const config = currentConfig.current;
    if (!config) throw new Error("Configuration is unavailable");
    const { field, snapshot, save, setConfig } = latest.current;
    if (!update && manualPending.current) return config;
    const baseline = config[field];
    const submitted = update ? update(JSON.parse(JSON.stringify(baseline))) : baseline;
    const serialized = JSON.stringify(submitted);
    if (!update && serialized === snapshot.current) return config;
    let saved: Config;
    try {
      saved = await save(submitted);
    } catch (error) {
      if (!update) failed.current = serialized;
      throw error;
    }
    snapshot.current = JSON.stringify(saved[field]);
    failed.current = null;
    const apply = (stored: Config | null) => {
      if (!stored) return stored;
      const value = reconcile(baseline, saved[field], stored[field]);
      const next = value === stored[field] ? stored : { ...stored, [field]: value };
      currentConfig.current = next;
      return next;
    };
    const next = apply(currentConfig.current) || saved;
    if (mounted.current) setConfig(apply);
    return next;
  };
  const saveNow = useCallback<SaveNow<Config[K]>>((update) => {
    clearTimer();
    manualPending.current++;
    const request = tail.current.then(() => persist(update));
    tail.current = request.catch(() => {});
    return request.finally(() => {
      manualPending.current--;
      failed.current = null;
      schedule();
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimer(); };
  }, []);
  const value = options.config?.[options.field];
  useEffect(() => {
    schedule();
    return clearTimer;
  }, [value]);
  return saveNow;
}
