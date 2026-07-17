// Dex route root — REQ-0035, migrated to formal chrome i18n (REQ-0038).
// Owns the shared /api/content fetch Dex.tsx needs.
//
// REQ-0182b: the display/edit toggle and the DexAdmin editor are GONE. The Dex
// is read-only. Dex Edit wrote content/live/*.json directly, and once REQ-0178
// made the display registry-first and REQ-0176 made the roll and the simulation
// registry-first, those writes reached nothing for any adopted entity: the
// operator saw "saved" and the game did not change, while the live file silently
// diverged from the ledger (parity DRIFT — it stranded a stray `dagger.stretch`
// on live twice). REQ-0182a ported the form's UX into the contentadmin PO/SI
// editor, which edits through the ledger, so the UX is preserved and the
// harmful surface is removed. The server refuses the route too (409 —
// routes/admin.cjs).
//
// The /api/me fetch went with it: `me` existed here ONLY to decide whether to
// show the toggle.
import { type ApiContentPayload } from '../api';
import { cachedFetchContent } from '../lib/contentCache';
import { usePolledResource } from '../lib/usePolledResource';
import { t } from '../i18n';
import type { Locale } from '../store';
import { Dex } from './Dex';

interface DexRootProps {
  locale: Locale;
  /** REQ-0052: pending Dex deep-link target (store.ts's dexFocusId,
   * from a '#/dex/<id>' hash -- e.g. a DexCardWindow footer link).
   * Threaded straight through to Dex.tsx, which owns actually consuming
   * it (jump to detail view) + clearing it. */
  dexFocusId?: string | null;
}

export function DexRoot({ locale, dexFocusId }: DexRootProps) {
  // REQ-0145b (cc): the shared /api/content fetch rides usePolledResource
  // (+ the module-level content cache). Error posture preserved exactly: a
  // content failure is surfaced (and deliberately NOT cleared by a later
  // success -- clearErrorOnSuccess false matches the old effect, whose error
  // state was only ever written on catch). REQ-0182b dropped the sibling
  // /api/me fetch: its only consumer was the edit toggle.
  const { data: payload, error } = usePolledResource<ApiContentPayload>(cachedFetchContent, {
    clearErrorOnSuccess: false,
  });

  return (
    <div className="dex-root">
      {error ? (
        <div className="dex-view dex-error">
          {t(locale, 'dex.loadFailed')}
          {error}
        </div>
      ) : !payload ? (
        <div className="dex-view dex-loading">{t(locale, 'dex.loading')}</div>
      ) : (
        <Dex locale={locale} payload={payload} dexFocusId={dexFocusId} />
      )}
    </div>
  );
}
