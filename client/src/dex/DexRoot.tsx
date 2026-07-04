// Dex route root — REQ-0035. Owns the display/edit mode toggle and the
// shared /api/content + /api/me fetches both Dex.tsx and DexAdmin.tsx
// need. The edit-mode toggle button is rendered here and is visible ONLY
// when GET /api/me's roles include item_admin -- a role-less user (or a
// server where /api/me fails) never sees it at all, and edit mode itself
// is a SEPARATE layout (DexAdmin), never overlaid on the display cards
// (Dex), per the task spec.
import { useCallback, useEffect, useState } from 'react';
import { fetchContent, fetchMe, type ApiContentPayload, type ApiMe } from '../api';
import type { Locale } from '../store';
import { Dex } from './Dex';
import { DexAdmin } from './DexAdmin';

interface DexRootProps {
  locale: Locale;
}

export function DexRoot({ locale }: DexRootProps) {
  const [payload, setPayload] = useState<ApiContentPayload | null>(null);
  const [me, setMe] = useState<ApiMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const reload = useCallback(() => setRefreshToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchContent()
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    // /api/me failure is non-fatal for the display view -- it just means
    // the edit toggle stays hidden (treated the same as "no admin role").
    fetchMe()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

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
            {locale === 'ja' ? '閲覧' : 'View'}
          </button>
          <button
            type="button"
            className={`dex-mode-toggle${editMode ? ' dex-mode-toggle-active' : ''}`}
            onClick={() => setEditMode(true)}
          >
            {locale === 'ja' ? '編集モード' : 'Edit mode'}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="dex-view dex-error">
          {locale === 'ja' ? '図鑑の読み込みに失敗しました: ' : 'Failed to load the dex: '}
          {error}
        </div>
      ) : !payload ? (
        <div className="dex-view dex-loading">{locale === 'ja' ? '読み込み中…' : 'Loading…'}</div>
      ) : editMode && isAdmin && me ? (
        <DexAdmin locale={locale} payload={payload} me={me} onSaved={reload} />
      ) : (
        <Dex locale={locale} payload={payload} />
      )}
    </div>
  );
}
