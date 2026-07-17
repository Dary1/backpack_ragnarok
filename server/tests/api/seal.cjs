'use strict';
// server/tests/api/seal.cjs -- REQ-0058: Sealed Seed Share server tests
// (files + pg parity, run under both backends by api_test.cjs). Covers:
// seal mint freshness-by-construction, copy fidelity (frozen tuple
// byte-equal across recipients' rooms), one-run-per-participant 409, the
// anti-spoiler visibility gate (masked until own settle / 403 for
// non-participants), the seal-scoped replay gate, and the single-shot
// (no-auto-restart) property of a sealed room. Reuses the shared schedule
// fixtures published on `h` by server/tests/api/schedule.cjs.
module.exports.run = async function run(h) {
  const assert = require('assert');
  const { T, AT, playersFixture, scheduleStorage, makeTestCanvas, forceRunElapsed, scheduleReq } = h;

  const sealP1 = playersFixture.createPlayer('SealP1', []);
  const sealP2 = playersFixture.createPlayer('SealP2', []);
  const sealOutsider = playersFixture.createPlayer('SealOutsider', []);
  scheduleStorage.writeProfile(sealP1.playerId, makeTestCanvas());
  scheduleStorage.writeProfile(sealP2.playerId, makeTestCanvas());
  scheduleStorage.writeProfile(sealOutsider.playerId, makeTestCanvas());

  async function mint(token, body) {
    return scheduleReq('POST', '/api/schedule/seal', token, body || { dungeonId: 'test_dungeon', level: 1 });
  }
  async function joinSeal(token, sealId) {
    return scheduleReq('POST', '/api/schedule/rooms', token, { sealId, formationId: 'formation1' });
  }
  // Fill all 4 slots (auto-starts the run on the next read) and, if
  // `settle` is true, force the run-clock elapsed + read again to settle
  // it. Storage-level forceRunElapsed works for ANY player's run (no dev-
  // fallback gate needed -- this is the unit harness, not the HTTP time
  // seam), so both participants can settle in-test.
  async function runRoom(token, roomId, settle) {
    for (let i = 0; i < 4; i++) {
      const r = await scheduleReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/' + i, token, { squadIndex: i });
      assert.strictEqual(r.status, 200, 'slot ' + i + ': ' + JSON.stringify(r.body));
    }
    const view = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, token); // triggers auto-start
    const runId = view.body.room.lastRunId;
    assert.ok(runId, 'room must have auto-started a run: ' + JSON.stringify(view.body.room));
    if (settle) {
      forceRunElapsed(runId);
      await scheduleReq('GET', '/api/schedule/rooms/' + roomId, token); // settles
    }
    return runId;
  }

  await AT('seal: POST /api/schedule/seal mints a fresh, zero-run sealed tuple; genSeed is withheld from the response but stored server-side; two mints differ', async () => {
    const a = await mint(sealP1.token);
    assert.strictEqual(a.status, 200);
    assert.ok(a.body.seal.sealId.startsWith('seal_'), 'sealId shape');
    assert.strictEqual(a.body.shareToken, a.body.seal.sealId, 'shareToken == sealId');
    assert.strictEqual(a.body.seal.level, 1);
    assert.ok(['default', 'test_fixed'].includes(a.body.seal.dungeonType), 'resolved dungeonType');
    assert.deepStrictEqual(a.body.seal.affixes, [], 'affixes default []');
    assert.strictEqual(a.body.seal.genSeed, undefined, 'genSeed must NOT be exposed in the response');
    // Server-side the seal DOES carry a fresh genSeed, and has zero runs at mint (freshness by construction).
    const stored = scheduleStorage.readSeal(a.body.seal.sealId);
    assert.strictEqual(typeof stored.genSeed, 'string');
    assert.ok(stored.genSeed.length >= 16, 'genSeed is a real crypto seed');
    assert.strictEqual(scheduleStorage.listSealRuns(a.body.seal.sealId).length, 0, 'a freshly-minted seal has zero participant runs');
    const b = await mint(sealP1.token);
    assert.notStrictEqual(b.body.seal.sealId, a.body.seal.sealId, 'each mint gets a unique sealId');
    assert.notStrictEqual(scheduleStorage.readSeal(b.body.seal.sealId).genSeed, stored.genSeed, 'each mint gets a fresh genSeed');
  });

  await AT('seal: a caller-supplied genSeed in the mint body is IGNORED (REQ-0043 gate untouched -- sealing always mints its own seed)', async () => {
    const res = await mint(sealP1.token, { dungeonId: 'test_dungeon', level: 1, genSeed: 'attacker-chosen-seed' });
    assert.strictEqual(res.status, 200, 'mint must NOT 403 on a stray genSeed -- it is simply ignored');
    const stored = scheduleStorage.readSeal(res.body.seal.sealId);
    assert.notStrictEqual(stored.genSeed, 'attacker-chosen-seed', 'the caller-supplied seed must never become the sealed seed');
  });

  await AT('seal: copy fidelity -- both recipients\' rooms copy the frozen tuple (dungeonId/level/genSeed/affixes) byte-equal, and carry the sealId', async () => {
    const m = await mint(sealP1.token, { dungeonId: 'test_dungeon', level: 2 });
    const sealId = m.body.seal.sealId;
    const stored = scheduleStorage.readSeal(sealId);
    const r1 = await joinSeal(sealP1.token, sealId);
    const r2 = await joinSeal(sealP2.token, sealId);
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
    assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
    for (const rr of [r1, r2]) {
      assert.strictEqual(rr.body.room.sealId, sealId, 'room carries the sealId');
      assert.strictEqual(rr.body.room.genSeed, stored.genSeed, 'room genSeed is the sealed seed, verbatim');
      assert.strictEqual(rr.body.room.dungeonId, stored.dungeonId, 'room dungeonId (the sealed dungeon def) copied verbatim'); // REQ-0185: dungeonId is the frozen selection now
      assert.strictEqual(rr.body.room.level, stored.level, 'room level copied verbatim');
      assert.deepStrictEqual(rr.body.room.affixes, stored.affixes, 'room affixes copied verbatim');
    }
    // Byte-equal across the two rooms.
    assert.strictEqual(r1.body.room.genSeed, r2.body.room.genSeed, 'both recipients get the SAME frozen seed');
    // Cleanup: cancel both rooms so they don't linger active.
    await scheduleReq('DELETE', '/api/schedule/rooms/' + r1.body.room.id, sealP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + r2.body.room.id, sealP2.token);
  });

  await AT('seal: one-run-per-participant -- a second join of the same sealId by the same caller is refused 409 (reason seal_already_joined)', async () => {
    const m = await mint(sealP1.token);
    const sealId = m.body.seal.sealId;
    const first = await joinSeal(sealP1.token, sealId);
    assert.strictEqual(first.status, 200);
    const dup = await joinSeal(sealP1.token, sealId);
    assert.strictEqual(dup.status, 409, 'second join must be 409: ' + JSON.stringify(dup.body));
    assert.strictEqual(dup.body.reason, 'seal_already_joined');
    // A DIFFERENT participant may still join once.
    const other = await joinSeal(sealP2.token, sealId);
    assert.strictEqual(other.status, 200, 'a different participant joins fine');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + first.body.room.id, sealP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + other.body.room.id, sealP2.token);
  });

  await AT('seal: joining a nonexistent sealId 404s', async () => {
    const res = await joinSeal(sealP1.token, 'seal_does_not_exist');
    assert.strictEqual(res.status, 404, JSON.stringify(res.body));
  });

  await AT('seal: anti-spoiler comparison -- masked until own settle, 403 for non-participants, unlocks after own run settles (everything reveals)', async () => {
    const m = await mint(sealP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const sealId = m.body.seal.sealId;
    const r1 = await joinSeal(sealP1.token, sealId);
    const r2 = await joinSeal(sealP2.token, sealId);
    // P2 fills + runs but does NOT settle (run in flight); P1 not run yet.
    await runRoom(sealP2.token, r2.body.room.id, false);

    // Non-participant: 403.
    const outsider = await scheduleReq('GET', '/api/schedule/seals/' + sealId + '/comparison', sealOutsider.token);
    assert.strictEqual(outsider.status, 403, 'a non-participant must be forbidden: ' + JSON.stringify(outsider.body));
    assert.strictEqual(outsider.body.reason, 'seal_not_participant');

    // P1 (own run not settled yet): locked -- sees self only, P2 hidden.
    const lockedP1 = await scheduleReq('GET', '/api/schedule/seals/' + sealId + '/comparison', sealP1.token);
    assert.strictEqual(lockedP1.status, 200);
    assert.strictEqual(lockedP1.body.unlocked, false, 'P1 has not settled -> locked');
    assert.strictEqual(lockedP1.body.participantCount, 2, 'both participants are counted');
    assert.ok(lockedP1.body.self, 'own entry always present');
    assert.strictEqual(lockedP1.body.participants.length, 0, 'other participants hidden until own settle');

    // P1 settles its own run.
    await runRoom(sealP1.token, r1.body.room.id, true);

    // P1 now unlocked: sees BOTH participants (incl. P2, whose run is still in flight).
    const openP1 = await scheduleReq('GET', '/api/schedule/seals/' + sealId + '/comparison', sealP1.token);
    assert.strictEqual(openP1.body.unlocked, true, 'own run settled -> unlocked');
    const ids = openP1.body.participants.map((x) => x.playerId).sort();
    assert.deepStrictEqual(ids, [sealP1.playerId, sealP2.playerId].sort(), 'unlocked view reveals every participant');
    const selfEntry = openP1.body.participants.find((x) => x.isSelf);
    assert.ok(selfEntry && selfEntry.settled, 'own entry marked settled');
    assert.ok(selfEntry.timeline && typeof selfEntry.timeline.clearTimeSecs === 'number', 'timeline metrics present');
    assert.ok(typeof selfEntry.timeline.damageTaken === 'number' && Array.isArray(selfEntry.timeline.encounters), 'per-encounter + damage metrics present');

    // P2 (still not settled): anti-spoiler is per-viewer -- P2 stays locked, P1 hidden from P2.
    const lockedP2 = await scheduleReq('GET', '/api/schedule/seals/' + sealId + '/comparison', sealP2.token);
    assert.strictEqual(lockedP2.body.unlocked, false, 'P2 has not settled -> still locked, even though P1 has');
    assert.strictEqual(lockedP2.body.participants.length, 0, 'P1 stays hidden from the un-settled P2');
    await scheduleReq('DELETE', '/api/schedule/rooms/' + r1.body.room.id, sealP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + r2.body.room.id, sealP2.token);
  });

  await AT('seal: seal-scoped replay -- own replay always readable; another participant\'s replay is 403 until own settle, then 200 with events + timeline', async () => {
    const m = await mint(sealP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const sealId = m.body.seal.sealId;
    const r1 = await joinSeal(sealP1.token, sealId);
    const r2 = await joinSeal(sealP2.token, sealId);
    await runRoom(sealP2.token, r2.body.room.id, true); // P2 settled
    // P1 has NOT run yet: reading P2's replay is locked.
    const locked = await scheduleReq('GET', '/api/schedule/seals/' + sealId + '/runs/' + encodeURIComponent(sealP2.playerId), sealP1.token);
    assert.strictEqual(locked.status, 403, 'cross-participant replay locked until own settle: ' + JSON.stringify(locked.body));
    assert.strictEqual(locked.body.reason, 'seal_replay_locked');
    // P1 runs + settles, then reads P2's replay -> 200 with the full event log.
    await runRoom(sealP1.token, r1.body.room.id, true);
    const opened = await scheduleReq('GET', '/api/schedule/seals/' + sealId + '/runs/' + encodeURIComponent(sealP2.playerId), sealP1.token);
    assert.strictEqual(opened.status, 200, JSON.stringify(opened.body));
    assert.strictEqual(opened.body.playerId, sealP2.playerId);
    assert.ok(Array.isArray(opened.body.events) && opened.body.events.length > 0, 'replay carries the full persisted event log');
    assert.ok(opened.body.timeline && typeof opened.body.timeline.clearTimeSecs === 'number');
    // Own replay is always readable (even before this point it would be; assert it works now too).
    const own = await scheduleReq('GET', '/api/schedule/seals/' + sealId + '/runs/' + encodeURIComponent(sealP1.playerId), sealP1.token);
    assert.strictEqual(own.status, 200);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + r1.body.room.id, sealP1.token);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + r2.body.room.id, sealP2.token);
  });

  await AT('seal: a sealed room is single-shot -- after its one run settles it does NOT auto-restart (each participant runs a sealId once)', async () => {
    const m = await mint(sealP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const sealId = m.body.seal.sealId;
    const r = await joinSeal(sealP1.token, sealId);
    const roomId = r.body.room.id;
    await runRoom(sealP1.token, roomId, true);
    const after = await scheduleReq('GET', '/api/schedule/rooms/' + roomId, sealP1.token);
    assert.notStrictEqual(after.body.room.status, 'active', 'the sealed room must not have auto-started a SECOND run');
    assert.strictEqual(after.body.room.status, 'canceled', 'a settled single-shot sealed room ends canceled (terminal), never re-armed');
    assert.strictEqual(scheduleStorage.listSealRuns(sealId).length, 1, 'exactly one participant-run registry entry for this seal');
  });

  await AT('seal: GET /api/schedule/seals/:sealId returns public meta (genSeed withheld) + participation status', async () => {
    const m = await mint(sealP1.token, { dungeonId: 'test_dungeon', level: 1 });
    const sealId = m.body.seal.sealId;
    const r2 = await joinSeal(sealP2.token, sealId);
    const meta = await scheduleReq('GET', '/api/schedule/seals/' + sealId, sealP2.token);
    assert.strictEqual(meta.status, 200);
    assert.strictEqual(meta.body.seal.sealId, sealId);
    assert.strictEqual(meta.body.seal.genSeed, undefined, 'meta must not leak the seed');
    assert.strictEqual(meta.body.youAreParticipant, true);
    assert.strictEqual(meta.body.yourRoomId, r2.body.room.id);
    assert.ok(meta.body.participantCount >= 1);
    // A caller who has NOT joined sees youAreParticipant:false but can still preview.
    const metaOut = await scheduleReq('GET', '/api/schedule/seals/' + sealId, sealOutsider.token);
    assert.strictEqual(metaOut.status, 200);
    assert.strictEqual(metaOut.body.youAreParticipant, false);
    await scheduleReq('DELETE', '/api/schedule/rooms/' + r2.body.room.id, sealP2.token);
  });

  // Cleanup: clear the seal players' warehouse rows so no cross-suite
  // residue (distinct player ids from scheduleP1/P2, but tidy regardless).
  for (const pl of [sealP1, sealP2, sealOutsider]) {
    for (const item of scheduleStorage.listWarehouseItems(pl.playerId)) {
      scheduleStorage.deleteWarehouseItem(pl.playerId, item.itemUid);
    }
  }
};
