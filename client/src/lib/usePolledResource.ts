// client/src/lib/usePolledResource.ts -- REQ-0145b (cc): ONE hook for the
// "load a server resource on mount (+ optionally poll it), keep
// error/loading state, expose a manual reload" pattern that was
// hand-rolled per page (WarehousePage's POLL_MS interval, MarketPage/
// RagnarokPage's composite initial load, DexRoot's refreshToken effect).
//
// PARITY-FIRST DESIGN: every option below exists to reproduce some
// adopting page's CURRENT mount/interval/error behavior exactly (the
// REQ-0145b frozen contract is zero behavioral change) -- do not
// "simplify" a call site by dropping an option without re-checking that
// page's previous semantics:
//   - intervalMs         WarehousePage polls its rows every 5s; most
//                        pages load once.
//   - trackLoading       Market/Ragnarok gate their whole layout on a
//                        loading flag that starts true and clears the
//                        error at each load start; pages without a
//                        loading gate skip these state updates entirely.
//   - onError            'set-error' stores a message (data untouched);
//                        'null-data' nulls the data (DexRoot's /api/me:
//                        a failed role probe = "no admin", not an
//                        error); 'ignore' leaves both untouched
//                        (best-effort lookups whose UI simply degrades).
//   - clearErrorOnSuccess DexRoot's content error deliberately stays
//                        visible once shown (false); WarehousePage's
//                        poll clears it on the next good poll (true).
//   - initialData        lets a page whose empty state is [] / a Map
//                        keep that instead of null.
//
// Concurrency: a per-hook sequence number makes stale in-flight
// resolutions no-ops (the same job the pages' `cancelled` flags /
// aliveRef guards did), and an alive guard drops post-unmount
// resolutions. The interval fires load() unconditionally (no in-flight
// dedup) -- same as the setInterval(() => void reload(), POLL_MS)
// pattern it replaces.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export interface UsePolledResourceOptions<T> {
  /** Poll every N ms; null/omitted = load once on mount (+ manual reload). */
  intervalMs?: number | null;
  /** Maintain a loading flag: starts true, set true + error cleared at
   * each load start, false when the load settles. */
  trackLoading?: boolean;
  /** What a rejected fetch does. Default 'set-error'. */
  onError?: 'set-error' | 'null-data' | 'ignore';
  /** Clear the stored error when a load succeeds. Default true. */
  clearErrorOnSuccess?: boolean;
  /** Map a rejection to the stored error string. Default: Error.message
   * (String(e) for non-Errors) -- the message shape the pages used. */
  formatError?: (e: unknown) => string;
  /** Initial `data` value (lazy initializer supported). Default null. */
  initialData?: T | null | (() => T | null);
}

export interface PolledResource<T> {
  data: T | null;
  setData: Dispatch<SetStateAction<T | null>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  /** Meaningful only with trackLoading: true (false otherwise). */
  loading: boolean;
  /** Awaitable manual reload -- resolves once the load has settled
   * (never rejects; failures land in `error` per onError). */
  reload: () => Promise<void>;
}

export function usePolledResource<T>(
  fetcher: () => Promise<T>,
  options: UsePolledResourceOptions<T> = {}
): PolledResource<T> {
  const { intervalMs = null, trackLoading = false } = options;
  const [data, setData] = useState<T | null>(options.initialData ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(trackLoading);

  // Latest-value refs so load() can have a stable identity (empty
  // useCallback deps) without going stale -- callers pass inline
  // closures over per-render values (locale, other loaders).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Alive guard (drop post-unmount resolutions) -- reset on every mount
  // so StrictMode's dev-only double-mount behaves like the pages'
  // per-effect `cancelled` flags did.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Monotonic load sequence: only the LATEST load applies its result,
  // reproducing the "cancel the previous effect's in-flight fetch"
  // semantics of the replaced per-page effects.
  const seqRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const o = optionsRef.current;
    const seq = ++seqRef.current;
    if (o.trackLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await fetcherRef.current();
      if (!aliveRef.current || seq !== seqRef.current) return;
      setData(result);
      if (o.clearErrorOnSuccess ?? true) setError(null);
    } catch (e) {
      if (!aliveRef.current || seq !== seqRef.current) return;
      const mode = o.onError ?? 'set-error';
      if (mode === 'set-error') {
        setError(o.formatError ? o.formatError(e) : e instanceof Error ? e.message : String(e));
      } else if (mode === 'null-data') {
        setData(null);
      }
      // 'ignore': leave data AND error untouched -- the UI degrades the
      // same way the replaced best-effort catch blocks did.
    } finally {
      if (o.trackLoading && aliveRef.current && seq === seqRef.current) setLoading(false);
    }
  }, []);

  // Initial load on mount (StrictMode dev double-mount = two loads, same
  // as the replaced effects).
  useEffect(() => {
    void load();
  }, [load]);

  // Optional poll interval -- unconditional fire, exactly like the
  // setInterval pattern it replaces.
  useEffect(() => {
    if (intervalMs == null) return;
    const id = setInterval(() => {
      void load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, load]);

  return { data, setData, error, setError, loading, reload: load };
}
