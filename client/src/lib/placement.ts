// client/src/lib/placement.ts -- REQ-0145b (cb): canonical home of the
// client-side first-fit placement helpers previously living as
// page-local copies (firstFitPlace + firstFitOrMergeTM in warehouse/
// WarehousePage.tsx, firstFitPlaceBp in schedule/WorkshopPage.tsx).
//
// GATHER-THEN-UNIFY VERDICT (REQ-0145b (cb), recorded per spec): the
// three functions were co-located verbatim and diffed. They are NOT
// semantically identical -- each drives a different engine placement
// API against a different record shape (firstFitPlace:
// invCanPlacePO/invMovePO + invCanPlaceSI/invMoveSI with push-check-
// rollback placeholders; firstFitPlaceBp: invCanPlaceBP/invMoveBP with a
// BP placeholder needing shape/unit/hpMax; firstFitOrMergeTM:
// tmCanPlace/tmMove with an existing-stack merge fast path that has no
// analogue in the other two). They therefore STAY as documented named
// variants sharing only the page-order convention and the grid bounds
// below. Do not force-merge them.
import type { ApiRolledBp } from '../api';
import type { EngineInstance, GameState } from '../engine/engine.d.ts';

export const GRID_MIN = 1;
export const GRID_MAX = 8; // matches every inventory page's fixed 8x8 layout (same bound the old server-side first-fit used)

export interface PlacementResult {
  page: number;
  cell: [number, number];
}

export interface BpPlacementResult {
  page: number;
  origin: [number, number];
}

/** The shared "try the currently open page first, then every other page
 * in ascending index order" walk all three first-fit variants use. */
function pageOrderFrom(openPage: number, pageCount: number): number[] {
  return [openPage, ...Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== openPage)];
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
 * occupancy rule).
 */
export function firstFitOrMergeTM(
  engine: EngineInstance,
  state: GameState,
  uid: string,
  itemId: string,
  qty: number,
  openPage: number,
  pageCount: number
): PlacementResult | null {
  const pageOrder = pageOrderFrom(openPage, pageCount);
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
 * copy -- per REQ-0041's two-phase design, this placement happens on
 * the CLIENT, not on the server. Tries `openPage` first, then every
 * other page in ascending index order (0..PAGE_COUNT-1, skipping
 * `openPage` since it was already tried) -- matches the REQ's own spec
 * ("try the CURRENTLY OPEN/ACTIVE inventory page first... if nothing
 * fits, scan the OTHER pages in page order").
 */
export function firstFitPlace(
  engine: EngineInstance,
  state: GameState,
  kind: 'po' | 'si',
  uid: string,
  itemId: string,
  openPage: number,
  pageCount: number
): PlacementResult | null {
  const pageOrder = pageOrderFrom(openPage, pageCount);
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

/** First-fit placement for a freshly-rolled BP -- same push-check-
 * rollback pattern as firstFitPlace's 'po' branch, just against
 * engine.invCanPlaceBP/invMoveBP instead of invCanPlacePO/invMovePO (a
 * BP record, unlike a PO, needs shape/unit/hpMax on the placeholder, not
 * just id/loc/cell/rot). Tries `openPage` first, then every other page
 * in ascending order -- same page-order convention as the other two
 * variants above. */
export function firstFitPlaceBp(
  engine: EngineInstance,
  state: GameState,
  rolled: ApiRolledBp,
  openPage: number,
  pageCount: number
): BpPlacementResult | null {
  const pageOrder = pageOrderFrom(openPage, pageCount);
  for (const pg of pageOrder) {
    const container = state.inv!.pages[pg];
    container.bps.push({
      id: rolled.uid,
      // REQ-0170: the BP is named after the Unit it carries -- because that is what
      // the player just obtained. The BP is the inventory; the Unit is the character.
      name: rolled.unitDef?.name ?? 'BP',
      color: '#8a8a8a',
      shape: rolled.shape,
      // REQ-0273 (bug 2): OFF-GRID sentinel, was [1,1]. invCanPlaceBP never
      // reads the placeholder's own origin (it tests candidate cells built
      // from shape + the candidate origin), but invMoveBP infers the BP's
      // travelling contents GEOMETRICALLY from its CURRENT footprint -- and a
      // placeholder parked at [1,1] captured any unrelated free PO that
      // happened to sit inside that fake footprint, excluded it from the
      // legality check as "contents", and teleported it into the newly
      // placed BP -- landing it exactly on the unit cell whenever its offset
      // from [1,1] equalled unit.off (the one cell invOccupancy does not
      // cover). Off-grid, the inference can capture nothing. Pinned by
      // client/scripts/check_placement.mjs against the real engine.
      origin: [-100, -100],
      unit: rolled.unit,
      hpMax: rolled.hpMax,
    });
    let found: [number, number] | null = null;
    for (let r = GRID_MIN; r <= GRID_MAX && !found; r++) {
      for (let c = GRID_MIN; c <= GRID_MAX && !found; c++) {
        const chk = engine.invCanPlaceBP(state, pg, rolled.uid, [r, c]);
        if (chk.ok) found = [r, c];
      }
    }
    if (found) {
      engine.invMoveBP(state, pg, rolled.uid, found);
      return { page: pg, origin: found };
    }
    container.bps.pop(); // no room on this page -- roll back, try next
  }
  return null;
}
