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
    scheduleP1, scheduleP2, scheduleReq, fillAllSlotsSnapshotsFrom } = h;

// =====================================================================
  // REQ-0042: Workshop gacha (POST /api/workshop/gacha) tests. Uses the
  // SAME scheduleP1/scheduleReq fixtures as the warehouse claim tests
  // above -- a gacha roll is fundamentally the same two-phase shape
  // (pending -> finalize-on-PUT -> lazy-revert), just against its own
  // gacha_pending store (see schedule.cjs's startGachaRoll/
  // finalizeGachaForCanvas doc comments) with a stricter finalize
  // condition (uid-presence AND balance-delta, not uid-presence alone).
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

  await AT('gacha: happy path -- balance 999->989 after one common_bp roll (cost 10), rolled BP uid appears in the response, finalizes on the next PUT containing both the deduction and the uid', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);

    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 200, 'roll must succeed: ' + JSON.stringify(rollRes.body));
    assert.strictEqual(rollRes.body.cost, 10, 'cost echoed back is the REQ doc\'s 10x LRDST');
    const rolled = rollRes.body.rolled;
    assert.ok(rolled && rolled.uid, 'rolled BP definition includes a minted uid');
    assert.ok(Array.isArray(rolled.shape) && rolled.shape.length >= 6 && rolled.shape.length <= 8, 'rolled shape has 6-8 cells: ' + JSON.stringify(rolled.shape));
    // REQ-0170: a roll emits a UNIT -- an identity from the pack's pool -- not an
    // anonymous 1-3 random dirs array. Its rays come from its def's connection_shape,
    // so what must hold here is that the id is a REAL def and its shape a REAL vocab
    // key; a rolled dirs array is exactly the thing that no longer exists.
    assert.ok(rolled.unit && typeof rolled.unit.id === 'string', 'rolled BP carries a unit identity');
    assert.ok(['test_queen', 'test_rook', 'test_loner'].includes(rolled.unit.id), 'the unit is drawn from the pack pool, got: ' + rolled.unit.id);
    assert.ok(rolled.unitDef && rolled.unitDef.id === rolled.unit.id, 'the response echoes the unit def for the result modal');
    assert.ok(['queen', 'rook', 'none'].includes(rolled.unitDef.connection_shape), 'the def names a real connection_shape');
    assert.strictEqual(rolled.linker, undefined, 'the retired linker field is GONE -- not renamed, not shadowed');
    const unitInShape = rolled.shape.some(([r, c]) => r === rolled.unit.off[0] && c === rolled.unit.off[1]);
    assert.ok(unitInShape, 'rolled unit cell is one of the polyomino\'s own cells');
    assert.strictEqual(rolled.hpMax, 15 * rolled.shape.length, 'hpMax = 15 x cellCount');

    // Server must NOT have deducted anything yet -- balance still 999,
    // matching the two-phase design (client deducts + auto-saves).
    const beforeFinalize = scheduleStorage.readProfile(scheduleP1.playerId);
    assert.strictEqual(schedule.readLrdstBalance(beforeFinalize.canvas), 999, 'server has not deducted balance server-side yet (two-phase)');

    // Simulate the CLIENT's own deduction + first-fit placement + auto-save.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.inv.pages[0].tms.find((t) => t.uid === 'lrdst_test_stack').qty -= 10; // 999 -> 989
    doc.canvas.inv.pages[1].bps.push({ id: rolled.uid, name: 'Rolled BP', color: '#888888', shape: rolled.shape, origin: [1, 1], unit: rolled.unit, hpMax: rolled.hpMax });
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200, 'auto-save PUT must succeed: ' + JSON.stringify(putRes.body));

    const afterDoc = scheduleStorage.readProfile(scheduleP1.playerId);
    assert.strictEqual(schedule.readLrdstBalance(afterDoc.canvas), 989, 'balance is 989 after the client deduction lands');
    assert.strictEqual(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), null, 'pending roll finalized (deleted) once BOTH the uid AND the balance-delta are present in the saved canvas');
  });

  await AT('gacha: REQ-0062 themed pack -- guaranteed BP PLUS bonus slots (po/si/tm) from per-pack sub-streams; bonuses echoed on the roll and stored on the pending doc; the pack Dex card exposes the transparent odds tables; finalize stays BP-uid+balance gated', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
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

    // Determinism: the SAME stored master seed reproduces the SAME bonuses (house RNG
    // discipline -- per-pack, per-slot labeled sub-streams).
    const pend = scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid);
    assert.ok(pend && Array.isArray(pend.rolled.bonuses) && pend.rolled.bonuses.length === 3, 'pending doc stores the rolled bonuses');
    const reroll = schedule.rollPackBp(schedule.resolvePack('test_themed'), pend.seed);
    assert.deepStrictEqual(reroll.bonuses.map((b) => b.id), rolled.bonuses.map((b) => b.id), 'bonuses are reproducible from the stored seed');

    // Transparent odds: the pack Dex card lists every table with its weights.
    const cardRes = await scheduleReq('GET', '/api/dex/card/pack/test_themed', scheduleP1.token, null);
    assert.strictEqual(cardRes.status, 200, 'pack Dex card resolves: ' + JSON.stringify(cardRes.body));
    assert.ok(Array.isArray(cardRes.body.card.bonus) && cardRes.body.card.bonus.length === 3, 'pack card exposes the bonus tables (transparent odds)');
    assert.ok(Array.isArray(cardRes.body.card.pool) && cardRes.body.card.pool.length >= 1, 'pack card exposes the unit pool with weights');

    // Finalize is UNCHANGED: BP uid present + balance dropped by the cost.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.inv.pages[0].tms.find((t) => t.uid === 'lrdst_test_stack').qty -= 20; // 999 -> 979
    doc.canvas.inv.pages[1].bps.push({ id: rolled.uid, name: 'Themed BP', color: '#888888', shape: rolled.shape, origin: [1, 1], unit: rolled.unit, hpMax: rolled.hpMax });
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200, 'auto-save PUT must succeed: ' + JSON.stringify(putRes.body));
    assert.strictEqual(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), null, 'themed pack finalizes on BP uid + balance drop (bonuses ride along, not independently gated)');
  });

  await AT('gacha: insufficient funds (balance < cost) is a 409, no pending row created', async () => {
    setLrdstBalance(scheduleP1.playerId, 5); // below the 10x cost
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 409, 'insufficient balance must 409: ' + JSON.stringify(rollRes.body));
    const pending = scheduleStorage.listGachaPending(scheduleP1.playerId);
    assert.strictEqual(pending.filter((p) => p.status === 'pending').length, 0, 'no pending row left behind by a rejected roll');
  });

  await AT('gacha: finalize requires BOTH the uid to be present AND the balance to have actually dropped -- placing the BP WITHOUT paying does not finalize', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 200);
    const rolled = rollRes.body.rolled;

    // Place the BP but do NOT deduct the LRDST cost -- an attempted
    // "forge" of a free roll.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.inv.pages[2].bps.push({ id: rolled.uid, name: 'Rolled BP', color: '#888888', shape: rolled.shape, origin: [1, 1], unit: rolled.unit, hpMax: rolled.hpMax });
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200);

    assert.ok(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), 'pending roll must NOT finalize -- uid present but balance never dropped');

    // Now also pay -- a SECOND PUT with the deduction applied finalizes it.
    const doc2 = scheduleStorage.readProfile(scheduleP1.playerId);
    doc2.canvas.inv.pages[0].tms.find((t) => t.uid === 'lrdst_test_stack').qty -= 10;
    const putRes2 = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc2.canvas);
    assert.strictEqual(putRes2.status, 200);
    assert.strictEqual(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), null, 'now finalizes once the balance ALSO actually dropped');
  });

  await AT('gacha: an abandoned pending roll (never finalized) lazily reverts -- the pending doc is deleted after the timeout, discovered on the next read', async () => {
    setLrdstBalance(scheduleP1.playerId, 999);
    const rollRes = await scheduleReq('POST', '/api/workshop/gacha', scheduleP1.token, { kind: 'common_bp' });
    assert.strictEqual(rollRes.status, 200);
    const rolled = rollRes.body.rolled;
    assert.ok(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), 'pending row exists right after the roll');

    // Force it to look abandoned -- backdate rolledAt past the timeout
    // (same backdate-a-timestamp convention forceRunElapsed/the abandoned-
    // claim test above use).
    const pendingDoc = scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid);
    pendingDoc.rolledAt = new Date(Date.now() - schedule.GACHA_PENDING_TIMEOUT_MS - 5000).toISOString();
    scheduleStorage.writeGachaPending(scheduleP1.playerId, rolled.uid, pendingDoc);

    // Any read of the pending store (purgeExpiredGachaPending, called by
    // finalizeGachaForCanvas/startGachaRoll) lazily deletes it.
    schedule.purgeExpiredGachaPending(scheduleP1.playerId);
    assert.strictEqual(scheduleStorage.readGachaPending(scheduleP1.playerId, rolled.uid), null, 'abandoned roll is gone after the timeout -- player can roll again, no stuck pending state');
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
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, JSON.stringify(claimRes.body));
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
