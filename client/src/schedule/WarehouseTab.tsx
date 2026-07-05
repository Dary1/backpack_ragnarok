// Warehouse tab (golden f) -- REQ-0036 P1-C, REWRITTEN by REQ-0041 for
// the two-phase claim + embedded InventoryBoard design.
//
// REQ-0041 changes from the original REQ-0036 P1-C version:
//  - This tab now EMBEDS the REAL InventoryBoard component (same Pixi
//    Application/BoardRenderer instance the Backpacks page uses -- see
//    board/inventorySlot.ts's module comment for the full "reuse via
//    portal, not a second Pixi app" decision writeup) + its Tabs, so the
//    inventory shown here is fully operable with EXACTLY the same
//    behavior as the Backpacks page (by construction, not by
//    reimplementation -- it IS the same component instance).
//  - The claim flow is now two-phase (bug #3's fix, see server/
//    schedule.cjs's claimWarehouseItem doc): POST claim marks the row
//    'claiming' and returns {itemUid, itemId} WITHOUT placing anything
//    server-side. THIS component now performs the engine first-fit
//    placement itself (open page first, then other pages in order),
//    pulses the placed cell(s) (~2s, BoardRenderer.pulseCellsSuccess),
//    pulse-highlights the destination tab if it lands on a page other
//    than the currently-open one, and finally calls notifyStateChanged()
//    -- the SAME auto-save choke point every other board mutation in
//    this app already goes through -- so the server's existing profile-
//    PUT finalization path (server/api.cjs) picks up the placement and
//    deletes the warehouse row on its own, with NO manual/explicit save
//    call from here (that would bypass the app's one-writer auto-save
//    discipline, defeating the whole point of the two-phase design).
//  - If NO page anywhere has room, this shows a toast error and leaves
//    the row 'claiming' -- per the REQ's own accepted design ("no item
//    loss on crash" via the lazy server-side timeout revert), no
//    explicit "abandon claim" endpoint was added (see the REQ-0041
//    outcome doc for this documented decision): the row simply reverts
//    to claimable server-side after WAREHOUSE_CLAIM_TIMEOUT_MS if this
//    client never manages to place it, without any extra round-trip.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimWarehouseItem as apiClaimWarehouseItem,
  fetchContent,
  fetchWarehouse,
  type ApiContentPayload,
  type ApiWarehouseItem,
} from '../api';
import { getInventoryRenderer } from '../board/inventoryRenderer';
import { setInventorySlot } from '../board/inventorySlot';
import type { EngineInstance, GameState } from '../engine/engine.d.ts';
import { friendlyScheduleError, isApiErrorStatus } from './errors';
import { formatCountdown } from './RoomCard';
import { t } from '../i18n';
import { notifyStateChanged, useGameStore, type Locale } from '../store';

interface WarehouseTabProps {
  locale: Locale;
}

const WAREHOUSE_CAP = 200; // mirrors server/schedule.cjs's WAREHOUSE_CAP (display only)
const POLL_MS = 5000;
const GRID_MIN = 1;
const GRID_MAX = 8; // matches every inventory page's fixed 8x8 layout (same bound the old server-side first-fit used)
const TAB_PULSE_MS = 1600; // >= the 3-cycle CSS animation's own 0.5s*3 duration, plus margin

function localizedItemName(locale: Locale, content: ApiContentPayload | null, itemId: string): string {
  const entry = content?.items[itemId] ?? content?.sis[itemId];
  if (!entry) return itemId;
  if (locale === 'ja') return entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name;
  return entry.name;
}

/** Determines whether `itemId` is a PO (has a `shape`, lives in
 * content.items) or an SI (has a `slot`, lives in content.sis) -- the two
 * kinds a claimed warehouse item can be in practice (see server/
 * schedule.cjs's REWARD_ROLL_TO_ITEM_ID table: every resolved reward/
 * grant item id is a real live_items.json or live_sis.json entry; BPs are
 * never warehouse-claimable content in this game -- they are not defined
 * in either content file, see the REQ-0041 outcome doc's note on this).
 * Falls back to 'po' if the id is in neither map (defensive; the claim
 * response's itemId should always resolve against one of them). */
function itemKindOf(content: ApiContentPayload | null, itemId: string): 'po' | 'si' {
  if (!content) return 'po';
  if (content.sis[itemId]) return 'si';
  return 'po';
}

interface PlacementResult {
  page: number;
  cell: [number, number];
}

/**
 * REQ-0042: claiming a TM warehouse row (kind:'tm', e.g. an LRDST
 * reward/grant) merges into an EXISTING matching-id inventory stack if
 * one exists ANYWHERE on `openPage`, otherwise first-fit-CREATES a new
 * stack -- reusing engine.js's tmMove/tmCanPlace (the SAME merge-on-
 * same-id-drop logic the engine's own drag-and-drop TM handling uses,
 * see mock-src/engine.js's TM model comment for the merge/uid-survivor
 * design). Tries `openPage` first, then every other page in ascending
 * order, exactly like firstFitPlace's po/si branches -- but the SCAN
 * itself is simpler here: rather than probing every cell for a legal
 * spot, this walks the page's EXISTING tms[] stacks first (an O(stacks)
 * check, since a same-id stack merge is legal from ANY of its own
 * cells -- tmCanPlace's mergeInto branch fires the moment the anchor
 * cell matches an existing same-id stack's OWN cell) before falling back
 * to the same row-major empty-cell scan invCanPlaceSI/invCanPlacePO use
 * (via tmCanPlace, which already implements that exact 1x1/BP-overlap/
 * occupancy rule -- see commit (b)).
 */
function firstFitOrMergeTM(
  engine: EngineInstance,
  state: GameState,
  uid: string,
  itemId: string,
  qty: number,
  openPage: number,
  pageCount: number
): PlacementResult | null {
  const pageOrder = [openPage, ...Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== openPage)];
  for (const pg of pageOrder) {
    const container = state.inv!.pages[pg];
    // Existing-stack merge check: any same-id stack on this page is a
    // legal merge target from its OWN cell (tmCanPlace's mergeInto path).
    const existingStack = container.tms.find((t) => t.id === itemId);
    if (existingStack) {
      const chk = engine.tmMove(state, pg, uid, existingStack.cell, itemId, qty);
      if (chk.ok) return { page: pg, cell: existingStack.cell };
    }
    // No mergeable stack on this page -- first-fit a NEW stack via the
    // same row-major scan firstFitPlace's po/si branches use, just
    // against tmCanPlace/tmMove.
    let found: [number, number] | null = null;
    for (let r = GRID_MIN; r <= GRID_MAX && !found; r++) {
      for (let c = GRID_MIN; c <= GRID_MAX && !found; c++) {
        const chk = engine.tmCanPlace(state, pg, uid, [r, c]);
        if (chk.ok) found = [r, c];
      }
    }
    if (found) {
      const mv = engine.tmMove(state, pg, uid, found, itemId, qty);
      if (mv.ok) return { page: pg, cell: found };
    }
  }
  return null;
}

/** Client-side first-fit placement for a claimed item -- mirrors the
 * OLD server-side claimWarehouseItem's own scan bounds/order exactly
 * (open page's own bounded 1..8 x 1..8 cell scan, matching
 * mock-src/engine.js's PAGE layout), just relocated to run against the
 * LIVE engine/state instance instead of a server-side profileCanvas
 * copy -- per REQ-0041's two-phase design, this placement now happens
 * HERE, not on the server. Tries `openPage` first, then every other
 * page in ascending index order (0..PAGE_COUNT-1, skipping `openPage`
 * since it was already tried) -- matches the REQ's own spec ("try the
 * CURRENTLY OPEN/ACTIVE inventory page first... if nothing fits, scan
 * the OTHER pages in page order").
 */
function firstFitPlace(
  engine: NonNullable<ReturnType<typeof useGameStore>['engine']>,
  state: NonNullable<ReturnType<typeof useGameStore>['state']>,
  kind: 'po' | 'si',
  uid: string,
  itemId: string,
  openPage: number,
  pageCount: number
): PlacementResult | null {
  const pageOrder = [openPage, ...Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== openPage)];
  for (const pg of pageOrder) {
    if (kind === 'po') {
      // invCanPlacePO needs the PO record to already exist in the page
      // (it looks up the record by uid for its shape/rot) -- push a
      // placeholder record first, same push-check-rollback pattern the
      // OLD server-side claimWarehouseItem used.
      const container = state.inv!.pages[pg];
      container.pos.push({ uid, id: itemId, loc: 'grid', cell: [1, 1], rot: 0 });
      let found: [number, number] | null = null;
      for (let r = GRID_MIN; r <= GRID_MAX && !found; r++) {
        for (let c = GRID_MIN; c <= GRID_MAX && !found; c++) {
          const chk = engine.invCanPlacePO(state, pg, uid, 0, [r, c]);
          if (chk.ok) found = [r, c];
        }
      }
      if (found) {
        engine.invMovePO(state, pg, uid, found);
        return { page: pg, cell: found };
      }
      container.pos.pop(); // no room on this page -- roll back, try next
    } else {
      // SI: invCanPlaceSI does not require a pre-existing record -- push
      // only once a legal cell is actually found, mirroring invMoveSI's
      // own contract (the record must exist before invMoveSI can update
      // its host, so it is created first with a placeholder host, same
      // idea as the PO branch, then moved into its real cell).
      const container = state.inv!.pages[pg];
      container.sis.push({ uid, id: itemId, host: 'inv' });
      let found: [number, number] | null = null;
      for (let r = GRID_MIN; r <= GRID_MAX && !found; r++) {
        for (let c = GRID_MIN; c <= GRID_MAX && !found; c++) {
          const chk = engine.invCanPlaceSI(state, pg, uid, [r, c], [uid]);
          if (chk.ok) found = [r, c];
        }
      }
      if (found) {
        engine.invMoveSI(state, pg, uid, found);
        return { page: pg, cell: found };
      }
      container.sis.pop(); // no room on this page -- roll back, try next
    }
  }
  return null;
}

/** Briefly applies the tab-claim-pulse CSS class (see index.css) to the
 * inv-tab button at `pageIndex`, found via LongPressTabs.tsx's
 * data-tab-index attribute -- a plain DOM query rather than plumbing a
 * "pulsing page index" prop through Tabs.tsx/LongPressTabs.tsx (both
 * shared with the preset-tabs use of the same component), matching this
 * REQ's overall preference for additive, minimally-invasive hooks. */
function pulseTab(pageIndex: number): void {
  const el = document.querySelector<HTMLElement>(`[data-tab-kind="inv"][data-tab-index="${pageIndex}"]`);
  if (!el) return;
  el.classList.remove('tab-claim-pulse');
  // Force a reflow so re-adding the class restarts the animation even if
  // a previous pulse on the SAME tab hasn't finished clearing yet.
  void el.offsetWidth;
  el.classList.add('tab-claim-pulse');
  setTimeout(() => el.classList.remove('tab-claim-pulse'), TAB_PULSE_MS);
}

export function WarehouseTab({ locale }: WarehouseTabProps) {
  const snapshot = useGameStore();
  const [items, setItems] = useState<ApiWarehouseItem[] | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claimingUid, setClaimingUid] = useState<string | null>(null);
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const slotRef = useRef<HTMLDivElement | null>(null);

  // REQ-0041: claim this DOM node as the inventory column's portal
  // target for as long as this tab is mounted (see board/inventorySlot.ts
  // for the full mechanism) -- releases it (back to null, i.e. "render
  // in the normal Backpacks-page spot") on unmount, matching this app's
  // existing "never leave a stale registration behind" discipline (same
  // shape as drag.ts's registerBoard cleanup, store.ts's subscribe
  // cleanup, etc).
  useEffect(() => {
    setInventorySlot(slotRef.current);
    return () => setInventorySlot(null);
  }, []);

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
      // Phase 1: server marks the row 'claiming' and hands back the
      // content def id -- see server/schedule.cjs's claimWarehouseItem
      // doc for the full two-phase design/bug-#3 rationale.
      const claimed = await apiClaimWarehouseItem(itemUid);

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
      const kind = claimed.kind === 'tm' ? 'tm' : itemKindOf(content, claimed.itemId);
      const openPage = snapshot.activeInvPage;
      const placed = kind === 'tm'
        ? firstFitOrMergeTM(engine, state, claimed.itemUid, claimed.itemId, claimed.qty ?? 1, openPage, engine.PAGE_COUNT)
        : firstFitPlace(engine, state, kind, claimed.itemUid, claimed.itemId, openPage, engine.PAGE_COUNT);

      if (!placed) {
        // No space anywhere -- per the REQ's own accepted design, leave
        // the row 'claiming' server-side; it lazily reverts to
        // 'claimable' after the server's own timeout (no explicit
        // "abandon claim" round-trip needed -- see this file's module
        // comment). Surface a toast so the user isn't left guessing.
        setToast(t(locale, 'schedule.warehouse.claimNoSpace'));
        setClaimErrors((prev) => ({ ...prev, [itemUid]: t(locale, 'schedule.warehouse.claimNoSpace') }));
        return;
      }

      // Placement-cell pulse ("ピコンピコン") on whichever board actually
      // received it -- reuses BoardRenderer's existing flash-overlay
      // mechanism (pulseCellsSuccess), via the singleton InventoryBoard
      // renderer this tab's embedded board IS (see board/
      // inventoryRenderer.ts's doc for why a module-level accessor is
      // the seam here, per the REQ-0041 Pixi-instance reuse decision).
      const renderer = getInventoryRenderer();
      const cells = kind === 'po' ? engine.cellsOfIn(state.inv.pages[placed.page].pos.find((p) => p.uid === claimed.itemUid)!) : [placed.cell];
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

      {/* REQ-0041: the Warehouse tab's embedded inventory board -- this
          div is the PORTAL TARGET App.tsx's InventoryColumn (Tabs +
          InventoryBoard) renders into while this tab is mounted (see
          board/inventorySlot.ts's module comment for the full
          reuse-via-portal decision). Fully operable with EXACTLY the
          same behavior as the Backpacks page's own inventory panel, by
          construction (it IS the same component instance/Pixi
          Application, not a reimplementation). */}
      <div className="schedule-warehouse-board-slot" ref={slotRef} data-testid="schedule-warehouse-board-slot" />
    </div>
  );
}
