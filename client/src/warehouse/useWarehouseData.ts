// client/src/warehouse/useWarehouseData.ts -- REQ-0145b (cd): the
// Warehouse page's DATA layer -- the rows poll + content/rooms/dungeons
// lookups (REQ-0145b (cc) usePolledResource adoption) and the two-phase
// claim / claim-all state machine (REQ-0041/0042/0091) -- extracted
// VERBATIM from WarehousePage.tsx, which keeps the presentation
// (filters, countdown ticker, cards, board portal). See WarehousePage's
// module comment for the full design history this machinery implements
// (two-phase claim, engine first-fit, pulse/tab-pulse, auto-save
// finalization, press feedback + double-press guard).
import { useEffect, useRef, useState } from 'react';
import {
  claimWarehouseItem as apiClaimWarehouseItem,
  fetchDungeons,
  fetchRooms,
  fetchWarehouse,
  type ApiContentPayload,
  type ApiDungeonsPayload,
  type ApiRoom,
  type ApiWarehouseItem,
} from '../api';
import { getInventoryRenderer } from '../board/inventoryRenderer';
import { t } from '../i18n';
import { cachedFetchContent } from '../lib/contentCache';
import { applyWarehouseClaim } from '../../../shared/player_actions.mjs'; // REQ-0310
import { pulseTab } from '../lib/tabPulse';
import { usePolledResource } from '../lib/usePolledResource';
import { friendlyScheduleError, isApiErrorStatus } from '../schedule/errors';
import { notifyStateChanged, useGameStore, type Locale } from '../store';
import { playClaimChime } from './claimSfx';
import { sellFromWarehouse } from '../api/market'; // REQ-0328

/** REQ-0072: market-settled rows (buyer delivery / seller TM proceeds --
 * server/services/market.cjs's settle step) carry a `sourceListingId`
 * the schedule-era ApiWarehouseItem predates. Typed as a client-local
 * extension rather than an edit to shared/dto.ts: the market lane owns
 * that file's market section and this avoids a parallel-lane conflict
 * over one optional field (see docs/REQ-0072-redesign-warehouse.md). */
type WarehouseRow = ApiWarehouseItem & { sourceListingId?: string | null };

export type { WarehouseRow };

const POLL_MS = 5000;
// REQ-0091: how long the claim-press flash's fade-out (CSS
// schedule-warehouse-claim-fadeout, 0.4s) is allowed to play before its
// class is removed from the DOM -- same "duration + margin" convention
// as TAB_PULSE_MS above.
const FLASH_FADEOUT_MS = 450;
// REQ-0328: the market's default/sole live TM (mirrors
// MarketPage.MARKET_TM_ID); the direct-sell price is carved in it. A TM
// selector for the warehouse Sell action arrives with a 2nd live TM.
// REQ-0366: exported -- SellModal shows the same TM on its PriceTag that
// the POST below actually carves in.
export const SELL_TM_ID = 'lrdst';

/** Outcome of a single-item claim, so Claim All can stop the moment the
 * board is genuinely full without guessing at React state timing. */
export type ClaimOutcome = 'claimed' | 'no_space' | 'error';

/** Data + claim machinery for the Warehouse page -- everything here was
 * WarehousePage component state before REQ-0145b (cd). */
export function useWarehouseData(locale: Locale) {
  const snapshot = useGameStore();
  // REQ-0145b (cc): rows / content / rooms / dungeons state machines
  // replaced by usePolledResource -- same intervals, same mount
  // behavior, same error posture per resource (see the hook's doc).
  const {
    data: items,
    error: loadError,
    reload,
  } = usePolledResource<WarehouseRow[]>(() => fetchWarehouse().then((res) => res.items), { intervalMs: POLL_MS });
  const { data: content } = usePolledResource<ApiContentPayload>(cachedFetchContent, {
    onError: 'ignore', // item name/icon resolution degrades to raw itemId -- non-fatal
  });
  // REQ-0086: rooms/dungeons used to arrive as props from SchedulePage
  // (which already fetched/polled them for its own Rooms view). This is
  // now its own top-level route with no such parent, so it fetches its
  // own one-shot copy for the SAME purpose -- resolving a row's
  // sourceRoomId to a real dungeon display name for the provenance chip
  // (mock 「出所: ニヴルヘイム深淵」). No polling: a warehouse row's
  // source room is already a settled/harvested-from room by the time it
  // shows up here, so staleness risk is negligible (unlike the Rooms
  // view's own live status/cooldown polling need).
  const { data: rooms } = usePolledResource<ApiRoom[]>(() => fetchRooms().then((res) => res.rooms), {
    onError: 'ignore', // provenance chip degrades to omitted -- non-fatal
  });
  const { data: dungeons } = usePolledResource<ApiDungeonsPayload>(fetchDungeons, {
    onError: 'ignore', // provenance chip degrades to omitted -- non-fatal
  });
  const [claimingUid, setClaimingUid] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  // REQ-0328: the row whose direct warehouse->market sell is in flight.
  const [sellingUid, setSellingUid] = useState<string | null>(null);
  // REQ-0091: per-row claim press-feedback (flash while the claim POST
  // is in flight, then a one-shot fade-out once the response is known --
  // see handleClaim's beginClaimFadeOut). Keyed by itemUid rather than a
  // single value like claimingUid: claim-all walks rows sequentially,
  // but a fade-out from the PREVIOUS row can still be finishing its own
  // timer while the NEXT row's flash starts, and the two must not stomp
  // each other.
  const [claimFx, setClaimFx] = useState<Record<string, 'flash' | 'fadeout'>>({});
  // REQ-0091: synchronous re-entrancy guard for handleClaim. claimingUid
  // (above) is React state -- batched/async -- so a second press arriving
  // before the button's own disabled={isClaiming} attribute actually
  // repaints could still re-enter handleClaim for the SAME row. A ref
  // mutates immediately on the calling thread, closing that window
  // regardless of render timing.
  const claimLockRef = useRef<Set<string>>(new Set());
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // REQ-0091: clears this row's flash/fade-out effect state entirely
  // (no key at all, not just a falsy value) once the fade-out animation
  // has had time to finish.
  const clearClaimFx = (itemUid: string) => {
    setClaimFx((prev) => {
      if (!(itemUid in prev)) return prev;
      const next = { ...prev };
      delete next[itemUid];
      return next;
    });
  };

  // REQ-0091: the moment the claim POST's response is known (success OR
  // error -- called from both places below), stop the looping flash and
  // hand off to the one-shot fade-out, cleaning up after it finishes.
  const beginClaimFadeOut = (itemUid: string) => {
    setClaimFx((prev) => ({ ...prev, [itemUid]: 'fadeout' }));
    setTimeout(() => clearClaimFx(itemUid), FLASH_FADEOUT_MS);
  };

  const handleClaim = async (itemUid: string): Promise<ClaimOutcome> => {
    // Same-row double-press guard (see claimLockRef's doc above) -- a
    // press already in flight for this itemUid makes this a silent
    // no-op rather than a second concurrent claim attempt.
    if (claimLockRef.current.has(itemUid)) return 'error';
    claimLockRef.current.add(itemUid);
    setClaimingUid(itemUid);
    setClaimErrors((prev) => ({ ...prev, [itemUid]: '' }));
    // Press feedback, immediately, before the network round-trip even
    // starts: flash this row's frame and play a short chime (see
    // warehouse/claimSfx.ts). Ends via beginClaimFadeOut once the
    // response below is back.
    setClaimFx((prev) => ({ ...prev, [itemUid]: 'flash' }));
    playClaimChime();
    try {
      // Phase 1: server marks the row 'claiming' and hands back the
      // content def id -- see server/schedule.cjs's claimWarehouseItem
      // doc for the full two-phase design/bug-#3 rationale.
      const claimed = await apiClaimWarehouseItem(itemUid);
      // REQ-0091: the server's response for THIS claim is back -- begin
      // the flash's fade-out now, regardless of what phase 2 (engine
      // placement/auto-save, below) still has to do.
      beginClaimFadeOut(itemUid);

      const engine = snapshot.engine;
      const state = snapshot.state;
      if (!engine || !state || !state.inv) {
        // Should not happen once boot() has resolved (both are always
        // set together, see store.ts) -- defensive fallback only.
        throw new Error('inventory not ready');
      }

      // Phase 2 (THIS client): the whole STATE transition -- the kind
      // dispatch, the first-fit placement that REUSES the warehouse row's own
      // itemUid (which is what makes server-side finalization on the next
      // profile save exact rather than a fuzzy itemId heuristic), and
      // REQ-0195d's verbatim-BP field restore -- lives in
      // shared/player_actions.mjs since REQ-0310, so the headless player
      // (REQ-0314) runs the SAME code this hook does instead of
      // reimplementing item-losing logic. What stays here is UI: the
      // no-space toast/error, the cell pulse and the tab pulse.
      const openPage = snapshot.activeInvPage;
      const res = applyWarehouseClaim(engine, state, claimed, content, openPage);

      if (!res.ok) {
        // No space anywhere -- per the REQ's own accepted design, leave
        // the row 'claiming' server-side; it lazily reverts to
        // 'claimable' after the server's own timeout (no explicit
        // "abandon claim" round-trip needed -- see this file's module
        // comment). Surface a toast so the user isn't left guessing.
        setToast(t(locale, 'schedule.warehouse.claimNoSpace'));
        setClaimErrors((prev) => ({ ...prev, [itemUid]: t(locale, 'schedule.warehouse.claimNoSpace') }));
        return 'no_space';
      }

      // Placement-cell pulse ("ピコンピコン") on whichever board actually
      // received it -- reuses BoardRenderer's existing flash-overlay
      // mechanism (pulseCellsSuccess), via the singleton InventoryBoard
      // renderer this tab's embedded board IS (see board/
      // inventoryRenderer.ts's doc for why a module-level accessor is
      // the seam here, per the REQ-0041 Pixi-instance reuse decision).
      // Only pulse if the placement landed on the CURRENTLY-DISPLAYED
      // page -- pulseCellsSuccess draws into gPulse (REQ-0346; it drew
      // into gTarget until then, which is why it never actually painted:
      // the notifyStateChanged() below wiped it in the same frame), a
      // layer of whichever page InventoryBoard.tsx's own ops-swap effect
      // last pointed the renderer at (activeInvPage). If the item landed
      // on a DIFFERENT page, pulsing cells there would be invisible (and
      // potentially misleading once the user switches there later) --
      // the tab-pulse notification below is the correct cue for that
      // case instead, exactly per the REQ's own spec ("auto-place into
      // another page and pulse-highlight THAT page's tab").
      const renderer = getInventoryRenderer();
      if (res.page === openPage) {
        renderer?.pulseCellsSuccess(res.cells);
      } else {
        pulseTab(res.page);
      }

      // Let the EXISTING auto-save choke point run naturally -- do NOT
      // bypass it with a manual save call (the whole point of the
      // two-phase design is that this auto-save is once again the
      // single writer; the server finalizes/deletes the warehouse row
      // on the arrival of the resulting profile PUT).
      notifyStateChanged();

      setToast(
        res.page === openPage
          ? t(locale, 'schedule.warehouse.claimedToast')
          : t(locale, 'schedule.warehouse.claimedOnOtherPage', { page: res.page + 1 })
      );
      await reload();
      return 'claimed';
    } catch (e) {
      // REQ-0091: covers BOTH "the claim POST itself came back as an
      // error" and any later synchronous failure in this same try block
      // (e.g. the defensive "inventory not ready" throw) -- either way
      // the attempt has concluded, so the flash ends here too.
      beginClaimFadeOut(itemUid);
      const message = isApiErrorStatus(e, 409)
        ? friendlyScheduleError(locale, e)
        : t(locale, 'schedule.warehouse.claimFailed') + (e instanceof Error ? e.message : String(e));
      setClaimErrors((prev) => ({ ...prev, [itemUid]: message }));
      return 'error';
    } finally {
      claimLockRef.current.delete(itemUid);
      setClaimingUid(null);
    }
  };

  // REQ-0328: DIRECT warehouse->market sell (item 9's player UI) for a
  // CLAIMABLE row -- POST /api/market/listings/from-warehouse consumes
  // the row into an active listing WITHOUT it ever occupying a canvas
  // cell; the item shows up under the Market page's My Listings. A
  // currency (tm) row has no direct-sell path (the Sell button is hidden
  // for it in WarehousePage), so this only ever runs for spoils rows.
  // REQ-0366: the price arrives from WarehousePage's SellModal (the
  // market price-carve UI in a modal) instead of a raw browser prompt()
  // here; qty is a clamped integer in [1,999] BY CONSTRUCTION
  // (market/priceCarve.tsx's clamp law), so the old post-hoc
  // sellInvalidPrice check is gone with the prompt. POST contract and
  // eligibility rules are UNCHANGED. Returns true once the row is
  // actually listed -- the modal closes on true and stays open on
  // failure (whose message lands on the shared toast).
  const handleSell = async (itemUid: string, qty: number): Promise<boolean> => {
    if (sellingUid) return false;
    setSellingUid(itemUid);
    try {
      await sellFromWarehouse(itemUid, { tm: SELL_TM_ID, qty });
      setToast(t(locale, 'schedule.warehouse.sellSuccess', { qty }));
      await reload(); // the consumed row leaves the warehouse list
      return true;
    } catch (e) {
      setToast(t(locale, 'schedule.warehouse.sellFailed') + (e instanceof Error ? e.message : String(e)));
      return false;
    } finally {
      setSellingUid(null);
    }
  };

  // Claim All -- a thin composition over the single-item handleClaim,
  // walking rows soonest-to-expire first (same order the list renders)
  // and stopping the moment the board is genuinely full (outcome
  // 'no_space'); a single-item 'error' does NOT stop the run (other rows
  // may still succeed). Reuses handleClaim as-is -- no reimplementation
  // of the two-phase placement/toast/reload logic.
  const handleClaimAll = async () => {
    if (!items || items.length === 0) return;
    const ordered = [...items].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
    setClaimingAll(true);
    for (const item of ordered) {
      const outcome = await handleClaim(item.itemUid);
      if (outcome === 'no_space') break;
    }
    setClaimingAll(false);
  };

  return {
    items,
    loadError,
    reload,
    content,
    rooms,
    dungeons,
    toast,
    claimingUid,
    claimingAll,
    claimFx,
    claimErrors,
    sellingUid,
    handleClaim,
    handleClaimAll,
    handleSell,
  };
}
