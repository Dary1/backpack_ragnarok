// Dex route root — REQ-0035, migrated to formal chrome i18n (REQ-0038).
// Owns the display/edit mode toggle and the shared /api/content +
// /api/me fetches both Dex.tsx and DexAdmin.tsx need. The edit-mode
// toggle button is rendered here and is visible ONLY when GET /api/me's
// roles include item_admin -- a role-less user (or a server where
// /api/me fails) never sees it at all, and edit mode itself is a
// SEPARATE layout (DexAdmin), never overlaid on the display cards (Dex),
// per the task spec.
import { useCallback, useState } from 'react';
import { fetchMe, type ApiContentPayload, type ApiMe } from '../api';
import { cachedFetchContent } from '../lib/contentCache';
import { usePolledResource } from '../lib/usePolledResource';
import { t } from '../i18n';
import type { Locale } from '../store';
import { Dex } from './Dex';
import { DexAdmin } from './DexAdmin';

interface DexRootProps {
  locale: Locale;
  /** REQ-0052: pending Dex deep-link target (store.ts's dexFocusId,
   * from a '#/dex/<id>' hash -- e.g. a DexCardWindow footer link).
   * Threaded straight through to Dex.tsx, which owns actually consuming
   * it (jump to detail view) + clearing it. */
  dexFocusId?: string | null;
}

export function DexRoot({ locale, dexFocusId }: DexRootProps) {
  // REQ-0145b (cc): the shared /api/content + /api/me fetches now ride
  // usePolledResource (+ the module-level content cache). Error posture
  // preserved exactly: a content failure is surfaced (and deliberately
  // NOT cleared by a later success -- clearErrorOnSuccess false matches
  // the old effect, whose error state was only ever written on catch);
  // an /api/me failure is non-fatal for the display view -- it just
  // means the edit toggle stays hidden (treated the same as "no admin
  // role"), hence onError 'null-data'.
  const { data: payload, error, reload: reloadContent } = usePolledResource<ApiContentPayload>(cachedFetchContent, {
    clearErrorOnSuccess: false,
  });
  const { data: me, reload: reloadMe } = usePolledResource<ApiMe>(fetchMe, { onError: 'null-data' });
  const [editMode, setEditMode] = useState(false);

  const reload = useCallback(() => {
    void reloadContent();
    void reloadMe();
  }, [reloadContent, reloadMe]);

  const isAdmin = !!me && Array.isArray(me.roles) && me.roles.includes('item_admin');

  return (
    <div className="dex-root">
      {isAdmin ? (
        <div className="dex-mode-toggle-row">
          <button
            type="button"
            className={`dex-mode-toggle${!editMode ? ' dex-mode-toggle-active' : ''}`}
            onClick={() => setEditMode(false)}
          >
            {t(locale, 'dex.viewMode')}
          </button>
          <button
            type="button"
            className={`dex-mode-toggle${editMode ? ' dex-mode-toggle-active' : ''}`}
            onClick={() => setEditMode(true)}
          >
            {t(locale, 'dex.editMode')}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="dex-view dex-error">
          {t(locale, 'dex.loadFailed')}
          {error}
        </div>
      ) : !payload ? (
        <div className="dex-view dex-loading">{t(locale, 'dex.loading')}</div>
      ) : editMode && isAdmin && me ? (
        <DexAdmin locale={locale} payload={payload} me={me} onSaved={reload} />
      ) : (
        <Dex locale={locale} payload={payload} dexFocusId={dexFocusId} />
      )}
    </div>
  );
}
