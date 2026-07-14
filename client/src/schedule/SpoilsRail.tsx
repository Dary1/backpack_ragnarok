// Expedition spoils rail (right column) -- REQ-0100. A compact, READ-ONLY
// preview of the caller's warehouse: pending count, a staged capacity
// meter, the soonest-to-expire rows, and a deep-link to the #/warehouse
// route (NO inline claim -- that would fork the REQ-0041 two-phase claim;
// the rail deep-links to the one real claim surface instead).
//
// Ratification (2026-07-14): after REQ-0086 the warehouse is its own route
// and SchedulePage no longer fetches warehouse data, so this rail owns ONE
// light GET /api/warehouse on mount + a slow (~15s) refresh + an immediate
// refresh when the watched room's run settles (Monitor detects settle and
// bumps `refreshSignal`). 4 rows, soonest-to-expire first, TM rows included
// (they are warehouse rows with the same TTL -- hiding them would under-
// report the pending count). Icons/names reuse the SAME content-map
// resolution the Monitor reward rows already use.
import { useCallback, useEffect, useState } from 'react';
import { fetchContent, fetchWarehouse, type ApiContentPayload, type ApiWarehouseItem } from '../api';
import { iconDataUrl } from '../dex/dexIcons';
import { t } from '../i18n';
import type { Locale } from '../store';

// REQ-0100: mirrors server core.cjs's WAREHOUSE_CAP (golden e: max 200
// items) -- the mock's 倉庫 {n}/200 meter. Hardcoded (a client never
// imports a server-only CJS constant) with this note so the two stay in
// sync by review.
const WAREHOUSE_CAP = 200;
const PREVIEW_ROWS = 4;
const REFRESH_MS = 15000;

interface SpoilsRailProps {
  locale: Locale;
  /** Bumped by SchedulePage whenever the watched room's run settles
   * (Monitor detects settle) -- triggers an immediate warehouse refresh so
   * freshly-won loot appears in the rail without waiting the slow poll. */
  refreshSignal: number;
}

/** Same content-map resolution the Monitor reward rows use (TM stacks in
 * content.tms; plain PO/SI in content.items/sis), degrading to "no icon,
 * no tint" while content loads or for an unrecognized id. */
function rowVisual(content: ApiContentPayload | null, item: ApiWarehouseItem): { icon: string | null; rarity: string | null } {
  if (!content) return { icon: null, rarity: null };
  const entry = item.kind === 'tm' ? content.tms[item.itemId] : content.items[item.itemId] ?? content.sis[item.itemId];
  if (!entry) return { icon: null, rarity: null };
  return { icon: iconDataUrl(entry.icon), rarity: entry.rarity ?? null };
}

function localizedItemName(locale: Locale, content: ApiContentPayload | null, itemId: string): string {
  const entry = content?.items[itemId] ?? content?.sis[itemId] ?? content?.tms[itemId];
  if (!entry) return itemId;
  if (locale === 'ja') return entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name;
  return entry.name;
}

/** Compact "time left" chip -- the 7-day TTL, rounded to the coarsest
 * still-informative unit (days, else hours, else minutes). */
function expiryLabel(locale: Locale, expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return locale === 'ja' ? '期限切れ' : 'expired';
  const days = Math.floor(ms / 86400000);
  if (days > 0) return locale === 'ja' ? `${days}日` : `${days}d`;
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (hours > 0) return locale === 'ja' ? `${hours}時間` : `${hours}h`;
  const mins = Math.floor((ms % 3600000) / 60000);
  return locale === 'ja' ? `${mins}分` : `${mins}m`;
}

export function SpoilsRail({ locale, refreshSignal }: SpoilsRailProps) {
  const [items, setItems] = useState<ApiWarehouseItem[] | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const res = await fetchWarehouse();
      setItems(res.items);
    } catch (e) {
      // Non-fatal -- a transient failure just keeps the last preview; the
      // next slow poll retries.
    }
  }, []);

  // Content (names/icons) once.
  useEffect(() => {
    let cancelled = false;
    fetchContent()
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Mount fetch + slow refresh.
  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);

  // Immediate refresh when the watched room's run settles.
  useEffect(() => {
    if (refreshSignal > 0) void reload();
  }, [refreshSignal, reload]);

  // Coarse clock for the expiry chips (30s is plenty for a day/hour label).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const sorted = (items ?? []).slice().sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
  const preview = sorted.slice(0, PREVIEW_ROWS);
  const pending = items?.length ?? 0;
  const frac = pending / WAREHOUSE_CAP;
  const capState = frac >= 1 ? 'is-full' : frac >= 0.85 ? 'is-warning' : 'is-calm';

  return (
    <div className="panel ornate schedule-spoils-rail" data-testid="schedule-spoils-rail">
      <i className="k tl" />
      <i className="k tr" />
      <i className="k br" />
      <i className="k bl" />
      <div className="schedule-spoils-rail-head">
        <span className="schedule-spoils-rail-pending" data-testid="schedule-spoils-count">
          {t(locale, 'schedule.spoils.pending', { count: pending })}
        </span>
        <span className="schedule-spoils-rail-cap tnum" data-testid="schedule-spoils-cap">
          {t(locale, 'schedule.spoils.capacity', { n: pending, max: WAREHOUSE_CAP })}
        </span>
      </div>
      <div className={`schedule-spoils-cap-bar ${capState}`}>
        <div className="schedule-spoils-cap-fill" style={{ width: `${Math.max(0, Math.min(100, frac * 100))}%` }} />
      </div>

      {items === null ? (
        <div className="schedule-spoils-loading t-micro">{t(locale, 'schedule.loading')}</div>
      ) : preview.length === 0 ? (
        <div className="schedule-spoils-empty t-micro" data-testid="schedule-spoils-empty">
          {t(locale, 'schedule.spoils.empty')}
        </div>
      ) : (
        <ul className="schedule-spoils-rows">
          {preview.map((item) => {
            const v = rowVisual(content, item);
            return (
              <li className="schedule-spoils-row" data-testid="schedule-spoils-row" data-item-uid={item.itemUid} key={item.itemUid}>
                <span className="schedule-spoils-row-thumb" aria-hidden="true">
                  {v.icon ? <img src={v.icon} alt="" /> : null}
                </span>
                <span className={`schedule-spoils-row-name${v.rarity ? ` rarity r-${v.rarity}` : ''}`}>
                  {localizedItemName(locale, content, item.itemId)}
                  {item.kind === 'tm' && typeof item.qty === 'number' ? ` x${item.qty}` : ''}
                </span>
                <span className="schedule-spoils-row-expiry tnum">{expiryLabel(locale, item.expiresAt, now)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <a className="btn btn-ghost schedule-spoils-claim-jump" href="#/warehouse" data-testid="schedule-spoils-claim-jump">
        {t(locale, 'schedule.spoils.claimHint')}
      </a>
      <div className="schedule-spoils-lore t-micro">{t(locale, 'schedule.spoils.lore')}</div>
    </div>
  );
}
