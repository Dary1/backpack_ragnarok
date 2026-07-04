// Warehouse tab (golden f) -- REQ-0036 P1-C. A section within the
// Schedule page (SchedulePage.tsx owns the Rooms/Warehouse toggle; this
// is NOT a separate top-level nav route). Lists GET /api/warehouse items
// (name/icon resolved against fetchContent()'s existing items map --
// reuses the SAME lookup Dex.tsx/ItemPanel.tsx already use, no second
// item-lookup path), an expiry countdown, a Claim button (-> POST
// /api/warehouse/claim), and a 200-cap indicator.
import { useCallback, useEffect, useState } from 'react';
import {
  claimWarehouseItem as apiClaimWarehouseItem,
  fetchContent,
  fetchWarehouse,
  type ApiContentPayload,
  type ApiWarehouseItem,
} from '../api';
import { friendlyScheduleError, isApiErrorStatus } from './errors';
import { formatCountdown } from './RoomCard';
import { t } from '../i18n';
import { flushAutoSave, loadGame, type Locale } from '../store';

interface WarehouseTabProps {
  locale: Locale;
}

const WAREHOUSE_CAP = 200; // mirrors server/schedule.cjs's WAREHOUSE_CAP (display only)
const POLL_MS = 5000;

function localizedItemName(locale: Locale, content: ApiContentPayload | null, itemId: string): string {
  const entry = content?.items[itemId];
  if (!entry) return itemId;
  if (locale === 'ja') return entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name;
  return entry.name;
}

export function WarehouseTab({ locale }: WarehouseTabProps) {
  const [items, setItems] = useState<ApiWarehouseItem[] | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claimingUid, setClaimingUid] = useState<string | null>(null);
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const res = await fetchWarehouse();
      setItems(res.items);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchContent()
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch(() => {
        /* item name/icon resolution degrades to raw itemId -- non-fatal */
      });
    void reload();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const handleClaim = async (itemUid: string) => {
    setClaimingUid(itemUid);
    setClaimErrors((prev) => ({ ...prev, [itemUid]: '' }));
    try {
      await apiClaimWarehouseItem(itemUid);
      setToast(t(locale, 'schedule.warehouse.claimedToast'));
      await reload();
      // Refresh the player's own inventory/canvas state so the claimed
      // item actually shows up if the user navigates to Backpacks --
      // reuses the SAME load-canvas path the rest of the app already
      // uses after a remote-side mutation (store.ts's loadGame()), then
      // flushes any pending local auto-save first so a concurrent local
      // edit isn't clobbered by the reload (mirrors how loadGame() is
      // documented to be called elsewhere: cancel/settle local state
      // before replacing it from the server).
      await flushAutoSave();
      await loadGame();
    } catch (e) {
      const message = isApiErrorStatus(e, 409)
        ? friendlyScheduleError(locale, e)
        : t(locale, 'schedule.warehouse.claimFailed') + (e instanceof Error ? e.message : String(e));
      setClaimErrors((prev) => ({ ...prev, [itemUid]: message }));
    } finally {
      setClaimingUid(null);
    }
  };

  return (
    <div className="schedule-warehouse-tab">
      <div className="schedule-warehouse-header">
        <h3>{t(locale, 'schedule.warehouse.title')}</h3>
        <span className="schedule-warehouse-cap" data-testid="schedule-warehouse-cap">
          {t(locale, 'schedule.warehouse.cap', { count: items?.length ?? 0, cap: WAREHOUSE_CAP })}
        </span>
      </div>

      {loadError ? <div className="schedule-error">{t(locale, 'schedule.warehouse.loadFailed')}{loadError}</div> : null}
      {toast ? <div className="schedule-toast" data-testid="schedule-warehouse-toast">{toast}</div> : null}

      {items === null ? (
        <div className="schedule-loading">{t(locale, 'schedule.loading')}</div>
      ) : items.length === 0 ? (
        <div className="schedule-empty">{t(locale, 'schedule.warehouse.empty')}</div>
      ) : (
        <div className="schedule-warehouse-list">
          {items.map((item) => {
            const expiresMs = Date.parse(item.expiresAt) - now;
            const expired = expiresMs <= 0;
            return (
              <div className="schedule-warehouse-row" key={item.itemUid} data-testid="schedule-warehouse-row" data-item-uid={item.itemUid}>
                <span className="schedule-warehouse-item-name">{localizedItemName(locale, content, item.itemId)}</span>
                <span className="schedule-warehouse-item-harvested">
                  {t(locale, 'schedule.warehouse.harvested', { time: new Date(item.harvestedAt).toLocaleString(locale) })}
                </span>
                <span className="schedule-warehouse-item-expiry">
                  {expired ? t(locale, 'schedule.warehouse.expired') : t(locale, 'schedule.warehouse.expiresIn', { time: formatCountdown(expiresMs) })}
                </span>
                <button
                  type="button"
                  className="schedule-claim-btn"
                  disabled={claimingUid === item.itemUid}
                  onClick={() => void handleClaim(item.itemUid)}
                  data-testid={`schedule-claim-btn-${item.itemUid}`}
                >
                  {claimingUid === item.itemUid ? t(locale, 'schedule.warehouse.claiming') : t(locale, 'schedule.warehouse.claimButton')}
                </button>
                {claimErrors[item.itemUid] ? <div className="schedule-slot-error">{claimErrors[item.itemUid]}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
