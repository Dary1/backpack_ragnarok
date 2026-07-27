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
import { itemKindOf } from '../lib/itemContent';
import type { ApiRolledBp } from '../api';
import { firstFitOrMergeTM, firstFitPlace, firstFitPlaceBp, type BpPlacementResult, type PlacementResult } from '../../../shared/placement.mjs'; // REQ-0310
import { pulseTab } from '../lib/tabPulse';
import { usePolledResource } from '../lib/usePolledResource';
import { friendlyScheduleError, isApiErrorStatus } from '../schedule/errors';
import { notifyStateChanged, useGameStore, type Locale } from '../store';
import { playClaimChime } from './claimSfx';

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

      // Phase 2 (THIS client): engine first-fit placement, reusing the
      // warehouse row's OWN itemUid as the new PO/SI's uid (see
      // server/schedule.cjs's claimWarehouseItem doc for why this is
      // what makes server-side finalization on the next profile save
      // exact rather than a fuzzy itemId-based heuristic).
      // REQ-0042: a TM-kind row (claimed.kind==='tm', e.g. an LRDST
      // reward/grant) takes a DIFFERENT placement path -- merge into an
      // existing matching-id stack if one exists, otherwise first-fit a
      // new stack (see firstFitOrMergeTM's own doc above) -- rather than
      // firstFitPlace's plain po/si first-fit (which has no merge
      // concept at all).
      const kind = claimed.kind === 'tm' ? 'tm' : claimed.kind === 'bp' ? 'bp' : itemKindOf(content, claimed.itemId);
      const openPage = snapshot.activeInvPage;
      // REQ-0195d: a bought unit (BP) row places via firstFitPlaceBp (the
      // Workshop's own claim path), reconstructing an ApiRolledBp from the
      // verbatim payload; the remaining instance fields are merged back below.
      const bpPayload = claimed.bp;
      const rolled: ApiRolledBp | null = kind === 'bp' && bpPayload
        ? { uid: claimed.itemUid, shape: bpPayload.shape, unit: bpPayload.unit, hpMax: bpPayload.hpMax, cellCount: bpPayload.cellCount ?? bpPayload.shape.length, bonuses: bpPayload.bonuses as ApiRolledBp['bonuses'] }
        : null;
      const placed: PlacementResult | BpPlacementResult | null = kind === 'tm'
        ? firstFitOrMergeTM(engine, state, claimed.itemUid, claimed.itemId, claimed.qty ?? 1, openPage, engine.PAGE_COUNT)
        : kind === 'bp'
          ? (rolled ? firstFitPlaceBp(engine, state, rolled, openPage, engine.PAGE_COUNT) : null)
          : firstFitPlace(engine, state, kind, claimed.itemUid, claimed.itemId, openPage, engine.PAGE_COUNT);

      if (!placed) {
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
      // REQ-0195d: firstFitPlaceBp sets only id/name/color/shape/origin/
      // unit/hpMax -- restore the rest of the verbatim BP instance so the
      // bought unit stays byte-faithful (never re-rolled).
      if (kind === 'bp' && bpPayload) {
        const placedBp = state.inv.pages[(placed as BpPlacementResult).page].bps.find((b) => b.id === claimed.itemUid) as Record<string, unknown> | undefined;
        if (placedBp) {
          if (bpPayload.name != null) placedBp.name = bpPayload.name;
          if (bpPayload.color != null) placedBp.color = bpPayload.color;
          if (bpPayload.cellCount != null) placedBp.cellCount = bpPayload.cellCount;
          if (bpPayload.bonuses != null) placedBp.bonuses = bpPayload.bonuses;
          if (bpPayload.roll != null) placedBp.roll = bpPayload.roll;
        }
      }
      const renderer = getInventoryRenderer();
      const cells = kind === 'po'
        ? engine.cellsOfIn(state.inv.pages[placed.page].pos.find((p) => p.uid === claimed.itemUid)!)
        : kind === 'bp'
          ? engine.bpCells({ shape: (rolled as ApiRolledBp).shape, origin: (placed as BpPlacementResult).origin } as Parameters<typeof engine.bpCells>[0])
          : [(placed as PlacementResult).cell];
      // (kind 'si' and 'tm' both fall through to the [placed.cell]
      // branch above -- both are always exactly 1x1, same as an SI.)
      // Only pulse if the placement landed on the CURRENTLY-DISPLAYED
      // page -- pulseCellsSuccess draws into gTarget, which always
      // reflects whatever page InventoryBoard.tsx's own ops-swap effect
      // last pointed the renderer at (activeInvPage). If the item landed
      // on a DIFFERENT page, pulsing cells there would be invisible (and
      // potentially misleading once the user switches there later) --
      // the tab-pulse notification below is the correct cue for that
      // case instead, exactly per the REQ's own spec ("auto-place into
      // another page and pulse-highlight THAT page's tab").
      if (placed.page === openPage) {
        renderer?.pulseCellsSuccess(cells);
      } else {
        pulseTab(placed.page);
      }

      // Let the EXISTING auto-save choke point run naturally -- do NOT
      // bypass it with a manual save call (the whole point of the
      // two-phase design is that this auto-save is once again the
      // single writer; the server finalizes/deletes the warehouse row
      // on the arrival of the resulting profile PUT).
      notifyStateChanged();

      setToast(
        placed.page === openPage
          ? t(locale, 'schedule.warehouse.claimedToast')
          : t(locale, 'schedule.warehouse.claimedOnOtherPage', { page: placed.page + 1 })
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
    handleClaim,
    handleClaimAll,
  };
}
