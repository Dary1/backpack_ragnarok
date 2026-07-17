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

  await AT('schedule: GET .../run?format=text (REQ-0045 g) returns a plain-text, one-humanized-line-per-event mirror of the same visibleEvents() the JSON route sends -- any OTHER/absent format value still returns JSON unchanged', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active');

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


  // REQ-0145a (sf): publish this group's shared fixtures for the later suites.
  Object.assign(h, { schedule, scheduleStorage, makeTestCanvas, fillAllSlots, forceRunElapsed, scheduleP1, scheduleP2, scheduleReq, fillAllSlotsSnapshotsFrom });
};
