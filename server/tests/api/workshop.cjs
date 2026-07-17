'use strict';
// server/tests/api/workshop.cjs -- REQ-0145a (sf): the REQ-0042 Workshop gacha group
// (two-phase roll/finalize/revert, TM grant + claim-merge).
// Cut VERBATIM from server/tests/api_test.cjs origin lines 1666-1834 @
// commit 46cd881 (only require paths adjusted for the deeper directory).
// Shared fixtures/state arrive on -- and are published back to -- the
// harness context `h`; execution order across suite files is FIXED by
// the api_test.cjs entry point and must never be reordered (later
// groups assert against server state earlier groups created).
module.exports.run = async function run(h) {
  const assert = require('assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { T, AT, api, admin, playersFixture, players, storage, mockReq, mockRes,
    authHeaders, guestA, guestB, adminGuest, devPlayer, devUserPath, configDir,
    evictServerModuleTree, evictStorageAndPlayers, tmpHome, realHomedir,
    fakeRepoHome, repoRoot, contentDir, liveDir, batchDir, fixtureLiveDungeonDir,
    schedule, scheduleStorage, makeTestCanvas, fillAllSlots, forceRunElapsed,
    scheduleP1, scheduleP2, scheduleReq, fillAllSlotsSnapshotsFrom, claimReq, findClaimSpot } = h; // REQ-0215: claimReq/findClaimSpot

// =====================================================================
  // REQ-0042 Workshop gacha (POST /api/workshop/gacha), REWRITTEN by REQ-0215.
  //
  // The roll is no longer a two-phase pending/finalize/revert dance against a
  // gacha_pending store. The user's spec sends the rolled Unit to the WAREHOUSE,
  // so the BP never enters the canvas and the old finalize gate (uid present AND
  // balance dropped) cannot exist -- and a balance-drop-only gate would hand out
  // free Units to anyone who spent LRDST elsewhere inside the window. The roll is
  // now ONE synchronous purchase, built on market buyListing's step order:
  // validate balance + warehouse cap, roll, debit server-side, deliver.
  //
  // So these tests assert a transaction, not a protocol: after a roll the balance
  // IS down and the Unit IS a claimable warehouse row -- or nothing happened at
  // all and nothing was charged.
  // =====================================================================

  // Gives scheduleP1's CURRENTLY SAVED profile an LRDST stack of the
  // given qty on inventory page 0 -- direct storage manipulation (same
  // convention the claim tests above use for setting up warehouse rows),
  // mirroring exactly what a real saved canvas with an LRDST balance
  // looks like (page shape post-REQ-0042: {bps,pos,sis,tms}).
  function setLrdstBalance(playerId, qty) {
    const doc = scheduleStorage.readProfile(playerId);
    doc.canvas.inv.pages[0].tms = [{ uid: 'lrdst_test_stack', id: 'lrdst', qty, cell: [8, 8] }];
    scheduleStorage.writeProfile(playerId, doc.canvas);
    return doc.canvas;
  }

  await AT('REQ-0215 gacha: one roll debits the cost server-side and delivers the Unit to the WAREHOUSE as a claimable kind:bp row -- no pending state, nothing on the canvas', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    const bpsBefore = JSON.stringify(scheduleStorage.readProfile(scheduleP1.playerId).canvas.inv.pages.map((pg) => pg.bps));

    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 200, 'roll must succeed: ' + JSON.stringify(rollRes.body));
    assert.strictEqual(rollRes.body.cost, 10, 'cost echoed back is the REQ doc\'s 10x LRDST');
    const rolled = rollRes.body.rolled;
    assert.ok(rolled && rolled.uid, 'rolled BP definition includes a minted uid');
    assert.ok(Array.isArray(rolled.shape) && rolled.shape.length >= 6 && rolled.shape.length <= 8, 'rolled shape has 6-8 cells: ' + JSON.stringify(rolled.shape));
    // REQ-0170: a roll emits a UNIT -- an identity from the pack's pool -- not an
    // anonymous 1-3 random dirs array. UNCHANGED by REQ-0215: the roll MATH is
    // untouched; only where the result is delivered changed.
    assert.ok(rolled.unit && typeof rolled.unit.id === 'string', 'rolled BP carries a unit identity');
    assert.ok(['test_queen', 'test_rook', 'test_loner'].includes(rolled.unit.id), 'the unit is drawn from the pack pool, got: ' + rolled.unit.id);
    assert.ok(rolled.unitDef && rolled.unitDef.id === rolled.unit.id, 'the response echoes the unit def for the result modal');
    assert.ok(['queen', 'rook', 'none'].includes(rolled.unitDef.connection_shape), 'the def names a real connection_shape');
    assert.strictEqual(rolled.linker, undefined, 'the retired linker field is GONE -- not renamed, not shadowed');
    const unitInShape = rolled.shape.some(([r, c]) => r === rolled.unit.off[0] && c === rolled.unit.off[1]);
    assert.ok(unitInShape, 'rolled unit cell is one of the polyomino\'s own cells');
    assert.strictEqual(rolled.hpMax, 15 * rolled.shape.length, 'hpMax = 15 x cellCount');

    // THE REQ-0215 INVERSION: the server HAS deducted, right now, with no PUT.
    const afterRoll = scheduleStorage.readProfile(scheduleP1.playerId);
    assert.strictEqual(schedule.readLrdstBalance(afterRoll.canvas), 989, 'REQ-0215: the roll debits the cost server-side, atomically -- it is a purchase, not a two-phase placement');
    assert.strictEqual(JSON.stringify(afterRoll.canvas.inv.pages.map((pg) => pg.bps)), bpsBefore, 'REQ-0215: the roll puts NOTHING on the canvas -- the Unit goes to the warehouse');

    // ...and the Unit is a claimable warehouse row carrying its verbatim instance.
    const rows = schedule.listWarehouse(scheduleP1.playerId);
    const row = rows.find((r) => r.itemUid === rolled.uid);
    assert.ok(row, 'the rolled Unit IS a warehouse row, keyed by the minted BP uid');
    assert.strictEqual(row.kind, 'bp', 'delivered in the REQ-0195d market-bought-unit row shape -- no new row kind');
    assert.strictEqual(row.status, 'claimable', 'delivered claimable, like any dungeon reward');
    assert.strictEqual(row.itemId, rolled.unit.id, 'the row resolves against the UNIT def');
    assert.strictEqual(row.sourcePackId, 'common_bp', 'provenance: which pack minted it');
    assert.deepStrictEqual(row.bp.shape, rolled.shape, 'the row carries the rolled shape verbatim');
    assert.deepStrictEqual(row.bp.unit, rolled.unit, 'the row carries the rolled unit identity + seat verbatim');
    assert.strictEqual(row.bp.hpMax, rolled.hpMax, 'the row carries hpMax verbatim');

    // REQ-0060/0215: the Unit is born when it is rolled and delivered -- one
    // atomic instant now, so the bio is stamped here rather than at a finalize
    // that may never come.
    const bio = require('../../services/bio.cjs').getBio ? require('../../services/bio.cjs').getBio(rolled.uid) : null;
    if (bio) assert.strictEqual(bio.born && bio.born.origin, 'gacha', 'the delivered Unit is stamped born:gacha');

    // And it claims onto the canvas through the ORDINARY warehouse path.
    const claim = await claimReq(scheduleP1, rolled.uid);
    assert.strictEqual(claim.status, 200, 'the rolled Unit claims like any other warehouse row: ' + JSON.stringify(claim.body));
    assert.strictEqual(claim.body.kind, 'bp');
    assert.strictEqual(claim.body.bp.unit.id, rolled.unit.id, 'the claim hands back the verbatim instance -- never re-rolled');
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, rolled.uid);
  });

  await AT('REQ-0215 gacha: REQ-0062 themed pack -- the guaranteed BP and every bonus slot land as their OWN warehouse rows; the roll stays reproducible from its seed; the pack Dex card still exposes the transparent odds', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);

    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'test_themed' });
    assert.strictEqual(rollRes.status, 200, 'themed roll must succeed: ' + JSON.stringify(rollRes.body));
    assert.strictEqual(rollRes.body.cost, 20, 'themed pack cost (20) echoed');
    const rolled = rollRes.body.rolled;
    assert.ok(rolled && rolled.uid, 'guaranteed BP minted');
    assert.ok(rolled.shape.length >= 3 && rolled.shape.length <= 4, 'guaranteed BP obeys the pack [3,4] cell band: ' + rolled.shape.length);
    assert.ok(Array.isArray(rolled.bonuses) && rolled.bonuses.length === 3, 'three bonus slots resolved: ' + JSON.stringify(rolled.bonuses));
    const byPool = {};
    for (const b of rolled.bonuses) {
      assert.ok(b.uid && b.uid !== rolled.uid, 'each bonus carries its own freshly minted uid');
      assert.ok(b.def && b.def.name, 'each bonus echoes a def for the result modal');
      byPool[b.pool] = b;
    }
    assert.strictEqual(byPool.po.id, 'blade', 'po bonus drawn from its table');
    assert.strictEqual(byPool.si.id, 'acc_gem', 'si bonus drawn from its table');
    assert.strictEqual(byPool.tm.id, 'lrdst', 'tm bonus drawn from its table');
    assert.strictEqual(byPool.tm.qty, 3, 'tm bonus qty honored');
    assert.strictEqual(byPool.po.qty, 1, 'po bonus qty defaults to 1');

    assert.strictEqual(schedule.readLrdstBalance(scheduleStorage.readProfile(scheduleP1.playerId).canvas), 979, 'the themed cost (20) is debited server-side, once');

    // REQ-0215: every bonus is its OWN ordinary warehouse row -- POs/SIs in the
    // grantWarehouseItem shape, TMs in the grantTmQty shape. The old code
    // first-fit-placed them straight onto the canvas alongside the BP.
    const rows = schedule.listWarehouse(scheduleP1.playerId);
    assert.strictEqual(rows.length, 4, 'one row for the guaranteed Unit + one per bonus slot: ' + JSON.stringify(rows.map((r) => r.itemId)));
    const poRow = rows.find((r) => r.itemUid === byPool.po.uid);
    assert.ok(poRow && poRow.kind === undefined && poRow.itemId === 'blade', 'the po bonus is a plain warehouse row keyed by its own minted uid');
    assert.strictEqual(typeof poRow.q, 'number', 'REQ-0215 interpretation: a PO/SI bonus now carries a rollQuality q, like every OTHER warehouse PO row (the old client-side placement gave it none)');
    const siRow = rows.find((r) => r.itemUid === byPool.si.uid);
    assert.ok(siRow && siRow.itemId === 'acc_gem', 'the si bonus is a plain warehouse row');
    const tmRow = rows.find((r) => r.itemUid === byPool.tm.uid);
    assert.ok(tmRow && tmRow.kind === 'tm' && tmRow.qty === 3, 'the tm bonus is a kind:tm stack row carrying its qty');
    for (const r of rows) assert.strictEqual(r.sourcePackId, 'test_themed', 'every delivered row records which pack minted it');

    // Determinism (house RNG discipline: per-pack, per-slot labeled sub-streams).
    // Asserted directly against rollPackBp now -- REQ-0215 deleted the pending doc
    // that used to be the only place a roll's seed was persisted, and the roll math
    // itself is what this invariant is actually about.
    const seed = 'req0215_fixed_seed_for_determinism';
    const a = schedule.rollPackBp(schedule.resolvePack('test_themed'), seed);
    const b = schedule.rollPackBp(schedule.resolvePack('test_themed'), seed);
    assert.deepStrictEqual(a.shape, b.shape, 'the same seed reproduces the same shape');
    assert.deepStrictEqual(a.unit, b.unit, 'the same seed reproduces the same unit + seat');
    assert.deepStrictEqual(a.bonuses.map((x) => x.id), b.bonuses.map((x) => x.id), 'the same seed reproduces the same bonuses');

    // Transparent odds: the pack Dex card lists every table with its weights.
    const cardRes = await scheduleReq('GET', '/api/dex/card/pack/test_themed', scheduleP1.token, null);
    assert.strictEqual(cardRes.status, 200, 'pack Dex card resolves: ' + JSON.stringify(cardRes.body));
    assert.ok(Array.isArray(cardRes.body.card.bonus) && cardRes.body.card.bonus.length === 3, 'pack card exposes the bonus tables (transparent odds)');
    assert.ok(Array.isArray(cardRes.body.card.pool) && cardRes.body.card.pool.length >= 1, 'pack card exposes the unit pool with weights');

    for (const r of rows) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, r.itemUid);
  });

  await AT('REQ-0215 gacha: insufficient funds is a 409 -- nothing charged, nothing delivered, no roll to abandon', async () => {
    setLrdstBalance(scheduleP1.playerId, 5); // below the 10x cost
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 409, 'insufficient balance must 409: ' + JSON.stringify(rollRes.body));
    assert.strictEqual(rollRes.body.reason, 'insufficient_balance', 'the 409 carries a machine-readable reason');
    assert.strictEqual(schedule.readLrdstBalance(scheduleStorage.readProfile(scheduleP1.playerId).canvas), 5, 'a refused roll charges nothing');
    assert.strictEqual(schedule.listWarehouse(scheduleP1.playerId).length, 0, 'a refused roll delivers nothing');
  });

  // REQ-0215: the roll is delivered to the warehouse, so the warehouse cap is now
  // a real precondition. buyListing's "no partial settle" posture: validated
  // BEFORE the commit point, so a full warehouse costs the player nothing. This
  // DIVERGES from addToWarehouse's drop-on-overflow posture deliberately -- a
  // dropped dungeon reward is re-earnable, a dropped roll was paid for.
  await AT('REQ-0215 gacha: a full warehouse is a 409 BEFORE anything is charged (no partial settle)', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    const filler = [];
    for (let i = 0; i < schedule.WAREHOUSE_CAP; i++) {
      const id = 'cap_filler_' + i + '_' + Date.now();
      scheduleStorage.writeWarehouseItem(scheduleP1.playerId, id, {
        itemUid: id, playerId: scheduleP1.playerId, itemId: 'blade',
        harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString(),
        status: 'claimable',
      });
      filler.push(id);
    }
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 409, 'a full warehouse must refuse the roll: ' + JSON.stringify(rollRes.body));
    assert.strictEqual(rollRes.body.reason, 'warehouse_full', 'the 409 says WHY, so the client can tell the player what to do about it');
    assert.strictEqual(schedule.readLrdstBalance(scheduleStorage.readProfile(scheduleP1.playerId).canvas), 999, 'REQ-0215: a roll refused for capacity charges NOTHING -- the cap check precedes the commit point');
    assert.strictEqual(schedule.listWarehouse(scheduleP1.playerId).length, schedule.WAREHOUSE_CAP, 'no row was added');
    for (const id of filler) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, id);
  });

  await AT('gacha: unknown kind is a 400', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    const res = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'not_a_real_kind' });
    assert.strictEqual(res.status, 400);
  });

  await AT('gacha: admin grant supports tm+qty (grantTmQty via POST /api/admin/warehouse/grant {tm,qty}) -- lands in the WAREHOUSE with a qty field, not directly in the live profile', async () => {
    const beforeDoc = scheduleStorage.readProfile(adminGuest.playerId);
    const res = await new Promise((resolve, reject) => {
      const req2 = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ tm: 'lrdst', qty: 42 }), authHeaders(adminGuest.token));
      const res2 = mockRes((b) => { let parsed = null; try { parsed = JSON.parse(b); } catch (e) {} resolve({ status: res2.statusCode, body: parsed }); });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
    assert.strictEqual(res.status, 200, 'tm+qty grant must succeed for an item_admin: ' + JSON.stringify(res.body));
    assert.strictEqual(res.body.item.itemId, 'lrdst');
    assert.strictEqual(res.body.item.qty, 42, 'granted warehouse row carries the qty field');
    assert.strictEqual(res.body.item.kind, 'tm', 'granted row is tagged kind:"tm"');
    const afterDoc = scheduleStorage.readProfile(adminGuest.playerId);
    assert.deepStrictEqual(afterDoc, beforeDoc, 'the grant must NOT touch the live profile at all -- warehouse only, avoids dual-writer clobber');
    const rows = schedule.listWarehouse(adminGuest.playerId);
    const found = rows.find((r) => r.itemId === 'lrdst' && r.qty === 42);
    assert.ok(found, 'the qty:42 lrdst row is visible via listWarehouse');
    scheduleStorage.deleteWarehouseItem(adminGuest.playerId, found.itemUid); // cleanup
  });

  await AT('gacha: admin grant rejects an unknown tm id (400)', async () => {
    const res = await new Promise((resolve, reject) => {
      const req2 = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ tm: 'not_a_real_tm', qty: 5 }), authHeaders(adminGuest.token));
      const res2 = mockRes((b) => { let parsed = null; try { parsed = JSON.parse(b); } catch (e) {} resolve({ status: res2.statusCode, body: parsed }); });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
    assert.strictEqual(res.status, 400);
  });

  await AT('gacha: claiming a TM warehouse row that MERGES into an existing same-id inventory stack still finalizes (deletes) the warehouse row -- regression test for a real bug where a merged claim never leaves its own uid anywhere in the saved canvas, so uid-only finalize logic left the row stuck in claiming status forever', async () => {
    // Seed an EXISTING lrdst stack directly into the players own
    // inventory (mirrors the clients firstFitOrMergeTM merge branch,
    // which lands the claim on the EXISTING stacks own cell, discarding
    // the claimed rows uid entirely -- see mock-src/engine.js tmMove doc:
    // the destination stack uid persists and the dragged one is
    // discarded).
    const existingDoc = scheduleStorage.readProfile(scheduleP1.playerId);
    existingDoc.canvas.inv.pages[0].tms = existingDoc.canvas.inv.pages[0].tms || [];
    existingDoc.canvas.inv.pages[0].tms.push({ uid: 'existing_lrdst_stack', id: 'lrdst', qty: 50, cell: [8, 8] });
    scheduleStorage.writeProfile(scheduleP1.playerId, existingDoc.canvas);

    const whId = 'claim_tm_merge_' + Date.now();
    schedule.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'lrdst', kind: 'tm', qty: 25, harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    // REQ-0215: the client sends the merge target's OWN cell as its fit result;
    // the server's one-spot test accepts it because tmCanPlace reports a same-id
    // stack as a legal merge target (idIfNew), not an 'occupied' rejection.
    const claimRes = await claimReq(scheduleP1, whId, { page: 0, position: [8, 8] });
    assert.strictEqual(claimRes.status, 200, JSON.stringify(claimRes.body));
    assert.deepStrictEqual(claimRes.body.position, [8, 8], 'the validated merge-target cell is echoed back');
    assert.ok(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), 'claiming row exists before the client merges it in');

    // Simulate the clients merge: the claimed rows OWN uid never
    // appears anywhere in the saved canvas (it was discarded by the
    // merge) -- only the pre-existing 'existing_lrdst_stack' uid, now
    // carrying the summed qty.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const stack = doc.canvas.inv.pages[0].tms.find((t) => t.uid === 'existing_lrdst_stack');
    stack.qty += 25;
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200, 'profile PUT (the auto-save after the merge) must succeed: ' + JSON.stringify(putRes.body));

    assert.strictEqual(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), null, 'the claiming row must finalize (be deleted) even though its OWN uid never appears in the saved canvas -- a same-id tms[] stack existing anywhere is sufficient finalize evidence for a TM-kind claim');
  });

};
