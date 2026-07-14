// client/src/lib/contentCache.ts -- REQ-0145b (cc): a module-level
// memo of the /api/content payload PROMISE, killing the redundant
// re-fetch every content-consuming page performed on mount (DexRoot,
// WarehousePage -- schedule/Monitor.tsx keeps its direct fetchContent
// call: that file is excluded from REQ-0145b, and its lazy
// fetch-on-settle lifecycle is its own).
//
// Freshness contract (per the REQ's risk register): OPT-IN call sites
// only -- api.ts#fetchContent itself stays uncached -- and every
// in-scope admin mutation of content data must call
// invalidateContentCache() (DexAdmin's save path does). ADOPTION NOTE
// (REQ-0156): the artadmin/contentadmin surfaces are excluded files this
// round; if/when their mutation paths start affecting consumers of this
// cache, they should invalidate it the same way.
//
// A REJECTED fetch is evicted immediately, so a transient failure is
// retried by the next caller (same "each mount retries" behavior the
// direct per-page fetches had) -- only a SUCCESSFUL payload is held.
import { fetchContent, type ApiContentPayload } from '../api';

let cached: Promise<ApiContentPayload> | null = null;

/** fetchContent(), memoized module-wide until invalidated. Concurrent
 * callers share one in-flight request (the promise itself is the memo). */
export function cachedFetchContent(): Promise<ApiContentPayload> {
  if (!cached) {
    const p = fetchContent().catch((e: unknown) => {
      if (cached === p) cached = null; // evict the failure, keep any newer promise
      throw e;
    });
    cached = p;
  }
  return cached;
}

/** Drops the memoized payload -- the next cachedFetchContent() refetches.
 * Call after ANY in-scope mutation of content data (DexAdmin save). */
export function invalidateContentCache(): void {
  cached = null;
}
