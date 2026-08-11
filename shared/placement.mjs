// shared/placement.mjs -- REQ-0310: the client-authoritative first-fit
// placement helpers, promoted from client/src/lib/placement.ts.
//
// Moved VERBATIM (REQ-0310 is an EXTRACTION -- the logic below is byte-for-byte
// the REQ-0145b (cb) original with its TypeScript annotations stripped; the
// typed surface now lives in placement.d.mts beside this file). ESM so Vite
// imports it unforked and node can `import()` it, dependency-free, engine
// passed in by the caller -- the same charter shared/forecast.mjs followed
// before REQ-0308 retired it.
//
// Per shared/README.md this module may NOT import from server/, sim/, client/
// or mock-src/. It imports nothing at all.
//
// ---------------------------------------------------------------------
// GATHER-THEN-UNIFY VERDICT (REQ-0145b (cb), preserved verbatim): the
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

export const GRID_MIN = 1;
export const GRID_MAX = 8; // matches every inventory page's fixed 8x8 layout (same bound the old server-side first-fit used)

/** The shared "try the currently open page first, then every other page
 * in ascending index order" walk all three first-fit variants use. */
export function pageOrderFrom(openPage, pageCount) {
  return [openPage, ...Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== openPage)];
}

/**
 * REQ-0042: claiming a TM warehouse row (kind:'tm', e.g. an LRDST
 * reward/grant) merges into an EXISTING matching-id inventory stack if
 * one exists ANYWHERE on `openPage`, otherwise first-fit-CREATES a new
 * stack -- reusing engine.js's tmMove/tmCanPlace (the SAME merge-on-
 * same-id-drop logic the engine's own drag-and-drop TM handling uses,
 * see shared/engine.js's TM model comment for the merge/uid-survivor
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
export function firstFitOrMergeTM(engine, state, uid, itemId, qty, openPage, pageCount) {
  const pageOrder = pageOrderFrom(openPage, pageCount);
  for (const pg of pageOrder) {
    const container = state.inv.pages[pg];
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
    let found = null;
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
 * shared/engine.js's PAGE layout), just relocated to run against the
 * LIVE engine/state instance instead of a server-side profileCanvas
 * copy -- per REQ-0041's two-phase design, this placement happens on
 * the CLIENT, not on the server. Tries `openPage` first, then every
 * other page in ascending index order (0..PAGE_COUNT-1, skipping
 * `openPage` since it was already tried) -- matches the REQ's own spec
 * ("try the CURRENTLY OPEN/ACTIVE inventory page first... if nothing
 * fits, scan the OTHER pages in page order").
 */
export function firstFitPlace(engine, state, kind, uid, itemId, openPage, pageCount) {
  const pageOrder = pageOrderFrom(openPage, pageCount);
  for (const pg of pageOrder) {
    if (kind === 'po') {
      // invCanPlacePO needs the PO record to already exist in the page
      // (it looks up the record by uid for its shape/rot) -- push a
      // placeholder record first, same push-check-rollback pattern the
      // OLD server-side claimWarehouseItem used.
      const container = state.inv.pages[pg];
      container.pos.push({ uid, id: itemId, loc: 'grid', cell: [1, 1], rot: 0 });
      let found = null;
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
      const container = state.inv.pages[pg];
      container.sis.push({ uid, id: itemId, host: 'inv' });
      let found = null;
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
export function firstFitPlaceBp(engine, state, rolled, openPage, pageCount) {
  const pageOrder = pageOrderFrom(openPage, pageCount);
  for (const pg of pageOrder) {
    const container = state.inv.pages[pg];
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
    let found = null;
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

// ---------------------------------------------------------------------
// REQ-0373: auto-arrange -- the fourth named variant.
//
// The three variants above answer "where does ONE new thing go?". This one
// answers "repack a WHOLE page". It shares no code with them (it drives all
// FOUR page kinds -- BP/PO/SI/TM -- rather than one), but it obeys the
// identical discipline: the row-major GRID_MIN..GRID_MAX scan, the engine's
// own legality call, then the engine's own mutator. Engine consumed AS-IS
// (design rule 1); nothing here re-implements a placement law.
//
// WHY LIFT-THEN-REPACK, NOT MOVE-IN-PLACE. Moving each item straight to a
// computed target deadlocks the moment two items want to swap: A sits on
// B's target and B on A's, every candidate move is illegal, and no ordering
// of legal moves escapes the cycle. So the page's movable records are first
// LIFTED out of the container arrays (immovables stay behind as real
// occupancy) and then re-seated one at a time, largest footprint first,
// into an engine-checked first fit. That is firstFitPlace's own push-check-
// rollback pattern applied to a whole page instead of a single claim -- no
// new engine concept, no cycle possible, every landing cell approved by the
// engine. Pinned by client/scripts/check_arrange.mjs.
//
// WHAT NEVER MOVES:
//  - A `fixed` PO (REQ-0051 starter-unit kit piece): engine.js's invMovePO
//    refuses it outright, so it IS the definition of "cannot legally move".
//    Left where it is; the repack treats it as occupancy.
//  - A PO sitting INSIDE a BP: it is cargo. It travels with its pack
//    (invMoveBP shifts contained POs by the same dr/dc, by design) and is
//    never re-seated alone -- arranging must not unpack a packed backpack.
//  - A socketed or stowed SI (host {po,si} / 'inv'): occupies no cell, so
//    there is nothing to arrange.
// A LOCKED BP DOES move: `locked` (REQ-0209) refuses new contents inside the
// pack, not relocation of the pack -- invCanPlaceBP/invMoveBP accept it, and
// moving a starter unit as ONE block preserves the build exactly.
//
// WHAT THE REPACK MAY NOT INVENT:
//  - A previously free PO may never land fully inside a BP (that would
//    silently load a pack). invCanPlaceCells reports containment as `bp` on
//    its result, so those candidate cells are skipped.
//  - Two same-id TM stacks are never merged, even though tmCanPlace would
//    call it legal: this is a relocation, not an economy change. Candidates
//    reporting `mergeInto` are skipped.
//
// ALL-OR-NOTHING. If any lifted record cannot be re-seated (reachable only
// if immovable occupancy fragments the page harder than the original layout
// did), every record is restored to its original slot IN ITS ORIGINAL ARRAY
// POSITION and the call reports moved:0 -- a half-arranged page is worse
// than an untidy one.

/** Bounding box + area of an absolute cell list. */
function extentOf(cells) {
  let minR = Infinity, minC = Infinity, maxR = -Infinity, maxC = -Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  return { area: cells.length, h: maxR - minR + 1, w: maxC - minC + 1 };
}

/** Seating order: biggest footprint first, ties broken by bounding box,
 * then kind, then uid. Every term is a pure function of the records
 * themselves, so the same page always yields the same layout -- that is
 * the REQ-0373 determinism gate, not an incidental property. */
const ARRANGE_KIND_RANK = { bp: 0, po: 1, si: 2, tm: 3 };
function compareArrangeEntities(a, b) {
  if (a.area !== b.area) return b.area - a.area;
  if (a.h !== b.h) return b.h - a.h;
  if (a.w !== b.w) return b.w - a.w;
  if (ARRANGE_KIND_RANK[a.kind] !== ARRANGE_KIND_RANK[b.kind]) return ARRANGE_KIND_RANK[a.kind] - ARRANGE_KIND_RANK[b.kind];
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

/** Off-grid parking origin for a lifted record while its scan runs -- the
 * REQ-0273 sentinel, reused for the same reason: at [-100,-100] a record
 * can neither be captured as another BP's contents nor collide with a real
 * cell, whatever the engine infers geometrically. */
const ARRANGE_PARK = [-100, -100];

/**
 * REQ-0373: repacks inventory page `pg` in place, largest footprint first,
 * as a sequence of engine-validated moves. Returns {moved,total} -- `total`
 * is how many entities the repack considered, `moved` how many actually
 * changed position (0 = already packed, or the repack rolled back). Mutates
 * `state` only through engine mutators plus the same container-array
 * push/splice firstFitPlace already uses.
 */
export function arrangePage(engine, state, pg) {
  const container = state && state.inv && state.inv.pages ? state.inv.pages[pg] : null;
  if (!container) return { moved: 0, total: 0 };
  if (!Array.isArray(container.tms)) container.tms = []; // pre-REQ-0042 page shape

  // ---- classify ------------------------------------------------------
  const cargoUids = new Set(); // POs riding inside a BP
  const contentsOf = new Map(); // bpId -> [{uid,dr,dc}]
  for (const bp of container.bps) {
    const inside = container.pos.filter((p) => engine.poInBPIn(p, bp));
    contentsOf.set(bp.id, inside.map((p) => ({ uid: p.uid, dr: p.cell[0] - bp.origin[0], dc: p.cell[1] - bp.origin[1] })));
    for (const p of inside) cargoUids.add(p.uid);
  }

  const entities = [];
  for (const bp of container.bps) entities.push({ kind: 'bp', uid: bp.id, ...extentOf(engine.bpCells(bp)), at: [bp.origin[0], bp.origin[1]] });
  for (const p of container.pos) {
    if (p.loc !== 'grid' || cargoUids.has(p.uid) || p.fixed) continue; // see WHAT NEVER MOVES
    entities.push({ kind: 'po', uid: p.uid, ...extentOf(engine.cellsOfIn(p)), at: [p.cell[0], p.cell[1]] });
  }
  for (const s of container.sis) {
    if (!s.host || typeof s.host !== 'object' || !('cell' in s.host)) continue; // socketed/stowed: no cell
    entities.push({ kind: 'si', uid: s.uid, area: 1, h: 1, w: 1, at: [s.host.cell[0], s.host.cell[1]] });
  }
  for (const tm of container.tms) entities.push({ kind: 'tm', uid: tm.uid, area: 1, h: 1, w: 1, at: [tm.cell[0], tm.cell[1]] });
  entities.sort(compareArrangeEntities);
  if (entities.length === 0) return { moved: 0, total: 0 };

  // Array order is restored verbatim on rollback (see ALL-OR-NOTHING).
  const order = { bps: container.bps.map((b) => b.id), pos: container.pos.map((p) => p.uid), sis: container.sis.map((s) => s.uid), tms: container.tms.map((t) => t.uid) };

  // ---- lift ----------------------------------------------------------
  const lifted = new Map(); // uid -> the DETACHED ORIGINAL record(s)
  for (const e of entities) {
    if (e.kind === 'bp') {
      const bp = container.bps.splice(container.bps.findIndex((b) => b.id === e.uid), 1)[0];
      const cargo = [];
      for (const c of contentsOf.get(e.uid) || []) {
        cargo.push({ po: container.pos.splice(container.pos.findIndex((p) => p.uid === c.uid), 1)[0], dr: c.dr, dc: c.dc });
      }
      lifted.set(e.uid, { bp, cargo });
    } else if (e.kind === 'po') {
      lifted.set(e.uid, { po: container.pos.splice(container.pos.findIndex((p) => p.uid === e.uid), 1)[0] });
    } else if (e.kind === 'si') {
      lifted.set(e.uid, { si: container.sis.splice(container.sis.findIndex((s) => s.uid === e.uid), 1)[0] });
    } else {
      lifted.set(e.uid, { tm: container.tms.splice(container.tms.findIndex((t) => t.uid === e.uid), 1)[0] });
    }
  }

  // ---- re-seat, largest first -----------------------------------------
  let seatedAll = true;
  for (const e of entities) {
    const rec = lifted.get(e.uid);
    let landed = null;
    if (e.kind === 'bp') {
      rec.bp.origin = [ARRANGE_PARK[0], ARRANGE_PARK[1]];
      container.bps.push(rec.bp);
      for (const c of rec.cargo) {
        c.po.cell = [ARRANGE_PARK[0] + c.dr, ARRANGE_PARK[1] + c.dc];
        container.pos.push(c.po);
      }
      const excl = rec.cargo.map((c) => c.po.uid);
      for (let r = GRID_MIN; r <= GRID_MAX && !landed; r++) {
        for (let c = GRID_MIN; c <= GRID_MAX && !landed; c++) {
          if (engine.invCanPlaceBP(state, pg, rec.bp.id, [r, c], excl).ok) landed = [r, c];
        }
      }
      if (landed && !engine.invMoveBP(state, pg, rec.bp.id, landed).ok) landed = null;
    } else if (e.kind === 'po') {
      rec.po.cell = [ARRANGE_PARK[0], ARRANGE_PARK[1]];
      container.pos.push(rec.po);
      for (let r = GRID_MIN; r <= GRID_MAX && !landed; r++) {
        for (let c = GRID_MIN; c <= GRID_MAX && !landed; c++) {
          const chk = engine.invCanPlacePO(state, pg, rec.po.uid, rec.po.rot, [r, c]);
          if (chk.ok && !chk.bp) landed = [r, c]; // never load a pack (see above)
        }
      }
      if (landed && !engine.invMovePO(state, pg, rec.po.uid, landed).ok) landed = null;
    } else if (e.kind === 'si') {
      rec.si.host = 'inv';
      container.sis.push(rec.si);
      for (let r = GRID_MIN; r <= GRID_MAX && !landed; r++) {
        for (let c = GRID_MIN; c <= GRID_MAX && !landed; c++) {
          if (engine.invCanPlaceSI(state, pg, rec.si.uid, [r, c], [rec.si.uid]).ok) landed = [r, c];
        }
      }
      if (landed && !engine.invMoveSI(state, pg, rec.si.uid, landed).ok) landed = null;
    } else {
      rec.tm.cell = [ARRANGE_PARK[0], ARRANGE_PARK[1]];
      container.tms.push(rec.tm);
      for (let r = GRID_MIN; r <= GRID_MAX && !landed; r++) {
        for (let c = GRID_MIN; c <= GRID_MAX && !landed; c++) {
          const chk = engine.tmCanPlace(state, pg, rec.tm.uid, [r, c], [rec.tm.uid]);
          if (chk.ok && !chk.mergeInto) landed = [r, c]; // never merge stacks (see above)
        }
      }
      if (landed && !engine.tmMove(state, pg, rec.tm.uid, landed).ok) landed = null;
    }
    if (!landed) { seatedAll = false; break; }
    e.to = landed;
  }

  // ---- commit, or restore every record exactly as it was ---------------
  if (!seatedAll) {
    for (const e of entities) {
      const rec = lifted.get(e.uid);
      if (e.kind === 'bp') {
        rec.bp.origin = [e.at[0], e.at[1]];
        for (const c of rec.cargo) c.po.cell = [e.at[0] + c.dr, e.at[1] + c.dc];
      } else if (e.kind === 'po') rec.po.cell = [e.at[0], e.at[1]];
      else if (e.kind === 'si') rec.si.host = { page: pg, cell: [e.at[0], e.at[1]] };
      else rec.tm.cell = [e.at[0], e.at[1]];
    }
    const byUid = new Map();
    for (const [uid, rec] of lifted) {
      if (rec.bp) { byUid.set(uid, rec.bp); for (const c of rec.cargo) byUid.set(c.po.uid, c.po); }
      else byUid.set(uid, rec.po || rec.si || rec.tm);
    }
    const stayed = { bps: container.bps, pos: container.pos, sis: container.sis, tms: container.tms };
    const rebuild = (key, idOf) => order[key].map((id) => byUid.get(id) || stayed[key].find((x) => idOf(x) === id)).filter(Boolean);
    container.bps = rebuild('bps', (b) => b.id);
    container.pos = rebuild('pos', (p) => p.uid);
    container.sis = rebuild('sis', (s) => s.uid);
    container.tms = rebuild('tms', (t) => t.uid);
    return { moved: 0, total: entities.length };
  }
  let moved = 0;
  for (const e of entities) if (e.to[0] !== e.at[0] || e.to[1] !== e.at[1]) moved++;
  return { moved, total: entities.length };
}
