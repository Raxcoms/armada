import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject, SetStateAction } from "react";

interface CachedValue {
  value: unknown;
  revision: number;
}

const cachedReads = new WeakMap<() => Promise<unknown>, CachedValue>();

export function useBackendState<T>(read: () => Promise<T>, interval = 0, paused = false, host?: RefObject<HTMLElement | null>, cached = false) {
  let cache = cached ? cachedReads.get(read) : undefined;
  if (cached && !cache) {
    cache = { value: null, revision: 0 };
    cachedReads.set(read, cache);
  }
  const cachedValue = (cache?.value ?? null) as T | null;
  const [state, updateState] = useState(() => ({ read, value: cachedValue }));
  const value = state.read === read ? state.value : cachedValue;
  const [failure, setFailure] = useState({ read, message: "" });
  const currentValue = useRef(value);
  currentValue.current = value;
  const ownedCache = useRef({ cache, revision: cache?.revision });
  const revision = useRef(0);
  const mounted = useRef(true);
  const pause = useRef(paused);
  pause.current = paused;
  const setValue = useCallback((next: SetStateAction<T | null>) => {
    if (!mounted.current && (!cache || ownedCache.current.cache !== cache || ownedCache.current.revision !== cache.revision)) return;
    revision.current += 1;
    const result = typeof next === "function" ? (next as (current: T | null) => T | null)(currentValue.current) : next;
    currentValue.current = result;
    if (cache) {
      cache.value = result;
      ownedCache.current = { cache, revision: ++cache.revision };
    }
    if (mounted.current) {
      updateState({ read, value: result });
      setFailure({ read, message: "" });
    }
  }, [read, cache]);
  const refresh = useCallback(async () => {
    if (pause.current) return;
    const request = ++revision.current;
    const cacheRevision = cache ? ++cache.revision : undefined;
    ownedCache.current = { cache, revision: cacheRevision };
    setFailure({ read, message: "" });
    try {
      const next = await read();
      if (mounted.current && !pause.current && request === revision.current && (!cache || cache.revision === cacheRevision)) {
        currentValue.current = next;
        if (cache) cache.value = next;
        updateState({ read, value: next });
      }
    } catch (error) {
      if (mounted.current && !pause.current && request === revision.current && (!cache || cache.revision === cacheRevision)) setFailure({ read, message: String(error) });
    }
  }, [read, cache]);
  useEffect(() => {
    mounted.current = true;
    const view = host?.current?.ownerDocument.defaultView || window;
    const document = view.document;
    const visibleRefresh = () => { if (!document.hidden) void refresh(); };
    void refresh();
    const timer = interval > 0 ? view.setInterval(visibleRefresh, interval) : undefined;
    view.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      mounted.current = false;
      revision.current += 1;
      view.clearInterval(timer);
      view.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh, interval, host]);
  return { value, setValue, error: failure.read === read ? failure.message : "", refresh };
}
