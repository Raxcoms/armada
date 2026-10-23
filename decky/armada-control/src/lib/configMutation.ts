import type { Dispatch, SetStateAction } from "react";
import type { Config } from "../types";

type ConfigSetter = Dispatch<SetStateAction<Config | null>>;

interface PendingValue<T> {
  confirmed: T;
  revision: number;
  tail: Promise<void>;
}

interface MutationOptions {
  optimistic?: boolean;
  read?: () => Promise<Config>;
}

export function createConfigMutation<K extends keyof Config>(
  field: K,
  apply: (value: Config[K]) => Promise<Config[K]>,
  { optimistic = true, read }: MutationOptions = {},
) {
  // The parent owns config, so pending changes must survive closing and reopening a tab.
  const owners = new WeakMap<ConfigSetter, PendingValue<Config[K]>>();
  return (config: Config, setConfig: ConfigSetter, value: Config[K], onError?: (error: unknown) => void) => {
    let state = owners.get(setConfig);
    if (!state) {
      state = { confirmed: config[field], revision: 0, tail: Promise.resolve() };
      owners.set(setConfig, state);
    }
    const current = state;
    const revision = ++current.revision;
    const show = (next: Config[K]) => setConfig((stored) => stored && revision === current.revision
      ? { ...stored, [field]: next } : stored);
    if (optimistic) show(value);
    const request = current.tail.then(async () => {
      try {
        current.confirmed = await apply(value);
      } catch (error) {
        if (read) {
          try {
            current.confirmed = (await read())[field];
          } catch {}
        }
        if (revision === current.revision) onError?.(error);
      } finally {
        show(current.confirmed);
      }
    });
    current.tail = request.catch(() => {});
    return request;
  };
}
