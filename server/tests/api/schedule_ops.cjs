'use strict';
// server/tests/api/schedule_ops.cjs -- REQ-0145a (sf): the second schedule block the monolith
// interleaves AFTER the gacha group: warehouse status normalization,
// cooldown/swap/cancel policies, CRUD validation, P1-C dungeons +
// dev/backdate seams, dev clears, REQ-0043 dungeon autogen. An 11th
// suite file beyond the REQ's sketch (recorded in the REQ execution
// log): keeping the monolith's execution order beats forcing these
// into schedule.cjs, which already ran before workshop.cjs.
// Cut VERBATIM from server/tests/api_test.cjs origin lines 1835-2445 @
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

  await AT('schedule: pre-REQ-0041 warehouse rows with no `status` field at all are treated as claimable (migration on read)', async () => {
    const legacyId = 'claim_legacy_' + Date.now();
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, legacyId, {
      itemUid: legacyId, playerId: scheduleP1.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString(),
      // no `status` field at all -- exactly what a pre-REQ-0041 row looks like.
    });
    const listed = schedule.listWarehouse(scheduleP1.playerId);
    const found = listed.find((i) => i.itemUid === legacyId);
    assert.ok(found, 'legacy row must be listed');
    assert.strictEqual(found.status, 'claimable', 'a legacy row missing `status` must be treated/migrated as claimable');
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: legacyId });
    assert.strictEqual(claimRes.status, 200, 'a legacy row must be claimable: ' + JSON.stringify(claimRes.body));
    scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, legacyId); // cleanup
  });

  await AT('schedule: cooldown value follows the CD_min/CD_max/(1-H) formula; wipe drops the room level by failureStep (floored at LEVEL_MIN)', async () => {
    const combat = require('../../../sim/combat.cjs');
    // Cooldown formula check (golden l): re-derive expected cooldown from
    // the SAME cooldownForH sim exposes, for a few H values, and confirm
    // schedule-produced runs land in the legal [CD_MIN,CD_MAX] band.
    assert.ok(Math.abs(combat.cooldownForH(1) - combat.TUNABLES.CD_MIN_SECS) < 1e-9, 'H=1 (full HP) -> CD_MIN');
    assert.ok(Math.abs(combat.cooldownForH(0) - combat.TUNABLES.CD_MAX_SECS) < 1e-9, 'H=0 (wipe) -> CD_MAX');
    const midExpected = combat.TUNABLES.CD_MIN_SECS + (combat.TUNABLES.CD_MAX_SECS - combat.TUNABLES.CD_MIN_SECS) * 0.5;
    assert.ok(Math.abs(combat.cooldownForH(0.5) - midExpected) < 1e-9, 'linear formula must hold at H=0.5');

    // Wipe level-down: build a room whose squads have ZERO attack (no
    // every_secs effect) against the same weak_slime -- with no damage
    // output, the pack's own deadline_secs will elapse into a wipe.
    // (weak_slime itself has no offense with s:[5,5] cadence and 1hp, so
    // this deliberately uses a non-attacking 'blade' squad instead of
    // 'test_sword' to force a guaranteed non-clear.)
    const zeroDmgCanvas = (() => {
      const c = makeTestCanvas();
      const swap = (canvas) => { for (const p of canvas.pos) p.id = 'blade'; return canvas; };
      swap({ bps: c.bps, pos: c.pos, sis: c.sis });
      for (const idx of [1, 2, 3]) swap(c.presets.store[idx]);
      return c;
    })();
    scheduleStorage.writeProfile(scheduleP2.playerId, zeroDmgCanvas);

    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP2.token, { dungeonId: 'test_dungeon', level: 3, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP2.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    const runRaw = scheduleStorage.readRun(roomAfter.body.room.lastRunId);
    assert.notStrictEqual(runRaw.result, 'victory', 'a zero-damage troop must not win: got ' + runRaw.result);

    forceRunElapsed(roomAfter.body.room.lastRunId);
    const settledView = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP2.token);
    if (runRaw.result === 'wipe') {
      assert.strictEqual(settledView.body.room.level, 3 - schedule.DEFAULT_FAILURE_STEP, 'golden i: level drops by failureStep on wipe');
      const wh = await scheduleReq('GET', '/api/warehouse', scheduleP2.token);
      assert.strictEqual(wh.body.items.filter((it) => it.sourceRoomId === roomId).length, 0, 'golden i: nothing gained on wipe');
    }
    // Level floor: repeatedly wipe from level 1 must never drop below LEVEL_MIN.
    const floored = combat.levelDownOnWipe(combat.TUNABLES.LEVEL_MIN);
    assert.strictEqual(floored, combat.TUNABLES.LEVEL_MIN, 'levelDownOnWipe must floor at LEVEL_MIN');

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP2.token);
  });

  await AT('schedule: swap is queued (not applied) while a run is active, and applies once that run settles (golden j)', async () => {
    // REQ-0045 (b)+(c) deploy gate v2 fallout: with all 4 slots filled by
    // 4 mutually-unique squads (0,1,2,3), swapping slot 0 to squad 1
    // (as this test originally did) is now correctly refused by
    // applyPendingSwapIfAny's own assignSlot call -- squad 1 is
    // SIMULTANEOUSLY still deployed live in slot 1 of this SAME room at
    // the moment the swap would apply, which the new deploy-overlap gate
    // (deployedUidSetsForGate) correctly treats as a same-room overlap,
    // regardless of the fact that squad 1 and squad 0 share no uid
    // WITH EACH OTHER (that was the old, no-longer-relevant check). This
    // is not a regression to route around -- it is the gate correctly
    // refusing to double-deploy the same squad into two slots at once.
    // Fixed by giving squad index 4 (normally empty/null, reserved for
    // the empty_unit test elsewhere in this file) a REAL, uniquely-
    // tagged BP+PO here, used ONLY as the swap TARGET (never itself
    // occupying any of the room's other 3 slots), then restoring it to
    // null afterward so the empty_unit test's own precondition holds for
    // every test that runs after this one.
    const doc = scheduleStorage.readProfile(scheduleP1.playerId);
    doc.canvas.presets.store[4] = {
      linked: true,
      bps: [{ id: 'bp_swaptarget', name: 'BP swaptarget', color: '#888888', shape: [[0, 0], [0, 1], [1, 0], [1, 1]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 40 }],
      pos: [{ uid: 'po_swaptarget', id: 'test_sword', loc: 'grid', cell: [1, 1], rot: 0 }],
      sis: [],
    };
    scheduleStorage.writeProfile(scheduleP1.playerId, doc.canvas);

    try {
      const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
      const roomId = created.body.room.id;
      for (let i = 0; i < 4; i++) {
        const assignRes = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
        assert.strictEqual(assignRes.status, 200, 'slot ' + i + ' assign must succeed: ' + JSON.stringify(assignRes.body));
      }
      const active = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
      assert.strictEqual(active.body.room.status, 'active', 'precondition: room has a run in flight');

      const swapWhileActive = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 0, squadIndex: 4 });
      assert.strictEqual(swapWhileActive.status, 200);
      assert.strictEqual(swapWhileActive.body.applied, false, 'a swap requested mid-run must be QUEUED, not applied immediately');
      assert.ok(swapWhileActive.body.room.pendingSwap, 'pendingSwap must be recorded on the room');
      assert.strictEqual(swapWhileActive.body.room.slots[0].squadIndex, 0, 'the slot itself must NOT change yet');

      forceRunElapsed(active.body.room.lastRunId);
      const settled = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token); // triggers settle + pending-swap application
      assert.strictEqual(settled.body.room.pendingSwap, null, 'pendingSwap must be cleared once applied');
      // squad 4 (the swap target) shares no uid with ANY of 0/1/2/3 and
      // is not deployed anywhere else, so applying the swap is legal.
      assert.strictEqual(settled.body.room.slots[0].squadIndex, 4, 'golden j: the swap applies AFTER the run ends');

      // Swap with NO run active applies immediately. Target squad 2 is
      // currently live in slot 2 of this SAME room -- correctly refused
      // now (same-room overlap), so this second assertion swaps slot 1
      // (currently squad 1) to squad 1 itself is a no-op-shaped case;
      // instead verify the "applies immediately when no run is active"
      // behavior using a legality-refusal shape: assignSlot's own
      // same-room-overlap gate applies identically whether queued or
      // immediate, so the meaningful thing left to prove here is that
      // NO queuing happens (immediate 200 with applied:true) when the
      // room is not active -- done by first canceling this room's
      // current run state is not an option (would delete state); instead
      // swap slot 3 (currently squad 3) to itself, which is always
      // legal (a squad never overlaps its own current slot -- excluded
      // by assignSlot's own excludeSlotIndex) and unambiguously proves
      // the immediate-apply path.
      const swapNow = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 3, squadIndex: 3 });
      assert.strictEqual(swapNow.body.applied, true, 'a swap requested with no active run must apply immediately');

      await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    } finally {
      const doc2 = scheduleStorage.readProfile(scheduleP1.playerId);
      doc2.canvas.presets.store[4] = null;
      scheduleStorage.writeProfile(scheduleP1.playerId, doc2.canvas);
    }
  });

  await AT('schedule: cancel policy -- immediate:true cancels right away; immediate:false with an active run only flags cancelRequested until settle (golden g)', async () => {
    // immediate: true
    const roomA = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, cancelPolicy: { immediate: true } });
    const cancelA = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomA.body.room.id, scheduleP1.token);
    assert.strictEqual(cancelA.body.room.status, 'canceled', 'immediate:true must cancel right away');

    // immediate: false, WITH an active run -> flagged, not canceled yet.
    const roomB = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1', cancelPolicy: { immediate: false } });
    const roomBId = roomB.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomBId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomBActive = await scheduleReq('GET', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    assert.strictEqual(roomBActive.body.room.status, 'active');
    const cancelB = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    assert.strictEqual(cancelB.body.room.status, 'active', 'immediate:false with a run in flight must NOT cancel yet');
    assert.strictEqual(cancelB.body.room.cancelRequested, true, 'cancelRequested must be flagged instead');

    // Once that run settles, the flagged cancel is honored instead of auto-scheduling the next run.
    forceRunElapsed(roomBActive.body.room.lastRunId);
    const afterSettle = await scheduleReq('GET', '/api/schedule/rooms/' + roomBId, scheduleP1.token);
    assert.strictEqual(afterSettle.body.room.status, 'canceled', 'golden g: cancel-after-current-run is honored once the run settles');

    // immediate: false with NO active run cancels right away (nothing to "finish first").
    const roomC = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, cancelPolicy: { immediate: false } });
    const cancelC = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomC.body.room.id, scheduleP1.token);
    assert.strictEqual(cancelC.body.room.status, 'canceled', 'immediate:false with no run active must cancel immediately (nothing to wait for)');
  });

  await AT('schedule: room CRUD -- level defaults/clamps to LEVEL_MIN, unknown formationId falls back to the default formation', async () => {
    const combat = require('../../../sim/combat.cjs');
    const noLevel = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon' });
    assert.strictEqual(noLevel.body.room.level, combat.TUNABLES.LEVEL_MIN, 'omitted level must default to LEVEL_MIN');
    const badFormation = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', formationId: 'not_a_real_formation' });
    assert.strictEqual(badFormation.body.room.formationId, schedule.DEFAULT_FORMATION_ID, 'unknown formationId falls back to the documented default');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + noLevel.body.room.id, scheduleP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + badFormation.body.room.id, scheduleP1.token);
  });

  await AT('schedule: creating a room without a dungeonId is a 400', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { level: 1 });
    assert.strictEqual(res.status, 400);
  });

  await AT('schedule: assigning an out-of-range slot index or an out-of-range squadIndex is a 400, not a crash', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const badSlot = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/99', scheduleP1.token, { squadIndex: 0 });
    assert.strictEqual(badSlot.status, 400);
    const badSquad = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 99 });
    assert.strictEqual(badSquad.status, 400);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: starting a run with an incomplete troop (not all 4 slots filled) is refused, never silently runs a partial troop', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', scheduleP1.token, { squadIndex: 0 });
    await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/1', scheduleP1.token, { squadIndex: 1 });
    // Only 2 of 4 slots filled -- room must stay 'open', no run started.
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'open', 'a room with an incomplete troop must never auto-start a run');
    assert.strictEqual(roomAfter.body.room.lastRunId, null);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: GET warehouse for a player with none is an empty list, not an error', async () => {
    const freshPlayer = playersFixture.createPlayer('FreshWarehouseOwner', []);
    const res = await scheduleReq('GET', '/api/warehouse', freshPlayer.token);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.items, []);
  });

  await AT('schedule: claiming an unknown/nonexistent warehouse itemUid is a 404', async () => {
    const res = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, { itemUid: 'no_such_item_uid_at_all' });
    assert.strictEqual(res.status, 404);
  });

  await AT('schedule: claim requires an itemUid in the body (400 when missing)', async () => {
    const res = await scheduleReq('POST', '/api/warehouse/claim', scheduleP1.token, {});
    assert.strictEqual(res.status, 400);
  });

  await AT('schedule: swap on an out-of-range slot index is a 400', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const res = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/swap', scheduleP1.token, { slot: 99, squadIndex: 0 });
    assert.strictEqual(res.status, 400);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: GET run on a room with no run yet is a 404', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const res = await scheduleReq('GET', '/api/schedule/rooms/' + roomId + '/run', scheduleP1.token);
    assert.strictEqual(res.status, 404);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: canceling an already-canceled room is idempotent (still 200, still canceled)', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, cancelPolicy: { immediate: true } });
    const roomId = created.body.room.id;
    const first = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(first.body.room.status, 'canceled');
    const second = await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.room.status, 'canceled');
  });

  // =====================================================================
  // REQ-0036 P1-C: GET /api/schedule/dungeons (no-auth) + POST .../dev/
  // backdate (dev-only) -- new server surface added for the client half.
  // =====================================================================

  await AT('schedule: GET /api/schedule/dungeons returns the dungeon list + formations, no auth required', async () => {
    // No token at all AND not even routed through resolveAuth -- confirm
    // by using a deliberately garbage token too (must still 200, unlike
    // every OTHER /api/schedule/* route, which would 401 on a bad token).
    const noToken = await scheduleReq('GET', '/api/schedule/dungeons', undefined);
    assert.strictEqual(noToken.status, 200);
    assert.ok(Array.isArray(noToken.body.dungeons) && noToken.body.dungeons.length >= 1, 'dungeons list present');
    assert.strictEqual(noToken.body.dungeons[0].id, 'test_dungeon', 'fixture dungeon id present');
    assert.ok(Array.isArray(noToken.body.formations) && noToken.body.formations.length === 2, 'both fixture formations present');
    assert.ok(noToken.body.formations.some((f) => f.id === 'formation1'));
    assert.ok(noToken.body.formations[0].canvases && noToken.body.formations[0].canvases.unit1, 'formation carries its canvases box map');

    const garbageToken = await scheduleReq('GET', '/api/schedule/dungeons', 'totally-bogus-token-value');
    assert.strictEqual(garbageToken.status, 200, 'a bad token must not block this no-auth route (never resolveAuth-gated)');
  });

  await AT('schedule: POST /api/schedule/rooms/:id/dev/backdate is dev-only (403 for a real guest token) and moves an active run\'s clock into the past for the dev fallback caller', async () => {
    // Room owned by ScheduleP1 (a REAL guest token, not the dev fallback).
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, scheduleP1.token, { squadIndex: i });
    const roomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, scheduleP1.token);
    assert.strictEqual(roomAfter.body.room.status, 'active', 'room must be running for this test to mean anything');

    // A real (non-dev) guest token -- even the room's OWN owner's token --
    // must be refused 403, never allowed to fast-forward their own run.
    const asOwner = await scheduleReq('POST', '/api/schedule/rooms/' + roomId + '/dev/backdate', scheduleP1.token, {});
    assert.strictEqual(asOwner.status, 403, 'a real guest token (even the room owner\'s own) must be refused: ' + JSON.stringify(asOwner.body));

    // The dev_mode fallback caller (no token at all) CAN backdate -- but
    // only ITS OWN rooms (ownership is still enforced via
    // getOwnRoomOr404) -- this room belongs to scheduleP1, not the dev
    // player, so even the dev fallback gets 404 here (never touches
    // another player's room).
    const asDevOnOthersRoom = await scheduleReq('POST', '/api/schedule/rooms/' + roomId + '/dev/backdate', undefined, {});
    assert.strictEqual(asDevOnOthersRoom.status, 404, 'dev fallback must not backdate a room it does not own: ' + JSON.stringify(asDevOnOthersRoom.body));

    // Create a room OWNED BY the dev fallback player itself, fill all 4
    // slots (dev player's own profile canvas was seeded by
    // ensureDevPlayer() + this suite's own admin fixtures -- but schedule
    // routes need the dev player to actually HAVE a canvas with 4 usable
    // squads; reuse the exact same makeTestCanvas() shape scheduleP1/P2
    // already use, written directly to the dev player's own profile).
    scheduleStorage.writeProfile(devPlayer.playerId, makeTestCanvas());
    const devRoomRes = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    assert.strictEqual(devRoomRes.status, 200, 'dev fallback must be able to create its own room: ' + JSON.stringify(devRoomRes.body));
    const devRoomId = devRoomRes.body.room.id;
    for (let i = 0; i < 4; i++) {
      const slotRes = await scheduleReq('PUT', '/api/schedule/rooms/' + devRoomId + '/slots/' + i, undefined, { squadIndex: i });
      assert.strictEqual(slotRes.status, 200, 'dev fallback slot ' + i + ' assign: ' + JSON.stringify(slotRes.body));
    }
    const devRoomAfter = await scheduleReq('GET', '/api/schedule/rooms/' + devRoomId, undefined);
    assert.strictEqual(devRoomAfter.body.room.status, 'active');
    const devRunId = devRoomAfter.body.room.lastRunId;
    const rawRunBefore = scheduleStorage.readRun(devRunId);
    assert.strictEqual(schedule.runClock(rawRunBefore).isSettled, false, 'run must not already be settled (test would be meaningless otherwise)');

    const backdateRes = await scheduleReq('POST', '/api/schedule/rooms/' + devRoomId + '/dev/backdate', undefined, { extraSecsIntoPast: 5 });
    assert.strictEqual(backdateRes.status, 200, JSON.stringify(backdateRes.body));
    assert.strictEqual(backdateRes.body.runId, devRunId);

    // The run's OWN persisted seed must be completely untouched by this
    // call (test-control seam, not a gameplay/reward-RNG-biasing knob).
    const rawRunAfter = scheduleStorage.readRun(devRunId);
    assert.strictEqual(rawRunAfter.seed, rawRunBefore.seed, 'backdate must never touch the run\'s seed');
    assert.strictEqual(schedule.runClock(rawRunAfter).isSettled, true, 'run clock must now read as settled');

    // A subsequent GET on the room must observe + settle it (lazy
    // settlement, same settleRoomIfDue() path every other test relies
    // on) -- confirms the backdate hook is a genuine drop-in substitute
    // for real wall-clock time from the room-lifecycle's point of view.
    const settledView = await scheduleReq('GET', '/api/schedule/rooms/' + devRoomId, undefined);
    assert.notStrictEqual(settledView.body.room.status, 'active', 'room must have settled out of active status');

    // Cleanup: cancel the dev room + clear anything it rewarded, so this
    // fixture player's state does not leak into any later test in this
    // file that might also touch the dev player's warehouse/rooms.
    for (const item of schedule.listWarehouse(devPlayer.playerId)) scheduleStorage.deleteWarehouseItem(devPlayer.playerId, item.itemUid);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + devRoomId, undefined);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, scheduleP1.token);
  });

  await AT('schedule: POST .../dev/backdate on a room with no run yet is a 400, not a crash', async () => {
    scheduleStorage.writeProfile(devPlayer.playerId, makeTestCanvas());
    const created = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', level: 1 });
    const roomId = created.body.room.id;
    const res = await scheduleReq('POST', '/api/schedule/rooms/' + roomId + '/dev/backdate', undefined, {});
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, undefined);
  });

  await AT('schedule: POST /api/warehouse/dev/backdate-claim is dev-only (403 for a real guest token) and force-reverts a claiming row without waiting out the real 120s timeout (REQ-0041 E2E hook)', async () => {
    // NOTE: this row is written ONCE, directly under devPlayer.playerId
    // (never rewritten under a DIFFERENT playerId afterwards) --
    // writeWarehouseItemPg's `ON CONFLICT (item_uid) DO UPDATE` clause
    // deliberately does not update the `player_id` COLUMN (only doc/
    // harvested_at/updated_at), matching every REAL call site's own
    // invariant that a warehouse row's owner never changes across its
    // life; rewriting the SAME itemUid under a second playerId (which
    // this test used to do, by mistake) silently orphans the row from
    // listWarehouseItemsPg's `WHERE player_id = $1` filter under its NEW
    // playerId, even though the JSON doc's own embedded `playerId` field
    // says otherwise -- a real, if narrow, footgun worth documenting
    // here rather than repeating.
    const grantId = 'wh_backdateclaim_' + Date.now();
    scheduleStorage.writeWarehouseItem(devPlayer.playerId, grantId, {
      itemUid: grantId, playerId: devPlayer.playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 999999).toISOString(),
      status: 'claimable',
    });

    // 403 for a real guest token, even a token belonging to a DIFFERENT
    // player entirely (scheduleP1's own guest token) -- this dev-only
    // hook never honors any real token, regardless of whose row it names.
    const guestRes = await scheduleReq('POST', '/api/warehouse/dev/backdate-claim', scheduleP1.token, { itemUid: grantId });
    assert.strictEqual(guestRes.status, 403, 'a real guest token must never reach this dev-only hook: ' + JSON.stringify(guestRes.body));

    // Claim it (marks 'claiming') via the dev fallback caller (undefined
    // token), then force-backdate its claimedAt -- must read as abandoned
    // (claimable again) on the very next GET /api/warehouse, with zero
    // real wall-clock wait.
    const claimRes = await scheduleReq('POST', '/api/warehouse/claim', undefined, { itemUid: grantId });
    assert.strictEqual(claimRes.status, 200, JSON.stringify(claimRes.body));

    const backdateRes = await scheduleReq('POST', '/api/warehouse/dev/backdate-claim', undefined, { itemUid: grantId });
    assert.strictEqual(backdateRes.status, 200, JSON.stringify(backdateRes.body));

    const listRes = await scheduleReq('GET', '/api/warehouse', undefined);
    const found = listRes.body.items.find((i) => i.itemUid === grantId);
    assert.ok(found, 'the row must still be present (never lost)');
    assert.strictEqual(found.status, 'claimable', 'the row must have lazily reverted to claimable after the forced backdate');

    // A row that is NOT currently 'claiming' (already claimable) is a 400
    // -- nothing to backdate.
    const notClaimingRes = await scheduleReq('POST', '/api/warehouse/dev/backdate-claim', undefined, { itemUid: grantId });
    assert.strictEqual(notClaimingRes.status, 400, JSON.stringify(notClaimingRes.body));

    scheduleStorage.deleteWarehouseItem(devPlayer.playerId, grantId);
  });

  await AT('schedule: POST /api/warehouse/dev/clear-debris is dev-only (403 for a real guest token) and bulk-clears ONLY the dev fallback caller\'s warehouse rows (fix: e2e pg teardown -- E2E debris-cleanup hook)', async () => {
    // Seed two rows for the dev fallback player + one for a real guest
    // (scheduleP1), written directly via the storage chokepoint -- same
    // seeding technique as the backdate-claim test above. Each row is
    // written ONCE under its final owner (see that test's NOTE on the
    // writeWarehouseItemPg ON CONFLICT/player_id footgun).
    const now = Date.now();
    const mkRow = (uid, pid) => ({
      itemUid: uid, playerId: pid, itemId: 'blade',
      harvestedAt: new Date(now).toISOString(), expiresAt: new Date(now + 999999).toISOString(),
      status: 'claimable',
    });
    const uidA = 'wh_cleardebris_a_' + now;
    const uidB = 'wh_cleardebris_b_' + now;
    const uidGuest = 'wh_cleardebris_guest_' + now;
    scheduleStorage.writeWarehouseItem(devPlayer.playerId, uidA, mkRow(uidA, devPlayer.playerId));
    scheduleStorage.writeWarehouseItem(devPlayer.playerId, uidB, mkRow(uidB, devPlayer.playerId));
    scheduleStorage.writeWarehouseItem(scheduleP1.playerId, uidGuest, mkRow(uidGuest, scheduleP1.playerId));
    try {
      // 403 for a real guest token -- this dev-only hook never honors ANY
      // real token (same callerIsDevFallback gate as dev/backdate and
      // dev/backdate-claim above), and the guard runs before any delete.
      const guestRes = await scheduleReq('POST', '/api/warehouse/dev/clear-debris', scheduleP1.token);
      assert.strictEqual(guestRes.status, 403, 'a real guest token must never reach this dev-only hook: ' + JSON.stringify(guestRes.body));

      // 405 for a non-POST method (same method gate shape as its siblings).
      const getRes = await scheduleReq('GET', '/api/warehouse/dev/clear-debris', undefined);
      assert.strictEqual(getRes.status, 405, JSON.stringify(getRes.body));

      // Happy path: the dev fallback caller (no token) clears its OWN
      // rows -- at least the two seeded here (earlier tests may have left
      // additional dev-player rows; that is exactly the debris this hook
      // exists to remove) -- and the very next list is empty.
      const clearRes = await scheduleReq('POST', '/api/warehouse/dev/clear-debris', undefined);
      assert.strictEqual(clearRes.status, 200, JSON.stringify(clearRes.body));
      assert.ok(clearRes.body.deleted >= 2, 'both seeded dev rows must count toward deleted: ' + JSON.stringify(clearRes.body));
      const devList = await scheduleReq('GET', '/api/warehouse', undefined);
      assert.strictEqual(devList.body.items.length, 0, 'dev warehouse must be empty right after clear-debris: ' + JSON.stringify(devList.body.items));

      // ...and NEVER the guest's row: the hook is caller-scoped (no
      // client-suppliable playerId exists in its shape), so a real
      // player's warehouse is untouched by a dev clear.
      const guestList = await scheduleReq('GET', '/api/warehouse', scheduleP1.token);
      assert.ok(guestList.body.items.find((i) => i.itemUid === uidGuest), 'the guest-owned row must survive the dev clear');

      // Idempotent: clearing an already-empty warehouse is a 200 with
      // deleted:0, never an error (setup AND teardown both call it).
      const again = await scheduleReq('POST', '/api/warehouse/dev/clear-debris', undefined);
      assert.strictEqual(again.status, 200, JSON.stringify(again.body));
      assert.strictEqual(again.body.deleted, 0, JSON.stringify(again.body));
    } finally {
      scheduleStorage.deleteWarehouseItem(scheduleP1.playerId, uidGuest);
    }
  });

  // =====================================================================
  // REQ-0082: dev-only POST /api/schedule/rooms/dev/clear -- bulk-clears the
  // dev fallback caller's accumulated schedule rooms (sibling of warehouse
  // dev/clear-debris; stops the canceled-room pile-up that collapsed the
  // schedule create panel's zero-rooms auto-open).
  // =====================================================================
  await AT('schedule: POST /api/schedule/rooms/dev/clear is dev-only (403 for a real guest token) and bulk-clears ONLY the dev fallback caller\'s rooms (REQ-0082)', async () => {
    // Seed two rooms for the dev fallback player + one for a real guest,
    // written directly via the storage chokepoint (minimal canceled docs --
    // clearRoomsForOwner only needs {id, ownerId} to find + remove them).
    const now = Date.now();
    const mkRoom = (id, pid) => ({ id: id, ownerId: pid, status: 'canceled', createdAt: now, slots: [] });
    const ridA = 'room_devclear_a_' + now;
    const ridB = 'room_devclear_b_' + now;
    const ridGuest = 'room_devclear_guest_' + now;
    scheduleStorage.writeRoom(ridA, mkRoom(ridA, devPlayer.playerId));
    scheduleStorage.writeRoom(ridB, mkRoom(ridB, devPlayer.playerId));
    scheduleStorage.writeRoom(ridGuest, mkRoom(ridGuest, scheduleP1.playerId));
    try {
      const guestRes = await scheduleReq('POST', '/api/schedule/rooms/dev/clear', scheduleP1.token);
      assert.strictEqual(guestRes.status, 403, 'a real guest token must never reach this dev-only hook: ' + JSON.stringify(guestRes.body));

      const getRes = await scheduleReq('GET', '/api/schedule/rooms/dev/clear', undefined);
      assert.strictEqual(getRes.status, 405, JSON.stringify(getRes.body));

      const clearRes = await scheduleReq('POST', '/api/schedule/rooms/dev/clear', undefined);
      assert.strictEqual(clearRes.status, 200, JSON.stringify(clearRes.body));
      assert.ok(clearRes.body.deleted >= 2, 'both seeded dev rooms must count toward deleted: ' + JSON.stringify(clearRes.body));
      assert.strictEqual(scheduleStorage.readRoom(ridA), null, 'dev room A must be gone after clear');
      assert.strictEqual(scheduleStorage.readRoom(ridB), null, 'dev room B must be gone after clear');

      assert.ok(scheduleStorage.readRoom(ridGuest), 'the guest-owned room must survive the dev clear (caller-scoped)');

      const again = await scheduleReq('POST', '/api/schedule/rooms/dev/clear', undefined);
      assert.strictEqual(again.status, 200, JSON.stringify(again.body));
    } finally {
      scheduleStorage.deleteRoom(ridGuest);
    }
  });

  // =====================================================================
  // REQ-0043: dungeon auto-generation -- room dungeonType/level/genSeed,
  // genSeed privilege gating (dev fallback / item_admin only, same
  // pattern as dev/backdate), and fixed-seed run reproducibility.
  // =====================================================================

  await AT('REQ-0043: POST /api/schedule/rooms accepts an explicit dungeonType and stores it on the room', async () => {
    const created = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 4, formationId: 'formation1' });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    assert.strictEqual(created.body.room.dungeonType, 'default');
    assert.strictEqual(created.body.room.level, 4);
    assert.ok(typeof created.body.room.genSeed === 'string' && created.body.room.genSeed.length > 0, 'a room always carries SOME genSeed, random by default');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + created.body.room.id, scheduleP1.token);
  });

  await AT('REQ-0043: an unknown dungeonType is a 400, not a silent fallback', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', dungeonType: 'not_a_real_type', level: 1 });
    assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  });

  await AT('REQ-0043: dungeonType defaults via back-compat -- a dungeonId equal to the static pilot dungeon\'s own id resolves to test_fixed; any other dungeonId resolves to default', async () => {
    const asPilot = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', level: 1 });
    assert.strictEqual(asPilot.body.room.dungeonType, 'test_fixed', 'dungeonId matching the fixture\'s own pilot dungeon id must back-compat-resolve to test_fixed');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + asPilot.body.room.id, scheduleP1.token);

    const asOther = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'some_other_string', level: 1 });
    assert.strictEqual(asOther.body.room.dungeonType, 'default', 'any other dungeonId defaults to the generator');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + asOther.body.room.id, scheduleP1.token);
  });

  await AT('REQ-0043: GET /api/schedule/dungeons lists the generator types (default, test_fixed) alongside the legacy dungeons array', async () => {
    const res = await scheduleReq('GET', '/api/schedule/dungeons', undefined);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.types), 'response must carry a types array');
    const ids = res.body.types.map((t) => t.id).sort();
    assert.deepStrictEqual(ids, ['default', 'test_fixed'], 'exactly the two known generator types');
    // Backward compat: the original dungeons array is untouched.
    assert.ok(res.body.dungeons.some((d) => d.id === 'test_dungeon'), 'legacy dungeons array must still be present (back-compat)');
  });

  await AT('REQ-0043: genSeed is refused (403) for a plain guest token, even a perfectly valid one', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', scheduleP1.token, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 1, genSeed: 'guest-attempted-seed' });
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));
  });

  await AT('REQ-0043: genSeed is refused (403) for a guest token WITHOUT item_admin, even naming a legit-looking seed', async () => {
    const plainGuest = playersFixture.createPlayer('PlainGuestNoAdmin', []);
    const res = await scheduleReq('POST', '/api/schedule/rooms', plainGuest.token, { dungeonId: 'test_dungeon', dungeonType: 'test_fixed', level: 1, genSeed: '12345' });
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));
  });

  await AT('REQ-0043: genSeed IS accepted for a guest token that carries the item_admin role', async () => {
    const adminGuest = playersFixture.createPlayer('AdminGuestReq0043', ['item_admin']);
    const res = await scheduleReq('POST', '/api/schedule/rooms', adminGuest.token, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 2, genSeed: 'admin-chosen-seed' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.room.genSeed, 'admin-chosen-seed');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + res.body.room.id, adminGuest.token);
  });

  await AT('REQ-0043: genSeed IS accepted for the dev_mode no-token fallback caller', async () => {
    const res = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 2, genSeed: 'dev-fallback-seed' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.room.genSeed, 'dev-fallback-seed');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + res.body.room.id, undefined);
  });

  await AT('REQ-0043: a room with an explicit genSeed produces a BYTE-IDENTICAL generated dungeon def to a direct dungen.generate() call with the same inputs', async () => {
    const dungen = require('../../../sim/dungen.cjs');
    const expected = dungen.generate('default', 3, 'reproducibility-check-seed');

    const created = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 3, genSeed: 'reproducibility-check-seed', formationId: 'formation1' });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const roomId = created.body.room.id;
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, undefined, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ': ' + JSON.stringify(r.body));
    }
    const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, undefined);
    assert.ok(after.body.room.lastRunId, 'troop complete -- a run must have auto-started');
    const runDoc = scheduleStorage.readRun(after.body.room.lastRunId);
    // encounter_start events (one per encounter actually reached) carry
    // `kind` -- reconstruct the encounter TYPE sequence actually run and
    // compare against the independently-generated def's own type
    // sequence, proving the SAME genSeed drove the SAME generated layout
    // server-side as calling dungen.generate() directly would.
    const startEvents = runDoc.events.filter((e) => e.ev === 'encounter_start');
    const actualTypeSeq = startEvents.map((e) => e.kind);
    const expectedTypeSeq = expected.encounters.map((e) => e.type);
    assert.deepStrictEqual(actualTypeSeq, expectedTypeSeq.slice(0, actualTypeSeq.length), 'the run\'s own encounter-type sequence must match dungen.generate()\'s def for the SAME genSeed');

    await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, undefined);
  });

  await AT('REQ-0043: two DIFFERENT rooms created with the SAME genSeed produce IDENTICAL replay logs (deterministic reproducibility)', async () => {
    async function runOnce() {
      const created = await scheduleReq('POST', '/api/schedule/rooms', undefined, { dungeonId: 'test_dungeon', dungeonType: 'default', level: 2, genSeed: 'same-seed-two-rooms', formationId: 'formation1' });
      const roomId = created.body.room.id;
      for (let i = 0; i < 4; i++) {
        await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, undefined, { squadIndex: i });
      }
      const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, undefined);
      const runDoc = scheduleStorage.readRun(after.body.room.lastRunId);
      await scheduleReq('DELETE', '/api/schedule/rooms/' + roomId, undefined);
      return runDoc;
    }
    const runA = await runOnce();
    const runB = await runOnce();
    // The GENERATED DUNGEON LAYOUT (encounter type/composition sequence)
    // must be identical across both rooms -- but the two runs' own COMBAT
    // seed is independently random per startRun() (by design, see
    // sim/dungen.cjs's header comment: genSeed governs LAYOUT only, never
    // combat outcome), so full event-log byte-equality is NOT expected;
    // what IS guaranteed deterministic is the encounter type/enemy-id
    // sequence actually reached, which this asserts on both runs.
    function encounterSignature(runDoc) {
      return runDoc.events
        .filter((e) => e.ev === 'encounter_start')
        .map((e) => e.kind);
    }
    assert.deepStrictEqual(encounterSignature(runA), encounterSignature(runB), 'same genSeed => same generated encounter-type sequence across two independently-created rooms');
  });

  os.homedir = realHomedir;
  delete process.env.CONTENT_ROOT; // REQ-0145a (sc): the real-repo admin test below must resolve REAL content again


};
