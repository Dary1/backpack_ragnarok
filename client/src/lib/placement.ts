// client/src/lib/placement.ts -- REQ-0145b (cb): canonical home of the
// client-side placement helpers previously living as page-local copies
// (firstFitPlace + firstFitOrMergeTM in warehouse/WarehousePage.tsx,
// firstFitPlaceBp in schedule/WorkshopPage.tsx).
//
// GATHER-THEN-UNIFY VERDICT (REQ-0145b (cb), recorded per spec, STILL BINDING):
// the three variants were co-located verbatim and diffed. They are NOT
// semantically identical -- each drives a different engine placement API against
// a different record shape (PO: invCanPlacePO/invMovePO with a push-check-
// rollback placeholder; BP: invCanPlaceBP/invMoveBP with a placeholder needing
// shape/unit/hpMax; TM: tmCanPlace/tmMove with an existing-stack merge fast path
// that has no analogue in the other two). They therefore STAY as documented named
// variants sharing only the page-order convention and the grid bounds below.
// Do not force-merge them.
//
// REQ-0215 SPLIT: each variant is now a PURE `findFit*` (search, no mutation) plus
// a `place*At` (mutate at ONE already-chosen spot). The old combined firstFit*
// helpers -- which searched and placed in a single inseparable step -- cannot
// express the claim protocol the user specified:
//
//   client searches -> server validates THAT ONE SPOT -> client places
//
// The search must complete and be reportable BEFORE the server round-trip (a "no
// gap" verdict is now an error raised without ever calling the server), and the
// placement must happen AFTER, at exactly the spot the server ratified. Searching
// and placing in one call would place the item before the server had a say, so a
// rejection would need an un-place -- and un-placing a MERGED TM is not
// expressible (tmMove's merge dissolves the source stack; see engine.js's TM
// model comment on uid survivorship). Splitting is what makes rollback
// unnecessary rather than merely inconvenient.
//
// The find*/place*At pairs are deliberately callable back-to-back with no
// validation between them -- that composition IS the old firstFit* behaviour,
// and is what the local-only paths (e.g. a dev grant) would use.
import type { ApiRolledBp } from '../api';
import type { EngineInstance, GameState } from '../engine/engine.d.ts';

export const GRID_MIN = 1;
export const GRID_MAX = 8; // matches every inventory page's fixed 8x8 layout (same bound the old server-side first-fit used)

/** REQ-0215: one placement spot, in the wire shape POST /api/warehouse/claim
 * takes and server/services/warehouse.cjs's claimSpotOr409 validates.
 * `position` is the anchor in each engine call's OWN convention: an anchor cell
 * for PO/SI/TM, the ORIGIN for a BP. One [row, col] pair covers all four kinds,
 * which is why the wire needs no per-kind shape. */
export interface FitSpot {
  page: number;
  position: [number, number];
}

/** The shared "try the currently open page first, then every other page
 * in ascending index order" walk all three variants use. */
function pageOrderFrom(openPage: number, pageCount: number): number[] {
  return [openPage, ...Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== openPage)];
}

/** The shared row-major 1..8 x 1..8 cell scan. Returns the first cell `ok`
 * accepts, or null. Bounds match mock-src/engine.js's PAGE layout (the same
 * bounds the pre-REQ-0041 server-side first-fit used). */
function scanCells(ok: (at: [number, number]) => boolean): [number, number] | null {
  for (let r = GRID_MIN; r <= GRID_MAX; r++) {
    for (let c = GRID_MIN; c <= GRID_MAX; c++) {
      if (ok([r, c])) return [r, c];
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// TM (REQ-0042) -- merge-or-place. Claiming a TM row (e.g. an LRDST
// reward/grant) merges into an EXISTING matching-id stack if one exists on the
// page, otherwise creates a new stack, reusing engine.js's tmCanPlace/tmMove
// (the SAME merge-on-same-id-drop logic the engine's own drag-and-drop TM
// handling uses -- see its TM model comment for the merge/uid-survivor design).
// ---------------------------------------------------------------------

/** PURE search. Walks each page's EXISTING same-id stacks first (an O(stacks)
 * check -- a same-id stack is a legal merge target from its OWN cell), then
 * falls back to a row-major empty-cell scan.
 *
 * The two probes pass tmCanPlace DIFFERENT arguments, deliberately, per its own
 * doc: the merge probe passes `idIfNew` (this uid has no stack yet, so tmCanPlace
 * cannot otherwise know what id it would merge AS, and without it a same-id stack
 * reads as a plain 'occupied' rejection); the free-cell scan OMITS it, because it
 * wants a real 'occupied' rejection on any occupied cell -- it is hunting for a
 * genuinely empty cell, not a second merge path. */
export function findFitOrMergeTM(
  engine: EngineInstance,
  state: GameState,
  uid: string,
  itemId: string,
  openPage: number,
  pageCount: number
): FitSpot | null {
  for (const pg of pageOrderFrom(openPage, pageCount)) {
    const container = state.inv!.pages[pg];
    const existingStack = container.tms.find((t) => t.id === itemId);
    if (existingStack) {
      const chk = engine.tmCanPlace(state, pg, uid, existingStack.cell, [uid], itemId);
      if (chk.ok) return { page: pg, position: existingStack.cell };
    }
    const found = scanCells((at) => engine.tmCanPlace(state, pg, uid, at).ok);
    if (found) return { page: pg, position: found };
  }
  return null;
}

/** Places (or merges) the stack at `spot`. tmMove handles BOTH cases -- landing
 * on a same-id stack merges, an empty cell creates -- so this one call covers
 * whichever branch findFitOrMergeTM matched. */
export function placeTMAt(
  engine: EngineInstance,
  state: GameState,
  uid: string,
  itemId: string,
  qty: number,
  spot: FitSpot
): boolean {
  return engine.tmMove(state, spot.page, uid, spot.position, itemId, qty).ok;
}

// ---------------------------------------------------------------------
// PO / SI. invCanPlacePO needs the PO record to already exist in the page (it
// looks the record up by uid for its shape/rot), so both search and place push a
// placeholder first -- the same push-check-rollback pattern the old server-side
// claimWarehouseItem used. The SEARCH always pops it back off: it is pure.
// ---------------------------------------------------------------------

/** PURE search for a PO. */
export function findFitPO(
  engine: EngineInstance,
  state: GameState,
  uid: string,
  itemId: string,
  openPage: number,
  pageCount: number
): FitSpot | null {
  for (const pg of pageOrderFrom(openPage, pageCount)) {
    const container = state.inv!.pages[pg];
    container.pos.push({ uid, id: itemId, loc: 'grid', cell: [1, 1], rot: 0 });
    const found = scanCells((at) => engine.invCanPlacePO(state, pg, uid, 0, at).ok);
    container.pos.pop(); // ALWAYS -- this function must not leave a trace
    if (found) return { page: pg, position: found };
  }
  return null;
}

/** PURE search for an SI. invCanPlaceSI does not require a pre-existing record,
 * but invMoveSI does (it updates the record's host), so the placeholder pattern
 * is kept symmetrical with the PO branch. */
export function findFitSI(
  engine: EngineInstance,
  state: GameState,
  uid: string,
  itemId: string,
  openPage: number,
  pageCount: number
): FitSpot | null {
  for (const pg of pageOrderFrom(openPage, pageCount)) {
    const container = state.inv!.pages[pg];
    container.sis.push({ uid, id: itemId, host: 'inv' });
    const found = scanCells((at) => engine.invCanPlaceSI(state, pg, uid, at, [uid]).ok);
    container.sis.pop(); // ALWAYS -- pure
    if (found) return { page: pg, position: found };
  }
  return null;
}

/** Places a PO or SI at `spot`. Rolls the placeholder back if the engine refuses,
 * so a rejected place leaves the state exactly as it found it. */
export function placeAt(
  engine: EngineInstance,
  state: GameState,
  kind: 'po' | 'si',
  uid: string,
  itemId: string,
  spot: FitSpot
): boolean {
  const container = state.inv!.pages[spot.page];
  if (kind === 'po') {
    container.pos.push({ uid, id: itemId, loc: 'grid', cell: [1, 1], rot: 0 });
    if (engine.invMovePO(state, spot.page, uid, spot.position).ok) return true;
    container.pos.pop();
    return false;
  }
  container.sis.push({ uid, id: itemId, host: 'inv' });
  if (engine.invMoveSI(state, spot.page, uid, spot.position).ok) return true;
  container.sis.pop();
  return false;
}

// ---------------------------------------------------------------------
// BP. Same push-check-rollback shape as the PO branch, against
// invCanPlaceBP/invMoveBP -- a BP placeholder, unlike a PO's, needs
// shape/unit/hpMax rather than just id/loc/cell/rot.
// ---------------------------------------------------------------------

/** The BP placeholder record both the search and the place need. REQ-0170: the BP
 * is named after the Unit it carries -- that is what the player obtained; the BP
 * is the inventory, the Unit is the character. */
function bpPlaceholder(rolled: ApiRolledBp, origin: [number, number]) {
  return {
    id: rolled.uid,
    name: rolled.unitDef?.name ?? 'BP',
    color: '#8a8a8a',
    shape: rolled.shape,
    origin,
    unit: rolled.unit,
    hpMax: rolled.hpMax,
  };
}

/** PURE search for a BP. */
export function findFitBP(
  engine: EngineInstance,
  state: GameState,
  rolled: ApiRolledBp,
  openPage: number,
  pageCount: number
): FitSpot | null {
  for (const pg of pageOrderFrom(openPage, pageCount)) {
    const container = state.inv!.pages[pg];
    container.bps.push(bpPlaceholder(rolled, [1, 1]));
    const found = scanCells((at) => engine.invCanPlaceBP(state, pg, rolled.uid, at).ok);
    container.bps.pop(); // ALWAYS -- pure
    if (found) return { page: pg, position: found };
  }
  return null;
}

/** Places a BP at `spot`, rolling the placeholder back on refusal. */
export function placeBPAt(
  engine: EngineInstance,
  state: GameState,
  rolled: ApiRolledBp,
  spot: FitSpot
): boolean {
  const container = state.inv!.pages[spot.page];
  container.bps.push(bpPlaceholder(rolled, [1, 1]));
  if (engine.invMoveBP(state, spot.page, rolled.uid, spot.position).ok) return true;
  container.bps.pop();
  return false;
}
