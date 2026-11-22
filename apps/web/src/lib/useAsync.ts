import { useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data?: T;
  error?: Error;
  loading: boolean;
}

/** Loads `fn(key)` whenever `key` changes; stale responses are ignored. */
export function useAsync<T>(key: string, fn: (key: string) => Promise<T>): AsyncState<T> {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [state, setState] = useState<AsyncState<T>>({ loading: true });

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    fnRef
      .current(key)
      .then((data) => live && setState({ data, loading: false }))
      .catch((error: unknown) => {
        if (live)
          setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false });
      });
    return () => {
      live = false;
    };
  }, [key]);

  return state;
}
