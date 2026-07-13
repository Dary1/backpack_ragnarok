'use strict';
// server/tests/api/warehouse.cjs -- REQ-0145a (sf): the warehouse flow group (victory rewards
// landing, 200-row cap, two-phase claim + SI claim + finalization).
// The test names carry the monolith's 'schedule:' prefix -- kept
// verbatim (renaming test names would break log-diffing against old
// runs for zero behavioral gain).
// Cut VERBATIM from server/tests/api_test.cjs origin lines 1483-1665 @
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

  await AT('schedule: victory rewards land in the warehouse with a harvestedAt + 7-day expiresAt (golden e)', async () => {
    // Defensive: clear any warehouse items left by earlier tests in this
    // group (each of which is supposed to clean up after itself, but this
    // assertion cares about an EXACT count, so start from a known-empty slate).
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    const runId = roomAfter.body.room.lastRunId;
    const runRaw = scheduleStorage.readRun(runId);
    assert.strictEqual(runRaw.result, 'victory', 'the test_sword fixture (50dmg/1s) must reliably one-shot the 1hp weak_slime fixture');

    forceRunElapsed(runId);
    const settledView = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle
    assert.strictEqual(settledView.body.room.status, 'open', 'settled room returns to open (cooldown, not canceled)');
    assert.ok(settledView.body.room.cooldownUntil, 'cooldownUntil must be set after a settled run');

    const wh = await scheduleReq('GET', '/api/warehouse', scheduleP1.token);
    assert.strictEqual(wh.status, 200);
    // REQ-0042: a victorious run now ALSO drops a single aggregate LRDST
    // reward row (kind:'tm', qty>0) alongside the 2 item rewards -- 3
    // rows total in this fixture dungeon (1 pack + 1 boss item reward,
    // plus 1 lrdst row covering both encounters' LRDST rolls).
    assert.strictEqual(wh.body.items.length, 3, 'both encounters (pack + boss) award one reward item each, PLUS one aggregate LRDST reward row (REQ-0042)');
    const lrdstRows = wh.body.items.filter((i) => i.kind === 'tm' && i.itemId === 'lrdst');
    assert.strictEqual(lrdstRows.length, 1, 'exactly one aggregate LRDST reward row for the whole run');
    assert.ok(lrdstRows[0].qty > 0, 'LRDST reward row carries a positive qty: ' + JSON.stringify(lrdstRows[0]));
    // Range sanity: 1 non-boss (pack) encounter [1-3] + 1 boss encounter
    // [5-10] cleared in this fixture dungeon -> total in [1+5, 3+10] = [6,13].
    assert.ok(lrdstRows[0].qty >= 6 && lrdstRows[0].qty <= 13, 'LRDST qty within the expected combined pack+boss range: got ' + lrdstRows[0].qty);
    for (const item of wh.body.items) {
      assert.ok(item.harvestedAt, 'harvestedAt present');
      assert.ok(item.expiresAt, 'expiresAt present');
      const ttlMs = Date.parse(item.expiresAt) - Date.parse(item.harvestedAt);
      assert.ok(Math.abs(ttlMs - schedule.WAREHOUSE_TTL_MS) < 1000, 'TTL must be ~7 days (golden e): got ' + ttlMs + 'ms');
    }
    // Cleanup: clear warehouse for later cap tests + cancel the room.
    for (const item of wh.body.items) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: warehouse cap (200 items) is enforced -- the 201st insert is refused, no reverse inventory->warehouse path exists', async () => {
    const before = schedule.listWarehouse(scheduleP1.playerId);
    for (const item of before) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid); // start from a clean slate
    for (let i = 0; i < schedule.WAREHOUSE_CAP; i++) {
      const r = schedule.addToWarehouse(scheduleP1.playerId, {
        itemUid: 'cap_' + i, playerId: scheduleP1.playerId, itemId: 'blade',
        harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + schedule.WAREHOUSE_TTL_MS).toISOString(),
      });
      assert.strictEqual(r.ok, true, 'insert ' + i + ' should succeed under the cap');
    }
    assert.strictEqual(schedule.listWarehouse(scheduleP1.playerId).length, schedule.WAREHOUSE_CAP);
    const overflow = schedule.addToWarehouse(scheduleP1.playerId, {
      itemUid: 'cap_overflow', playerId: scheduleP1.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + schedule.WAREHOUSE_TTL_MS).toISOString(),
    });
    assert.strictEqual(overflow.ok, false, 'the 201st insert must be refused');
    assert.strictEqual(schedule.listWarehouse(scheduleP1.playerId).length, schedule.WAREHOUSE_CAP, 'cap must not be exceeded');

    // No reverse (inventory -> warehouse) path: schedule.cjs's module
    // exports contain no such function at all -- this is a structural
    // assertion, not a behavioral one (there is nothing to call).
    assert.strictEqual(typeof schedule.moveInventoryToWarehouse, 'undefined', 'no inventory->warehouse function must exist (golden r ban, generalized ahead of P3)');

    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
  });

  // REQ-0041: REWRITTEN for the two-phase claim design (bug #3 fix --
  // see schedule.cjs's claimWarehouseItem doc for the full root-cause
  // writeup: the OLD version's server-side first-fit + storage.writeProfile
  // raced the client's own debounced auto-save PUT and could silently
  // lose the claimed item). The OLD assertions here (claim placing the
  // item server-side, a 409 for "no inventory space") are now WRONG --
  // the server never touches profileCanvas/inventory space on claim at
  // all anymore; first-fit placement is entirely the CLIENT's job.
  await AT('schedule: two-phase claim -- POST /api/warehouse/claim marks the row "claiming" and returns {itemUid,itemId} WITHOUT touching the profile; a claiming row cannot be claimed again (409); an unknown/expired uid is 404', async () => {
    const whId = 'claim_test_' + Date.now();
    schedule.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'blade', harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    const beforeDoc = scheduleStorage.readProfile(scheduleP1.playerId);

    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, 'claim must succeed: ' + JSON.stringify(claimRes.body));
    assert.strictEqual(claimRes.body.itemUid, whId, 'response echoes the warehouse row\'s own itemUid (the client reuses this AS the new inventory uid)');
    assert.strictEqual(claimRes.body.itemId, 'blade', 'response carries the CONTENT def id so the client can run engine first-fit itself');
    assert.strictEqual(claimRes.body.placed, undefined, 'the two-phase response must NOT report a server-side placement -- there is none');

    // The row must still exist (not deleted) but now be 'claiming', and
    // the profile must be COMPLETELY untouched by the claim call itself
    // -- this is the crux of bug #3's fix: no second writer.
    const row = scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId);
    assert.ok(row, 'claiming row must still exist (not deleted) -- only status changes');
    assert.strictEqual(row.status, 'claiming');
    assert.ok(row.claimedAt, 'claimedAt must be set');
    const afterDoc = scheduleStorage.readProfile(scheduleP1.playerId);
    assert.deepStrictEqual(afterDoc.canvas, beforeDoc.canvas, 'claim must NOT mutate the profile canvas at all (server is no longer a writer on this path)');

    // A 'claiming' row is not visible as claimable and cannot be claimed
    // again -- 409, not a silent double-claim.
    const doubleClaimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(doubleClaimRes.status, 409, 'claiming an already-claiming row must 409: ' + JSON.stringify(doubleClaimRes.body));

    // Clean up: revert this row back to claimable via the same mechanism
    // production code uses (direct storage write, matching how a real
    // lazy-timeout revert would leave it) so later tests in this file see
    // a clean warehouse state.
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, whId);

    // Unknown/nonexistent uid -- 404 (unchanged from the old behavior).
    const notFoundRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: 'no_such_uid_' + Date.now() });
    assert.strictEqual(notFoundRes.status, 404);

    // TTL: an already-expired item never surfaces via claim (lazily purged) -- unchanged.
    const expiredId = 'claim_test_expired_' + Date.now();
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, expiredId, { itemUid: expiredId, playerId: scheduleP1.playerId, itemId: 'blade', harvestedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    const claimExpiredRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: expiredId });
    assert.strictEqual(claimExpiredRes.status, 404, 'an expired warehouse item must 404 on claim (lazily purged)');
    assert.strictEqual(scheduleStorage.readWarehouseItem(scheduleP1.playerId, expiredId), null, 'expired item must actually be deleted by the purge');
  });

  // REQ-0115: a granted SI must also be CLAIMABLE onto the canvas -- the
  // non-tm claim branch validated against itemDefsById (PO-only), so an SI
  // row 400'd as "unknown content item id". Now accepts SI ids too.
  await AT('REQ-0115 claim: POST /api/warehouse/claim accepts an SI warehouse row (acc_gem) -- 200, echoes itemId, marks claiming (regression: was BAD_REQUEST unknown content item id)', async () => {
    const scheduleSi = require('../../schedule.cjs');
    const whId = 'claim_si_test_' + Date.now();
    scheduleSi.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'acc_gem', harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, 'SI claim must succeed: ' + JSON.stringify(claimRes.body));
    assert.strictEqual(claimRes.body.itemId, 'acc_gem', 'response carries the SI content id for client-side placement');
    assert.strictEqual(claimRes.body.kind, undefined, 'a plain SI row is not kind:tm');
    const row = scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId);
    assert.ok(row && row.status === 'claiming', 'SI row must be marked claiming, not deleted');
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, whId);
  });

  await AT('schedule: two-phase claim finalization -- a profile PUT containing the claimed itemUid deletes the warehouse row; a claiming row older than the timeout lazily reverts to claimable and is claimable again', async () => {
    const whId = 'claim_finalize_' + Date.now();
    schedule.addToWarehouse(scheduleP1.playerId, { itemUid: whId, playerId: scheduleP1.playerId, itemId: 'blade', harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString() });
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: whId });
    assert.strictEqual(claimRes.status, 200, JSON.stringify(claimRes.body));
    assert.ok(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), 'claiming row exists before the client places it');

    // Simulate the CLIENT's own engine first-fit placement + auto-save:
    // place a PO whose uid is the warehouse row's own itemUid (per the
    // two-phase design, the client reuses itemUid AS the new PO's uid --
    // see schedule.cjs's claimWarehouseItem doc) into an empty inventory
    // page, then PUT the profile exactly as store.ts's flushAutoSave
    // would.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.inv.pages[0].pos.push({ uid: whId, id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 });
    const putRes = await scheduleReq('PUT', '/api/profile/' + scheduleP1.playerId + '/canvas', scheduleP1.token, doc.canvas);
    assert.strictEqual(putRes.status, 200, 'profile PUT (the client\'s auto-save) must succeed: ' + JSON.stringify(putRes.body));

    // The profile PUT handler must have finalized (deleted) the claiming
    // row as a side effect, since whId now appears in the saved canvas.
    assert.strictEqual(scheduleStorage.readWarehouseItem(scheduleP1.playerId, whId), null, 'claiming row must be deleted once its uid lands in a saved canvas (server finalizes on save)');

    // Simulated ABANDONED claim: force a 'claiming' row with an old
    // claimedAt (older than WAREHOUSE_CLAIM_TIMEOUT_MS) via direct
    // data-file manipulation (mirrors this file's own forceRunElapsed()
    // helper's backdate-a-timestamp pattern) -- must lazily revert to
    // 'claimable' (and thus be claimable again) the next time warehouse
    // rows are read, WITHOUT ever losing the item.
    const abandonedId = 'claim_abandoned_' + Date.now();
    const oldClaimedAt = new Date(Date.now() - schedule.WAREHOUSE_CLAIM_TIMEOUT_MS - 5000).toISOString();
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, abandonedId, {
      itemUid: abandonedId, playerId: scheduleP1.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString(),
      status: 'claiming', claimedAt: oldClaimedAt,
    });
    // listWarehouse (GET /api/warehouse) triggers the lazy revert via
    // purgeExpiredWarehouseItems -> normalizeWarehouseStatus.
    const listed = schedule.listWarehouse(scheduleP1.playerId);
    const found = listed.find((i) => i.itemUid === abandonedId);
    assert.ok(found, 'abandoned row must still be present (never lost)');
    assert.strictEqual(found.status, 'claimable', 'abandoned row must have lazily reverted to claimable after the timeout');
    assert.strictEqual(found.claimedAt, null, 'claimedAt must be cleared on revert');
    const reclaimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: abandonedId });
    assert.strictEqual(reclaimRes.status, 200, 'a reverted-to-claimable row must be claimable again: ' + JSON.stringify(reclaimRes.body));
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, abandonedId); // cleanup
  });

};
