import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from './api';

export interface Resource<T> { data: T | null; loading: boolean; error: string | null; reload: () => void; setData: React.Dispatch<React.SetStateAction<T | null>> }
export function useResource<T>(path: string | null, pollMs = 0): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const generation = useRef(0);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setData(null);
    setError(null);
    setLoading(Boolean(path));
    if (!path) return () => controller.abort();
    let inFlight = false;
    const fetchData = async (initial: boolean) => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (current === generation.current) { setData(value); setError(null); }
      } catch (problem) {
        if (!controller.signal.aborted && current === generation.current) setError(describeError(problem));
      } finally { inFlight = false; if (!controller.signal.aborted && initial && current === generation.current) setLoading(false); }
    };
    void fetchData(true);
    const timer = pollMs ? window.setInterval(() => { if (document.visibilityState === 'visible') void fetchData(false); }, pollMs) : null;
    return () => { controller.abort(); if (timer !== null) clearInterval(timer); };
  }, [path, pollMs, version]);
  return { data, loading, error, reload, setData };
}
