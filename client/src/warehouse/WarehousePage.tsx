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
//
// REQ-0072 (MJOLNIR re-skin; mock: web/redesign/warehouse.html):
// presentation-only rewrite of the render tree -- the claim machinery
// above (two-phase claim, engine first-fit, pulse/tab-pulse, auto-save
// finalization, poll cadence, claim-all walk order) is UNCHANGED, and
// so is every E2E-load-bearing selector (schedule-warehouse-row /
// schedule-claim-btn-<uid> / schedule-warehouse-toast /
// schedule-claim-all-btn / schedule-warehouse-capacity-* /
// .schedule-slot-error / schedule-warehouse-board-slot). New chrome:
// ornate capacity topstrip (gold bar + staged warning kept), a
// DECAYING SOON section for rows within 48h of expiry, the stone-shelf
// card grid (rarity-framed .wcard anatomy with per-row Joermungandr TTL
// ring + provenance chip + NEW badge), kind-based filter chips, and the
// footer lore. Rows are ordered soonest-to-expire within BOTH sections
// (the REQ-0046 sort, unchanged in spirit -- the danger split is that
// same ordering made spatial). What the mock shows with no backing
// data (weapon/frost/ember filters, seller names, boss provenance,
// non-decaying currency) is inferred or omitted per
// docs/REQ-0072-redesign-warehouse.md.
//
// REQ-0086 (promoted to an independent top-level route): this file is a
// direct extraction of the former client/src/schedule/WarehouseTab.tsx
// (embedded as the #/schedule page's WAREHOUSE tab) into its own
// `#/warehouse` route + Nav.tsx rail entry. Extraction only -- every
// mechanism described above (two-phase claim, embedded InventoryBoard
// portal, capacity/danger/shelf/filter/TTL-ring presentation, every
// E2E-load-bearing selector) is UNCHANGED. What changed structurally:
// this component now owns its own permanent pagehead/key-art/rune-
// divider (previously SchedulePage swapped that chrome's identity
// between Rooms and Warehouse depending on which tab was active -- see
// SchedulePage.tsx, which keeps only the Rooms/Expedition identity now)
// and fetches its own one-shot rooms/dungeons copy for the provenance
// chip (previously passed down as props from SchedulePage, which no
// longer renders this component at all).
//
// This supersedes REQ-0036's original golden-f placement decision
// ("Warehouse -> inventory transfer any time (Warehouse tab inside
// Schedule screen)") per a direct 2026-07-07 user instruction (recorded
// as REQ-0086 on the docs FS, since docs/REQ lives there, not in this
// repo -- see PROJECT.md). The mock (web/redesign/*.html) always showed
// 倉庫 as its own rail entry across every page's nav, including its own
// dedicated warehouse.html document; REQ-0069 found this and explicitly
// deferred adding it ("the warehouse lives as a Schedule tab today").
// REQ-0086 lands that deferred entry.
//
// REQ-0091 (claim button press feedback + double-press guard, direct
// user instruction via https://backpack-dev.qtie.jp/app/#/warehouse):
// additive only, no change to the two-phase claim machinery itself.
// Pressing a row's claim button now flashes that row's OWN frame (CSS
// schedule-claim-flash, index.css) + plays a short synthesized chime
// (warehouse/claimSfx.ts) immediately; the moment the claim POST's
// response is known (success or error), the flash hands off to a
// one-shot fade-out (schedule-claim-fadeout) and is removed from the DOM
// once that finishes. A ref-based guard (claimLockRef) closes the same-
// row double-press race the existing disabled={isClaiming} attribute
// alone cannot (state updates are batched/async; the ref mutates
// immediately). New hooks only -- no selector in the contract above was
// renamed or removed.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimWarehouseItem as apiClaimWarehouseItem,
  fetchContent,
  fetchDungeons,
  fetchRooms,
  fetchWarehouse,
  type ApiContentPayload,
  type ApiDungeonsPayload,
  type ApiRoom,
  type ApiWarehouseItem,
} from '../api';
import { getInventoryRenderer } from '../board/inventoryRenderer';
import { setInventorySlot } from '../board/inventorySlot';
import { iconDataUrl } from '../dex/dexIcons';
import { rarThemeClass } from '../render/uiBits';
import type { EngineInstance, GameState } from '../engine/engine.d.ts';
import { friendlyScheduleError, isApiErrorStatus } from '../schedule/errors';
import { localizedName } from '../schedule/CreateRoomForm';
import { formatCountdown } from '../schedule/RoomCard';
import { t } from '../i18n';
import { notifyStateChanged, useGameStore, type Locale } from '../store';
import { playClaimChime } from './claimSfx';

interface WarehousePageProps {
  locale: Locale;
}

/** REQ-0072: market-settled rows (buyer delivery / seller TM proceeds --
 * server/services/market.cjs's settle step) carry a `sourceListingId`
 * the schedule-era ApiWarehouseItem predates. Typed as a client-local
 * extension rather than an edit to shared/dto.ts: the market lane owns
 * that file's market section and this avoids a parallel-lane conflict
 * over one optional field (see docs/REQ-0072-redesign-warehouse.md). */
type WarehouseRow = ApiWarehouseItem & { sourceListingId?: string | null };

const WAREHOUSE_CAP = 200; // mirrors server/schedule.cjs's WAREHOUSE_CAP (display only)
const POLL_MS = 5000;
const GRID_MIN = 1;
const GRID_MAX = 8; // matches every inventory page's fixed 8x8 layout (same bound the old server-side first-fit used)
const TAB_PULSE_MS = 1600; // >= the 3-cycle CSS animation's own 0.5s*3 duration, plus margin
// REQ-0091: how long the claim-press flash's fade-out (CSS
// schedule-warehouse-claim-fadeout, 0.4s) is allowed to play before its
// class is removed from the DOM -- same "duration + margin" convention
// as TAB_PULSE_MS above.
const FLASH_FADEOUT_MS = 450;
// REQ-0072: rows closer than this to expiry move into the mock's
// DECAYING SOON section (its example rows read 期限 2日 / 期限 1日) and
// wear the red TTL treatment. Supersedes the old 24h "warm label"
// threshold -- same idea, made a section instead of a tint.
const DECAY_SOON_MS = 2 * 86400000;
// REQ-0072: the mock's NEW badge / 新着 count. No "seen" tracking exists
// anywhere in the data model, so "new" is honestly derived from the
// row's own harvestedAt: delivered within the last 24h (one Muninn
// night, matching the mock's 「今夜搬入」 framing).
const FRESH_MS = 86400000;

function localizedItemName(locale: Locale, content: ApiContentPayload | null, itemId: string): string {
  // REQ-0072: TM ids (kind:'tm' rows, e.g. LRDST) live in content.tms,
  // which this lookup used to miss entirely -- a TM row rendered as its
  // raw id. Checked last, same order contentEntryFor uses.
  const entry = content?.items[itemId] ?? content?.sis[itemId] ?? content?.tms[itemId];
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

/** Resolves the content entry (for its rarity + icon) for a warehouse
 * row of a given kind. TM stacks live in content.tms; plain PO/SI items
 * live in content.items/content.sis (checked in that order, mirroring
 * localizedItemName/itemKindOf above). Returns null when content hasn't
 * loaded yet or the id resolves against no map (defensive -- the row
 * simply renders without an icon/rarity in that case). */
function contentEntryFor(content: ApiContentPayload | null, kind: 'po' | 'si' | 'tm', itemId: string): { rarity: string; icon: string } | null {
  if (!content) return null;
  if (kind === 'tm') return content.tms[itemId] ?? null;
  return content.items[itemId] ?? content.sis[itemId] ?? null;
}

/* REQ-0075: rarThemeClass (app ramp -> theme .rar-* frame) moved to
   client/src/render/uiBits.ts so the Dex port reuses the SAME mapping
   instead of a second copy -- imported above. */

/** Day-aware countdown for the Warehouse's 7-day TTL. RoomCard's
 * formatCountdown is minute/second only (fine for a run's short
 * countdown), so a multi-day remaining duration would render as e.g.
 * "10080m 0s" -- a real display bug for this view. Tiers down to
 * days/hours/minutes and defers to formatCountdown for the final
 * sub-1-hour stretch (so the last hour still reads "12m 3s" exactly as
 * the rest of the app does). */
function formatWarehouseCountdown(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return formatCountdown(ms);
}

/** REQ-0072: the mock's Joermungandr TTL ring (mock .cring) -- an SVG
 * donut whose arc is the row's REMAINING share of its OWN lifetime
 * (expiresAt - harvestedAt), so the percentage stays honest even if the
 * server-side TTL constant ever changes: no 7-day literal is baked in
 * here. Geometry mirrors the mock exactly: pathLength=100 dasharray arc
 * from 12 o'clock, end-of-arc dot at (20 + 15·sin θ, 20 − 15·cos θ). */
function TtlRing({ pct, danger, label }: { pct: number; danger: boolean; label: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const theta = (clamped / 100) * 2 * Math.PI;
  const dotX = 20 + 15 * Math.sin(theta);
  const dotY = 20 - 15 * Math.cos(theta);
  const stroke = danger ? '#D14B44' : 'var(--gold-lo)';
  const dot = danger ? '#E06B5F' : 'var(--gold-hi)';
  return (
    <svg className="schedule-warehouse-ring" viewBox="0 0 40 40" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(233,227,211,.1)" strokeWidth="3" />
      <circle
        cx="20"
        cy="20"
        r="15"
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        pathLength={100}
        strokeDasharray={`${clamped} ${100 - clamped}`}
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
      />
      <circle cx={dotX} cy={dotY} r="2.6" fill={dot} />
      <text x="20" y="23.5" textAnchor="middle">
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

/** Outcome of a single-item claim, so Claim All can stop the moment the
 * board is genuinely full without guessing at React state timing. */
type ClaimOutcome = 'claimed' | 'no_space' | 'error';

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

type WarehouseFilter = 'all' | 'spoils' | 'currency';

export function WarehousePage({ locale }: WarehousePageProps) {
  const snapshot = useGameStore();
  const [items, setItems] = useState<WarehouseRow[] | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // REQ-0086: rooms/dungeons used to arrive as props from SchedulePage
  // (which already fetched/polled them for its own Rooms view). This is
  // now its own top-level route with no such parent, so it fetches its
  // own one-shot copy for the SAME purpose -- resolving a row's
  // sourceRoomId to a real dungeon display name for the provenance chip
  // (mock 「出所: ニヴルヘイム深淵」). No polling: a warehouse row's
  // source room is already a settled/harvested-from room by the time it
  // shows up here, so staleness risk is negligible (unlike the Rooms
  // view's own live status/cooldown polling need).
  const [rooms, setRooms] = useState<ApiRoom[] | null>(null);
  const [dungeons, setDungeons] = useState<ApiDungeonsPayload | null>(null);
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
  const [now, setNow] = useState(() => Date.now());
  // REQ-0072: kind-based display filter (mock filter chips). The mock's
  // weapon/frost/ember chips have no backing taxonomy (see the notes
  // doc); `kind:'tm'` vs everything else is the one REAL category split
  // a row carries, so the honest chip set is all / spoils / currency.
  // Display-only: claim-all still walks the FULL list.
  const [filter, setFilter] = useState<WarehouseFilter>('all');
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

  // REQ-0086: one-shot rooms/dungeons fetch for the provenance chip (see
  // the state comment above) -- failures are non-fatal, same posture as
  // every other best-effort lookup on this page (the chip is simply
  // omitted for a row that cannot be resolved).
  useEffect(() => {
    let cancelled = false;
    fetchRooms()
      .then((res) => {
        if (!cancelled) setRooms(res.rooms);
      })
      .catch(() => {
        /* provenance chip degrades to omitted -- non-fatal */
      });
    fetchDungeons()
      .then((d) => {
        if (!cancelled) setDungeons(d);
      })
      .catch(() => {
        /* provenance chip degrades to omitted -- non-fatal */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
        return 'no_space';
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

  // REQ-0072: resolves the mock's provenance chip (「出所: …」) from the
  // ONLY origin data a row actually carries: sourceListingId (market
  // settlement -- gold-etched chip, mock REQ-0065 P1-5 treatment) or
  // sourceRoomId -> the player's own room -> its dungeon's display name.
  // Dev grants (both sources null) and unresolvable rooms yield null --
  // the chip is omitted rather than invented.
  const provenanceFor = (row: WarehouseRow): { market: boolean; name?: string } | null => {
    if (row.sourceListingId) return { market: true };
    if (row.sourceRoomId) {
      const room = rooms?.find((r) => r.id === row.sourceRoomId);
      const entry = room ? dungeons?.dungeons.find((d) => d.id === room.dungeonId) : undefined;
      if (entry) return { market: false, name: localizedName(locale, entry) };
    }
    return null;
  };

  // Render soonest-to-expire first (REQ-0046, unchanged). `items` itself
  // stays unchanged for length/cap math below.
  const sortedItems = items ? [...items].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt)) : null;

  // Staged capacity warning (REQ-0046, unchanged thresholds). server/
  // schedule.cjs's addToWarehouse SILENTLY DROPS new rewards once at
  // WAREHOUSE_CAP, so 'full' is a real data-loss state, not just a
  // styling threshold.
  const capRatio = (items?.length ?? 0) / WAREHOUSE_CAP;
  const capState: 'calm' | 'warning' | 'full' = capRatio >= 1 ? 'full' : capRatio >= 0.7 ? 'warning' : 'calm';

  // REQ-0072 derived presentation: danger split + shelf tallies. All
  // counts are computed from the UNFILTERED list (the filter chips only
  // narrow what is shown, never what is counted or claim-all-walked).
  const dangerCount = items ? items.filter((i) => Date.parse(i.expiresAt) - now < DECAY_SOON_MS).length : 0;
  const kindCount = items ? new Set(items.map((i) => i.itemId)).size : 0;
  const pieceCount = items ? items.reduce((sum, i) => sum + (i.qty ?? 1), 0) : 0;
  const freshCount = items ? items.filter((i) => now - Date.parse(i.harvestedAt) < FRESH_MS).length : 0;

  const matchesFilter = (row: WarehouseRow): boolean => {
    if (filter === 'all') return true;
    const isCurrency = row.kind === 'tm';
    return filter === 'currency' ? isCurrency : !isCurrency;
  };
  const visibleItems = sortedItems ? sortedItems.filter(matchesFilter) : null;
  const dangerRows = visibleItems ? visibleItems.filter((i) => Date.parse(i.expiresAt) - now < DECAY_SOON_MS) : [];
  const shelfRows = visibleItems ? visibleItems.filter((i) => Date.parse(i.expiresAt) - now >= DECAY_SOON_MS) : [];

  const capWord = t(locale, 'schedule.warehouse.capWord');

  const filterChip = (key: WarehouseFilter, label: string) => (
    <button
      type="button"
      className={`chip schedule-warehouse-filter-chip${filter === key ? ' is-on' : ''}`}
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      data-testid={`schedule-warehouse-filter-${key}`}
      key={key}
    >
      {label}
    </button>
  );

  // One warehouse card (mock .wcard): rarity frame + corner gem, 64px
  // thumb (with stack count), name/sub/provenance column, and the TTL
  // ring + claim button side rail. Shared verbatim by the DECAYING SOON
  // grid and the stone shelf -- only the container differs.
  const renderRow = (item: WarehouseRow) => {
    const expiresMs = Date.parse(item.expiresAt) - now;
    const lifetimeMs = Date.parse(item.expiresAt) - Date.parse(item.harvestedAt);
    const ttlPct = lifetimeMs > 0 ? (expiresMs / lifetimeMs) * 100 : 0;
    const expired = expiresMs <= 0;
    const danger = expiresMs < DECAY_SOON_MS; // includes expired
    const fresh = now - Date.parse(item.harvestedAt) < FRESH_MS;
    const rowKind = item.kind === 'tm' ? 'tm' : itemKindOf(content, item.itemId);
    const entry = contentEntryFor(content, rowKind, item.itemId);
    const icon = entry ? iconDataUrl(entry.icon) : null;
    const qty = item.qty ?? 1;
    const src = provenanceFor(item);
    const isClaiming = claimingUid === item.itemUid;
    // REQ-0091: press-feedback class on the row's OWN frame -- 'flash'
    // while the claim POST is in flight, 'fadeout' once the response is
    // back (see handleClaim/beginClaimFadeOut); absent otherwise.
    const fx = claimFx[item.itemUid];
    const fxClass = fx === 'flash' ? ' schedule-claim-flash' : fx === 'fadeout' ? ' schedule-claim-fadeout' : '';
    return (
      <article
        className={`schedule-warehouse-row rar ${rarThemeClass(entry?.rarity)}${danger ? ' is-danger' : ''}${rowKind === 'tm' ? ' schedule-warehouse-row-stack' : ''}${fxClass}`}
        key={item.itemUid}
        data-testid="schedule-warehouse-row"
        data-item-uid={item.itemUid}
        title={t(locale, 'schedule.warehouse.harvested', { time: new Date(item.harvestedAt).toLocaleString(locale) })}
      >
        {fresh ? (
          <span className="schedule-warehouse-badge-new den" data-testid="schedule-warehouse-badge-new">
            {t(locale, 'schedule.warehouse.badgeNew')}
          </span>
        ) : null}
        <span className="gem" aria-hidden="true" />
        <span className="schedule-warehouse-icon-frame">
          {icon ? <img src={icon} alt="" /> : null}
          {qty > 1 ? <span className="schedule-warehouse-qcnt tnum">&times;{qty}</span> : null}
        </span>
        <div className="schedule-warehouse-row-main">
          <div className="schedule-warehouse-item-name dj">{localizedItemName(locale, content, item.itemId)}</div>
          <div className="schedule-warehouse-row-sub">
            {entry ? <span className={`rar-word rarity r-${entry.rarity}`}>{entry.rarity}</span> : null}
            {rowKind === 'tm' ? <span className="kw-gold">{t(locale, 'schedule.warehouse.currencyWord')}</span> : null}
            <span className="tnum">&times;{qty}</span>
            <span className={`schedule-warehouse-item-expiry${danger ? ' schedule-warehouse-item-expiry-soon' : ''}`}>
              {expired
                ? t(locale, 'schedule.warehouse.expired')
                : t(locale, 'schedule.warehouse.expiresIn', { time: formatWarehouseCountdown(expiresMs) })}
            </span>
          </div>
          {src ? (
            <div className="schedule-warehouse-row-src">
              <span
                className={`chip schedule-warehouse-src${src.market ? ' schedule-warehouse-src-market' : ''}`}
                data-testid="schedule-warehouse-src"
              >
                {src.market ? t(locale, 'schedule.warehouse.srcMarket') : t(locale, 'schedule.warehouse.srcDungeon', { name: src.name ?? '' })}
              </span>
              {src.market ? <div className="schedule-warehouse-src-note t-micro">{t(locale, 'schedule.warehouse.srcMarketNote')}</div> : null}
            </div>
          ) : null}
          {claimErrors[item.itemUid] ? <div className="schedule-slot-error">{claimErrors[item.itemUid]}</div> : null}
        </div>
        <div className="schedule-warehouse-row-side">
          <TtlRing
            pct={ttlPct}
            danger={danger}
            label={t(locale, 'schedule.warehouse.ringTitle', { pct: Math.max(0, Math.round(ttlPct)) })}
          />
          <button
            type="button"
            className={`btn schedule-claim-btn${isClaiming ? ' placing' : ''}`}
            disabled={isClaiming}
            onClick={() => void handleClaim(item.itemUid)}
            data-testid={`schedule-claim-btn-${item.itemUid}`}
          >
            {isClaiming ? t(locale, 'schedule.warehouse.claiming') : t(locale, 'schedule.warehouse.claimButton')}
          </button>
        </div>
      </article>
    );
  };

  const pageSub = t(locale, 'schedule.warehouse.pageSub');
  const pageTitle = t(locale, 'schedule.warehouse.pageTitle');
  const pageLede = t(locale, 'schedule.warehouse.pageLede');

  return (
    <div className="schedule-page">
      {/* REQ-0086: full-viewport key art -- same served /redesign/assets
          convention as the Expedition page (REQ-0071/0072). This page
          always wears the warehouse identity now (no more swapping with
          a sibling Rooms tab -- see SchedulePage.tsx, which keeps its
          own permanent Expedition identity after this split). */}
      <div className="warehouse-bgart" aria-hidden="true" />

      <section className="schedule-pagehead">
        <div className="schedule-pagehead-main">
          {pageSub ? <div className="schedule-pagehead-kicker den">{pageSub}</div> : null}
          <h1 className="schedule-pagehead-title dj dj-wide">{pageTitle}</h1>
          <div className="schedule-pagehead-lede">{pageLede}</div>
        </div>
      </section>
      <div className="rune-divider schedule-pagehead-divider" aria-hidden="true">
        ᚷ
      </div>

      <div className="schedule-warehouse-tab">
      {/* mock .topstrip: capacity meter / near-expiry chip / filters /
          bulk claim. Same staged capacity semantics as before (REQ-0046)
          -- calm/warning/full classes and the warning-text testid are
          load-bearing names, kept verbatim. */}
      <section className="panel ornate schedule-warehouse-topstrip" data-testid="schedule-warehouse-topstrip">
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />
        <div className="schedule-warehouse-capblock">
          <div className="schedule-warehouse-caphead">
            <span className="schedule-warehouse-cap tnum" data-testid="schedule-warehouse-cap">
              {items?.length ?? 0}
              <span className="schedule-warehouse-cap-of">/{WAREHOUSE_CAP}</span>
            </span>
            {capWord ? <span className="dj schedule-warehouse-cap-word">{capWord}</span> : null}
            <span className="den schedule-warehouse-cap-den">{t(locale, 'schedule.warehouse.capDen')}</span>
          </div>
          <div
            className={`bar schedule-warehouse-capacity-bar schedule-warehouse-capacity-${capState}`}
            data-testid="schedule-warehouse-capacity-bar"
          >
            <div className="fill gold schedule-warehouse-capacity-fill" style={{ width: `${Math.min(100, capRatio * 100)}%` }} />
          </div>
        </div>
        {dangerCount > 0 ? (
          <span className="chip warn schedule-warehouse-warnchip" data-testid="schedule-warehouse-warnchip">
            ⚠ {t(locale, 'schedule.warehouse.expiryWarnChip', { count: dangerCount })}
          </span>
        ) : null}
        <div className="schedule-warehouse-filters" role="group">
          {filterChip('all', t(locale, 'schedule.warehouse.filterAll'))}
          {filterChip('spoils', t(locale, 'schedule.warehouse.filterSpoils'))}
          {filterChip('currency', t(locale, 'schedule.warehouse.filterCurrency'))}
        </div>
        <span className="schedule-warehouse-grow" />
        <button
          type="button"
          className="btn btn-forge schedule-claim-all-btn"
          onClick={() => void handleClaimAll()}
          disabled={claimingAll || !items || items.length === 0}
          data-testid="schedule-claim-all-btn"
        >
          <span className="rune" aria-hidden="true">
            ᚷ
          </span>{' '}
          {claimingAll ? t(locale, 'schedule.warehouse.claimingAll') : t(locale, 'schedule.warehouse.claimAllButton')}
        </button>
        {capState !== 'calm' ? (
          <div
            className={`schedule-warehouse-capacity-warning-text ${capState}`}
            data-testid="schedule-warehouse-capacity-warning"
          >
            {capState === 'full' ? t(locale, 'schedule.warehouse.capFull') : t(locale, 'schedule.warehouse.capWarning')}
          </div>
        ) : null}
        <div className="schedule-warehouse-strip-note t-micro">{t(locale, 'schedule.warehouse.stripNote')}</div>
      </section>

      {loadError ? <div className="schedule-error">{t(locale, 'schedule.warehouse.loadFailed')}{loadError}</div> : null}
      {toast ? <div className="schedule-toast" data-testid="schedule-warehouse-toast">{toast}</div> : null}

      {sortedItems === null ? (
        <div className="schedule-loading">{t(locale, 'schedule.loading')}</div>
      ) : sortedItems.length === 0 ? (
        <div className="schedule-empty">{t(locale, 'schedule.warehouse.empty')}</div>
      ) : (
        <>
          {/* mock DECAYING SOON strip: rows within 48h of expiry, pulled
              out ABOVE the shelf. Same soonest-first ordering. */}
          {dangerRows.length > 0 ? (
            <>
              <div
                className="schedule-warehouse-colhead schedule-warehouse-colhead-danger"
                data-testid="schedule-warehouse-danger-head"
              >
                <span className="schedule-warehouse-colhead-rn">⚠</span>
                <h3 className="dj">{t(locale, 'schedule.warehouse.dangerTitle')}</h3>
                <span className="den schedule-warehouse-colhead-den">{t(locale, 'schedule.warehouse.dangerDen')}</span>
                <span className="t-micro">{t(locale, 'schedule.warehouse.dangerNote')}</span>
              </div>
              <div className="schedule-warehouse-danger-grid" data-testid="schedule-warehouse-danger-grid">
                {dangerRows.map(renderRow)}
              </div>
            </>
          ) : null}

          {/* mock stone shelf (.shelf .mat-stone): the stored-spoils grid
              with the kinds/pieces/new tally in its colhead. */}
          <section className="panel ornate schedule-warehouse-shelf" data-testid="schedule-warehouse-shelf">
            <i className="k tl" />
            <i className="k tr" />
            <i className="k br" />
            <i className="k bl" />
            <div className="schedule-warehouse-colhead">
              <span className="schedule-warehouse-colhead-rn rune">ᚷ</span>
              <h3 className="dj">{t(locale, 'schedule.warehouse.shelfTitle')}</h3>
              <span className="den schedule-warehouse-colhead-den">{t(locale, 'schedule.warehouse.shelfDen')}</span>
              <span className="schedule-warehouse-colhead-grow" />
              <span className="t-micro tnum" data-testid="schedule-warehouse-shelf-count">
                {t(locale, 'schedule.warehouse.shelfCount', { kinds: kindCount, pieces: pieceCount })}
                {freshCount > 0 ? ` ・ ${t(locale, 'schedule.warehouse.shelfFresh', { fresh: freshCount })}` : ''}
              </span>
            </div>
            {shelfRows.length > 0 ? (
              <div className="schedule-warehouse-list">{shelfRows.map(renderRow)}</div>
            ) : (
              <div className="schedule-empty">
                {t(locale, dangerRows.length > 0 || filter !== 'all' ? 'schedule.warehouse.shelfFiltered' : 'schedule.warehouse.empty')}
              </div>
            )}
          </section>
        </>
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

      {/* mock .wfoot -- lore line + the first-fit explainer (which states
          REAL behavior: handleClaim's placement + no-space posture). */}
      <footer className="schedule-warehouse-foot">
        <div className="rune-divider" aria-hidden="true">
          ᛞ
        </div>
        <div className="schedule-warehouse-foot-lore">{t(locale, 'schedule.warehouse.footLore')}</div>
        <div className="t-micro">{t(locale, 'schedule.warehouse.footNote')}</div>
      </footer>
      </div>
    </div>
  );
}
