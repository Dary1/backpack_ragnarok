// shared/player_actions.mjs -- REQ-0310: the three CLIENT-AUTHORITATIVE player
// actions, as pure state transitions.
//
// WHY THIS FILE EXISTS. Three player actions are two-phase, and the
// authoritative second phase is the CLIENT's. The server rolls or reserves; the
// client mutates the canvas and PUTs; that PUT is the commit:
//
//   - Gacha         -- POST /api/workshop/gacha records a pending row and
//     returns the rolled BP without deducting anything. finalizeGachaForCanvas
//     then verifies both the minted uid's presence AND that the balance dropped
//     by exactly the cost.
//   - Warehouse claim -- the row is marked 'claiming' and a payload returned;
//     the client places it REUSING THE ROW'S OWN uid (what
//     finalizeClaimingItemsForCanvas scans for) and PUTs. A row left 'claiming'
//     reverts after 120 s.
//   - Fresh profile -- the initial Squads are built entirely client-side from
//     /api/content's starterUnits.
//
// So "the rules of the game" partly lived in a React app. A second client
// (REQ-0314's headless `bpk`) would have had to REIMPLEMENT item- and
// currency-losing logic and get it subtly right. It calls these functions
// instead.
//
// CONTRACT. Pure state transitions: no React, no chimes, no tab pulses, no
// network, no message formatting. The engine is passed in -- this module does
// not wrap, adapt or re-export it. State is mutated IN PLACE by the engine (the
// returned `state` is the same object) and every returned shape carries enough
// for a caller to drive its own UI ({ ok, reason, page, cells }) without
// re-deriving anything.
//
// Per shared/README.md this module may NOT import from server/, sim/, client/
// or mock-src/. It imports only ./placement.mjs.
import { firstFitOrMergeTM, firstFitPlace, firstFitPlaceBp } from './placement.mjs';

/** Determines whether `itemId` is a PO (has a `shape`, lives in content.items)
 * or an SI (has a `slot`, lives in content.sis) -- the two kinds a claimed
 * warehouse item can be in practice (see server/schedule.cjs's
 * REWARD_ROLL_TO_ITEM_ID table: every resolved reward/grant item id is a real
 * live_items.json or live_sis.json entry; BPs are never warehouse-claimable
 * CONTENT -- a bought BP arrives as kind:'bp' with its own payload instead, see
 * applyWarehouseClaim). Falls back to 'po' if the id is in neither map
 * (defensive; the claim response's itemId should always resolve against one).
 *
 * REQ-0310: moved verbatim from client/src/lib/itemContent.ts. Argument order
 * is (defs, itemId) -- the call-site order it has always had. */
export function itemKindOf(defs, itemId) {
  if (!defs) return 'po';
  if (defs.sis[itemId]) return 'si';
  return 'po';
}

/** The default refund-uid minter -- byte-identical to the expression
 * WorkshopPage.tsx inlined before REQ-0310 (`'lrdst_refund_' + Date.now()`).
 * Injected rather than called directly so the transition stays a pure,
 * goldenable function (tests pass a counter); this default exists so a caller
 * that does not care still gets the historical behaviour exactly. */
export function defaultRefundUidMinter() {
  return 'lrdst_refund_' + Date.now();
}

/**
 * GACHA phase 2. Deduct `cost` LRDST, first-fit-place the rolled BP, then
 * best-effort place the pack's bonus slots.
 *
 * Returns
 *   { ok:true,  state, page, origin, cells }
 *   { ok:false, reason:'insufficient_lrdst', state }
 *   { ok:false, reason:'no_space', state, refunded }
 *
 * FOUR SUBTLETIES, all preserved deliberately (REQ-0310 is an extraction):
 *
 * (1) spendTM IS PAGE-SCOPED AND NEVER SPENDS ACROSS PAGES. The page order is
 *     [openPage, ...every other page ascending] and each attempt asks ONE whole
 *     page to cover the WHOLE cost. A player whose LRDST is split 6+6 over two
 *     pages therefore cannot afford a cost of 10 -- that is correct, existing
 *     behaviour (see shared/engine.js's TM model comment for why spend is
 *     page-scoped), NOT a bug to improve into a cross-page spend.
 *
 * (2) THE REFUND MINTS A uid. `mintUid` is injected (see
 *     defaultRefundUidMinter) so this function stays goldenable. It is called
 *     INSIDE the loop, once per attempt, exactly where `Date.now()` used to be
 *     evaluated.
 *
 * (3) THE REFUND CAN SILENTLY FAIL -- see `refunded` in the return value and
 *     the note on it below. Behaviour is UNCHANGED from the React original;
 *     the flag merely makes the outcome observable instead of discarded.
 *
 * (4) BONUSES ARE BEST-EFFORT AND COME AFTER THE BP. A bonus that finds no room
 *     is simply skipped: the guaranteed BP remains the sole finalize gate. Keep
 *     that asymmetry.
 */
export function applyGachaRoll(engine, state, rolled, cost, openPage, opts) {
  const mintUid = (opts && opts.mintUid) || defaultRefundUidMinter;
  // (1) page-scoped spend -- whole pages, in order, until one page's OWN
  // balance covers the whole cost. Computed once and reused by the refund
  // loop below, exactly as the original did.
  const pageOrder = [openPage, ...Array.from({ length: engine.PAGE_COUNT }, (_, i) => i).filter((i) => i !== openPage)];
  let spent = false;
  for (const pg of pageOrder) {
    const spendRes = engine.spendTM(state, pg, 'lrdst', cost);
    if (spendRes.ok) {
      spent = true;
      break;
    }
  }
  if (!spent) {
    // Should not happen (the server verified balance >= cost against the
    // last-saved canvas moments ago) unless the balance changed in the interim
    // on THIS client without a save, or the LRDST is split across pages with
    // none alone covering the cost -- report it rather than silently placing a
    // BP the player never paid for.
    return { ok: false, reason: 'insufficient_lrdst', state };
  }

  const placed = firstFitPlaceBp(engine, state, rolled, openPage, engine.PAGE_COUNT);
  if (!placed) {
    // No space anywhere -- the pending roll is simply left unfinalized
    // server-side and lazily reverts after the timeout. The LRDST was already
    // deducted above, though, so refund it locally (no server round trip: the
    // pending roll was never finalized, so the server-side balance was never
    // touched either).
    //
    // (3) THE REFUND IS A FIXED-CELL ATTEMPT, NOT A FIRST-FIT SCAN. tmMove
    // targets cell [1,1] of each page in turn, and tmCanPlace accepts that cell
    // only when it is FREE or already holds an 'lrdst' stack to merge into. So
    // the refund fails outright when every page's [1,1] is occupied by anything
    // else -- a single PO parked on [1,1] of every page is enough, the
    // inventory need not be full. The original discarded this result; `refunded`
    // reports it. See REQ-0310 section 9.1(3) and its outcome note.
    let refunded = false;
    for (const pg of pageOrder) {
      const refund = engine.tmMove(state, pg, mintUid(), [1, 1], 'lrdst', cost);
      if (refund.ok) {
        refunded = true;
        break;
      }
    }
    return { ok: false, reason: 'no_space', state, refunded };
  }

  // (4) the pack's bonus slots (POs / SI lenses / TMs) ride the SAME save as
  // the guaranteed BP. Best-effort: a bonus that finds no room is not placed.
  for (const b of rolled.bonuses ?? []) {
    if (b.pool === 'tm') {
      firstFitOrMergeTM(engine, state, b.uid, b.id, b.qty ?? 1, openPage, engine.PAGE_COUNT);
    } else {
      firstFitPlace(engine, state, b.pool, b.uid, b.id, openPage, engine.PAGE_COUNT);
    }
  }

  const cells = engine.bpCells({ shape: rolled.shape, origin: placed.origin });
  return { ok: true, state, page: placed.page, origin: placed.origin, cells };
}

/**
 * WAREHOUSE CLAIM phase 2. Kind-dispatch the placement, REUSING the warehouse
 * row's own uid, then restore the verbatim BP instance fields.
 *
 * Returns
 *   { ok:true,  state, kind, page, cells }
 *   { ok:false, reason:'no_space', state }
 *
 * THREE SUBTLETIES:
 *
 * (1) uid REUSE IS THE FINALIZE CONTRACT. The placed item carries
 *     `claimed.itemUid` VERBATIM -- that is what finalizeClaimingItemsForCanvas
 *     scans for on the next profile PUT. A freshly minted uid would leave the
 *     row stuck in 'claiming' until it reverted, and the player would appear to
 *     lose the item. Never mint here.
 *
 * (2) KIND RESOLUTION NEEDS CONTENT DEFS -- hence `defs`. A row is 'tm' or 'bp'
 *     when it says so, otherwise the id is resolved against the content maps.
 *
 * (3) THE BP PATH HAS A POST-PLACEMENT RESTORE, AND IT IS STATE, NOT UI.
 *     firstFitPlaceBp sets only id/name/color/shape/origin/unit/hpMax, so
 *     name/color/cellCount/bonuses/roll are re-applied from the verbatim
 *     payload -- REQ-0195d's "a bought unit stays byte-faithful, never
 *     re-rolled". Leaving this behind would make a bought BP silently lossy for
 *     any second client.
 */
export function applyWarehouseClaim(engine, state, claimed, defs, openPage) {
  const kind = claimed.kind === 'tm' ? 'tm' : claimed.kind === 'bp' ? 'bp' : itemKindOf(defs, claimed.itemId);
  // REQ-0195d: a bought unit (BP) row places via firstFitPlaceBp (the
  // Workshop's own claim path), reconstructing a rolled-BP payload from the
  // verbatim row payload; the remaining instance fields are merged back below.
  const bpPayload = claimed.bp;
  const rolled = kind === 'bp' && bpPayload
    ? { uid: claimed.itemUid, shape: bpPayload.shape, unit: bpPayload.unit, hpMax: bpPayload.hpMax, cellCount: bpPayload.cellCount ?? bpPayload.shape.length, bonuses: bpPayload.bonuses }
    : null;
  const placed = kind === 'tm'
    ? firstFitOrMergeTM(engine, state, claimed.itemUid, claimed.itemId, claimed.qty ?? 1, openPage, engine.PAGE_COUNT)
    : kind === 'bp'
      ? (rolled ? firstFitPlaceBp(engine, state, rolled, openPage, engine.PAGE_COUNT) : null)
      : firstFitPlace(engine, state, kind, claimed.itemUid, claimed.itemId, openPage, engine.PAGE_COUNT);

  if (!placed) {
    // No space anywhere -- leave the row 'claiming' server-side; it lazily
    // reverts to 'claimable' after the server's own timeout (no explicit
    // "abandon claim" round-trip). The state is left untouched: every
    // first-fit variant rolls its own placeholder back on failure.
    return { ok: false, reason: 'no_space', state };
  }

  // (3) restore the verbatim BP instance -- STATE, not UI.
  if (kind === 'bp' && bpPayload) {
    const placedBp = state.inv.pages[placed.page].bps.find((b) => b.id === claimed.itemUid);
    if (placedBp) {
      if (bpPayload.name != null) placedBp.name = bpPayload.name;
      if (bpPayload.color != null) placedBp.color = bpPayload.color;
      if (bpPayload.cellCount != null) placedBp.cellCount = bpPayload.cellCount;
      if (bpPayload.bonuses != null) placedBp.bonuses = bpPayload.bonuses;
      if (bpPayload.roll != null) placedBp.roll = bpPayload.roll;
    }
  }

  // The cells the caller may want to pulse. Derivation only -- no mutation.
  // ('si' and 'tm' both fall through to [placed.cell]: both are always 1x1.)
  const cells = kind === 'po'
    ? engine.cellsOfIn(state.inv.pages[placed.page].pos.find((p) => p.uid === claimed.itemUid))
    : kind === 'bp'
      ? engine.bpCells({ shape: rolled.shape, origin: placed.origin })
      : [placed.cell];

  return { ok: true, state, kind, page: placed.page, cells };
}

/**
 * FRESH PROFILE. Builds the starting GameState from the served starter-unit
 * definitions (gameData.starterUnits) -- four starter units, 5x5 BPs (the unit
 * forms no links), each a BP with an authored hpMax override pre-filled with 4
 * fixed (immovable) POs. Returns null when the payload carries no starterUnits
 * (an older server), so the caller falls back to the baked demo scenario. The
 * caller runs the result through engine.migrateState(), which gives every BP+PO
 * an inventory home while preserving the canvas fixed references.
 *
 * REQ-0310: moved verbatim from client/src/store/boot.ts. POST /api/starter/claim
 * grants nothing -- it only meters regrants -- so this really is the whole of
 * fresh-profile creation.
 */
export function buildStarterUnitsState(gameData, locale) {
  const su = gameData.starterUnits;
  if (!su || !Array.isArray(su.units) || su.units.length === 0) return null;
  const slotFor = (unit) => {
    const bp = {
      id: 'bp_' + unit.id,
      name: unit.name,
      color: unit.color,
      shape: su.bpShape,
      origin: su.origin,
      unit: { id: su.unit.id, off: su.unit.off },
      hpMax: su.hpMax,
      locked: true, // REQ-0209: starter-unit interiors are fully immutable (rotation-only)
    };
    const pos = unit.pos.map((pp, i) => ({
      uid: 'po_' + unit.id + '_' + i,
      id: pp.id,
      loc: 'grid',
      cell: pp.cell,
      rot: pp.rot,
      fixed: true,
    }));
    return { linked: true, bps: [bp], pos, sis: [] };
  };
  const nameOf = (unit) =>
    (locale === 'ja' && unit.i18n && unit.i18n.ja && unit.i18n.ja.name) ? unit.i18n.ja.name : unit.name;
  const units = su.units;
  const first = slotFor(units[0]);
  const names = units.map(nameOf);
  const store = [null];
  for (let i = 1; i < units.length; i++) store.push(slotFor(units[i]));
  // Pad to the engine default squad count so a fresh guest keeps one empty
  // spare squad tab (matches makeSquadsMeta shape).
  while (names.length < 5) { names.push('Squad ' + (names.length + 1)); store.push({ linked: true, bps: [], pos: [], sis: [] }); }
  return { linked: first.linked, bps: first.bps, pos: first.pos, sis: first.sis, presets: { active: 0, names, store } };
}
