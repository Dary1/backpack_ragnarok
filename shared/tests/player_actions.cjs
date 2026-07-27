'use strict';
// shared/tests/player_actions.cjs -- REQ-0310 G4/G5 goldens for
// shared/player_actions.mjs, driven against the REAL shared/engine.js.
//
// G4(b) and G4(d) are THE POINT OF THIS FILE. They are the item-loss and
// currency-loss cases: a second client (REQ-0314's headless `bpk`) that got
// these wrong would silently destroy real players' inventories. Treat a red
// here as a release blocker, not a test bug.
//
// G4(b) also PINS A PRE-EXISTING DEFECT rather than hiding it -- see
// "LATENT DEFECT" below and REQ-0310 section 9.1(3). Those cases assert the
// CURRENT (lossy) behaviour on purpose, so that the separate behaviour-change
// commit that fixes it has to update them deliberately.
const fs = require('fs');
const path = require('path');
const Engine = require('../engine.js');

let fails = 0;
let checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('ok  :', msg); }
}
function brief(v) {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : (s.length > 140 ? s.slice(0, 140) + '...' : s);
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, same ? msg : `${msg} (got ${brief(a)}, want ${brief(b)})`);
}

const ITEMS = {
  hilt: { name: 'H', tags: [], shape: [[0, 0]], icon: 'icon-x' },
  dagger: { name: 'D', tags: [], shape: [[0, 0], [1, 0]], icon: 'icon-x' },
};
const SI_DEFS = { lens: { name: 'L', tags: [], icon: 'icon-x' } };
const DEFS = { items: ITEMS, sis: SI_DEFS, tms: { lrdst: { name: 'LRDST', icon: 'icon-x' } } };

const ROLLED = {
  uid: 'bp_rolled',
  shape: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]],
  unit: { id: 'dwarf', off: [2, 1] },
  hpMax: 30,
  unitDef: { name: 'Dwarf' },
};

const E = Engine.create(ITEMS, SI_DEFS, { ROWS: 8, COLS: 8 });
const fresh = () => E.migrateState({ linked: true, bps: [], pos: [], sis: [] });

/** Total LRDST across every inventory page -- the balance the player owns. */
function lrdstTotal(st) {
  let n = 0;
  for (const pg of st.inv.pages) for (const t of pg.tms) if (t.id === 'lrdst') n += t.qty;
  return n;
}
/** Fill every still-free cell of `pg` with 1x1 POs. */
function fillPage(st, pg, skip) {
  const container = st.inv.pages[pg];
  const skipKeys = new Set((skip || []).map(([r, c]) => r + ',' + c));
  for (let r = 1; r <= 8; r++) {
    for (let c = 1; c <= 8; c++) {
      if (skipKeys.has(r + ',' + c)) continue;
      const occ = E.invOccupancy(container, []);
      if (occ[E.key(r, c)]) continue;
      container.pos.push({ uid: `filler_${pg}_${r}_${c}`, id: 'hilt', loc: 'grid', cell: [r, c], rot: 0 });
    }
  }
}
/** G5: every state these functions produce must pass the uid invariant. */
function invariant(st, msg) {
  ok(E.checkUidInvariant(st).ok, `G5 uid invariant: ${msg}`);
}
function counterMinter() {
  let n = 0;
  return () => 'refund_' + (++n);
}

async function main() {
  const PA = await import('../player_actions.mjs');
  const { applyGachaRoll, applyWarehouseClaim, buildStarterUnitsState, itemKindOf } = PA;

  // ------------------------------------------------------------------ G4(a)
  console.log('\n-- G4(a) gacha: sufficient LRDST + space -> placed, balance -cost');
  {
    const st = fresh();
    st.inv.pages[0].tms.push({ uid: 'wallet', id: 'lrdst', qty: 50, cell: [8, 8] });
    const before = lrdstTotal(st);
    const res = applyGachaRoll(E, st, ROLLED, 10, 0, { mintUid: counterMinter() });
    ok(res.ok === true, 'roll succeeded');
    eq(lrdstTotal(st), before - 10, 'balance dropped by exactly the cost');
    const bp = st.inv.pages[res.page].bps.find((b) => b.id === ROLLED.uid);
    ok(!!bp, 'the rolled BP is on the board under its minted uid');
    eq(bp.hpMax, 30, 'BP carries its rolled hpMax');
    ok(Array.isArray(res.cells) && res.cells.length === 6, 'cells returned for the caller to pulse (6-cell BP)');
    invariant(st, 'after a successful roll');
  }

  // -- bonuses are best-effort and land in the SAME transition (section 9.1(4))
  {
    const st = fresh();
    st.inv.pages[0].tms.push({ uid: 'wallet', id: 'lrdst', qty: 50, cell: [8, 8] });
    const rolled = {
      ...ROLLED,
      bonuses: [
        { pool: 'tm', id: 'lrdst', uid: 'bonus_tm', qty: 3 },
        { pool: 'po', id: 'hilt', uid: 'bonus_po' },
        { pool: 'si', id: 'lens', uid: 'bonus_si' },
      ],
    };
    const res = applyGachaRoll(E, st, rolled, 10, 0, { mintUid: counterMinter() });
    ok(res.ok === true, 'bonuses: roll succeeded');
    eq(lrdstTotal(st), 50 - 10 + 3, 'bonus TM merged into the wallet in the same transition');
    ok(st.inv.pages.some((p) => p.pos.some((x) => x.uid === 'bonus_po')), 'bonus PO placed');
    ok(st.inv.pages.some((p) => p.sis.some((x) => x.uid === 'bonus_si')), 'bonus SI placed');
    invariant(st, 'after a roll with bonuses');
  }

  // ------------------------------------------- section 9.1(1) page scoping
  console.log('\n-- 9.1(1) spendTM is page-scoped and NEVER spends across pages');
  {
    const st = fresh();
    st.inv.pages[0].tms.push({ uid: 'w0', id: 'lrdst', qty: 6, cell: [8, 8] });
    st.inv.pages[1].tms.push({ uid: 'w1', id: 'lrdst', qty: 6, cell: [8, 8] });
    const res = applyGachaRoll(E, st, ROLLED, 10, 0, { mintUid: counterMinter() });
    ok(res.ok === false && res.reason === 'insufficient_lrdst', '6+6 across two pages cannot pay 10 (existing behaviour, deliberately preserved)');
    eq(lrdstTotal(st), 12, 'nothing was spent on the failed attempt');
    ok(!st.inv.pages.some((p) => p.bps.some((b) => b.id === ROLLED.uid)), 'no BP placed');
    invariant(st, 'after insufficient_lrdst');
  }

  // ------------------------------------------------------------------ G4(b)
  console.log('\n-- G4(b) gacha: NO SPACE -> refunded, net balance unchanged, no BP  [ITEM-LOSS GATE]');
  {
    const st = fresh();
    st.inv.pages[0].tms.push({ uid: 'wallet', id: 'lrdst', qty: 20, cell: [8, 8] });
    // Everything full except [1,1] on page 0 -- no 6-cell BP fits anywhere, but
    // the refund's fixed target cell IS available.
    fillPage(st, 0, [[1, 1]]);
    for (let pg = 1; pg < E.PAGE_COUNT; pg++) fillPage(st, pg, []);
    const before = lrdstTotal(st);
    const mint = counterMinter();
    const res = applyGachaRoll(E, st, ROLLED, 10, 0, { mintUid: mint });
    ok(res.ok === false && res.reason === 'no_space', 'placement failed with no_space');
    ok(res.refunded === true, 'the refund landed');
    eq(lrdstTotal(st), before, 'NET BALANCE UNCHANGED -- the player lost no currency');
    ok(!st.inv.pages.some((p) => p.bps.some((b) => b.id === ROLLED.uid)), 'no BP was placed');
    const refundStack = st.inv.pages[0].tms.find((t) => t.uid === 'refund_1');
    ok(!!refundStack, 'the refund stack carries the INJECTED uid (no Date.now() leaked into the transition)');
    eq(refundStack && refundStack.qty, 10, 'the refund stack holds exactly the cost');
    invariant(st, 'after a refunded no_space roll');
  }

  // ---------------------------------------------------------- LATENT DEFECT
  // REQ-0310 section 9.1(3). The refund is a FIXED-CELL attempt --
  // tmMove(state, pg, uid, [1,1], ...) -- not a first-fit scan. tmCanPlace
  // accepts [1,1] only when it is free or already holds an 'lrdst' stack, so
  // the refund fails outright whenever every page's [1,1] is occupied by
  // anything else. The original discarded the return value, so the cost was
  // deducted and never returned: the player silently loses currency.
  //
  // These two cases assert the CURRENT, LOSSY behaviour. They are the bug
  // report. The fix is a separate, clearly-labelled behaviour-change commit.
  console.log('\n-- G4(b) LATENT DEFECT (section 9.1(3)): refund targets [1,1] ONLY -> currency can be lost');
  {
    const st = fresh();
    st.inv.pages[0].tms.push({ uid: 'wallet', id: 'lrdst', qty: 20, cell: [8, 8] });
    for (let pg = 0; pg < E.PAGE_COUNT; pg++) fillPage(st, pg, []); // [1,1] occupied by a PO on every page
    const res = applyGachaRoll(E, st, ROLLED, 10, 0, { mintUid: counterMinter() });
    ok(res.ok === false && res.reason === 'no_space', 'no_space as expected');
    ok(res.refunded === false, 'DEFECT PINNED: the refund could not land');
    eq(lrdstTotal(st), 10, 'DEFECT PINNED: 10 LRDST deducted and LOST (was 20)');
    invariant(st, 'after a lost-currency roll');
  }
  {
    // The sharpest form: the wallet stack is drained to zero, so its cell is
    // FREED by the spend -- and the refund still fails, because it only ever
    // looks at [1,1]. A first-fit refund would always succeed here.
    const st = fresh();
    st.inv.pages[0].tms.push({ uid: 'wallet', id: 'lrdst', qty: 10, cell: [8, 8] });
    for (let pg = 0; pg < E.PAGE_COUNT; pg++) fillPage(st, pg, []);
    const res = applyGachaRoll(E, st, ROLLED, 10, 0, { mintUid: counterMinter() });
    ok(res.refunded === false, 'DEFECT PINNED: refund fails even though the spend freed cell [8,8]');
    eq(lrdstTotal(st), 0, 'DEFECT PINNED: the players ENTIRE balance is lost');
    const free = E.tmCanPlace(st, 0, 'probe', [8, 8], [], 'lrdst');
    ok(free.ok === true, 'and a first-fit refund WOULD have found [8,8] free -- proving the fix is first-fit');
    invariant(st, 'after a total-loss roll');
  }

  // ------------------------------------------------------------------ G4(c)
  console.log('\n-- G4(c) claim: every kind REUSES the warehouse row uid (the finalize contract)');
  {
    const st = fresh();
    const res = applyWarehouseClaim(E, st, { itemUid: 'row_po', itemId: 'hilt' }, DEFS, 0);
    ok(res.ok === true && res.kind === 'po', 'po row resolved to kind po');
    ok(st.inv.pages[res.page].pos.some((p) => p.uid === 'row_po'), 'PO placed under the ROW uid, verbatim');
    invariant(st, 'after a po claim');
  }
  {
    const st = fresh();
    const res = applyWarehouseClaim(E, st, { itemUid: 'row_si', itemId: 'lens' }, DEFS, 0);
    ok(res.ok === true && res.kind === 'si', 'si row resolved to kind si');
    ok(st.inv.pages[res.page].sis.some((a) => a.uid === 'row_si'), 'SI placed under the ROW uid, verbatim');
    invariant(st, 'after an si claim');
  }
  {
    // TM, no existing stack -> a fresh stack keeps the row uid.
    const st = fresh();
    const res = applyWarehouseClaim(E, st, { itemUid: 'row_tm', itemId: 'lrdst', kind: 'tm', qty: 7 }, DEFS, 0);
    ok(res.ok === true && res.kind === 'tm', 'tm row resolved to kind tm');
    const stack = st.inv.pages[res.page].tms.find((t) => t.uid === 'row_tm');
    ok(!!stack, 'fresh TM stack placed under the ROW uid, verbatim');
    eq(stack && stack.qty, 7, 'fresh TM stack carries the row qty');
    invariant(st, 'after a fresh tm claim');
  }
  {
    // TM MERGE -- the one kind where the row uid is DELIBERATELY consumed:
    // tmMove keeps the destination stack's uid (shared/engine.js's TM model).
    // The server knows this: finalizeClaimingItemsForCanvas finalizes a tm row
    // on `presentUids.has(itemUid) || presentTmIds.has(itemId)`. So the
    // finalize evidence for a merged claim is the same-id stack, not the uid.
    const st = fresh();
    st.inv.pages[0].tms.push({ uid: 'stack0', id: 'lrdst', qty: 5, cell: [3, 3] });
    const res = applyWarehouseClaim(E, st, { itemUid: 'row_tm2', itemId: 'lrdst', kind: 'tm', qty: 7 }, DEFS, 0);
    ok(res.ok === true, 'tm-merge claim succeeded');
    eq(lrdstTotal(st), 12, 'merged qty landed in the surviving stack');
    ok(!st.inv.pages.some((p) => p.tms.some((t) => t.uid === 'row_tm2')), 'row uid is consumed by the merge (engine contract)');
    ok(st.inv.pages.some((p) => p.tms.some((t) => t.id === 'lrdst')), 'a same-id stack exists -- the finalize evidence the server actually scans for');
    invariant(st, 'after a tm-merge claim');
  }
  {
    // BP -- section 9.2(3): the post-placement restore is STATE, not UI.
    const st = fresh();
    const bpPayload = {
      shape: ROLLED.shape,
      unit: ROLLED.unit,
      hpMax: 30,
      cellCount: 6,
      name: 'Bought Dwarf',
      color: '#123456',
      bonuses: [{ slot: 1, id: 'hilt' }],
      roll: { pct: 42 },
    };
    const res = applyWarehouseClaim(E, st, { itemUid: 'row_bp', itemId: 'x', kind: 'bp', bp: bpPayload }, DEFS, 0);
    ok(res.ok === true && res.kind === 'bp', 'bp row resolved to kind bp');
    const bp = st.inv.pages[res.page].bps.find((b) => b.id === 'row_bp');
    ok(!!bp, 'BP placed under the ROW uid, verbatim');
    eq(bp && bp.name, 'Bought Dwarf', 'REQ-0195d restore: name');
    eq(bp && bp.color, '#123456', 'REQ-0195d restore: color');
    eq(bp && bp.cellCount, 6, 'REQ-0195d restore: cellCount');
    eq(bp && bp.bonuses, [{ slot: 1, id: 'hilt' }], 'REQ-0195d restore: bonuses');
    eq(bp && bp.roll, { pct: 42 }, 'REQ-0195d restore: roll -- a bought unit is never re-rolled');
    eq(res.cells.length, 6, 'bp claim returns the placed cells');
    invariant(st, 'after a bp claim');
  }

  // ------------------------------------------------------------------ G4(d)
  console.log('\n-- G4(d) claim: NO SPACE -> state untouched, row left claiming  [ITEM-LOSS GATE]');
  for (const [label, claimed] of [
    ['po', { itemUid: 'row_po', itemId: 'hilt' }],
    ['si', { itemUid: 'row_si', itemId: 'lens' }],
    ['tm', { itemUid: 'row_tm', itemId: 'ptm', kind: 'tm', qty: 3 }],
    ['bp', { itemUid: 'row_bp', itemId: 'x', kind: 'bp', bp: { shape: ROLLED.shape, unit: ROLLED.unit, hpMax: 30, name: 'B' } }],
  ]) {
    const st = fresh();
    for (let pg = 0; pg < E.PAGE_COUNT; pg++) fillPage(st, pg, []);
    const before = JSON.stringify(st);
    const res = applyWarehouseClaim(E, st, claimed, DEFS, 0);
    ok(res.ok === false && res.reason === 'no_space', `${label}: no_space reported`);
    ok(JSON.stringify(st) === before, `${label}: STATE BYTE-IDENTICAL -- every placeholder rolled back, nothing lost`);
    invariant(st, `after a no-space ${label} claim`);
  }

  // ------------------------------------------------------------------ G4(e)
  console.log('\n-- G4(e) buildStarterUnitsState deep-equals the BASE (112bd5d) output');
  {
    const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'starter_state_golden.json'), 'utf8'));
    const su = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'live', 'starter_units.json'), 'utf8'));
    eq(buildStarterUnitsState({ starterUnits: su }, 'en'), golden.en, 'starter state (en) deep-equals base');
    eq(buildStarterUnitsState({ starterUnits: su }, 'ja'), golden.ja, 'starter state (ja) deep-equals base');
    eq(buildStarterUnitsState({ starterUnits: null }, 'en'), null, 'no starterUnits -> null (boot falls back to the baked scenario)');
    eq(buildStarterUnitsState({ starterUnits: { units: [] } }, 'en'), null, 'empty units -> null');
    // G5 against the REAL content defs: the starter seed's POs are live
    // live_items.json ids, so migrateState needs the real ITEMS map to home
    // them (this is exactly what boot.ts does with the served GameData).
    const LIVE_ITEMS = {};
    for (const f of ['live_items.json', 'starter_items.json']) {
      const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'live', f), 'utf8'));
      for (const e of doc.entries) LIVE_ITEMS[e.id] = e;
    }
    const LE = Engine.create(LIVE_ITEMS, SI_DEFS, { ROWS: 8, COLS: 8 });
    const seeded = LE.migrateState(buildStarterUnitsState({ starterUnits: su }, 'en'));
    ok(LE.checkUidInvariant(seeded).ok, 'G5 uid invariant: starter seed survives migrateState against live content defs');
    checks++;
    ok(seeded.inv && seeded.inv.pages.length === LE.PAGE_COUNT, 'starter seed gains a full inventory through migrateState');
  }

  // ------------------------------------------------------------ itemKindOf
  console.log('\n-- itemKindOf (moved verbatim from client/src/lib/itemContent.ts)');
  eq(itemKindOf(DEFS, 'lens'), 'si', 'an id in sis resolves to si');
  eq(itemKindOf(DEFS, 'hilt'), 'po', 'an id in items resolves to po');
  eq(itemKindOf(DEFS, 'unknown_id'), 'po', 'an unknown id defensively resolves to po');
  eq(itemKindOf(null, 'lens'), 'po', 'no defs loaded yet -> po');

  console.log(fails ? `\nplayer_actions: ${fails}/${checks} FAILED` : `\nplayer_actions: all green (${checks} checks)`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
