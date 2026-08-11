'use strict';
// server/tests/api/schedule.cjs -- REQ-0145a (sf): the REQ-0036 P1-B Dungeon Schedule core group
// (rooms CRUD/auth isolation, deploy gate v2, runs/replay) + the shared
// schedule fixtures (scheduleReq, scheduleP1/P2, canvas helpers) every
// later suite reuses.
// Cut VERBATIM from server/tests/api_test.cjs origin lines 1016-1482 @
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
    fakeRepoHome, repoRoot, contentDir, liveDir, batchDir, fixtureLiveDungeonDir } = h;

  // =====================================================================
  // REQ-0036 P1-B: Dungeon Schedule + Warehouse test group. Runs against
  // the SAME synthetic fakeRepoHome/repoRoot fixture as the tests above
  // (os.homedir() is still pointed there) -- schedule.cjs resolves its
  // own content paths (content/live/*.json, content/batches/batch-002-
  // dungeon-pilot/*.json) the same mtime-cached way api.cjs's
  // buildContentPayload() does, so the tiny fixture dungeon written
  // above (batchDir: 'test_dungeon', one weak_slime pack + boss) is what
  // every schedule test below actually runs.
  // =====================================================================
  const schedule = require('../../schedule.cjs');
  const scheduleStorage = require('../../storage.cjs');

  // Builds a fresh, internally-independent profile canvas: 4 squads
  // (indices 0-3), each with ITS OWN uniquely-tagged BP + a placed
  // 'test_sword' PO wired to attack (every_secs strike, see the
  // live_items.json fixture above) so a real sim run reliably kills the
  // 1hp weak_slime fixture enemy fast. Every uid across all 4 squads is
  // globally unique (tagged by squad index) so isSquadIndependent() is
  // true for every one of them against each other -- tests that need an
  // independence VIOLATION deliberately clone one squad's uids into
  // another below.
  function makeTestCanvas() {
    function squadCanvas(tag) {
      return {
        linked: true,
        bps: [{ id: 'bp_' + tag, name: 'BP ' + tag, color: '#888888', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 40 }],
        pos: [{ uid: 'po_' + tag, id: 'test_sword', loc: 'grid', cell: [1, 1], rot: 0 }],
        sis: [],
      };
    }
    const p0 = squadCanvas('t0'), p1 = squadCanvas('t1'), p2 = squadCanvas('t2'), p3 = squadCanvas('t3');
    return Object.assign({}, p0, {
      layout: { ROWS: 8, COLS: 8 },
      inv: { pages: [{ bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }, { bps: [], pos: [], sis: [] }], names: ['1', '2', '3', '4', '5'] },
      presets: { active: 0, names: ['P1', 'P2', 'P3', 'P4', 'P5'], store: [null, p1, p2, p3, null] },
    });
  }

  function fillAllSlots(scheduleApi, room, callerId, canvas, itemDefsById) {
    let r = room;
    for (let i = 0; i < 4; i++) r = scheduleApi.assignSlot(r, callerId, i, i, canvas, itemDefsById);
    return r;
  }

  // Force a run's clock to read as fully elapsed, without a real sleep --
  // rewrites startedAt into the past by (durationSecs + margin) seconds.
  function forceRunElapsed(runId) {
    const run = scheduleStorage.readRun(runId);
    run.startedAt = new Date(Date.now() - (run.durationSecs + 5) * 1000).toISOString();
    scheduleStorage.writeRun(runId, run);
  }

  const scheduleP1 = playersFixture.createPlayer('ScheduleP1', []);
  const scheduleP2 = playersFixture.createPlayer('ScheduleP2', []);
  scheduleStorage.writeProfile(scheduleP1.playerId, makeTestCanvas());
  scheduleStorage.writeProfile(scheduleP2.playerId, makeTestCanvas());

  function scheduleReq(method, urlPath, token, body) {
    return new Promise((resolve, reject) => {
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const req2 = mockReq(method, urlPath, bodyStr, authHeaders(token));
      const res2 = mockRes((b) => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { /* leave null */ }
        resolve({ status: res2.statusCode, body: parsed });
      });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
  }

  await AT('schedule: POST /api/schedule/rooms creates a room owned by the caller', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', cancelPolicy: { immediate: false } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.room.ownerId, scheduleP1.playerId);
    assert.strictEqual(res.body.room.visibility, 'self');
    assert.strictEqual(res.body.room.status, 'open');
    assert.strictEqual(res.body.room.slots.length, 4);
  });

  await AT('schedule: GET /api/schedule/rooms lists only the caller\'s own rooms', async () => {
    const before = await scheduleReq('GET', '/api/schedule/rooms', scheduleP2.token);
    assert.strictEqual(before.body.rooms.length, 0, 'ScheduleP2 has created no rooms yet');
    await scheduleReq('POST', '/api/schedule/rooms', scheduleP2.token, { dungeonId: 'test_dungeon', level: 1 });
    const after = await scheduleReq('GET', '/api/schedule/rooms', scheduleP2.token);
    assert.strictEqual(after.body.rooms.length, 1);
    const p1List = await scheduleReq('GET', '/api/schedule/rooms', scheduleP1.token);
    assert.ok(p1List.body.rooms.length >= 1, 'ScheduleP1 still sees its own room from the prior test');
    assert.ok(p1List.body.rooms.every((r) => r.ownerId === scheduleP1.playerId), 'every listed room belongs to the caller');
  });

  await AT('schedule: auth isolation -- player B cannot GET or DELETE player A\'s room (404, not 403)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const getRes = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    assert.strictEqual(getRes.status, 404, 'cross-player GET must 404, never 403 (no existence leak)');
    const delRes = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    assert.strictEqual(delRes.status, 404, 'cross-player DELETE must 404');
    // Sanity: the OWNER can still see it fine.
    const ownGet = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(ownGet.status, 200);
  });

  await AT('schedule: invalid token is rejected with 401 on every schedule route', async () => {
    const res = await scheduleReq('GET', '/api/schedule/rooms', 'totally-bogus-token-value');
    assert.strictEqual(res.status, 401);
    assert.ok(String(res.body.error).startsWith('unauthorized: '), '401 wording: ' + res.body.error);
  });

  // REQ-0145a (se): the combined schedule/warehouse/workshop route module
  // splits into three files -- pin the 401 preamble (status AND wording)
  // for the warehouse and workshop families too, one representative route
  // each, BEFORE the split, so the extracted shared preamble
  // (lib/route_auth.cjs) provably reproduces today's behavior for every
  // family, not just schedule rooms.
  await AT('warehouse: invalid token is rejected with 401 (same preamble wording)', async () => {
    const res = await scheduleReq('GET', '/api/warehouse', 'totally-bogus-token-value');
    assert.strictEqual(res.status, 401);
    assert.ok(String(res.body.error).startsWith('unauthorized: '), '401 wording: ' + res.body.error);
  });

  await AT('workshop: invalid token is rejected with 401 (same preamble wording)', async () => {
    const res = await scheduleReq('POST', '/api/workshop/gacha', 'totally-bogus-token-value', { kind: 'common_bp' });
    assert.strictEqual(res.status, 401);
    assert.ok(String(res.body.error).startsWith('unauthorized: '), '401 wording: ' + res.body.error);
  });

  // REQ-0045 (b)+(c): deploy gate v2 replaces isSquadIndependent-as-gate
  // (a STATIC, warehouse-wide "does this squad share any uid with ANY
  // OTHER squad anywhere" check -- the yellow-tint concept) with a
  // DYNAMIC deployed-overlap check (deployedUidSetsForGate in
  // server/schedule.cjs): a squad is assignable iff its uid set does
  // not intersect any uid set ACTUALLY deployed right now, either in
  // this same room's OTHER slots or in another of the caller's currently
  // ACTIVE rooms. The three tests below cover the three distinct
  // scenarios the old gate got wrong or never had to distinguish:
  //   1. yellow-but-idle (shares a uid with an undeployed sibling
  //      squad) must now DEPLOY OK -- the old gate refused this
  //      unconditionally, which was bug (b).
  //   2. duplicate squadIndex assigned to two slots of the SAME room
  //      must be REFUSED (identical uid sets, so trivially overlapping)
  //      -- the old gate ALLOWED this (it only ever consulted
  //      isSquadIndependent, a warehouse-wide static property, never the
  //      room's own other slots), which was one half of bug (c).
  //   3. four mutually-unique squads filling all 4 slots of one room
  //      must SUCCEED and auto-start -- the old gate refused this
  //      whenever any one of the 4 happened to share a uid with some
  //      OTHER unrelated squad elsewhere in the warehouse (a false
  //      positive against a squad not even being deployed), which was
  //      the other half of bug (c). makeTestCanvas()'s squads 0-3 are
  //      already globally unique against each other by construction (see
  //      its own doc comment above), so fillAllSlots() below IS this
  //      scenario already -- asserted explicitly here as its own named
  //      test rather than only implicitly via the cross-room-overlap
  //      test further down.
  await AT('schedule: deploy gate v2 -- a squad sharing a uid with another of the caller\'s OWN squads, where that OTHER squad is NOT deployed anywhere, deploys OK (REQ-0045 b)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    // Make squad index 4 an EXACT duplicate of squad 0's uids --
    // guaranteed uid overlap between them ("yellow") -- but squad 4 is
    // NOT deployed anywhere (no room references it).
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const squad0Snapshot = { bps: doc.canvas.bps, pos: doc.canvas.pos, sis: doc.canvas.sis };
    doc.canvas.presets.store[4] = JSON.parse(JSON.stringify(squad0Snapshot));
    scheduleStorage.writeProfile(scheduleP1.playerId, doc.canvas);

    const res = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(res.status, 200, 'mere cross-squad uid sharing (neither side deployed) must NOT block: ' + JSON.stringify(res.body));

    // Clean up: clear the duplicate + the room.
    const doc2 = scheduleStorage.readProfile(scheduleP1.playerId);
    doc2.canvas.presets.store[4] = null;
    scheduleStorage.writeProfile(scheduleP1.playerId, doc2.canvas);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: deploy gate v2 -- assigning the SAME squadIndex to a SECOND slot of the SAME room is refused 409 (REQ-0045 c: duplicates must be REFUSED)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const first = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 1 });
    assert.strictEqual(first.status, 200, 'slot 0 assign: ' + JSON.stringify(first.body));

    // Same squadIndex (1) into a DIFFERENT slot of the SAME room -- the
    // uid set is IDENTICAL to slot 0's, so this is a same-room duplicate-
    // deployment attempt. This must be refused regardless of the room's
    // own status (still 'open' here, not yet 'active') --
    // deployedUidSetsForGate checks this room's OWN other slots
    // unconditionally, not just once the room has gone active.
    const dup = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/1', scheduleP1.token, { squadIndex: 1 });
    assert.strictEqual(dup.status, 409, 'same-room duplicate squadIndex must be 409: ' + JSON.stringify(dup.body));
    // REQ-0168 U6: a same-room duplicate now carries its OWN structured
    // reason ('same_room_duplicate'), distinct from a cross-room overlap
    // ('deployed_overlap'), so the client can show a truthful, location-
    // correct message instead of the misleading cross-room one.
    assert.strictEqual(dup.body.reason, 'same_room_duplicate', 'the 409 body must carry a structured reason=same_room_duplicate');
    assert.ok(/another slot of this room/i.test(dup.body.error), 'same-room message names the location: ' + JSON.stringify(dup.body));

    // Room never reaches 4/4 filled, so it correctly never auto-starts.
    const view = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(view.body.room.status, 'open');
    assert.strictEqual(view.body.room.slots[1].squadIndex, null, 'the rejected duplicate assign must not have mutated slot 1');

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: deploy gate v2 -- four mutually-unique squads filling all 4 slots of one room succeeds and auto-starts (REQ-0045 c: unique-4 must start)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    // makeTestCanvas()'s squads 0-3 are globally unique against each
    // other (see its own doc comment above) -- filling all 4 slots with
    // them, one per slot, must succeed and auto-start a run.
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ' assign (unique squad ' + i + '): ' + JSON.stringify(r.body));
    }
    const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(after.body.room.status, 'active', 'four mutually-unique squads must auto-start the room\'s first run');

    // Cleanup: settle + clear rewards so later tests start from a clean
    // slate, mirroring the cross-room-overlap test's own cleanup below.
    const roomRaw = scheduleStorage.readRoom(roomId);
    forceRunElapsed(roomRaw.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: LIST endpoint (GET /api/schedule/rooms) settles a just-completed room too, not only the single-room GET (REQ-0087: expedition never departs)', async () => {
    // Root cause (REQ-0087): the live client's Rooms view (SchedulePage.tsx)
    // polls ONLY fetchRooms() -- GET /api/schedule/rooms, the LIST route --
    // every ROOMS_POLL_MS tick; it never calls fetchRoom(id) (the single-
    // room GET) in its normal render loop. Before this fix, listOwnRooms()
    // was a bare storage filter with no settleRoomIfDue() step, so a room
    // whose 4th (last) slot assignment JUST completed would keep reading
    // status 'open' forever from the ONLY endpoint real users' polling ever
    // hits -- even though every assignSlot PUT genuinely returned 200 and
    // nothing anywhere ever surfaced an error. This test deliberately never
    // touches the single-room GET, mirroring the live client exactly.
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ' assign (unique squad ' + i + '): ' + JSON.stringify(r.body));
    }
    const list = await scheduleReq('GET', '/api/schedule/rooms', scheduleP1.token);
    assert.strictEqual(list.status, 200);
    const room = list.body.rooms.find((r) => r.id === roomId);
    assert.ok(room, 'the just-created room must appear in the list response');
    assert.strictEqual(room.status, 'active', 'the LIST endpoint alone must observe the auto-start (REQ-0087) -- a real user never calls the single-room GET');

    // Cleanup: same pattern as the sibling REQ-0045(c) test above.
    const roomRaw = scheduleStorage.readRoom(roomId);
    forceRunElapsed(roomRaw.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: LIST endpoint -- one room whose settle THROWS (stale squadIndex after its squad was deleted out from under it) must not 400 the whole list or hide the caller\'s OTHER rooms (REQ-0087 follow-up, caught live)', async () => {
    // Live incident: right after REQ-0087's first fix deployed, the shared
    // dev account's own squad count changed (unrelated concurrent work)
    // AFTER a room's 4 slots had already been filled with now-out-of-range
    // indices. settleRoomIfDue() legitimately throws in that case
    // (startRun -> buildSquadSnapshots -> squadCanvasOf finds nothing at
    // that index any more) -- but the FIRST version of this fix let that
    // exception escape the whole listOwnRooms().map(), turning ONE stale
    // room into a 400 for the caller's ENTIRE rooms list. Reproduced here
    // by filling a room normally, then shrinking the SAME player's
    // squads.store out from under two of its already-assigned slots
    // (simulating a squad deleted after deployment) before ever letting
    // anything settle it.
    const goodCanvas = scheduleStorage.readProfile(scheduleP1.playerId).canvas;
    let roomAId, roomBId;
    try {
      const roomA = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
      roomAId = roomA.body.room.id;
      for (let i = 0; i < 4; i++) {
        const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomAId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
        assert.strictEqual(r.status, 200, 'slot ' + i + ' assign: ' + JSON.stringify(r.body));
      }
      // Corrupt: truncate store to 2 entries, stranding slots 2 and 3's
      // squadIndex references -- WITHOUT ever calling anything that would
      // settle roomA first (no single-room GET, no list call yet).
      const corrupted = JSON.parse(JSON.stringify(goodCanvas));
      corrupted.presets.store = corrupted.presets.store.slice(0, 2);
      scheduleStorage.writeProfile(scheduleP1.playerId, corrupted);

      const roomB = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
      roomBId = roomB.body.room.id;

      const list = await scheduleReq('GET', '/api/schedule/rooms', scheduleP1.token);
      assert.strictEqual(list.status, 200, 'roomA\'s settle failure must not 400 the whole list: ' + JSON.stringify(list.body));
      const gotA = list.body.rooms.find((r) => r.id === roomAId);
      const gotB = list.body.rooms.find((r) => r.id === roomBId);
      assert.ok(gotA, 'roomA (the one whose settle throws) must still be present, unsettled, not dropped');
      assert.ok(gotB, 'roomB (an unrelated healthy room) must be present and unaffected by roomA\'s failure');
      assert.strictEqual(gotB.status, 'open');
    } finally {
      // Cleanup ALWAYS runs (even on assertion failure) so a failure in
      // this test can never poison scheduleP1's shared canvas/rooms for
      // every test that runs after it in the same process.
      scheduleStorage.writeProfile(scheduleP1.playerId, goodCanvas);
      if (roomAId) await scheduleReq('DELETE', '/api/schedule/rooms/' + roomAId, scheduleP1.token);
      if (roomBId) await scheduleReq('DELETE', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    }
  });

  await AT('schedule: deploy gate -- a squad with ZERO BP is refused 409 empty_squad, and a squad with >=1 BP is unaffected (REQ-0041 feedback 5)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    // Squad index 4 starts life completely empty post-migration (REQ-0031:
    // "new squads start empty") -- 0 BPs, so it must be refused with a
    // STRUCTURED reason ('empty_squad'), distinct from the independence 409
    // above (an empty squad IS vacuously independent -- see mock-src/
    // tests/run.cjs's own "combine, don't conflate" test for this exact
    // distinction at the engine layer; this is the server-side half).
    const emptyRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 4 });
    assert.strictEqual(emptyRes.status, 409, 'zero-BP squad must be refused 409: ' + JSON.stringify(emptyRes.body));
    assert.strictEqual(emptyRes.body.reason, 'empty_squad', 'the 409 body must carry a structured reason=empty_squad');
    assert.ok(/no Backpack|empty squad/i.test(emptyRes.body.error));

    // Sanity: squad index 0 (the fixture's real, BP-bearing squad) is NOT
    // affected by this gate -- assigning it must still succeed 200.
    const okRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(okRes.status, 200, 'a squad WITH a BP must still be assignable: ' + JSON.stringify(okRes.body));

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: deploy gate -- a squad already deployed in another of the caller\'s ACTIVE rooms is refused 409 on cross-room overlap', async () => {
    // Room X: fill all 4 slots with squads 0-3 and start its run (-> status 'active').
    const roomXRes = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomXId = roomXRes.body.room.id;
    for (let i = 0; i < 4; i++) {
      const assignRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomXId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
      assert.strictEqual(assignRes.status, 200, 'slot ' + i + ' assign: ' + JSON.stringify(assignRes.body));
    }
    const roomXAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomXId, scheduleP1.token);
    assert.strictEqual(roomXAfter.body.room.status, 'active', 'room X must auto-start its first run once all 4 slots are filled');

    // Room Y: try to also deploy squad 0 (already active in room X) -> 409.
    const roomYRes = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomYId = roomYRes.body.room.id;
    const overlapRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomYId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(overlapRes.status, 409, 'cross-room overlap must be 409: ' + JSON.stringify(overlapRes.body));
    assert.ok(/active schedule/i.test(overlapRes.body.error));
    // REQ-0168 U6: cross-room overlap keeps the 'deployed_overlap' reason
    // (distinct from the same-room duplicate's 'same_room_duplicate').
    assert.strictEqual(overlapRes.body.reason, 'deployed_overlap', 'cross-room overlap must carry reason=deployed_overlap');

    // Cleanup: settle room X's run (force-elapse) so it doesn't leak into
    // later tests as still-active, then clear whatever it rewarded so
    // warehouse-count assertions in LATER tests start from a clean slate.
    const roomXRaw = scheduleStorage.readRoom(roomXId);
    forceRunElapsed(roomXRaw.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomXId, scheduleP1.token); // triggers settle
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomXId, scheduleP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomYId, scheduleP1.token);
  });

  await AT('schedule: run executes and persists a replay log + summary; fixed seed -> deterministic re-simulation', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });

    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active');
    const runId = roomAfter.body.room.lastRunId;
    assert.ok(runId, 'room must record its lastRunId');

    const runRaw = scheduleStorage.readRun(runId);
    assert.ok(Array.isArray(runRaw.events) && runRaw.events.length > 0, 'run must persist a non-empty replay log');
    assert.ok(['victory', 'wipe', 'incomplete'].includes(runRaw.result), 'run must persist a legal summary result');
    assert.strictEqual(typeof runRaw.seed, 'string', 'run must persist its crypto-random seed');
    assert.strictEqual(typeof runRaw.durationSecs, 'number');

    // Determinism: re-running combat.runDungeon with the SAME persisted
    // seed + same squad snapshots must reproduce the identical event log
    // (sim/combat.cjs's own documented determinism guarantee, exercised
    // here through the schedule service's actual persisted seed).
    const combat = require('../../../sim/combat.cjs');
    // REQ-0185: the dive is now ROLLED from the room's authored dungeon def
    // (sim/dungeon_roll.cjs) with the room's OWN genSeed -- re-derive it the same
    // way startRun does, then re-run with the persisted combat seed.
    const dungeonRoll = require('../../../sim/dungeon_roll.cjs');
    const { itemDefsById, dungeonDefsById, gimicDefsById, enemyDefsById, skillDefsById, monsterPackDefsById } = schedule.getScheduleContent(); // REQ-0184/0185
    const rmForReplay = roomAfter.body.room;
    const dungeonDef = dungeonRoll.rollDungeon(dungeonDefsById[rmForReplay.dungeonId], rmForReplay.level, rmForReplay.genSeed, { gimicDefsById });
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    const squadSnapshots = fillAllSlotsSnapshotsFrom(doc.canvas);
    const replay = combat.runDungeon({
      masterSeed: runRaw.seed, dungeonDef, squadSnapshots, itemDefsById, enemyDefsById, skillDefsById, monsterPackDefsById,
      formationId: 'formation1', level: 1, participants: [scheduleP1.playerId],
    });
    // Semantic (deep-equal) comparison, not raw string equality: in pg
    // mode, runRaw.events came back through a jsonb column, which (per
    // server/README.md's own documented caveat) reorders object keys
    // into Postgres's canonical order -- NOT byte-identical at the raw-
    // JSON-text level even though the DATA is identical. Files mode
    // preserves insertion order exactly, so this same assertion is
    // strictly stronger there; deepStrictEqual is the correct invariant
    // in BOTH backends (determinism is about the DATA, not incidental
    // key ordering introduced by a storage round-trip).
    assert.deepStrictEqual(replay.events, runRaw.events, 'same seed + same squad snapshots must reproduce a semantically-identical replay log');
    assert.strictEqual(replay.result, runRaw.result);

    // GET run: run-clock fields present, events is an array (possibly
    // truncated to what's "aired" so far -- immediately after start this
    // may be a strict subset of the full log).
    const runView = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.strictEqual(runView.status, 200);
    assert.ok(runView.body.clock && typeof runView.body.clock.elapsedSecs === 'number');
    assert.ok(Array.isArray(runView.body.events));
    assert.ok(runView.body.events.length <= runRaw.events.length, 'visible events must never exceed the full persisted log');

    // Cleanup: settle (this run also rewards -- clear those too) then cancel.
    forceRunElapsed(runId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  function fillAllSlotsSnapshotsFrom(canvas) {
    const active = { bps: canvas.bps, pos: canvas.pos, sis: canvas.sis };
    return [active, canvas.presets.store[1], canvas.presets.store[2], canvas.presets.store[3]];
  }

  // REQ-0240: presentation-pacing serving layer -- ApiRunView carries the
  // paced timeline (events gain `pt`), the roster (M1), pacingVersion (M2),
  // and durationSecs is now the PRESENTATION duration the player watches (the
  // "battle wait increase"); settle/cooldown ride that same paced clock.
  await AT('schedule: REQ-0240 run view carries roster + pacingVersion + paced pt; durationSecs is the presentation duration; settle rides pt', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active');
    const runId = roomAfter.body.room.lastRunId;

    const pacing = require('../../services/pacing.cjs');
    const runRaw = scheduleStorage.readRun(runId);
    // Stored log stays byte-clean (pt lives OFF the events, in run.presentation).
    assert.strictEqual(runRaw.pacingVersion, 1, 'a fresh run is paced (pacingVersion 1)');
    assert.ok(runRaw.presentation && Array.isArray(runRaw.presentation.pt), 'run.presentation.pt array is stored');
    assert.strictEqual(runRaw.presentation.pt.length, runRaw.events.length, 'one pt per event');
    assert.ok(runRaw.events.every((e) => e.pt === undefined), 'stored events must NOT carry pt (determinism/goldens stay intact)');

    // durationSecs is the PRESENTATION duration, clamped into [45,300]. The
    // tiny fixture stretches UP to the 45s floor -- this IS the battle-wait
    // increase (sim resolves instantly; presentation time is what grows).
    assert.ok(runRaw.durationSecs >= pacing.PACING.minPresentSecs - 1e-6, 'presentation duration must hit the >=45s floor: ' + runRaw.durationSecs);
    assert.ok(runRaw.durationSecs <= pacing.PACING.maxPresentSecs + 1e-6);
    assert.strictEqual(typeof runRaw.simDurationSecs, 'number', 'the legacy combat-time duration is preserved for seals');

    // Roster (M1): 4 slots with per-BP hpMax + enemy hints with numeric hpMax.
    const view0 = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.strictEqual(view0.body.pacingVersion, 1);
    assert.ok(view0.body.roster && Array.isArray(view0.body.roster.slots), 'roster.slots present');
    assert.strictEqual(view0.body.roster.slots.length, 4);
    assert.ok(view0.body.roster.slots.every((sl) => Array.isArray(sl.bps)), 'each slot exposes a bps array');
    assert.ok(view0.body.roster.slots.some((sl) => sl.bps.some((b) => typeof b.hpMax === 'number' && b.hpMax > 0)), 'at least one BP hpMax is exposed');
    assert.ok(Array.isArray(view0.body.roster.enemies) && view0.body.roster.enemies.length > 0, 'enemy hints present');
    for (const en of view0.body.roster.enemies) {
      assert.ok(typeof en.hpMax === 'number' && en.hpMax > 0, 'enemy hpMax numeric');
      assert.ok(typeof en.name === 'string' && typeof en.nameJa === 'string', 'enemy names present (client reveals on first-seen)');
      assert.ok(Array.isArray(en.footprint), 'enemy footprint present');
    }

    // Paced visibility: the intro withholds events at elapsed~=0; advancing the
    // clock a few paced seconds airs more, gated on `pt` (each carries pt).
    const nEarly = view0.body.events.length;
    { const _r = scheduleStorage.readRun(runId); _r.startedAt = new Date(Date.now() - 20 * 1000).toISOString(); scheduleStorage.writeRun(_r.id, _r); }
    const view1 = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.ok(view1.body.events.length >= nEarly, 'more presentation time reveals >= as many events');
    assert.ok(view1.body.events.every((e) => typeof e.pt === 'number'), 'every aired event carries its pt on the wire');
    for (let i = 1; i < view1.body.events.length; i++) assert.ok(view1.body.events[i].pt >= view1.body.events[i - 1].pt, 'served pt is monotonic');
    assert.ok(!view1.body.clock.isSettled, '20s < 45s presentation -> still live');

    // Settle rides the paced clock: only once elapsed >= presentation duration
    // does the run settle and the room leave active (cooldown from THAT moment).
    forceRunElapsed(runId); // backdates by durationSecs (presentation) + margin
    const settledRoom = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.notStrictEqual(settledRoom.body.room.status, 'active', 'run settles at the presentation duration');
    assert.ok(settledRoom.body.room.cooldownUntil, 'cooldown starts from the (paced) settle moment');

    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: GET .../run?format=text (REQ-0045 g) returns a plain-text, one-humanized-line-per-event mirror of the same visibleEvents() the JSON route sends -- any OTHER/absent format value still returns JSON unchanged', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active');

    // REQ-0240: presentation pacing holds an intro beat (~1.8s) before the
    // first event airs, and spaces the rest across the paced timeline -- a run
    // read at elapsed~=0 therefore shows "(no events yet)". Advance this LIVE
    // run's clock a few paced seconds (still << durationSecs, so it stays
    // unsettled) so real events have aired for this humanized-mirror check.
    {
      const _r = scheduleStorage.readRun(roomAfter.body.room.lastRunId);
      _r.startedAt = new Date(Date.now() - 15 * 1000).toISOString();
      scheduleStorage.writeRun(_r.id, _r);
    }

    // Plain-text request -- driven DIRECTLY via mockReq/api.handle (not
    // the scheduleReq() helper above, which always JSON.parse's the
    // body and would just get `null` back for a non-JSON response).
    const textReq = mockReq('GET', '/api/schedule/rooms/' + roomId + '/run?format=text', undefined, authHeaders(scheduleP1.token));
    const textRes = await new Promise((resolve) => {
      const res2 = mockRes((b) => resolve({ status: res2.statusCode, headers: res2.headers, body: b }));
      api.handle(textReq, res2);
    });
    assert.strictEqual(textRes.status, 200);
    assert.ok(textRes.headers['Content-Type'].startsWith('text/plain'), 'format=text must respond text/plain, not application/json');
    assert.ok(textRes.body.length > 0, 'text body must be non-empty (this room has a real in-flight run with real events)');
    // Every non-empty line must start with "N: " (the same idx-prefixed
    // shape Monitor.tsx's own log panel renders) -- a crude but effective
    // proxy for "this is humanized text, not raw JSON": a bare
    // JSON.parse of the WHOLE body must fail (it is NOT one JSON
    // document), while every individual line starts with a plain integer
    // index, never a JSON delimiter.
    let threwOnWholeBodyParse = false;
    try { JSON.parse(textRes.body); } catch (e) { threwOnWholeBodyParse = true; }
    assert.ok(threwOnWholeBodyParse, 'the whole text body must NOT itself be one parseable JSON document (it is multi-line humanized text)');
    const lines = textRes.body.split('\n').filter((l) => l.length > 0);
    assert.ok(lines.length > 0, 'must have at least one non-empty line');
    for (const line of lines) assert.ok(/^\d+: /.test(line), 'every line must start with "N: " (idx-prefixed humanized event), got: ' + JSON.stringify(line));

    // Absent format param (the default JSON route) is completely
    // unaffected by this new branch.
    const jsonRes = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.strictEqual(jsonRes.status, 200);
    assert.ok(Array.isArray(jsonRes.body.events));

    // A bogus/unknown format value also falls through to JSON, not text
    // and not an error -- only the EXACT string 'text' is special-cased.
    const bogusReq = mockReq('GET', '/api/schedule/rooms/' + roomId + '/run?format=bogus', undefined, authHeaders(scheduleP1.token));
    const bogusRes = await new Promise((resolve) => {
      const res2 = mockRes((b) => { let parsed = null; try { parsed = JSON.parse(b); } catch (e) { /* leave null */ } resolve({ status: res2.statusCode, body: parsed }); });
      api.handle(bogusReq, res2);
    });
    assert.strictEqual(bogusRes.status, 200);
    assert.ok(Array.isArray(bogusRes.body.events), 'an unrecognized format value must still return the normal JSON shape, not error or text');

    forceRunElapsed(roomAfter.body.room.lastRunId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    for (const item of schedule.listWarehouse(scheduleP1.playerId)) scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });


  // ===================================================================
  // REQ-0324: co-operative Troop -- recruitment + human-equivalent join/leave.
  // A player OPENS a public recruiting Troop that other players (human or bot,
  // indistinguishably) BROWSE and JOIN with one of their own squads, and may
  // LEAVE before departure. Dedicated players (each with its own canvas) so
  // these never perturb the scheduleP1/P2 room state later suites assert on.
  // ===================================================================
  const troopHost = playersFixture.createPlayer('TroopHost', []);
  const troopJ2 = playersFixture.createPlayer('TroopJoiner2', []);
  const troopJ3 = playersFixture.createPlayer('TroopJoiner3', []);
  // A BOT account is just a plain player -- REQ-0324 forbids special-casing; it
  // browses/joins through the exact same X-Auth-Token surface as a human.
  const troopBot = playersFixture.createPlayer('TroopBot4', []);
  for (const pl of [troopHost, troopJ2, troopJ3, troopBot]) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());

  function browseTroops(token, query) {
    return scheduleReq('GET', '/api/schedule/troops' + (query || '?state=recruiting'), token);
  }

  let openTroopId = null;

  await AT('troop: POST /api/schedule/troops opens a PUBLIC recruiting troop with the host seated in slot 0', async () => {
    const res = await scheduleReq('POST', '/api/schedule/troops', troopHost.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', squadIndex: 0 });
    assert.strictEqual(res.status, 200, 'host open must 200: ' + JSON.stringify(res.body));
    const t = res.body.troop;
    openTroopId = t.id;
    assert.strictEqual(t.visibility, 'public', 'a troop is a public room');
    assert.strictEqual(t.state, 'recruiting');
    assert.strictEqual(t.hostId, troopHost.playerId, 'hostId == opener');
    assert.strictEqual(t.ownerId, troopHost.playerId, 'ownerId is kept as an alias of hostId');
    assert.strictEqual(t.slots.length, 4);
    assert.ok(t.slots[0] && t.slots[0].ownerId === troopHost.playerId && t.slots[0].squadIndex === 0, 'host seated in slot 0: ' + JSON.stringify(t.slots[0]));
    assert.ok(typeof t.slots[0].joinedAt === 'string' && t.slots[0].joinedAt.length > 0, 'seat carries a joinedAt');
    assert.strictEqual(t.slots[1], null, 'slots 1..3 start empty (null)');
    assert.strictEqual(t.slots[2], null);
    assert.strictEqual(t.slots[3], null);
  });

  await AT('troop: browse (GET /troops?state=recruiting) shows the open troop as 1/4; &attackLv filters on the host-set level', async () => {
    const res = await browseTroops(troopJ2.token);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.troops));
    const mine = res.body.troops.find((x) => x.roomId === openTroopId);
    assert.ok(mine, 'the open troop must appear in the public browse for ANOTHER player');
    assert.strictEqual(mine.seats, '1/4', 'one seat filled (the host)');
    assert.strictEqual(mine.attackLv, 1);
    assert.strictEqual(mine.hostId, troopHost.playerId);
    assert.ok(Number.isInteger(mine.ageSec) && mine.ageSec >= 0, 'ageSec is a non-negative integer');
    const match = await browseTroops(troopJ2.token, '?state=recruiting&attackLv=1');
    assert.ok(match.body.troops.some((x) => x.roomId === openTroopId), 'attackLv=1 must include a level-1 troop');
    const nomatch = await browseTroops(troopJ2.token, '?state=recruiting&attackLv=99');
    assert.ok(!nomatch.body.troops.some((x) => x.roomId === openTroopId), 'attackLv=99 must exclude a level-1 troop');
  });

  await AT('troop: a 2nd player JOINS the lowest free seat -> 2/4', async () => {
    const res = await scheduleReq('POST', '/api/schedule/troops/' + openTroopId + '/join', troopJ2.token, { squadIndex: 0 });
    assert.strictEqual(res.status, 200, 'join must 200: ' + JSON.stringify(res.body));
    const t = res.body.troop;
    assert.strictEqual(t.slots[1].ownerId, troopJ2.playerId, 'joiner takes seat 1 (lowest free)');
    assert.strictEqual(t.slots[1].squadIndex, 0);
    assert.strictEqual(t.slots[2], null);
    const browse = await browseTroops(troopJ3.token);
    assert.strictEqual(browse.body.troops.find((x) => x.roomId === openTroopId).seats, '2/4');
  });

  await AT('troop: a 3rd player joins -> 3/4; still recruiting and still offered in browse (REQ-0325: a troop departs only when its 4th seat fills)', async () => {
    const r3 = await scheduleReq('POST', '/api/schedule/troops/' + openTroopId + '/join', troopJ3.token, { squadIndex: 0 });
    assert.strictEqual(r3.status, 200, 'J3 join: ' + JSON.stringify(r3.body));
    const t = r3.body.troop;
    assert.strictEqual(t.slots[2].ownerId, troopJ3.playerId, 'J3 takes seat 2 (lowest free)');
    assert.strictEqual(t.state, 'recruiting', 'a 3/4 troop is still recruiting (not yet full)');
    assert.ok(!t.lastRunId, 'no run has started at 3/4');
    const browse = await browseTroops(troopHost.token);
    assert.strictEqual(browse.body.troops.find((x) => x.roomId === openTroopId).seats, '3/4', 'a 3/4 troop still appears in browse');
  });

  await AT('troop: LEAVE frees a seat before departure and it REAPPEARS in browse; a non-member cannot leave', async () => {
    const res = await scheduleReq('POST', '/api/schedule/troops/' + openTroopId + '/leave', troopJ3.token);
    assert.strictEqual(res.status, 200, 'leave must 200: ' + JSON.stringify(res.body));
    assert.strictEqual(res.body.troop.slots[2], null, 'the leaver seat is freed');
    const browse = await browseTroops(troopJ2.token);
    const mine = browse.body.troops.find((x) => x.roomId === openTroopId);
    assert.ok(mine, 'the troop reappears once a seat is free');
    assert.strictEqual(mine.seats, '2/4');
    const nonMember = playersFixture.createPlayer('TroopNonMember', []);
    scheduleStorage.writeProfile(nonMember.playerId, makeTestCanvas());
    const bad = await scheduleReq('POST', '/api/schedule/troops/' + openTroopId + '/leave', nonMember.token);
    assert.strictEqual(bad.status, 409, 'a non-member leave must 409: ' + JSON.stringify(bad.body));
  });

  await AT('troop: cross-player deploy gate -- a joiner double-deploying a uid already seated elsewhere is refused 409 deployed_overlap', async () => {
    const gateJoiner = playersFixture.createPlayer('TroopGateJoiner', []);
    scheduleStorage.writeProfile(gateJoiner.playerId, makeTestCanvas());
    // gateJoiner hosts their OWN troop with squad 0 -> squad 0's uids are now
    // committed to a recruiting troop they hold a seat in.
    const own = await scheduleReq('POST', '/api/schedule/troops', gateJoiner.token, { dungeonId: 'test_dungeon', level: 1, squadIndex: 0 });
    assert.strictEqual(own.status, 200, 'gateJoiner opens their own troop: ' + JSON.stringify(own.body));
    // openTroopId still has a free seat. gateJoiner tries to ALSO seat squad 0
    // there -> same player, same uids, already committed elsewhere.
    const clash = await scheduleReq('POST', '/api/schedule/troops/' + openTroopId + '/join', gateJoiner.token, { squadIndex: 0 });
    assert.strictEqual(clash.status, 409, 'double-deploying squad 0 must 409: ' + JSON.stringify(clash.body));
    assert.strictEqual(clash.body.reason, 'deployed_overlap', 'the 409 carries reason=deployed_overlap');
    // A DIFFERENT, independent squad (index 1) is fine -- the gate blocks uid
    // OVERLAP, not the player.
    const ok = await scheduleReq('POST', '/api/schedule/troops/' + openTroopId + '/join', gateJoiner.token, { squadIndex: 1 });
    assert.strictEqual(ok.status, 200, 'a non-overlapping squad still joins: ' + JSON.stringify(ok.body));
    scheduleStorage.deleteRoom(own.body.troop.id);
  });

  await AT('troop: the HOST may seat a SECOND squad of their own in their OWN troop (REQ-0337) -- only uid OVERLAP is refused, not the player', async () => {
    // REQ-0337 rests entirely on this: the client opens a public Troop with the
    // player's first squad and then POSTs .../join once per REMAINING squad they
    // mustered, so that leaving 1-3 seats open IS the recruitment. Every existing
    // troop test joins as a DIFFERENT player, so nothing pinned the same-player
    // case -- and deployedUidSetsByOrigin's sameRoom bucket is exactly where it
    // could silently start refusing.
    const multiHost = playersFixture.createPlayer('TroopMultiSquadHost', []);
    scheduleStorage.writeProfile(multiHost.playerId, makeTestCanvas());
    const opened = await scheduleReq('POST', '/api/schedule/troops', multiHost.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', squadIndex: 0 });
    assert.strictEqual(opened.status, 200, 'host opens with squad 0: ' + JSON.stringify(opened.body));
    const roomId = opened.body.troop.id;
    // A DIFFERENT squad of the SAME player takes the next free seat.
    const second = await scheduleReq('POST', '/api/schedule/troops/' + roomId + '/join', multiHost.token, { squadIndex: 1 });
    assert.strictEqual(second.status, 200, 'the host must be able to seat a second squad of their own: ' + JSON.stringify(second.body));
    const t = second.body.troop;
    assert.strictEqual(t.slots[0].ownerId, multiHost.playerId);
    assert.strictEqual(t.slots[1].ownerId, multiHost.playerId, 'both seats belong to the host');
    assert.strictEqual(t.slots[1].squadIndex, 1);
    assert.strictEqual(t.state, 'recruiting', 'a 2/4 troop is still recruiting -- it must NOT depart');
    assert.strictEqual(t.slots[2], null, 'the remaining seats stay OPEN -- this is the recruitment');
    assert.strictEqual(t.slots[3], null);
    // ...and it is offered to everyone else as 2/4, which is what the fleet sees.
    const browse = await browseTroops(troopHost.token);
    const row = browse.body.troops.find((x) => x.roomId === roomId);
    assert.ok(row, 'a part-mustered troop is still publicly recruiting');
    assert.strictEqual(row.seats, '2/4');
    // The SAME squad twice is still refused -- the gate blocks uid overlap.
    const dup = await scheduleReq('POST', '/api/schedule/troops/' + roomId + '/join', multiHost.token, { squadIndex: 1 });
    assert.strictEqual(dup.status, 409, 'the same squad twice must still 409: ' + JSON.stringify(dup.body));
    assert.strictEqual(dup.body.reason, 'same_room_duplicate');
    scheduleStorage.deleteRoom(roomId);
  });

  await AT('troop: legacy-slot migration on read -- an ownerless { squadIndex } seat surfaces with ownerId = room.ownerId', async () => {
    const legacyHost = playersFixture.createPlayer('TroopLegacyHost', []);
    scheduleStorage.writeProfile(legacyHost.playerId, makeTestCanvas());
    const opened = await scheduleReq('POST', '/api/schedule/troops', legacyHost.token, { dungeonId: 'test_dungeon', level: 1, squadIndex: 2 });
    assert.strictEqual(opened.status, 200);
    const roomId = opened.body.troop.id;
    // Simulate a LEGACY solo-shaped seat (pre-REQ-0324): { squadIndex } with NO
    // owner field. Migration-on-read must attribute it to room.ownerId.
    const raw = scheduleStorage.readRoom(roomId);
    raw.slots[0] = { squadIndex: 2 };
    scheduleStorage.writeRoom(roomId, raw);
    const view = await scheduleReq('GET', '/api/schedule/troops/' + roomId, legacyHost.token);
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.body.troop.slots[0].ownerId, legacyHost.playerId, 'a legacy ownerless seat reads as owned by the room owner');
    assert.strictEqual(view.body.troop.slots[0].squadIndex, 2, 'the squad index is preserved');
    assert.strictEqual(view.body.troop.slots[0].joinedAt, null, 'a legacy seat has no joinedAt');
    scheduleStorage.deleteRoom(roomId);
  });

  // ===================================================================
  // REQ-0325: a full Troop AUTO-DEPARTS, runs with ALL FOUR participants, and
  // fans rewards RANDOMLY to each owner's warehouse. Fresh, dedicated players
  // and troops (each seat takes a DISTINCT squad 0..3, so every deployed uid
  // across the run is globally unique) so the multi-participant run + settlement
  // never perturbs the recruiting-phase fixtures above or later suites' state.
  // ===================================================================
  const r5Owners = ['R5Host', 'R5B', 'R5C', 'R5D'].map((n) => playersFixture.createPlayer(n, []));
  const r5Outsider = playersFixture.createPlayer('R5Outsider', []);
  for (const pl of [...r5Owners, r5Outsider]) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
  const r5Ids = r5Owners.map((pl) => pl.playerId);

  // Open a fresh troop (host seats squad 0) and seat 3 more owners, each with a
  // DISTINCT squad (1,2,3). Returns { id, departed } -- the last join's view.
  async function openAndFillTroop(owners, level) {
    const open = await scheduleReq('POST', '/api/schedule/troops', owners[0].token, { dungeonId: 'test_dungeon', level, formationId: 'formation1', squadIndex: 0 });
    assert.strictEqual(open.status, 200, 'open troop: ' + JSON.stringify(open.body));
    const id = open.body.troop.id;
    let last = open;
    for (let i = 1; i < 4; i++) {
      last = await scheduleReq('POST', '/api/schedule/troops/' + id + '/join', owners[i].token, { squadIndex: i });
      assert.strictEqual(last.status, 200, 'join seat ' + i + ': ' + JSON.stringify(last.body));
    }
    return { id, departed: last.body.troop };
  }

  let r5TroopId = null;
  await AT('REQ-0325: filling the 4th seat AUTO-DEPARTS the troop and starts the first run atomically (no client action)', async () => {
    const open = await scheduleReq('POST', '/api/schedule/troops', r5Owners[0].token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', squadIndex: 0 });
    r5TroopId = open.body.troop.id;
    for (let i = 1; i < 3; i++) {
      const j = await scheduleReq('POST', '/api/schedule/troops/' + r5TroopId + '/join', r5Owners[i].token, { squadIndex: i });
      assert.strictEqual(j.status, 200, 'seat ' + i + ' join: ' + JSON.stringify(j.body));
      assert.strictEqual(j.body.troop.state, 'recruiting', 'still recruiting below 4/4');
      assert.ok(!j.body.troop.lastRunId, 'no run before the last seat fills');
    }
    const last = await scheduleReq('POST', '/api/schedule/troops/' + r5TroopId + '/join', r5Owners[3].token, { squadIndex: 3 });
    assert.strictEqual(last.status, 200, 'the 4th join: ' + JSON.stringify(last.body));
    const t = last.body.troop;
    assert.strictEqual(t.state, 'active', 'filling the last seat transitions recruiting -> active (departed)');
    assert.ok(t.lastRunId, 'the first run started atomically with the 4th join');
    // A departed troop is no longer recruiting -> gone from browse, and no new
    // seat can be joined.
    const browse = await browseTroops(r5Owners[0].token);
    assert.ok(!browse.body.troops.some((x) => x.roomId === r5TroopId), 'a departed troop is absent from the recruiting browse');
    const lateJoin = await scheduleReq('POST', '/api/schedule/troops/' + r5TroopId + '/join', r5Outsider.token, { squadIndex: 0 });
    assert.strictEqual(lateJoin.status, 409, 'joining a departed troop must 409: ' + JSON.stringify(lateJoin.body));
    // The run records ALL FOUR seat owners as its participants.
    const run = scheduleStorage.readRun(t.lastRunId);
    assert.ok(run, 'the first run doc exists');
    assert.deepStrictEqual([...run.participants].sort(), [...r5Ids].sort(), 'all four seat owners are the run participants');
  });

  await AT('REQ-0325: a departed troop settles -> item rewards fan out RANDOMLY to owners\' warehouses; every reward owner is one of the four; the LRDST drop follows the uniform rule; nothing leaks to a non-participant', async () => {
    const run0 = scheduleStorage.readRun(scheduleStorage.readRoom(r5TroopId).lastRunId);
    assert.strictEqual(run0.result, 'victory', 'the attacking fixture troop should clear the 1hp-slime dungeon: got ' + run0.result);
    assert.ok(run0.rewards.length >= 1, 'a victory banks at least one item reward to fan out');
    forceRunElapsed(run0.id);
    const settled = await scheduleReq('GET', '/api/schedule/troops/' + r5TroopId, r5Owners[0].token); // poll -> lazy settle
    assert.strictEqual(settled.status, 200, 'settle poll: ' + JSON.stringify(settled.body));
    const run = scheduleStorage.readRun(run0.id);
    assert.strictEqual(run.settled, true, 'the run settled on the poll');
    // golden p: each item reward's owner is drawn uniformly at random from the four.
    for (const a of run.rewards) assert.ok(r5Ids.includes(a.owner), 'reward owner ' + a.owner + ' must be one of the four participants');
    const expectByOwner = {};
    for (const id of r5Ids) expectByOwner[id] = 0;
    for (const a of run.rewards) expectByOwner[a.owner]++;
    // Each owner's warehouse holds EXACTLY its uniform-random item-reward share.
    for (const pl of r5Owners) {
      const wh = await scheduleReq('GET', '/api/warehouse', pl.token);
      const mine = wh.body.items.filter((it) => it.sourceRunId === run.id && it.itemId !== 'lrdst');
      assert.strictEqual(mine.length, expectByOwner[pl.playerId], 'owner ' + pl.playerId + ' warehouse item-reward count matches its assignment');
    }
    // The aggregate LRDST drop ALSO follows the uniform rule: exactly ONE
    // participant receives it (uniform single-winner); it lands nowhere else.
    if (run.lrdstReward > 0) {
      let recipients = 0;
      for (const pl of r5Owners) {
        const wh = await scheduleReq('GET', '/api/warehouse', pl.token);
        const lr = wh.body.items.filter((it) => it.sourceRunId === run.id && it.itemId === 'lrdst');
        if (lr.length) { recipients++; assert.strictEqual(lr[0].qty, run.lrdstReward, 'the LRDST recipient gets the full aggregate qty'); }
      }
      assert.strictEqual(recipients, 1, 'the LRDST drop lands in exactly one participant warehouse (uniform single-winner)');
    }
    // No leak: a non-participant receives NOTHING from this run.
    const outWh = await scheduleReq('GET', '/api/warehouse', r5Outsider.token);
    assert.strictEqual(outWh.body.items.filter((it) => it.sourceRunId === run.id).length, 0, 'no reward leaks to a non-participant');
  });

  await AT('REQ-0325: a WIPED troop run grants NO rewards to any participant and drops the troop level exactly ONCE', async () => {
    const wOwners = ['R5W1', 'R5W2', 'R5W3', 'R5W4'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of wOwners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const level = 3;
    const { id } = await openAndFillTroop(wOwners, level);
    const run = scheduleStorage.readRun(scheduleStorage.readRoom(id).lastRunId);
    // Drive this run to a WIPE outcome deterministically. The fixture's 1hp slime
    // cannot actually kill a full attacking troop, so we exercise settleRun's WIPE
    // BRANCH by rewriting the run's summary before settlement -- the same control
    // seam forceRunElapsed uses for a run's clock. The sim's own wipe production is
    // proven in sim/tests/run.cjs; here we assert the TROOP settlement of a wipe.
    run.result = 'wipe';
    run.rewards = [];
    run.lrdstReward = 0;
    run.levelAfter = level - schedule.DEFAULT_FAILURE_STEP;
    run.settled = false;
    scheduleStorage.writeRun(run.id, run);
    forceRunElapsed(run.id);
    const settled = await scheduleReq('GET', '/api/schedule/troops/' + id, wOwners[0].token);
    assert.strictEqual(settled.status, 200);
    assert.strictEqual(settled.body.troop.level, level - schedule.DEFAULT_FAILURE_STEP, 'a wipe drops the troop level exactly once');
    for (const pl of wOwners) {
      const wh = await scheduleReq('GET', '/api/warehouse', pl.token);
      assert.strictEqual(wh.body.items.filter((it) => it.sourceRunId === run.id).length, 0, 'a wipe banks nothing for participant ' + pl.playerId);
    }
    scheduleStorage.deleteRoom(id);
  });

  await AT('REQ-0325: auto-restart re-snapshots all four owners\' CURRENT canvases at each new departure; run #2 keeps all four participants and leaks nothing', async () => {
    const roomBefore = scheduleStorage.readRoom(r5TroopId);
    assert.strictEqual(roomBefore.state, 'active', 'the troop is still departed (cycling between runs)');
    const firstRunId = roomBefore.lastRunId;
    // Mutate ONE owner's LIVE canvas between runs: give the host squad a BP with a
    // UNIQUE hpMax the first run never saw. The next departure must re-snapshot
    // this CURRENT canvas (the frozen-canvas rule re-applied per run).
    const hostCanvas = makeTestCanvas();
    hostCanvas.bps[0].hpMax = 7; // squad 0 (active preset) unique marker
    scheduleStorage.writeProfile(r5Owners[0].playerId, hostCanvas);
    // Clear the cooldown so the next poll auto-starts run #2.
    const cooled = scheduleStorage.readRoom(r5TroopId);
    cooled.cooldownUntil = new Date(Date.now() - 1000).toISOString();
    scheduleStorage.writeRoom(r5TroopId, cooled);
    const poll = await scheduleReq('GET', '/api/schedule/troops/' + r5TroopId, r5Owners[0].token);
    assert.strictEqual(poll.status, 200);
    const room2 = scheduleStorage.readRoom(r5TroopId);
    assert.ok(room2.lastRunId && room2.lastRunId !== firstRunId, 'a NEW run auto-started after cooldown cleared');
    const run2 = scheduleStorage.readRun(room2.lastRunId);
    assert.deepStrictEqual([...run2.participants].sort(), [...r5Ids].sort(), 'run #2 still fans across all four participants');
    assert.ok((run2.bioRoster || []).some((b) => b.hpMax === 7), 'run #2 re-snapshotted the host\'s CURRENT canvas (unique hpMax=7 marker present)');
    // Settle run #2 and re-confirm no leak to the outsider.
    forceRunElapsed(run2.id);
    await scheduleReq('GET', '/api/schedule/troops/' + r5TroopId, r5Owners[0].token);
    const outWh = await scheduleReq('GET', '/api/warehouse', r5Outsider.token);
    assert.strictEqual(outWh.body.items.filter((it) => it.sourceRunId === run2.id).length, 0, 'run #2 leaks nothing to a non-participant');
  });

  await AT('REQ-0325: a seated uid in a DEPARTED troop is frozen from the market (Law of Possession), for a JOINER as well as the host', async () => {
    const squadsSvc = require('../../services/squads.cjs');
    const room = scheduleStorage.readRoom(r5TroopId);
    assert.strictEqual(room.state, 'active', 'the troop is departed, so its seats are committed to the dive');
    // r5B (a JOINER who does NOT own the troop room) holds seat 1 with squad 1.
    const bCanvas = scheduleStorage.readProfile(r5Owners[1].playerId).canvas;
    const frozen = squadsSvc.deployedUidSet(r5Owners[1].playerId, bCanvas);
    const seatUids = squadsSvc.squadUidSet(squadsSvc.squadCanvasOf(bCanvas, 1));
    assert.ok(seatUids.size > 0, 'the joiner seat references at least one uid');
    for (const uid of seatUids) assert.ok(frozen.has(uid), 'joiner seat uid ' + uid + ' must be frozen while the troop is departed');
  });

  // ===================================================================
  // REQ-0326: a seated member CANCELS -> the whole co-op Troop disbands (all-or-
  // nothing), every seat is RETURNED (uids released from the deploy/market
  // freeze), and a discrete disbandEvent carrying the released-owner roster is
  // emitted (the seam REQ-0327 consumes). No run in flight -> disband NOW; a run
  // active -> the current dive settles normally, then disbands ON RETURN.
  // ===================================================================

  await AT('REQ-0326: a seated member cancels a still-RECRUITING troop -> immediate disband, every seat returned, disbandEvent lists the seated owners; a released owner can redeploy the same squad elsewhere', async () => {
    const owners = ['R6RecHost', 'R6RecB', 'R6RecC'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of owners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const open = await scheduleReq('POST', '/api/schedule/troops', owners[0].token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', squadIndex: 0 });
    const id = open.body.troop.id;
    await scheduleReq('POST', '/api/schedule/troops/' + id + '/join', owners[1].token, { squadIndex: 1 });
    const j = await scheduleReq('POST', '/api/schedule/troops/' + id + '/join', owners[2].token, { squadIndex: 2 });
    assert.strictEqual(j.body.troop.state, 'recruiting', 'precondition: 3/4, still recruiting (no run in flight)');
    // A NON-member cannot cancel a live troop.
    const outsider = playersFixture.createPlayer('R6RecOutsider', []);
    scheduleStorage.writeProfile(outsider.playerId, makeTestCanvas());
    const bad = await scheduleReq('POST', '/api/schedule/troops/' + id + '/cancel', outsider.token);
    assert.strictEqual(bad.status, 409, 'a non-seated player cannot cancel: ' + JSON.stringify(bad.body));
    // A seated JOINER (not the host) cancels -> the WHOLE troop disbands NOW.
    const res = await scheduleReq('POST', '/api/schedule/troops/' + id + '/cancel', owners[1].token);
    assert.strictEqual(res.status, 200, 'seated-member cancel: ' + JSON.stringify(res.body));
    const t = res.body.troop;
    assert.strictEqual(t.state, 'canceled', 'a recruiting troop disbands immediately on cancel');
    assert.ok(t.slots.every((sl) => sl === null), 'every seat is returned (cleared) on disband');
    assert.ok(t.disbandEvent, 'a discrete disbandEvent is emitted');
    assert.strictEqual(t.disbandEvent.roomId, id, 'disbandEvent carries the troop id');
    assert.deepStrictEqual([...t.disbandEvent.releasedOwners].sort(), owners.map((o) => o.playerId).sort(), 'disbandEvent lists exactly the seated owners at cancel time (<=4)');
    assert.ok(t.disbandEvent.releasedOwners.length <= 4, 'at most four owners');
    // The persisted room carries the same disbandEvent (the REQ-0327 read seam).
    const stored = scheduleStorage.readRoom(id);
    assert.deepStrictEqual([...stored.disbandEvent.releasedOwners].sort(), owners.map((o) => o.playerId).sort(), 'the disbandEvent is persisted on the room doc');
    // A disbanded troop is gone from browse.
    const browse = await browseTroops(owners[0].token);
    assert.ok(!browse.body.troops.some((x) => x.roomId === id), 'a disbanded troop no longer appears in browse');
    // Released owner can immediately deploy the SAME squad elsewhere -- the seat
    // no longer freezes its uids (would 409 deployed_overlap if still committed).
    const rehost = await scheduleReq('POST', '/api/schedule/troops', owners[0].token, { dungeonId: 'test_dungeon', level: 1, squadIndex: 0 });
    assert.strictEqual(rehost.status, 200, 'a released owner redeploys squad 0 after disband: ' + JSON.stringify(rehost.body));
    scheduleStorage.deleteRoom(rehost.body.troop.id);
    scheduleStorage.deleteRoom(id);
  });

  await AT('REQ-0326: cancelling a DEPARTED troop mid-run defers to RETURN -- the in-flight dive settles its rewards normally, THEN the troop disbands (no restart), every seat returned, disbandEvent lists all four owners', async () => {
    const owners = ['R6MidA', 'R6MidB', 'R6MidC', 'R6MidD'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of owners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const { id, departed } = await openAndFillTroop(owners, 1);
    assert.strictEqual(departed.state, 'active', 'precondition: troop departed, run in flight');
    const runId = departed.lastRunId;
    // A seated member cancels WHILE the run is active -> disband is DEFERRED.
    const cancel = await scheduleReq('POST', '/api/schedule/troops/' + id + '/cancel', owners[2].token);
    assert.strictEqual(cancel.status, 200, 'mid-run cancel: ' + JSON.stringify(cancel.body));
    assert.strictEqual(cancel.body.troop.state, 'active', 'the troop stays active mid-run -- disband waits for RETURN');
    assert.strictEqual(cancel.body.troop.disbandRequested, true, 'disbandRequested is flagged for the return');
    assert.ok(!cancel.body.troop.disbandEvent, 'no disbandEvent yet -- the dive has not returned');
    // The in-flight run is UNAFFECTED and still settles normally.
    const run0 = scheduleStorage.readRun(runId);
    assert.strictEqual(run0.result, 'victory', 'the in-flight dive is untouched by the cancel');
    forceRunElapsed(runId);
    const afterReturn = await scheduleReq('GET', '/api/schedule/troops/' + id, owners[0].token); // poll -> settle THEN disband
    assert.strictEqual(afterReturn.status, 200, 'return poll: ' + JSON.stringify(afterReturn.body));
    const run = scheduleStorage.readRun(runId);
    assert.strictEqual(run.settled, true, 'the current dive settled its rewards normally before disband');
    const t = afterReturn.body.troop;
    assert.strictEqual(t.state, 'canceled', 'on RETURN the troop disbands instead of restarting');
    assert.ok(t.slots.every((sl) => sl === null), 'every seat is returned on disband');
    const stored = scheduleStorage.readRoom(id);
    assert.strictEqual(stored.state, 'canceled', 'the disband is persisted');
    assert.strictEqual(stored.status, 'canceled', 'a disbanded troop never auto-starts again');
    assert.strictEqual(stored.lastRunId, runId, 'NO next run was scheduled (lastRunId is still the settled dive)');
    assert.ok(stored.disbandEvent, 'a discrete disbandEvent is emitted on return');
    assert.deepStrictEqual([...stored.disbandEvent.releasedOwners].sort(), owners.map((o) => o.playerId).sort(), 'disbandEvent lists all four released owners');
    // The FINAL dive settled its rewards normally: at least one participant banked an item.
    let banked = 0;
    for (const pl of owners) {
      const wh = await scheduleReq('GET', '/api/warehouse', pl.token);
      banked += wh.body.items.filter((it) => it.sourceRunId === runId).length;
    }
    assert.ok(banked >= 1, 'the final dive settled its rewards normally before disband');
    // A released owner can now deploy the same squad elsewhere.
    const redeploy = await scheduleReq('POST', '/api/schedule/troops', owners[3].token, { dungeonId: 'test_dungeon', level: 1, squadIndex: 3 });
    assert.strictEqual(redeploy.status, 200, 'a released owner redeploys squad 3 after disband: ' + JSON.stringify(redeploy.body));
    scheduleStorage.deleteRoom(redeploy.body.troop.id);
    scheduleStorage.deleteRoom(id);
  });

  await AT('REQ-0326: cancelling a departed troop BETWEEN runs (cooling down, no dive in flight) disbands immediately and schedules no next run', async () => {
    const owners = ['R6CoolA', 'R6CoolB', 'R6CoolC', 'R6CoolD'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of owners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const { id } = await openAndFillTroop(owners, 1);
    const runId = scheduleStorage.readRoom(id).lastRunId;
    forceRunElapsed(runId);
    await scheduleReq('GET', '/api/schedule/troops/' + id, owners[0].token); // settle run #1 -> now cooling down
    const cooling = scheduleStorage.readRoom(id);
    assert.strictEqual(cooling.state, 'active', 'still departed, cycling between runs');
    assert.strictEqual(cooling.status, 'open', 'between runs -> status open (no dive in flight)');
    assert.ok(cooling.cooldownUntil && Date.parse(cooling.cooldownUntil) > Date.now(), 'precondition: cooling down, next run not yet due');
    const res = await scheduleReq('POST', '/api/schedule/troops/' + id + '/cancel', owners[1].token);
    assert.strictEqual(res.status, 200, 'between-runs cancel: ' + JSON.stringify(res.body));
    assert.strictEqual(res.body.troop.state, 'canceled', 'a between-runs cancel disbands immediately (no dive to finish)');
    assert.ok(res.body.troop.slots.every((sl) => sl === null), 'every seat returned');
    assert.deepStrictEqual([...res.body.troop.disbandEvent.releasedOwners].sort(), owners.map((o) => o.playerId).sort(), 'disbandEvent lists all four owners');
    assert.strictEqual(scheduleStorage.readRoom(id).lastRunId, runId, 'no next run scheduled on disband');
    scheduleStorage.deleteRoom(id);
  });

  // ===================================================================
  // REQ-0357: the wipe-streak circuit breaker. Three consecutive
  // zero-progress wipes = observable evidence of a hopeless matchup; the
  // room must STOP occupying its lane and ANNOUNCE why, instead of
  // auto-restarting forever (the live 15-min wipe loop this REQ fixes).
  // The sim's own wipe production is proven in sim/tests; here we drive
  // the settlement machinery through the same summary-rewrite seam the
  // REQ-0325 wipe test uses.
  // ===================================================================
  function rewriteRunAsWipe(runId, finalProgressPct) {
    const run = scheduleStorage.readRun(runId);
    run.result = 'wipe';
    run.finalProgressPct = finalProgressPct;
    run.rewards = [];
    run.lrdstReward = 0;
    run.levelAfter = 1;
    run.settled = false;
    scheduleStorage.writeRun(run.id, run);
    forceRunElapsed(run.id);
  }
  function clearCooldown(roomId) {
    const room = scheduleStorage.readRoom(roomId);
    room.cooldownUntil = new Date(Date.now() - 1000).toISOString();
    scheduleStorage.writeRoom(room.id, room);
  }

  await AT('REQ-0357: a troop that wipes at 0% progress three runs straight is DISBANDED by the breaker (seats returned, reason wipe_streak, every member notified)', async () => {
    const owners = ['R7WsA', 'R7WsB', 'R7WsC', 'R7WsD'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of owners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const { id } = await openAndFillTroop(owners, 1);
    for (let cycle = 1; cycle <= 3; cycle++) {
      const roomNow = scheduleStorage.readRoom(id);
      assert.ok(roomNow.lastRunId, 'cycle ' + cycle + ': a run is in flight');
      rewriteRunAsWipe(roomNow.lastRunId, 0);
      await scheduleReq('GET', '/api/schedule/troops/' + id, owners[0].token); // settle
      const settled = scheduleStorage.readRoom(id);
      if (cycle < 3) {
        assert.strictEqual(settled.wipeStreak, cycle, 'streak counts consecutive zero-progress wipes');
        assert.strictEqual(settled.state, 'active', 'below the limit the troop keeps cycling');
        clearCooldown(id);
        const prevRun = settled.lastRunId;
        await scheduleReq('GET', '/api/schedule/troops/' + id, owners[0].token); // auto-start next
        assert.notStrictEqual(scheduleStorage.readRoom(id).lastRunId, prevRun, 'cycle ' + cycle + ': next run auto-started');
      } else {
        assert.strictEqual(settled.state, 'canceled', 'the 3rd zero-progress wipe trips the breaker: no 4th run, troop disbanded');
        assert.ok(settled.slots.every((sl) => sl === null), 'every seat returned');
        assert.strictEqual(settled.disbandEvent.reason, 'wipe_streak', 'the disband records WHY');
      }
    }
    for (const pl of owners) {
      const feed = await scheduleReq('GET', '/api/notifications', pl.token);
      const mine = feed.body.notifications.filter((n) => n.kind === 'troop_disbanded' && n.roomId === id);
      assert.strictEqual(mine.length, 1, 'exactly one breaker notification for ' + pl.playerId);
      assert.strictEqual(mine[0].payload.reason, 'wipe_streak', 'the notification carries the breaker reason');
    }
    scheduleStorage.deleteRoom(id);
  });

  await AT('REQ-0357: a SOLO room trips the same breaker -- canceled with a discrete haltEvent + one room_halted notification to the owner', async () => {
    const owner = playersFixture.createPlayer('R7SoloW', []);
    scheduleStorage.writeProfile(owner.playerId, makeTestCanvas());
    const created = await scheduleReq('POST', '/api/schedule/rooms', owner.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, owner.token, { squadIndex: i });
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, owner.token); // start run #1
    for (let cycle = 1; cycle <= 3; cycle++) {
      const roomNow = scheduleStorage.readRoom(roomId);
      assert.ok(roomNow.lastRunId, 'cycle ' + cycle + ': a run is in flight');
      rewriteRunAsWipe(roomNow.lastRunId, 0);
      await scheduleReq('GET', '/api/schedule/rooms/' + roomId, owner.token); // settle
      if (cycle < 3) {
        clearCooldown(roomId);
        await scheduleReq('GET', '/api/schedule/rooms/' + roomId, owner.token); // auto-start next
      }
    }
    const halted = scheduleStorage.readRoom(roomId);
    assert.strictEqual(halted.status, 'canceled', 'the solo lane stops');
    assert.strictEqual(halted.haltEvent.reason, 'wipe_streak', 'the halt records WHY');
    assert.strictEqual(halted.haltEvent.streak, 3, 'the halt records the streak');
    const feed = await scheduleReq('GET', '/api/notifications', owner.token);
    const mine = feed.body.notifications.filter((n) => n.kind === 'room_halted' && n.roomId === roomId);
    assert.strictEqual(mine.length, 1, 'exactly one room_halted notification');
    assert.strictEqual(mine[0].payload.reason, 'wipe_streak');
    scheduleStorage.deleteRoom(roomId);
  });

  await AT('REQ-0357: ANY progress (or a victory) RESETS the streak -- a struggling-but-moving room is never broken', async () => {
    const owner = playersFixture.createPlayer('R7SoloR', []);
    scheduleStorage.writeProfile(owner.playerId, makeTestCanvas());
    const created = await scheduleReq('POST', '/api/schedule/rooms', owner.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, owner.token, { squadIndex: i });
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, owner.token);
    // two zero-progress wipes...
    for (let cycle = 1; cycle <= 2; cycle++) {
      rewriteRunAsWipe(scheduleStorage.readRoom(roomId).lastRunId, 0);
      await scheduleReq('GET', '/api/schedule/rooms/' + roomId, owner.token);
      clearCooldown(roomId);
      await scheduleReq('GET', '/api/schedule/rooms/' + roomId, owner.token);
    }
    assert.strictEqual(scheduleStorage.readRoom(roomId).wipeStreak, 2, 'two zero-progress wipes counted');
    // ...then a wipe WITH progress: streak resets, room keeps cycling.
    rewriteRunAsWipe(scheduleStorage.readRoom(roomId).lastRunId, 40);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, owner.token);
    const after = scheduleStorage.readRoom(roomId);
    assert.strictEqual(after.wipeStreak, 0, 'progress resets the streak (a wipe at 40% is a fight, not a pathology)');
    assert.notStrictEqual(after.status, 'canceled', 'the room keeps its lane');
    for (const item of schedule.listWarehouse(owner.playerId)) scheduleStorage.deleteWarehouseItem(owner.playerId, item.itemUid);
    scheduleStorage.deleteRoom(roomId);
  });

  // ===================================================================
  // REQ-0327: the troop-disband NOTIFICATION FEED. ONE mechanism a human
  // device and a bot program consume IDENTICALLY (GET /api/notifications,
  // auth = X-Auth-Token). disbandTroopRoom (REQ-0326) appends ONE
  // troop_disbanded entry to each released owner feed; GET returns the
  // caller unseen entries; ack hides them; a bot account (no browser)
  // reads its own identical entry via the same endpoint (owner item 7).
  // ===================================================================
  await AT('REQ-0327: disbanding a full troop of 4 (on return) gives EACH owner exactly one troop_disbanded entry; GET returns it once; ack hides it; a bot account reads its identical entry via the same endpoint', async () => {
    const owners = ['R7A', 'R7B', 'R7C', 'R7BotD'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of owners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const level = 2;
    const open = await scheduleReq('POST', '/api/schedule/troops', owners[0].token, { dungeonId: 'test_dungeon', level, formationId: 'formation1', squadIndex: 0 });
    const id = open.body.troop.id;
    for (let i = 1; i < 4; i++) await scheduleReq('POST', '/api/schedule/troops/' + id + '/join', owners[i].token, { squadIndex: i });
    // Precondition: no owner has any notification before the disband.
    for (const pl of owners) {
      const pre = await scheduleReq('GET', '/api/notifications', pl.token);
      assert.strictEqual(pre.status, 200, 'feed read: ' + JSON.stringify(pre.body));
      assert.strictEqual(pre.body.notifications.length, 0, 'no notification before disband for ' + pl.playerId);
    }
    // Cancel mid-run defers to RETURN; drive the dive home so the disband
    // (and its emission) fire on the settle poll.
    const cancel = await scheduleReq('POST', '/api/schedule/troops/' + id + '/cancel', owners[1].token);
    assert.strictEqual(cancel.status, 200, 'cancel: ' + JSON.stringify(cancel.body));
    const runId = scheduleStorage.readRoom(id).lastRunId;
    forceRunElapsed(runId);
    await scheduleReq('GET', '/api/schedule/troops/' + id, owners[0].token); // poll -> settle THEN disband -> emit
    assert.strictEqual(scheduleStorage.readRoom(id).state, 'canceled', 'precondition: the troop disbanded on return');
    // EACH of the four owners gained EXACTLY ONE troop_disbanded entry.
    const idOf = {};
    for (const pl of owners) {
      const feed = await scheduleReq('GET', '/api/notifications', pl.token);
      assert.strictEqual(feed.status, 200, 'feed: ' + JSON.stringify(feed.body));
      const mine = feed.body.notifications.filter((n) => n.kind === 'troop_disbanded' && n.roomId === id);
      assert.strictEqual(mine.length, 1, 'owner ' + pl.playerId + ' gets exactly one troop_disbanded entry');
      const entry = mine[0];
      assert.strictEqual(entry.attackLv, level, 'the entry carries the troop attack level');
      assert.strictEqual(entry.seenAt, null, 'a fresh entry is unseen');
      assert.ok(typeof entry.id === 'number' && entry.id > 0, 'the entry has a positive numeric id');
      assert.ok(typeof entry.ts === 'string' && entry.ts.length > 0, 'the entry carries a timestamp');
      assert.strictEqual(entry.payload.reason, 'member_cancel', 'the payload carries the disband reason');
      idOf[pl.playerId] = entry.id;
    }
    // Idempotent: a second settle poll never double-emits.
    // REQ-0368: scoped to the KIND. These counts used "entries for this room"
    // as a proxy for "troop_disbanded entries", which held while the room was
    // the only thing that could notify; the same room's FINAL dive now emits a
    // run_settled entry on the settle poll first, so the proxy no longer holds
    // even though the disband emission itself is unchanged.
    await scheduleReq('GET', '/api/schedule/troops/' + id, owners[0].token);
    const again = await scheduleReq('GET', '/api/notifications', owners[0].token);
    assert.strictEqual(again.body.notifications.filter((n) => n.roomId === id && n.kind === 'troop_disbanded').length, 1, 'a re-poll never double-notifies (exactly one entry stands)');
    // ack hides the entry for THAT owner only.
    const ack = await scheduleReq('POST', '/api/notifications/ack', owners[0].token, { ids: [idOf[owners[0].playerId]] });
    assert.strictEqual(ack.status, 200, 'ack: ' + JSON.stringify(ack.body));
    assert.strictEqual(ack.body.acked, 1, 'exactly one entry acked');
    const afterAck = await scheduleReq('GET', '/api/notifications', owners[0].token);
    assert.strictEqual(afterAck.body.notifications.filter((n) => n.roomId === id && n.kind === 'troop_disbanded').length, 0, 'ack hides the entry from the unseen feed');
    // The BOT account (no browser) still reads its identical entry via the SAME endpoint (item 7).
    const botFeed = await scheduleReq('GET', '/api/notifications', owners[3].token);
    const botMine = botFeed.body.notifications.filter((n) => n.roomId === id && n.kind === 'troop_disbanded');
    assert.strictEqual(botMine.length, 1, 'the bot account reads its own identical entry via the same endpoint');
    assert.strictEqual(botMine[0].kind, 'troop_disbanded', 'same kind for the bot');
    assert.strictEqual(botMine[0].attackLv, level, 'same attackLv for the bot');
    // since cursor: passing the bot own latest id returns nothing strictly-newer.
    const sinceSelf = await scheduleReq('GET', '/api/notifications?since=' + botMine[0].id, owners[3].token);
    assert.strictEqual(sinceSelf.status, 200, 'since read: ' + JSON.stringify(sinceSelf.body));
    assert.strictEqual(sinceSelf.body.notifications.filter((n) => n.roomId === id && n.kind === 'troop_disbanded').length, 0, 'a since cursor at the latest id returns only strictly-newer entries');
    // No leak: an unrelated caller never sees this disband entry.
    const outsider = playersFixture.createPlayer('R7Outsider', []);
    const outFeed = await scheduleReq('GET', '/api/notifications', outsider.token);
    assert.strictEqual(outFeed.status, 200, 'outsider feed read ok');
    assert.strictEqual(outFeed.body.notifications.filter((n) => n.roomId === id).length, 0, 'no disband notification leaks to a non-owner');
    scheduleStorage.deleteRoom(id);
  });

  await AT('REQ-0327: a still-RECRUITING troop disband notifies exactly the seated owners immediately (<=4)', async () => {
    const owners = ['R7RecA', 'R7RecB', 'R7RecC'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of owners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const open = await scheduleReq('POST', '/api/schedule/troops', owners[0].token, { dungeonId: 'test_dungeon', level: 4, formationId: 'formation1', squadIndex: 0 });
    const id = open.body.troop.id;
    await scheduleReq('POST', '/api/schedule/troops/' + id + '/join', owners[1].token, { squadIndex: 1 });
    await scheduleReq('POST', '/api/schedule/troops/' + id + '/join', owners[2].token, { squadIndex: 2 });
    const res = await scheduleReq('POST', '/api/schedule/troops/' + id + '/cancel', owners[1].token);
    assert.strictEqual(res.body.troop.state, 'canceled', 'immediate disband while recruiting');
    for (const pl of owners) {
      const feed = await scheduleReq('GET', '/api/notifications', pl.token);
      const mine = feed.body.notifications.filter((n) => n.roomId === id && n.kind === 'troop_disbanded');
      assert.strictEqual(mine.length, 1, 'each seated owner is notified immediately: ' + pl.playerId);
      assert.strictEqual(mine[0].attackLv, 4, 'the entry carries the troop attack level');
    }
    scheduleStorage.deleteRoom(id);
  });

  // =====================================================================
  // REQ-0368: the notification CENTRE kinds. Each is emitted from a service
  // code path the server already owned (settleRun / the warehouse purge
  // sweep / market buyListing -- the market one is asserted in the market
  // suite, which is where a settled trade already exists). What is proven
  // here: the moment fires, the payload is per-RECIPIENT (never the whole
  // party's haul), a re-poll never double-notifies now that (kind, roomId)
  // alone no longer identifies an event, and the REQ-0327 `since` cursor
  // filters the new kinds exactly as it filters the old ones.
  // =====================================================================

  await AT('REQ-0368: a settled SOLO run emits exactly one run_settled entry to the room owner -- result/dungeonId/lootCount/runId payload, attackLv = the level FOUGHT, a re-poll never double-emits, and the since cursor hides it', async () => {
    const solo = playersFixture.createPlayer('R8Solo', []);
    scheduleStorage.writeProfile(solo.playerId, makeTestCanvas());
    // Level 1: the fixture dungeon is the one the sibling auto-start test
    // above uses, and it only rolls a runnable dive at that level.
    const level = 1;
    const created = await scheduleReq('POST', '/api/schedule/rooms', solo.token, { dungeonId: 'test_dungeon', level, formationId: 'formation1' });
    assert.strictEqual(created.status, 200, 'create room: ' + JSON.stringify(created.body));
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, solo.token, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ': ' + JSON.stringify(r.body));
    }
    // The first run starts LAZILY, on the next read of the room (see
    // settleRoomIfDue's "the very first run, once all 4 slots just got
    // filled" branch) -- the sibling auto-start test above reads it the
    // same way.
    const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, solo.token);
    assert.strictEqual(after.body.room.status, 'active', 'precondition: four unique squads auto-start the room first run');
    // Nothing announced while the dive is still in flight.
    const pre = await scheduleReq('GET', '/api/notifications', solo.token);
    assert.strictEqual(pre.body.notifications.filter((n) => n.roomId === roomId).length, 0, 'no run_settled before the run returns');
    const roomRaw0 = scheduleStorage.readRoom(roomId);
    assert.strictEqual(roomRaw0.status, 'active', 'precondition: four unique squads auto-start the room first run');
    const runId = roomRaw0.lastRunId;
    const runBefore = scheduleStorage.readRun(runId);
    forceRunElapsed(runId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, solo.token); // poll -> lazy settle -> emit
    assert.strictEqual(scheduleStorage.readRun(runId).settled, true, 'precondition: the run settled on the poll');

    const feed = await scheduleReq('GET', '/api/notifications', solo.token);
    assert.strictEqual(feed.status, 200, 'feed: ' + JSON.stringify(feed.body));
    const mine = feed.body.notifications.filter((n) => n.kind === 'run_settled' && n.payload.runId === runId);
    assert.strictEqual(mine.length, 1, 'exactly one run_settled entry for the settled run');
    const entry = mine[0];
    assert.strictEqual(entry.roomId, roomId, 'the entry carries the room id');
    assert.strictEqual(entry.attackLv, level, 'attackLv is the level the dive was FOUGHT at, not the room level after settlement');
    assert.strictEqual(entry.seenAt, null, 'a fresh entry is unseen');
    assert.strictEqual(entry.dedupeKey, runId, 'the run id is the idempotency key -- a room settles many runs');
    assert.strictEqual(entry.payload.result, runBefore.result, 'the payload carries the run result');
    assert.strictEqual(entry.payload.dungeonId, 'test_dungeon', 'the payload carries the dungeon');
    const ownLoot = (runBefore.rewards || []).filter((a) => a.owner === solo.playerId).length;
    assert.strictEqual(entry.payload.lootCount, ownLoot, 'lootCount is THIS owner own reward count');

    // Idempotent across polls: the widened (kind, roomId, dedupeKey) key
    // collapses a re-emission for the SAME run, while still allowing the
    // room next run to notify (asserted by the follow-up below).
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, solo.token);
    const again = await scheduleReq('GET', '/api/notifications', solo.token);
    assert.strictEqual(again.body.notifications.filter((n) => n.kind === 'run_settled' && n.payload.runId === runId).length, 1, 'a re-poll never double-notifies the same run');

    // since cursor: nothing strictly newer than this entry own id.
    const since = await scheduleReq('GET', '/api/notifications?since=' + entry.id, solo.token);
    assert.strictEqual(since.status, 200, 'since read: ' + JSON.stringify(since.body));
    assert.strictEqual(since.body.notifications.filter((n) => n.id <= entry.id).length, 0, 'the since cursor returns only strictly-newer entries');
    // ack hides it.
    const ack = await scheduleReq('POST', '/api/notifications/ack', solo.token, { ids: [entry.id] });
    assert.strictEqual(ack.body.acked, 1, 'exactly one entry acked');
    const afterAck = await scheduleReq('GET', '/api/notifications', solo.token);
    assert.strictEqual(afterAck.body.notifications.filter((n) => n.id === entry.id).length, 0, 'ack hides the entry');
    // No leak to an unrelated caller.
    const outsider = playersFixture.createPlayer('R8SoloOutsider', []);
    const out = await scheduleReq('GET', '/api/notifications', outsider.token);
    assert.strictEqual(out.body.notifications.filter((n) => n.roomId === roomId).length, 0, 'no run_settled leaks to a non-participant');
    for (const item of schedule.listWarehouse(solo.playerId)) scheduleStorage.deleteWarehouseItem(solo.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, solo.token);
  });

  await AT('REQ-0368: a settled TROOP run notifies EVERY participant, each with their OWN lootCount (never the party total) and nobody else', async () => {
    const owners = ['R8TrA', 'R8TrB', 'R8TrC', 'R8TrD'].map((n) => playersFixture.createPlayer(n, []));
    for (const pl of owners) scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const { id } = await openAndFillTroop(owners, 1);
    const runId = scheduleStorage.readRoom(id).lastRunId;
    const runBefore = scheduleStorage.readRun(runId);
    forceRunElapsed(runId);
    await scheduleReq('GET', '/api/schedule/troops/' + id, owners[0].token); // settle
    assert.strictEqual(scheduleStorage.readRun(runId).settled, true, 'precondition: the troop dive settled');
    let summed = 0;
    for (const pl of owners) {
      const feed = await scheduleReq('GET', '/api/notifications', pl.token);
      const mine = feed.body.notifications.filter((n) => n.kind === 'run_settled' && n.payload.runId === runId);
      assert.strictEqual(mine.length, 1, 'each participant gets exactly one run_settled: ' + pl.playerId);
      const own = (runBefore.rewards || []).filter((a) => a.owner === pl.playerId).length;
      assert.strictEqual(mine[0].payload.lootCount, own, 'participant ' + pl.playerId + ' is told THEIR OWN haul, not the party total');
      summed += mine[0].payload.lootCount;
    }
    assert.strictEqual(summed, (runBefore.rewards || []).length, 'the per-participant counts sum to the run whole reward set');
    const outsider = playersFixture.createPlayer('R8TrOutsider', []);
    const out = await scheduleReq('GET', '/api/notifications', outsider.token);
    assert.strictEqual(out.body.notifications.filter((n) => n.roomId === id).length, 0, 'nothing leaks to a non-participant');
    for (const pl of owners) for (const item of schedule.listWarehouse(pl.playerId)) scheduleStorage.deleteWarehouseItem(pl.playerId, item.itemUid);
    scheduleStorage.deleteRoom(id);
  });

  await AT('REQ-0368: the warehouse purge sweep announces BOTH edges -- warehouse_expired names the rows it deleted (the silent-loss fix) and warehouse_expiring batch-collapses the rows entering the <24h window, each exactly once', async () => {
    const wh = playersFixture.createPlayer('R8Wh', []);
    scheduleStorage.writeProfile(wh.playerId, makeTestCanvas());
    const now = Date.now();
    const row = (uid, itemId, expiresInMs) => ({
      itemUid: uid, playerId: wh.playerId, itemId,
      harvestedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + expiresInMs).toISOString(),
      sourceRoomId: null, sourceRunId: null, status: 'claimable',
    });
    // One already dead, two inside the 24h window, one comfortably fresh.
    scheduleStorage.writeWarehouseItem(wh.playerId, 'wh_dead1', row('wh_dead1', 'test_sword', -60 * 1000));
    scheduleStorage.writeWarehouseItem(wh.playerId, 'wh_soon1', row('wh_soon1', 'test_sword', 6 * 60 * 60 * 1000));
    scheduleStorage.writeWarehouseItem(wh.playerId, 'wh_soon2', row('wh_soon2', 'test_sword', 20 * 60 * 60 * 1000));
    scheduleStorage.writeWarehouseItem(wh.playerId, 'wh_fresh', row('wh_fresh', 'test_sword', 6 * 24 * 60 * 60 * 1000));

    const survivors = schedule.listWarehouse(wh.playerId); // a read IS the sweep
    assert.strictEqual(survivors.length, 3, 'the expired row is gone, the other three survive');

    const feed = await scheduleReq('GET', '/api/notifications', wh.token);
    assert.strictEqual(feed.status, 200, 'feed: ' + JSON.stringify(feed.body));
    const expired = feed.body.notifications.filter((n) => n.kind === 'warehouse_expired');
    assert.strictEqual(expired.length, 1, 'one batch-collapsed warehouse_expired entry for the sweep');
    assert.strictEqual(expired[0].payload.count, 1, 'it counts the one row that actually died');
    assert.deepStrictEqual(expired[0].payload.itemIds, ['test_sword'], 'it names the lost item -- until REQ-0368 this loss was entirely silent');
    assert.strictEqual(expired[0].roomId, null, 'a warehouse kind has no room behind it');
    const expiring = feed.body.notifications.filter((n) => n.kind === 'warehouse_expiring');
    assert.strictEqual(expiring.length, 1, 'the two rows entering the window collapse into ONE entry for the sweep');
    assert.strictEqual(expiring[0].payload.count, 2, 'the entry carries the batch count');

    // A second sweep announces NOTHING new: the deleted row is gone, and the
    // two warned rows are marked on the row itself, so a client polling every
    // few seconds is warned once per item rather than once per poll.
    schedule.listWarehouse(wh.playerId);
    schedule.listWarehouse(wh.playerId);
    const feed2 = await scheduleReq('GET', '/api/notifications', wh.token);
    assert.strictEqual(feed2.body.notifications.filter((n) => n.kind === 'warehouse_expired').length, 1, 'no second warehouse_expired');
    assert.strictEqual(feed2.body.notifications.filter((n) => n.kind === 'warehouse_expiring').length, 1, 'no re-warning on a re-poll');
    assert.ok(scheduleStorage.readWarehouseItem(wh.playerId, 'wh_soon1').expiringNotifiedAt, 'the warned row carries its own once-only marker');
    assert.ok(!scheduleStorage.readWarehouseItem(wh.playerId, 'wh_fresh').expiringNotifiedAt, 'a row outside the window is not marked');

    // A row CROSSING into the window later gets its own entry.
    const fresh = scheduleStorage.readWarehouseItem(wh.playerId, 'wh_fresh');
    fresh.expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    scheduleStorage.writeWarehouseItem(wh.playerId, 'wh_fresh', fresh);
    schedule.listWarehouse(wh.playerId);
    const feed3 = await scheduleReq('GET', '/api/notifications', wh.token);
    const expiring3 = feed3.body.notifications.filter((n) => n.kind === 'warehouse_expiring');
    assert.strictEqual(expiring3.length, 2, 'a row that crosses into the window later is its own batch');
    assert.strictEqual(expiring3[1].payload.count, 1, 'and counts only the newly-crossed row');
    for (const item of schedule.listWarehouse(wh.playerId)) scheduleStorage.deleteWarehouseItem(wh.playerId, item.itemUid);
  });

  // =====================================================================
  // REQ-0372: expedition run history -- per-room listing of past settled
  // runs, replay-by-id, and the 10-run retention prune. Both backends run
  // this group (the api suite executes twice, files AND pg).
  // =====================================================================

  // settleCurrent: force the room's in-flight run's clock elapsed, then poll --
  // the lazy settle. Returns the run id that just settled. The room is left
  // COOLING DOWN (no new dive), so a caller can assert against a room whose
  // lastRunId is a settled run.
  async function settleCurrent(roomId, token) {
    const runId = scheduleStorage.readRoom(roomId).lastRunId;
    forceRunElapsed(runId);
    await scheduleReq('GET', '/api/schedule/rooms/' + roomId, token);
    assert.strictEqual(scheduleStorage.readRun(runId).settled, true, 'the run settled on the poll');
    return runId;
  }

  // startNextDive: clear the cooldown (not what this group tests) and poll, so
  // maybeAutoStartNextRun departs the next dive.
  async function startNextDive(roomId, token) {
    const cooled = scheduleStorage.readRoom(roomId);
    cooled.cooldownUntil = null;
    scheduleStorage.writeRoom(roomId, cooled);
    const res = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, token);
    assert.strictEqual(res.body.room.status, 'active', 'the next dive departed');
  }

  async function makeHistoryRoom(player, runCount) {
    const created = await scheduleReq('POST', '/api/schedule/rooms', player.token, { dungeonId: 'test_dungeon', level: 1 });
    assert.strictEqual(created.status, 200, 'history room created: ' + JSON.stringify(created.body));
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, player.token, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ' assigned: ' + JSON.stringify(r.body));
    }
    // Filling the 4th slot does not itself depart the dive -- the route settles
    // BEFORE it assigns, so the lazy scheduler only sees a full room on the
    // NEXT read (the REQ-0087 poll path). One GET is that read.
    const launched = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, player.token);
    assert.strictEqual(launched.body.room.status, 'active', 'the filled room departed: ' + JSON.stringify(launched.body.room && launched.body.room.status));
    const settledIds = [];
    for (let n = 0; n < runCount; n++) {
      if (n > 0) await startNextDive(roomId, player.token);
      settledIds.push(await settleCurrent(roomId, player.token));
    }
    // Leaves the room cooling down with NO dive in flight: room.lastRunId is
    // the newest SETTLED run, so GET .../run and the history listing describe
    // the same set.
    return { roomId, settledIds };
  }

  function dropHistoryRoom(player, roomId) {
    for (const item of schedule.listWarehouse(player.playerId)) scheduleStorage.deleteWarehouseItem(player.playerId, item.itemUid);
    for (const run of scheduleStorage.listRunsForRoom(roomId)) scheduleStorage.deleteRun(run.id);
    scheduleStorage.deleteRoom(roomId);
  }

  await AT('REQ-0372: GET .../runs lists past SETTLED runs newest-first with the {runId,result,startedAt,durationMs,level,lootSummary} shape, plus a window-scoped W/L tally', async () => {
    const pl = playersFixture.createPlayer('R372A', []);
    scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const { roomId, settledIds } = await makeHistoryRoom(pl, 2);

    const res = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs', pl.token);
    assert.strictEqual(res.status, 200, 'listing: ' + JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.roomId, roomId, 'the listing names its own room');
    assert.strictEqual(res.body.window, schedule.RUN_HISTORY_LIMIT, 'the retention window is reported, so the client can label the tally honestly');
    assert.strictEqual(res.body.runs.length, 2, 'both settled runs are listed');
    assert.deepStrictEqual(res.body.runs.map((r) => r.runId), settledIds.slice().reverse(), 'newest departure first');

    // A dive IN FLIGHT is not history yet -- the listing is settled runs only.
    await startNextDive(roomId, pl.token);
    const midFlight = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs', pl.token);
    assert.strictEqual(midFlight.body.runs.length, 2, 'the in-flight third dive is NOT listed');
    assert.ok(!midFlight.body.runs.some((r) => r.runId === scheduleStorage.readRoom(roomId).lastRunId), 'and specifically not by its own id');

    const row = res.body.runs[0];
    assert.ok(['victory', 'wipe', 'incomplete'].includes(row.result), 'result is a run outcome: ' + row.result);
    assert.ok(typeof row.startedAt === 'string' && !Number.isNaN(Date.parse(row.startedAt)), 'startedAt is an ISO timestamp');
    assert.strictEqual(typeof row.durationMs, 'number', 'durationMs is a number');
    assert.ok(row.durationMs >= 0, 'durationMs is non-negative');
    assert.strictEqual(row.level, 1, 'the level the dive was FOUGHT at (room.level at departure), captured on the run doc');
    assert.ok(Array.isArray(row.lootSummary), 'lootSummary is an array');
    for (const loot of row.lootSummary) {
      assert.strictEqual(typeof loot.itemId, 'string', 'loot row names an item id');
      assert.ok(loot.kind === 'item' || loot.kind === 'tm', 'loot row carries the content table to resolve it from');
      assert.ok(loot.qty >= 1, 'loot row qty is aggregated, never zero');
    }
    // durationMs is COMBAT time (the seal-comparison basis), NOT the [45s,300s]
    // clamped presentation duration the monitor's transport counts down.
    const raw0 = scheduleStorage.readRun(row.runId);
    assert.strictEqual(row.durationMs, Math.round(raw0.simDurationSecs * 1000), 'durationMs reports simDurationSecs, the combat-truth clear time');

    const tallyTotal = res.body.tally.victory + res.body.tally.wipe + res.body.tally.incomplete;
    assert.strictEqual(tallyTotal, res.body.runs.length, 'the tally counts exactly the LISTED window -- there is no all-time record to report');
    assert.strictEqual(res.body.tally[row.result] >= 1, true, 'the listed run is counted under its own result');

    // A room with no settled run yet lists nothing rather than 404ing.
    const empty = await scheduleReq('POST', '/api/schedule/rooms', pl.token, { dungeonId: 'test_dungeon', level: 1 });
    const emptyList = await scheduleReq('GET', '/api/schedule/rooms/' + empty.body.room.id + '/runs', pl.token);
    assert.strictEqual(emptyList.status, 200, 'a run-less room still answers');
    assert.deepStrictEqual(emptyList.body.runs, [], 'with an empty list');
    assert.deepStrictEqual(emptyList.body.tally, { victory: 0, wipe: 0, incomplete: 0 }, 'and a zero tally');
    scheduleStorage.deleteRoom(empty.body.room.id);

    // Method + ownership guards match the rest of the /rooms surface.
    const wrongMethod = await scheduleReq('POST', '/api/schedule/rooms/' + roomId + '/runs', pl.token, {});
    assert.strictEqual(wrongMethod.status, 405, 'listing is GET-only');
    const otherPlayer = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs', scheduleP2.token);
    assert.strictEqual(otherPlayer.status, 404, "another player's room history is not readable");

    dropHistoryRoom(pl, roomId);
  });

  await AT('REQ-0372: GET .../runs/<runId> replays a PAST run through the same ApiRunView shape -- byte-identical events to the live .../run path -- and refuses an id from any other room', async () => {
    const pl = playersFixture.createPlayer('R372B', []);
    scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const { roomId, settledIds } = await makeHistoryRoom(pl, 2);
    const olderRunId = settledIds[0];

    const byId = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs/' + olderRunId, pl.token);
    assert.strictEqual(byId.status, 200, 'past replay: ' + JSON.stringify(byId.body && byId.body.error));
    assert.strictEqual(byId.body.runId, olderRunId, 'it serves the run that was asked for, not the latest');
    assert.strictEqual(byId.body.roomId, roomId);
    assert.strictEqual(byId.body.settled, true, 'a listed run is settled by construction');
    // The monitor playback path reads exactly these fields -- the by-id route
    // must fill every one of them, not a reduced projection.
    for (const key of ['ok', 'startedAt', 'durationSecs', 'pacingVersion', 'roster', 'clock', 'events', 'result', 'finalProgressPct', 'cooldownSecs', 'levelAfter', 'H']) {
      assert.ok(Object.prototype.hasOwnProperty.call(byId.body, key), 'by-id view carries ' + key);
    }
    assert.ok(byId.body.events.length > 0, 'a settled replay is fully revealed');

    // FROZEN-SURFACE gate: the replay bytes reaching the client through the NEW
    // route are identical to the ones the existing live route serves for the
    // very same run (both go through schedule.visibleEvents -- assert it, do
    // not assume it).
    const live = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', pl.token);
    assert.strictEqual(live.body.runId, settledIds[1], 'precondition: .../run serves the room LAST (settled) run');
    const sameViaNew = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs/' + live.body.runId, pl.token);
    assert.strictEqual(JSON.stringify(sameViaNew.body.events), JSON.stringify(live.body.events), 'replay bytes are byte-identical through the new fetch path');
    assert.strictEqual(JSON.stringify(sameViaNew.body.roster), JSON.stringify(live.body.roster), 'so is the roster');

    // Cross-room + unknown id are both 404 (a run id is only readable through
    // the room that owns it).
    const otherRoom = await makeHistoryRoom(pl, 1);
    const crossRoom = await scheduleReq('GET', '/api/schedule/rooms/' + otherRoom.roomId + '/runs/' + olderRunId, pl.token);
    assert.strictEqual(crossRoom.status, 404, "a run id from ANOTHER room is not served through this room");
    const unknown = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs/run_does_not_exist', pl.token);
    assert.strictEqual(unknown.status, 404, 'an unknown run id 404s');
    const foreign = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs/' + olderRunId, scheduleP2.token);
    assert.strictEqual(foreign.status, 404, "another player's replay is not readable");

    dropHistoryRoom(pl, otherRoom.roomId);
    dropHistoryRoom(pl, roomId);
  });

  await AT('REQ-0372: retention -- settling the 11th run PRUNES the oldest run doc out of storage; the listing caps at RUN_HISTORY_LIMIT and a pruned replay 404s', async () => {
    const pl = playersFixture.createPlayer('R372C', []);
    scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const limit = schedule.RUN_HISTORY_LIMIT;
    const { roomId, settledIds } = await makeHistoryRoom(pl, limit + 2);

    const listed = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs', pl.token);
    assert.strictEqual(listed.body.runs.length, limit, 'the listing caps at the retention window');
    assert.deepStrictEqual(
      listed.body.runs.map((r) => r.runId),
      settledIds.slice(-limit).reverse(),
      'and it is the NEWEST ' + limit + ', newest first'
    );

    // The guard is real storage deletion, not a display cap.
    const pruned = settledIds.slice(0, settledIds.length - limit);
    assert.strictEqual(pruned.length, 2, 'precondition: two runs fell out of the window');
    for (const gone of pruned) {
      assert.strictEqual(scheduleStorage.readRun(gone), null, 'pruned run doc is deleted from storage: ' + gone);
      const res = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs/' + gone, pl.token);
      assert.strictEqual(res.status, 404, 'a pruned replay 404s rather than half-serving');
    }
    for (const kept of settledIds.slice(-limit)) {
      assert.ok(scheduleStorage.readRun(kept), 'a run inside the window survives: ' + kept);
    }
    // The in-flight run is never a prune candidate.
    const roomNow = scheduleStorage.readRoom(roomId);
    assert.ok(scheduleStorage.readRun(roomNow.lastRunId), 'the room current run doc is untouched');

    dropHistoryRoom(pl, roomId);
  });

  await AT('REQ-0372: a run doc recorded BEFORE this REQ (no attackLv) reports level:null rather than a guessed level', async () => {
    const pl = playersFixture.createPlayer('R372D', []);
    scheduleStorage.writeProfile(pl.playerId, makeTestCanvas());
    const { roomId, settledIds } = await makeHistoryRoom(pl, 1);
    const legacy = scheduleStorage.readRun(settledIds[0]);
    assert.strictEqual(legacy.attackLv, 1, 'a run recorded now carries the level it was fought at');
    delete legacy.attackLv; // exactly the shape of a pre-REQ-0372 run doc
    scheduleStorage.writeRun(legacy.id, legacy);

    const listed = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/runs', pl.token);
    assert.strictEqual(listed.body.runs[0].level, null, 'a legacy run reports null -- levelAfter is FLOORED on a wipe, so it is not the fought level');

    dropHistoryRoom(pl, roomId);
  });

  scheduleStorage.deleteRoom(r5TroopId);

  // Cleanup the shared open troop so it never leaks into later suites' state.
  scheduleStorage.deleteRoom(openTroopId);

  // REQ-0145a (sf): publish this group's shared fixtures for the later suites.
  Object.assign(h, { schedule, scheduleStorage, makeTestCanvas, fillAllSlots, forceRunElapsed, scheduleP1, scheduleP2, scheduleReq, fillAllSlotsSnapshotsFrom });
};
