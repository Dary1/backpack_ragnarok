'use strict';
// server/tests/api/ragnarok.cjs -- REQ-0145a (sf): the REQ-0066 Hall of Ragnarok group
// (seasons, devotion rite, eternal order, einherjar records) + the
// seasonal furnace-window test and the 401 sweep. The final test here
// is 'admin: REAL repo happy path' -- an ADMIN test kept in this file
// because it is order-critical: it must run exactly here, under the
// restored REAL homedir epoch (the schedule_ops suite restored it),
// after every fake-epoch group and before dismantle re-swaps the
// sandbox (recorded in the REQ execution log).
// Cut VERBATIM from server/tests/api_test.cjs origin lines 2928-3603 @
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
    scheduleP1, scheduleP2, scheduleReq, fillAllSlotsSnapshotsFrom,
    market, invPage, mkCanvas, marketReq } = h;

  // =====================================================================
  // REQ-0066: Hall of Ragnarok test group. Same synthetic fixture tree
  // as the schedule/market groups above (module paths still bound to
  // fakeRepoHome); drives the real api.handle() surface for every
  // route, plus the ragnarok facade (server/ragnarok.cjs -- rule-3
  // consumers never require services/ directly) and storage.cjs's
  // ragnarok roots for white-box assertions. Runs identically in files
  // AND pg modes (STORAGE_BACKEND), like the rest of this suite -- pg
  // needs server/migrations/005_ragnarok.sql applied, same as 001..004
  // for the groups above.
  // =====================================================================
  const ragnarok = require('../../ragnarok.cjs');

  // seasons.json fixture management: the service's mtime cache
  // (services/ragnarok.cjs getSeasonsDoc) must observe every rewrite,
  // so each write force-bumps mtime monotonically (same-ms rewrites
  // would otherwise be served from cache).
  const seasonsFixturePath = path.join(liveDir, 'seasons.json');
  let seasonsBumpMs = 0;
  function writeSeasonsFixture(doc) {
    if (doc === null) {
      try { fs.unlinkSync(seasonsFixturePath); } catch (e) { /* already absent */ }
      return;
    }
    fs.writeFileSync(seasonsFixturePath, JSON.stringify(doc));
    seasonsBumpMs += 1000;
    const t = new Date(Date.now() + seasonsBumpMs);
    fs.utimesSync(seasonsFixturePath, t, t);
  }
  function seasonEntry(index, startMs, extra) {
    return Object.assign({
      index, name: '狼の冬', nameEn: 'The Wolf\'s Winter',
      startAt: new Date(startMs).toISOString(), phaseDays: 7, phasesPerSeason: 12,
      ragnarokAt: new Date(startMs + 84 * 24 * 60 * 60 * 1000).toISOString(),
    }, extra || {});
  }
  const RAG_HOUR = 60 * 60 * 1000;
  const RAG_DAY = 24 * RAG_HOUR;
  // The canonical fixture season the devotion/furnace tests run under:
  // Season 1, started 10 days + 1 hour ago (phase 2 of 12).
  function writeCanonicalSeason() {
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, Date.now() - 10 * RAG_DAY - RAG_HOUR)] });
  }

  const ragA = playersFixture.createPlayer('RagnarAlfa', []);
  const ragB = playersFixture.createPlayer('RagnarBravo', []);
  const ragC = playersFixture.createPlayer('RagnarCastle', []);
  const ragD = playersFixture.createPlayer('RagnarDelta', []);
  const ragE = playersFixture.createPlayer('RagnarEcho', []);

  // ragA: the main devotion fixture. Inventory (page 0) is MASTER
  // (REQ-0033: every uid has exactly ONE home record in st.inv.pages):
  // homes for 2 BPs, 4 POs, 2 SIs. Squad 1 (the devotion candidate)
  // references bp_dev + shared_po + solo_po + si_dev; squad 2 SHARES
  // shared_po (the yellow case) and also holds keep_po plus si_other
  // seated ON shared_po (host {po:...} -- exercises the surviving-SI
  // stow rule when its host PO is destroyed).
  const bpDef = (id) => ({ id, name: 'BP ' + id, color: '#886644', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30 });
  const ragAInvPage = {
    bps: [bpDef('bp_dev'), bpDef('bp_other')],
    pos: [
      { uid: 'shared_po', id: 'blade', cell: [1, 1], rot: 0 },
      { uid: 'solo_po', id: 'blade', cell: [1, 2], rot: 0 },
      { uid: 'other_po', id: 'fx_dagger', cell: [1, 3], rot: 0 },
      { uid: 'keep_po', id: 'blade', cell: [1, 4], rot: 0 },
    ],
    sis: [
      { uid: 'si_dev', id: 'acc_gem', host: 'inv' },
      { uid: 'si_other', id: 'acc_gem', host: 'inv' },
    ],
    tms: [],
  };
  const ragASquad1 = {
    linked: true,
    bps: [bpDef('bp_dev')],
    pos: [
      { uid: 'shared_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 },
      { uid: 'solo_po', id: 'blade', loc: 'grid', cell: [1, 2], rot: 0 },
    ],
    sis: [{ uid: 'si_dev', id: 'acc_gem', host: 'inv' }],
  };
  const ragASquad2 = {
    linked: true,
    bps: [bpDef('bp_other')],
    pos: [
      { uid: 'shared_po', id: 'blade', loc: 'grid', cell: [2, 1], rot: 0 },
      { uid: 'keep_po', id: 'blade', loc: 'grid', cell: [2, 2], rot: 0 },
    ],
    sis: [{ uid: 'si_other', id: 'acc_gem', host: { po: 'shared_po' } }],
  };
  scheduleStorage.writeProfile(ragA.playerId, mkCanvas(
    [ragAInvPage, invPage(), invPage(), invPage(), invPage()],
    [null, ragASquad1, ragASquad2]
  ));

  // ragB: idempotency + empty_squad fixture (squad 1 devotable, squad
  // 2 exists but has no BP -> empty_squad).
  scheduleStorage.writeProfile(ragB.playerId, mkCanvas(
    [{
      bps: [bpDef('bp_b1')],
      pos: [{ uid: 'b1_po', id: 'blade', cell: [1, 1], rot: 0 }],
      sis: [], tms: [],
    }, invPage(), invPage(), invPage(), invPage()],
    [null,
      { linked: true, bps: [bpDef('bp_b1')], pos: [{ uid: 'b1_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }], sis: [] },
      { linked: true, bps: [], pos: [], sis: [] }]
  ));

  // ragC: rite-lock (mid_rite / crash recovery) fixture -- one inventory
  // item as recovery ground truth, two squads so last_squad can't fire.
  scheduleStorage.writeProfile(ragC.playerId, mkCanvas(
    [{ bps: [bpDef('bp_c1')], pos: [{ uid: 'c_keep_po', id: 'blade', cell: [1, 1], rot: 0 }], sis: [], tms: [] },
      invPage(), invPage(), invPage(), invPage()],
    [null, { linked: true, bps: [bpDef('bp_c1')], pos: [], sis: [] }]
  ));

  // ragE: active-squad devotion fixture. The ACTIVE squad (index 0,
  // living in the top-level canvas fields -- engine.js ~1230) is the
  // devotion candidate; stored squad 1 shares eA_po.
  scheduleStorage.writeProfile(ragE.playerId, Object.assign(mkCanvas(
    [{
      bps: [bpDef('bp_e'), bpDef('bp_e2')],
      pos: [{ uid: 'eA_po', id: 'blade', cell: [1, 1], rot: 0 }, { uid: 'eKeep_po', id: 'blade', cell: [1, 2], rot: 0 }],
      sis: [], tms: [],
    }, invPage(), invPage(), invPage(), invPage()],
    [null, { linked: true, bps: [bpDef('bp_e2')], pos: [{ uid: 'eA_po', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }, { uid: 'eKeep_po', id: 'blade', loc: 'grid', cell: [1, 2], rot: 0 }], sis: [] }]
  ), {
    bps: [bpDef('bp_e')],
    pos: [{ uid: 'eA_po', id: 'blade', loc: 'grid', cell: [3, 3], rot: 0 }],
    sis: [],
  }));

  await AT('ragnarok: season derivation -- phase/countdown boundaries, latest-started wins, degenerate missing/future registry', async () => {
    const now = Date.now();
    // Fresh season (started an hour ago): phase 1, day 1, full countdown.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - RAG_HOUR)] });
    let cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season.index, 1);
    assert.strictEqual(cs.season.name, '狼の冬');
    assert.strictEqual(cs.derived.phase, 1, 'phase 1 on day 1');
    assert.strictEqual(cs.derived.phaseDay, 1);
    assert.strictEqual(cs.derived.ended, false);
    assert.strictEqual(cs.derived.daysToRagnarok, 84, '84-day season (12 phases x 7 days)');
    // One phase in (7d + 1h): phase 2, phaseDay 1.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - 7 * RAG_DAY - RAG_HOUR)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.derived.phase, 2, 'phase flips at startAt + phaseDays');
    assert.strictEqual(cs.derived.phaseDay, 1);
    assert.strictEqual(cs.derived.daysToRagnarok, 77);
    // Mid-phase-9 (mock's own strip: 第九月相): 8 full phases + 3 days in.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - (8 * 7 + 3) * RAG_DAY - RAG_HOUR)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.derived.phase, 9);
    assert.strictEqual(cs.derived.phaseDay, 4);
    // Past ragnarokAt with no successor: ended, phase pinned at 12, countdown 0.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - 85 * RAG_DAY)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.derived.ended, true);
    assert.strictEqual(cs.derived.phase, 12, 'phase clamps to phasesPerSeason');
    assert.strictEqual(cs.derived.daysToRagnarok, 0);
    assert.strictEqual(cs.derived.msToRagnarok, 0);
    // Two seasons: the most recently STARTED one wins.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now - 100 * RAG_DAY), seasonEntry(2, now - 5 * RAG_DAY, { name: '鴉の夏' })] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season.index, 2);
    assert.strictEqual(cs.season.name, '鴉の夏');
    assert.strictEqual(cs.derived.phase, 1);
    assert.strictEqual(ragnarok.listSeasons().length, 2, 'the registry lists every season');
    // Entirely-future registry: no current season yet.
    writeSeasonsFixture({ schema: 'season/1', seasons: [seasonEntry(1, now + 5 * RAG_DAY)] });
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season, null, 'a future-only registry has no current season');
    assert.strictEqual(cs.derived, null);
    // Missing file: the documented degenerate case.
    writeSeasonsFixture(null);
    cs = ragnarok.currentSeason();
    assert.strictEqual(cs.season, null);
    assert.deepStrictEqual(ragnarok.listSeasons(), []);
    // Leave the canonical fixture in place for every test below.
    writeCanonicalSeason();
  });

  await AT('ragnarok: GET /api/ragnarok/season returns registry + derived clock; token-gated', async () => {
    const res = await marketReq('GET', '/api/ragnarok/season', ragA.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.strictEqual(res.body.seasons.length, 1);
    const season = res.body.season;
    assert.strictEqual(season.index, 1);
    assert.strictEqual(season.name, '狼の冬');
    assert.strictEqual(season.phaseDays, 7);
    assert.strictEqual(season.phasesPerSeason, 12);
    assert.strictEqual(Date.parse(season.ragnarokAt) - Date.parse(season.startAt), 84 * RAG_DAY, 'ragnarokAt = startAt + 12 * phaseDays');
    assert.strictEqual(res.body.derived.phase, 2, '10 days in = phase 2');
    assert.strictEqual(res.body.derived.daysToRagnarok, 74);
    assert.strictEqual(res.body.derived.ended, false);
    const noAuth = await marketReq('GET', '/api/ragnarok/season', 'totally-bogus-token');
    assert.strictEqual(noAuth.status, 401);
  });

  await AT('ragnarok: battleScoreOf is THE 戦果 formula (damage*1 + kills*50 + survived*100) and tier thresholds hold', async () => {
    assert.strictEqual(ragnarok.battleScoreOf({ damage: 100, kills: 2, survived: 1 }), 300);
    assert.strictEqual(ragnarok.battleScoreOf({ damage: 0, kills: 0, survived: true }), 100, 'boolean survived coerces');
    assert.strictEqual(ragnarok.battleScoreOf({}), 0);
    assert.strictEqual(ragnarok.battleScoreOf(null), 0);
    assert.strictEqual(ragnarok.SCORE_FORMULA_VERSION, 1);
    assert.deepStrictEqual(ragnarok.SCORE_WEIGHTS, { damage: 1.0, kills: 50, survived: 100 });
    // Tier ladder [ORCH defaults 0/500/2000/8000]; VALHALLA is never assigned server-side.
    assert.strictEqual(ragnarok.tierOf(0), 'THRALL');
    assert.strictEqual(ragnarok.tierOf(499), 'THRALL');
    assert.strictEqual(ragnarok.tierOf(500), 'KARL');
    assert.strictEqual(ragnarok.tierOf(1999), 'KARL');
    assert.strictEqual(ragnarok.tierOf(2000), 'JARL');
    assert.strictEqual(ragnarok.tierOf(8000), 'EINHERJAR');
    assert.strictEqual(ragnarok.tierOf(999999), 'EINHERJAR');
  });

  await AT('ragnarok: devotion preview itemizes the blast radius (incl. shared refs + affected squads) with a degenerate-safe projection', async () => {
    const res = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragA.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.deepStrictEqual(res.body.squad, { index: 1, name: 'P2' });
    assert.strictEqual(res.body.eligible, true);
    assert.deepStrictEqual(res.body.reasons, []);
    assert.strictEqual(res.body.blast.bps, 1, 'bp_dev');
    assert.strictEqual(res.body.blast.pos, 2, 'shared_po + solo_po');
    assert.strictEqual(res.body.blast.sis, 1, 'si_dev');
    assert.strictEqual(res.body.blast.total, 4);
    assert.deepStrictEqual(res.body.blast.affectedSquads, [
      { index: 2, name: 'P3', lostBps: 0, lostPos: 1, lostSis: 0 },
    ], 'squad 2 shares shared_po (yellow) and loses exactly it');
    // Projection: no einherjar exist anywhere yet -> degenerate-safe rank 1 of 1.
    assert.strictEqual(res.body.projection.currentRank, null);
    assert.strictEqual(res.body.projection.projectedRank, 1);
    assert.strictEqual(res.body.projection.totalAfter, 1);
    assert.strictEqual(res.body.projection.topPercentile, 100);
    assert.strictEqual(res.body.projection.einherjarCountAfter, 1);
    // Preview persists nothing: the canvas is untouched.
    const canvas = scheduleStorage.readProfile(ragA.playerId).canvas;
    assert.strictEqual(canvas.presets.store.length, 3);
    assert.strictEqual(canvas.inv.pages[0].pos.length, 4);
  });

  await AT('ragnarok: `deployed` gate -- an open room slotting the squad (or any uid it shares) blocks the rite; releasing the room clears it', async () => {
    // White-box room doc: deployedUidSet (services/market.cjs, reused by
    // the rite gate) only reads ownerId/status/slots off listRooms().
    const roomDoc = {
      id: 'room_rag_gate', ownerId: ragA.playerId, status: 'open',
      slots: [{ squadIndex: 1 }, { squadIndex: null }, { squadIndex: null }, { squadIndex: null }],
    };
    scheduleStorage.writeRoom(roomDoc.id, roomDoc);
    try {
      let res = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragA.token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.eligible, false);
      assert.deepStrictEqual(res.body.reasons, ['deployed']);
      // The rite itself 409s with the same structured reason.
      const post = await marketReq('POST', '/api/ragnarok/devotion/1', ragA.token);
      assert.strictEqual(post.status, 409, JSON.stringify(post.body));
      assert.strictEqual(post.body.reason, 'deployed');
      // Sharing counts too: squad 2 shares shared_po with slotted squad 1.
      res = await marketReq('GET', '/api/ragnarok/devotion/preview/2', ragA.token);
      assert.strictEqual(res.body.eligible, false, 'devoting squad 2 would destroy shared_po out from under deployed squad 1');
      assert.deepStrictEqual(res.body.reasons, ['deployed']);
      // Canceled rooms release their uids (open/active-only gate).
      roomDoc.status = 'canceled';
      scheduleStorage.writeRoom(roomDoc.id, roomDoc);
      res = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragA.token);
      assert.strictEqual(res.body.eligible, true);
      assert.deepStrictEqual(res.body.reasons, []);
    } finally {
      scheduleStorage.deleteRoom(roomDoc.id);
    }
  });

  await AT('ragnarok: POST devotion -- einherjar record engraved; every referenced uid destroyed ACCOUNT-WIDE (inventory homes + shared squad refs); squad slot deleted', async () => {
    const res = await marketReq('POST', '/api/ragnarok/devotion/1', ragA.token, undefined, { 'idempotency-key': 'rite-A-1' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.replayed, false);
    assert.strictEqual(res.body.einherjar.squadName, 'P2', 'squadName = the squad display name');
    assert.strictEqual(res.body.einherjar.seasonDevoted, 1, 'stamped with the current season index');
    assert.deepStrictEqual(res.body.einherjar.counts, { bps: 1, pos: 2, sis: 1 });
    assert.strictEqual(res.body.einherjar.score, 0, 'no battles yet (REQ-0068) -> score 0');
    assert.deepStrictEqual(res.body.einherjar.perSeason, []);
    assert.strictEqual(res.body.einherjar.bioArchive, null, 'REQ-0060 not built -> stored empty');
    assert.strictEqual(res.body.blast.total, 4);
    assert.deepStrictEqual(res.body.blast.affectedSquads, [{ index: 2, name: 'P3', lostBps: 0, lostPos: 1, lostSis: 0 }]);

    const canvas = scheduleStorage.readProfile(ragA.playerId).canvas;
    // The devoted squad slot is DELETED (engine.js deleteSquad: store
    // slot + names[] entry both vanish; deleted index > active 0 leaves
    // active untouched).
    assert.strictEqual(canvas.presets.store.length, 2);
    assert.deepStrictEqual(canvas.presets.names, ['P1', 'P3', 'P4', 'P5']);
    assert.strictEqual(canvas.presets.active, 0);
    // Inventory homes (MASTER) destroyed for exactly the devoted uids.
    const pg0 = canvas.inv.pages[0];
    assert.deepStrictEqual(pg0.bps.map((b) => b.id), ['bp_other'], 'bp_dev home destroyed');
    assert.deepStrictEqual(pg0.pos.map((p) => p.uid), ['other_po', 'keep_po'], 'shared_po + solo_po homes destroyed, unrelated homes intact');
    assert.deepStrictEqual(pg0.sis.map((a) => a.uid), ['si_other'], 'si_dev home destroyed, si_other intact');
    // The yellow-shared squad (was index 2, now index 1) lost EXACTLY
    // the shared piece; its own material survives; its SI that sat on
    // the destroyed PO is stowed (host 'inv' -- engine.js ~388-389's
    // missing-host repair semantics).
    const shared = canvas.presets.store[1];
    assert.deepStrictEqual(shared.pos.map((p) => p.uid), ['keep_po']);
    assert.deepStrictEqual(shared.bps.map((b) => b.id), ['bp_other']);
    assert.deepStrictEqual(shared.sis, [{ uid: 'si_other', id: 'acc_gem', host: 'inv' }]);
    // White-box: the record is finalized and carries the frozen snapshot
    // (deep copy + content defs at rite time).
    const rec = scheduleStorage.listEinherjarRecords().find((r) => r.playerId === ragA.playerId);
    assert.ok(rec, 'einherjar record persisted');
    assert.strictEqual(rec.rite.state, 'done');
    assert.strictEqual(rec.idemKey, 'rite-A-1');
    assert.deepStrictEqual(rec.snapshot.canvas.pos.map((p) => p.uid), ['shared_po', 'solo_po'], 'snapshot froze the devoted canvas');
    assert.deepStrictEqual(rec.snapshot.canvas.bps.map((b) => b.id), ['bp_dev']);
    assert.strictEqual(rec.snapshot.itemDefs.pos.blade.id, 'blade', 'PO content def frozen at rite time (name is mutated by the earlier admin-edit tests, so pin identity)');
    assert.ok(rec.snapshot.itemDefs.sis.acc_gem, 'SI content def frozen at rite time');
    // The einherjar list endpoint shows it.
    const list = await marketReq('GET', '/api/ragnarok/einherjar', ragA.token);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.einherjar.length, 1);
    assert.strictEqual(list.body.einherjar[0].squadName, 'P2');
  });

  await AT('ragnarok: devoting the ACTIVE squad -- engine deleteSquad bookkeeping (nearest tab in) + top-level strip', async () => {
    const res = await marketReq('POST', '/api/ragnarok/devotion/0', ragE.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.einherjar.squadName, 'P1');
    assert.deepStrictEqual(res.body.einherjar.counts, { bps: 1, pos: 1, sis: 0 });
    const canvas = scheduleStorage.readProfile(ragE.playerId).canvas;
    // engine.js deleteSquad's nearest-remaining-tab rule: the old
    // store[1] slid into index 0 and is now the ACTIVE squad (its
    // content lives at the top level).
    assert.strictEqual(canvas.presets.store.length, 1);
    assert.strictEqual(canvas.presets.active, 0);
    assert.strictEqual(canvas.presets.store[0], null, 'active slot is materialized at the top level (engine.js splitBackSquads)');
    assert.deepStrictEqual(canvas.presets.names, ['P2', 'P3', 'P4', 'P5']);
    assert.deepStrictEqual(canvas.bps.map((b) => b.id), ['bp_e2']);
    assert.deepStrictEqual(canvas.pos.map((p) => p.uid), ['eKeep_po'], 'the shared eA_po reference was stripped from the surviving squad');
    // Homes: bp_e + eA_po destroyed; bp_e2 + eKeep_po intact.
    const pg0 = canvas.inv.pages[0];
    assert.deepStrictEqual(pg0.bps.map((b) => b.id), ['bp_e2']);
    assert.deepStrictEqual(pg0.pos.map((p) => p.uid), ['eKeep_po']);
  });

  await AT('ragnarok: 409 vocabulary (last_squad / empty_squad) + 404 no-leak for out-of-range, malformed and profile-less squad ids', async () => {
    // last_squad: ragE is down to a single squad after the test above
    // (mirrors engine.js deleteSquad's own last-refusal, ~1919).
    const last = await marketReq('POST', '/api/ragnarok/devotion/0', ragE.token);
    assert.strictEqual(last.status, 409, JSON.stringify(last.body));
    assert.strictEqual(last.body.reason, 'last_squad');
    const lastPrev = await marketReq('GET', '/api/ragnarok/devotion/preview/0', ragE.token);
    assert.strictEqual(lastPrev.body.eligible, false);
    assert.deepStrictEqual(lastPrev.body.reasons, ['last_squad']);
    // empty_squad: ragB squad 2 has no BP (engine.isSquadDeployable false).
    const empty = await marketReq('POST', '/api/ragnarok/devotion/2', ragB.token);
    assert.strictEqual(empty.status, 409);
    assert.strictEqual(empty.body.reason, 'empty_squad');
    // 404 no-leak: out-of-range, malformed, and no-profile-at-all are
    // byte-identical plain 404s.
    for (const [who, seg] of [[ragA, '99'], [ragA, 'abc'], [ragA, '-1'], [ragD, '0']]) {
      const prev = await marketReq('GET', '/api/ragnarok/devotion/preview/' + seg, who.token);
      assert.strictEqual(prev.status, 404, seg + ' preview -> ' + prev.status);
      assert.strictEqual(prev.body.error, 'squad not found');
      const post = await marketReq('POST', '/api/ragnarok/devotion/' + seg, who.token);
      assert.strictEqual(post.status, 404, seg + ' devote -> ' + post.status);
      assert.strictEqual(post.body.error, 'squad not found');
    }
  });

  await AT('ragnarok: mid_rite lock -- fresh `applying` 409s; stale one is lazily VOIDED when the cost never landed, ROLLED FORWARD when it did', async () => {
    const nowIso = new Date().toISOString();
    const mkLockRec = (id, riteT, snapPos) => ({
      id, playerId: ragC.playerId, squadName: 'Lock ' + id, seasonDevoted: 1, devotedAt: nowIso,
      snapshot: { canvas: { bps: [], pos: snapPos, sis: [] }, counts: { bps: 0, pos: snapPos.length, sis: 0 }, itemDefs: { pos: {}, sis: {} } },
      blast: { bps: 0, pos: snapPos.length, sis: 0, total: snapPos.length, affectedSquads: [] },
      bioArchive: null, perSeason: [], emblems: [], idemKey: null,
      rite: { state: 'applying', t: riteT },
    });
    // (a) FRESH 'applying' record = a rite in flight: 409 mid_rite, and
    // the pending record is hidden from the hall.
    scheduleStorage.writeEinherjarRecord('ein_lock_fresh', mkLockRec('ein_lock_fresh', nowIso, [{ uid: 'c_keep_po', id: 'blade' }]));
    const blocked = await marketReq('POST', '/api/ragnarok/devotion/1', ragC.token);
    assert.strictEqual(blocked.status, 409, JSON.stringify(blocked.body));
    assert.strictEqual(blocked.body.reason, 'mid_rite');
    const prev = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragC.token);
    assert.strictEqual(prev.body.eligible, false);
    assert.ok(prev.body.reasons.includes('mid_rite'));
    let list = await marketReq('GET', '/api/ragnarok/einherjar', ragC.token);
    assert.strictEqual(list.body.einherjar.length, 0, 'an applying record is hidden until finalized');
    // (b) STALE 'applying' whose snapshot uids are STILL HOMED (the
    // atomic profile write never happened): lazily VOIDED -- the player
    // lost nothing, no engraving stands (under-deliver-never-duplicate).
    const staleT = new Date(Date.now() - ragnarok.RITE_LOCK_TIMEOUT_MS - 5000).toISOString();
    scheduleStorage.writeEinherjarRecord('ein_lock_fresh', mkLockRec('ein_lock_fresh', staleT, [{ uid: 'c_keep_po', id: 'blade' }]));
    const prev2 = await marketReq('GET', '/api/ragnarok/devotion/preview/1', ragC.token);
    assert.strictEqual(prev2.body.eligible, true, 'stale un-landed rite no longer blocks');
    assert.strictEqual(scheduleStorage.readEinherjarRecord('ein_lock_fresh'), null, 'voided record is deleted');
    // (c) STALE 'applying' whose snapshot uids are GONE from the
    // inventory (the cost landed, the finalize write crashed): lazily
    // ROLLED FORWARD to done -- the paid-for engraving stands.
    scheduleStorage.writeEinherjarRecord('ein_lock_landed', mkLockRec('ein_lock_landed', staleT, [{ uid: 'ghost_po', id: 'blade' }]));
    list = await marketReq('GET', '/api/ragnarok/einherjar', ragC.token);
    assert.strictEqual(list.body.einherjar.length, 1);
    assert.strictEqual(list.body.einherjar[0].squadName, 'Lock ein_lock_landed');
    const recovered = scheduleStorage.readEinherjarRecord('ein_lock_landed');
    assert.strictEqual(recovered.rite.state, 'done');
    assert.ok(recovered.rite.recoveredAt, 'roll-forward is stamped');
  });

  await AT('ragnarok: Idempotency-Key -- replaying the rite returns the ORIGINAL record; no second destruction; keys are per-player', async () => {
    const invBefore = scheduleStorage.readProfile(ragB.playerId).canvas.inv.pages[0];
    assert.strictEqual(invBefore.pos.length, 1, 'precondition: b1_po home present');
    const first = await marketReq('POST', '/api/ragnarok/devotion/1', ragB.token, undefined, { 'idempotency-key': 'rite-B-1' });
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    assert.strictEqual(first.body.replayed, false);
    const recId = first.body.einherjar.id;
    const canvasAfterFirst = scheduleStorage.readProfile(ragB.playerId).canvas;
    assert.strictEqual(canvasAfterFirst.presets.store.length, 2);
    // Replay: same caller, same key -> the original outcome, nothing
    // re-destroyed (the replay short-circuits BEFORE eligibility -- the
    // now-shifted index 1 points at a DIFFERENT squad and must not be
    // touched).
    const replay = await marketReq('POST', '/api/ragnarok/devotion/1', ragB.token, undefined, { 'idempotency-key': 'rite-B-1' });
    assert.strictEqual(replay.status, 200, JSON.stringify(replay.body));
    assert.strictEqual(replay.body.replayed, true);
    assert.strictEqual(replay.body.einherjar.id, recId);
    const canvasAfterReplay = scheduleStorage.readProfile(ragB.playerId).canvas;
    assert.strictEqual(canvasAfterReplay.presets.store.length, 2, 'replay deleted nothing');
    assert.deepStrictEqual(canvasAfterReplay.inv.pages[0].pos, [], 'b1_po destroyed exactly once');
    const einCount = scheduleStorage.listEinherjarRecords().filter((r) => r.playerId === ragB.playerId).length;
    assert.strictEqual(einCount, 1, 'no duplicate record');
    // Keys are scoped per player: another caller reusing the key gets
    // their OWN outcome (here: 404, no profile at all), never ragB's.
    const foreign = await marketReq('POST', '/api/ragnarok/devotion/0', ragD.token, undefined, { 'idempotency-key': 'rite-B-1' });
    assert.strictEqual(foreign.status, 404);
  });

  await AT('ragnarok: GET /api/ragnarok/einherjar -- own by default, ?player= is public for registered players, unknown 404', async () => {
    const own = await marketReq('GET', '/api/ragnarok/einherjar', ragB.token);
    assert.strictEqual(own.status, 200);
    assert.strictEqual(own.body.playerId, ragB.playerId);
    assert.strictEqual(own.body.einherjar.length, 1);
    assert.strictEqual(own.body.einherjar[0].squadName, 'P2');
    assert.strictEqual(own.body.einherjar[0].seasonDevoted, 1);
    // Hall records are public: ragA can read ragB's corridor.
    const foreign = await marketReq('GET', '/api/ragnarok/einherjar?player=' + encodeURIComponent(ragB.playerId), ragA.token);
    assert.strictEqual(foreign.status, 200);
    assert.strictEqual(foreign.body.playerId, ragB.playerId);
    assert.strictEqual(foreign.body.einherjar.length, 1);
    // The list DTO never leaks the frozen snapshot internals.
    assert.strictEqual(foreign.body.einherjar[0].snapshot, undefined);
    const unknown = await marketReq('GET', '/api/ragnarok/einherjar?player=totally_not_a_player', ragA.token);
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(unknown.body.error, 'player not found');
  });

  await AT('ragnarok: the Eternal Order ranks by score desc, then einherjarCount, then name -- 戦果 folded via battleScoreOf; newest-first hall', async () => {
    const nowIso2 = new Date().toISOString();
    const mkDoneRec = (id, playerId, squadName, devotedAt, perSeason) => ({
      id, playerId, squadName, seasonDevoted: 1, devotedAt,
      snapshot: { canvas: { bps: [], pos: [], sis: [] }, counts: { bps: 0, pos: 0, sis: 0 }, itemDefs: { pos: {}, sis: {} } },
      blast: { bps: 0, pos: 0, sis: 0, total: 0, affectedSquads: [] },
      bioArchive: null, perSeason: perSeason || [], emblems: [], idemKey: null,
      rite: { state: 'done', t: devotedAt },
    });
    // ragD: 2 engravings, one with a real battle history -> 300 (100*1 + 2*50 + 1*100).
    scheduleStorage.writeEinherjarRecord('ein_d1', mkDoneRec('ein_d1', ragD.playerId, 'Delta1',
      new Date(Date.now() - 2 * RAG_DAY).toISOString(),
      [{ season: 1, battles: [{ damage: 100, kills: 2, survived: 1 }] }]));
    scheduleStorage.writeEinherjarRecord('ein_d2', mkDoneRec('ein_d2', ragD.playerId, 'Delta2',
      new Date(Date.now() - 1 * RAG_DAY).toISOString(), []));
    // Newest-first hall listing while we're here.
    const hall = await marketReq('GET', '/api/ragnarok/einherjar?player=' + encodeURIComponent(ragD.playerId), ragD.token);
    assert.deepStrictEqual(hall.body.einherjar.map((e) => e.squadName), ['Delta2', 'Delta1']);
    assert.strictEqual(hall.body.einherjar[1].score, 300, 'per-record 戦果 fold');
    // Force a rebuild (stale cache) and read the standings.
    scheduleStorage.writeRagnarokOrderCache({ rebuiltAt: new Date(Date.now() - 2 * RAG_DAY).toISOString(), dawnUtcHour: 20, formulaVersion: 1, entries: [] });
    const res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.strictEqual(res.body.total, 5, 'exactly the players with engravings (A, B, C, D, E)');
    assert.deepStrictEqual(res.body.tiers, [
      { tier: 'THRALL', min: 0 }, { tier: 'KARL', min: 500 }, { tier: 'JARL', min: 2000 }, { tier: 'EINHERJAR', min: 8000 },
    ]);
    const top = res.body.top;
    assert.strictEqual(top[0].playerId, ragD.playerId, 'score 300 leads');
    assert.strictEqual(top[0].rank, 1);
    assert.strictEqual(top[0].score, 300);
    assert.strictEqual(top[0].einherjarCount, 2);
    assert.strictEqual(top[0].tier, 'THRALL', '300 < 500: still a thrall');
    assert.strictEqual(top[0].emblem, 'emblem_horn3', 'placeholder emblem');
    // Zero-score group: einherjarCount ties broken by name asc.
    assert.deepStrictEqual(top.slice(1).map((e) => e.name), ['RagnarAlfa', 'RagnarBravo', 'RagnarCastle', 'RagnarEcho']);
    assert.deepStrictEqual(top.map((e) => e.rank), [1, 2, 3, 4, 5]);
    assert.strictEqual(res.body.me.playerId, ragA.playerId);
    assert.strictEqual(res.body.me.rank, 2);
    // A caller with no engraving gets the synthetic unranked row.
    const guest = await marketReq('GET', '/api/ragnarok/order?around=me', guestA.token);
    assert.strictEqual(guest.body.me.rank, null);
    assert.strictEqual(guest.body.me.einherjarCount, 0);
    assert.strictEqual(guest.body.me.tier, 'THRALL');
    assert.deepStrictEqual(guest.body.around, [], 'unranked around=me is empty, not an error');
  });

  await AT('ragnarok: order pagination -- top=N, around=me windows, q= find-by-name', async () => {
    const top2 = await marketReq('GET', '/api/ragnarok/order?top=2', ragA.token);
    assert.strictEqual(top2.body.top.length, 2);
    assert.deepStrictEqual(top2.body.top.map((e) => e.rank), [1, 2]);
    assert.strictEqual(top2.body.total, 5, 'total reports the whole order, not the page');
    // around=me for the tail (ragE, rank 5): window clips at the end.
    const tail = await marketReq('GET', '/api/ragnarok/order?around=me', ragE.token);
    assert.deepStrictEqual(tail.body.around.map((e) => e.rank), [3, 4, 5]);
    assert.strictEqual(tail.body.me.rank, 5);
    // around=me for the head (ragD, rank 1): clips at the start.
    const head = await marketReq('GET', '/api/ragnarok/order?around=me', ragD.token);
    assert.deepStrictEqual(head.body.around.map((e) => e.rank), [1, 2, 3]);
    // q= find-by-name (case-insensitive substring), capped by top.
    const q1 = await marketReq('GET', '/api/ragnarok/order?q=ragnarc', ragA.token);
    assert.deepStrictEqual(q1.body.matches.map((e) => e.name), ['RagnarCastle']);
    const qAll = await marketReq('GET', '/api/ragnarok/order?q=RAGNAR', ragA.token);
    assert.strictEqual(qAll.body.matches.length, 5);
    const qCap = await marketReq('GET', '/api/ragnarok/order?q=RAGNAR&top=1', ragA.token);
    assert.strictEqual(qCap.body.matches.length, 1);
    const qMiss = await marketReq('GET', '/api/ragnarok/order?q=loki', ragA.token);
    assert.deepStrictEqual(qMiss.body.matches, []);
  });

  await AT('ragnarok: the daily-dawn lazy rebuild -- fresh cache served verbatim, stale/formula-mismatch caches rebuilt, rebuild deterministic', async () => {
    // lastDawnMs boundary math (dawn = 20:00 UTC [ORCH] = 05:00 JST).
    assert.strictEqual(ragnarok.lastDawnMs(Date.UTC(2026, 0, 15, 21, 0, 0)), Date.UTC(2026, 0, 15, 20, 0, 0), 'past dawn -> today\'s dawn');
    assert.strictEqual(ragnarok.lastDawnMs(Date.UTC(2026, 0, 15, 19, 59, 59)), Date.UTC(2026, 0, 14, 20, 0, 0), 'before dawn -> yesterday\'s dawn');
    // A FRESH cache (rebuiltAt at/after the last dawn) is served
    // verbatim -- the sentinel proves no rebuild happened.
    const sentinel = {
      rebuiltAt: new Date().toISOString(), dawnUtcHour: 20, formulaVersion: 1,
      entries: [{ playerId: 'sentinel', name: 'Sentinel', emblem: 'emblem_horn3', einherjarCount: 9, score: 9999, rank: 1, tier: 'EINHERJAR' }],
    };
    scheduleStorage.writeRagnarokOrderCache(sentinel);
    let res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.body.total, 1, 'cache served, no rebuild');
    assert.strictEqual(res.body.top[0].playerId, 'sentinel');
    // A cache OLDER than the last dawn boundary rebuilds ("first
    // request past dawn recomputes"; 更新は毎暁).
    scheduleStorage.writeRagnarokOrderCache(Object.assign({}, sentinel, { rebuiltAt: new Date(Date.now() - 25 * RAG_HOUR).toISOString() }));
    res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.body.total, 5, 'stale cache rebuilt from einherjar records');
    assert.strictEqual(res.body.top[0].playerId, ragD.playerId);
    assert.ok(Date.parse(res.body.rebuiltAt) >= ragnarok.lastDawnMs(Date.now()), 'rebuiltAt stamped now');
    // A formula-version mismatch self-invalidates even when fresh.
    scheduleStorage.writeRagnarokOrderCache(Object.assign({}, sentinel, { formulaVersion: 0 }));
    res = await marketReq('GET', '/api/ragnarok/order', ragA.token);
    assert.strictEqual(res.body.total, 5, 'formula bump invalidates the cache');
    // Determinism: two rebuilds over the same records are identical.
    const ts = Date.now();
    const r1 = ragnarok.rebuildOrder(ts);
    const r2 = ragnarok.rebuildOrder(ts);
    assert.deepStrictEqual(r1, r2, 'rebuild is a pure fold over the records');
  });

  await AT('market: GET /api/market/furnace windows the burn total by the current season (REQ-0066), all-time fallback without a registry', async () => {
    writeCanonicalSeason(); // re-anchor: season 1 started 10d1h ago
    // REQ-0195a: furnace totals are per-tm rows now; all burns here are lrdst.
    const lrdstRow = (r) => (r.body.furnace.totals || []).find((x) => x.tm === 'lrdst') || { total: 0, count: 0 };
    const seasonRes = await marketReq('GET', '/api/ragnarok/season', ragA.token);
    const seasonStartIso = seasonRes.body.season.startAt;
    const before = await marketReq('GET', '/api/market/furnace', ragA.token);
    assert.strictEqual(before.status, 200, JSON.stringify(before.body));
    assert.deepStrictEqual(before.body.season, { index: 1, name: '狼の冬' }, 'furnace names the season it windows');
    assert.strictEqual(before.body.furnace.since, seasonStartIso, 'window starts at the season start');
    // White-box ledger entries: one BEFORE the season started (must not
    // count), one inside the window (must).
    scheduleStorage.writeMarketFurnaceEntry({ id: 'furn_win_old', amount: 7, tm: 'lrdst', listingId: 'x_old', t: new Date(Date.now() - 30 * RAG_DAY).toISOString() });
    scheduleStorage.writeMarketFurnaceEntry({ id: 'furn_win_new', amount: 5, tm: 'lrdst', listingId: 'x_new', t: new Date(Date.now() - 1 * RAG_DAY).toISOString() });
    const windowed = await marketReq('GET', '/api/market/furnace', ragA.token);
    assert.strictEqual(lrdstRow(windowed).total, lrdstRow(before).total + 5, 'pre-season burn excluded, in-season burn counted');
    assert.strictEqual(lrdstRow(windowed).count, lrdstRow(before).count + 1);
    // No seasons file -> the documented all-time fallback (pre-REQ-0066
    // behavior byte-for-byte: since null, everything counts).
    writeSeasonsFixture(null);
    const allTime = await marketReq('GET', '/api/market/furnace', ragA.token);
    assert.strictEqual(allTime.body.furnace.since, null);
    assert.strictEqual(allTime.body.season, null);
    assert.strictEqual(lrdstRow(allTime).total, lrdstRow(before).total + 5 + 7, 'all-time includes the pre-season entry');
    writeCanonicalSeason();
  });

  await AT('ragnarok: every /api/ragnarok route is token-gated (401 for a garbage token)', async () => {
    for (const [method, p2] of [
      ['GET', '/api/ragnarok/season'],
      ['GET', '/api/ragnarok/order'],
      ['GET', '/api/ragnarok/einherjar'],
      ['GET', '/api/ragnarok/devotion/preview/0'],
      ['POST', '/api/ragnarok/devotion/0'],
    ]) {
      const res = await marketReq(method, p2, 'totally-bogus-token');
      assert.strictEqual(res.status, 401, method + ' ' + p2 + ' -> ' + res.status);
    }
  });

  await AT('admin: REAL repo happy path -- edit persists to the real content/live/live_items.json, then self-restores byte-identical', async () => {
    // This test intentionally operates against the REAL repo tree (not the
    // synthetic fixture above) -- os.homedir() is already restored to the
    // real value at this point in the run. Per the task spec: back up the
    // real file BEFORE the edit, perform the edit via the real HTTP PUT
    // path, verify the file changed, then RESTORE the exact original bytes
    // and verify checksum-identical -- in a try/finally so restoration
    // always happens even if an assertion above it throws.
    const crypto = require('crypto');
    const realItemsPath = path.join(realHomedir(), 'backpack_ragnarok', 'content', 'live', 'live_items.json');
    const originalBytes = fs.readFileSync(realItemsPath);
    const originalMode = fs.statSync(realItemsPath).mode;
    const originalSha = crypto.createHash('sha256').update(originalBytes).digest('hex');

    // REQ-0047 (c): rebind the WHOLE server module tree (see evictServerModuleTree).
    evictServerModuleTree();
    const realApi = require('../../api.cjs');

    try {
      // Ensure the real dev player exists + is an item_admin, and grab its
      // real token (created if missing, same as server boot would do).
      const realAdmin = require('../../admin.cjs');
      const realDevPlayer = realAdmin.ensureDevPlayer();

      // Pick a real live item id and confirm current name via the real admin module.
      const found = realAdmin.findLiveEntry('dagger');
      assert.ok(found, 'fixture item "dagger" must exist in the real content/live/live_items.json');
      const originalName = found.doc.entries[found.index].name;

      await new Promise((resolve, reject) => {
        const req = mockReq(
          'PUT',
          '/api/admin/item/dagger',
          JSON.stringify({ name: originalName + ' (test-edit)' }),
          authHeaders(realDevPlayer.token)
        );
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        realApi.handle(req, res);
      });

      // Verify the real file actually changed.
      const changedBytes = fs.readFileSync(realItemsPath);
      assert.notStrictEqual(changedBytes.toString('utf8'), originalBytes.toString('utf8'), 'file must have changed after the edit');
      const reread = JSON.parse(changedBytes.toString('utf8'));
      const changedEntry = reread.entries.find((e) => e.id === 'dagger');
      assert.strictEqual(changedEntry.name, originalName + ' (test-edit)');
      // Fidelity check: the rewritten file must preserve the original's
      // trailing-newline convention (every content/live/*.json in this
      // repo ends with exactly one trailing newline) -- admin.cjs's write
      // path explicitly re-adds it since JSON.stringify never does.
      if (originalBytes.toString('utf8').endsWith('\n')) {
        assert.ok(changedBytes.toString('utf8').endsWith('\n'), 'rewritten file must keep the trailing newline the original had');
      }
    } finally {
      // ALWAYS restore, even if an assertion above threw -- bytes AND mode
      // (the admin write path's atomic tmp-file+rename can change the
      // file's mode bits, e.g. losing an executable bit some content
      // files happen to carry; restore that explicitly too so `git
      // status` shows a truly clean tree, not just byte-identical
      // content).
      fs.writeFileSync(realItemsPath, originalBytes);
      fs.chmodSync(realItemsPath, originalMode);
      const restoredSha = crypto.createHash('sha256').update(fs.readFileSync(realItemsPath)).digest('hex');
      if (restoredSha !== originalSha) {
        throw new Error('CRITICAL: failed to restore content/live/live_items.json byte-identical! before=' + originalSha + ' after=' + restoredSha);
      }
    }
  });


};
