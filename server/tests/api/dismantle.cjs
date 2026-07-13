'use strict';
// server/tests/api/dismantle.cjs -- REQ-0145a (sf): the REQ-0063 Dismantle group (ledger,
// quality roll, TTL auto-dismantle, dex-card dismantle overlay). Runs
// inside its own dz* module generation: re-swaps the sandbox to the
// synthetic fakeRepoHome, re-evicts + re-requires every server module
// under dz* names, and restores the real homedir on exit -- exactly
// the monolith's own block.
// Cut VERBATIM from server/tests/api_test.cjs origin lines 3604-3913 @
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
  // REQ-0063: Dismantle system (ledger, quality roll, TTL auto-dismantle).
  //
  // Own module generation: the "admin: REAL repo happy path" test just
  // above deliberately runs against the REAL os.homedir() (restored at
  // `os.homedir = realHomedir;` earlier in this file) so it can edit-then-
  // restore the actual content/live/live_items.json -- and nothing
  // previously ran AFTER that test to swap the sandbox back. Re-swap to
  // the SAME synthetic fakeRepoHome/repoRoot fixture the rest of this
  // suite uses, and re-evict + re-require every server/ module fresh
  // under new LOCAL names (dz*) so this block never touches the real
  // ~/backpack_ragnarok tree.
  // =====================================================================
  {
    os.homedir = () => fakeRepoHome;
    process.env.CONTENT_ROOT = contentDir; // REQ-0145a (sc): re-inject alongside the homedir re-swap
    evictServerModuleTree();
    const dzApi = require('../../api.cjs');
    const dzPlayers = require('../../players.cjs');
    const dzStorage = require('../../storage.cjs');
    const dzSchedule = require('../../schedule.cjs');
    const dzDismantle = require('../../dismantle.cjs');
    const dzWarehouseSvc = require('../../services/warehouse.cjs');

    function dzReq(method, urlPath, token, body) {
      return new Promise((resolve, reject) => {
        const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
        const req2 = mockReq(method, urlPath, bodyStr, authHeaders(token));
        const res2 = mockRes((b) => {
          let parsed = null;
          try { parsed = JSON.parse(b); } catch (e) { /* leave null */ }
          resolve({ status: res2.statusCode, body: parsed });
        });
        try { dzApi.handle(req2, res2); } catch (e) { reject(e); }
      });
    }

    // A bare, minimal profile: two 'blade' PO instances homed in
    // inventory page 0 (dzp1/dzp2, never referenced by the active
    // squad -- not deployed), plus a THIRD (dzp3) that IS referenced by
    // the active squad (index 0) so a hand-written room can deploy it.
    const dismantlePlayer = dzPlayers.createPlayer('DismantlePlayer', []);
    const dzCanvas = {
      pos: [{ uid: 'dzp3', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 }],
      bps: [], sis: [],
      presets: { active: 0, store: [null, null] },
      inv: {
        pages: [
          {
            pos: [
              { uid: 'dzp1', id: 'blade', loc: 'grid', cell: [1, 1], rot: 0 },
              { uid: 'dzp2', id: 'blade', loc: 'grid', cell: [3, 1], rot: 0 },
              { uid: 'dzp3', id: 'blade', loc: 'grid', cell: [5, 1], rot: 0 },
            ],
            sis: [], bps: [], tms: [],
          },
        ],
      },
    };
    dzStorage.writeProfile(dismantlePlayer.playerId, dzCanvas);
    // Minimal room doc, written directly (bypassing assignSlot's own
    // "empty_squad" business-rule validation -- irrelevant to what THIS
    // gate test is proving, which is that dismantleItem correctly
    // CONSUMES market.deployedUidSet's result, a function already fully
    // covered by the market suspension tests above). Only the fields
    // deployedUidSet itself reads are populated.
    dzStorage.writeRoom('dz_room_1', {
      id: 'dz_room_1', ownerId: dismantlePlayer.playerId, status: 'open',
      slots: [{ squadIndex: 0 }, { squadIndex: null }, { squadIndex: null }, { squadIndex: null }],
    });

    T('dismantle: every /api/dismantle route is token-gated (401 for a garbage token)', () => {
      const req = mockReq('POST', '/api/dismantle', JSON.stringify({ itemUid: 'dzp1', kind: 'po' }), { 'x-auth-token': 'garbage' });
      const res = mockRes();
      dzApi.handle(req, res);
      assert.strictEqual(res.statusCode, 401);
    });

    await AT('dismantle: happy path -- removes the item, engraves the ledger, yields 1 lrdst via warehouse', async () => {
      const before = await dzReq('GET', '/api/dismantle/ledger', dismantlePlayer.token);
      assert.strictEqual(before.status, 200);
      assert.deepStrictEqual(before.body.entries, [], 'fresh player has no ledger yet');

      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp1', kind: 'po' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.itemId, 'blade');
      assert.strictEqual(res.body.dismantleCount, 1);
      assert.ok(Math.abs(res.body.suppression - dzDismantle.suppressionFloor(1)) < 1e-9);
      assert.deepStrictEqual(res.body.yield, { tmId: 'lrdst', qty: 1 });

      // Item gone from inventory (home record), everywhere.
      const canvasAfter = dzStorage.readProfile(dismantlePlayer.playerId).canvas;
      assert.strictEqual(dzDismantle.findInventoryItem(canvasAfter, 'dzp1', 'po'), null);
      // The untouched sibling instance (dzp2) must survive.
      assert.ok(dzDismantle.findInventoryItem(canvasAfter, 'dzp2', 'po'), 'sibling instance untouched');

      // Ledger persisted.
      assert.strictEqual(dzDismantle.dismantleCountFor(dismantlePlayer.playerId, 'blade'), 1);

      // Yield landed as a normal claimable warehouse row (house grant
      // pattern -- never written straight onto the canvas, see the
      // dismantleItem RULE-5 doc).
      const wh = dzSchedule.listWarehouse(dismantlePlayer.playerId);
      const yieldRow = wh.find((w) => w.kind === 'tm' && w.itemId === 'lrdst');
      assert.ok(yieldRow, 'yield row present in warehouse');
      assert.strictEqual(yieldRow.qty, 1);
      assert.strictEqual(yieldRow.status, 'claimable');
    });

    await AT('dismantle: a second dismantle of the SAME item id engraves cumulatively (分解値 rises, suppression rises)', async () => {
      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp2', kind: 'po' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.dismantleCount, 2);
      assert.ok(res.body.suppression > dzDismantle.suppressionFloor(1), 'suppression strictly rises with count');
      assert.ok(res.body.suppression < dzDismantle.SUPPRESSION_CAP, 'suppression never reaches the cap');

      const ledger = await dzReq('GET', '/api/dismantle/ledger', dismantlePlayer.token);
      const entry = ledger.body.entries.find((e) => e.itemId === 'blade');
      assert.strictEqual(entry.dismantleCount, 2);
    });

    await AT('dismantle: unknown itemUid -> 404', async () => {
      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'not_a_real_uid', kind: 'po' });
      assert.strictEqual(res.status, 404);
    });

    await AT('dismantle: malformed body (missing itemUid / bad kind) -> 400', async () => {
      const r1 = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { kind: 'po' });
      assert.strictEqual(r1.status, 400);
      const r2 = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp3', kind: 'bp' });
      assert.strictEqual(r2.status, 400);
    });

    await AT('dismantle: deployed gate -- an item referenced by a slotted squad in an open room cannot be dismantled (409)', async () => {
      const res = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp3', kind: 'po' });
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.strictEqual(res.body.reason, 'deployed');
      // Untouched: still present, ledger unchanged.
      const canvasAfter = dzStorage.readProfile(dismantlePlayer.playerId).canvas;
      assert.ok(dzDismantle.findInventoryItem(canvasAfter, 'dzp3', 'po'), 'deployed item survives the refused dismantle');
      assert.strictEqual(dzDismantle.dismantleCountFor(dismantlePlayer.playerId, 'blade'), 2, 'ledger unchanged by a refused dismantle');

      // Releasing the room lifts the gate (same Law-of-Possession
      // lazy-derivation contract market's own suspension test proves).
      const room = dzStorage.readRoom('dz_room_1');
      room.status = 'canceled';
      dzStorage.writeRoom('dz_room_1', room);
      const res2 = await dzReq('POST', '/api/dismantle', dismantlePlayer.token, { itemUid: 'dzp3', kind: 'po' });
      assert.strictEqual(res2.status, 200, JSON.stringify(res2.body));
      assert.strictEqual(res2.body.dismantleCount, 3);
    });

    T('dismantle: suppressionFloor -- asymptotic, capped, diminishing marginal effect (CAP=0.5, DECAY=0.85)', () => {
      const s = dzDismantle.suppressionFloor;
      assert.strictEqual(s(0), 0);
      assert.ok(s(1) > 0 && s(1) < s(5));
      assert.ok(s(5) < s(20));
      assert.ok(s(20) < dzDismantle.SUPPRESSION_CAP);
      assert.ok(s(100) < dzDismantle.SUPPRESSION_CAP, 'never reaches the cap, even at very high n');
      // NOTE: n=1000 is deliberately NOT asserted here -- at that
      // magnitude 0.85^n underflows below double-precision's ability to
      // distinguish (1 - 0.85^1000) from 1 exactly, so s(1000) legitimately
      // COMPUTES as exactly the cap in floating point even though the
      // true mathematical limit is only ever approached. n=100 is already
      // a wildly unrealistic dismantle count for real play and safely
      // within float precision, so it is the honest boundary to assert.
      // Diminishing marginal effect: the FIRST dismantle's delta exceeds
      // a LATER dismantle's delta (strong-early/weak-later, per the
      // user's own confirmed spec).
      const firstDelta = s(1) - s(0);
      const laterDelta = s(10) - s(9);
      assert.ok(firstDelta > laterDelta, 'marginal effect diminishes: ' + firstDelta + ' vs ' + laterDelta);
    });

    T('dismantle: rollQuality -- floor rises with 分解値, ceiling always reaches toward 1, q is always < 1', () => {
      const qp = dzPlayers.createPlayer('QualityRollCheck', []);
      // n=0: floor is exactly 0 -- q can land anywhere in [0,1).
      for (let i = 0; i < 50; i++) {
        const q = dzDismantle.rollQuality(qp.playerId, 'never_dismantled_item');
        assert.ok(q >= 0 && q < 1, 'q in [0,1): ' + q);
      }
      // Engrave 10x, then every roll must be >= that floor.
      for (let i = 0; i < 10; i++) dzDismantle.engrave(qp.playerId, 'well_farmed_item');
      const floor = dzDismantle.currentSuppression(qp.playerId, 'well_farmed_item');
      assert.ok(floor > 0);
      for (let i = 0; i < 50; i++) {
        const q = dzDismantle.rollQuality(qp.playerId, 'well_farmed_item');
        assert.ok(q >= floor && q < 1, 'q=' + q + ' must be >= floor=' + floor + ' and < 1');
      }
    });

    await AT('dismantle: quality roll wired into acquisition -- admin grant + dungeon reward + warehouse claim all carry q', async () => {
      const qp2 = dzPlayers.createPlayer('QualityWiring', []);
      // engrave a known floor first so the roll is provably bounded below it.
      for (let i = 0; i < 6; i++) dzDismantle.engrave(qp2.playerId, 'blade');
      const floor = dzDismantle.currentSuppression(qp2.playerId, 'blade');
      assert.ok(floor > 0);

      // grantWarehouseItem (admin-grant path).
      const granted = dzWarehouseSvc.grantWarehouseItem(qp2.playerId, 'blade');
      assert.strictEqual(granted.ok, true);
      assert.ok(typeof granted.item.q === 'number' && granted.item.q >= floor && granted.item.q < 1, 'q=' + granted.item.q);

      // claimWarehouseItem surfaces q in its return value (consumed by
      // the client's WarehouseTab.tsx to attach it to the new PO record).
      const { itemDefsById } = dzSchedule.getScheduleContent();
      const claimed = dzWarehouseSvc.claimWarehouseItem(qp2.playerId, granted.item.itemUid, itemDefsById, {});
      assert.strictEqual(claimed.q, granted.item.q, 'claim response carries the SAME q the row was minted with');
    });

    await AT('dismantle: TTL auto-dismantle -- expiry engraves the ledger always, yields probabilistically (50%), never for kind:tm currency rows', async () => {
      const ttlPlayer = dzPlayers.createPlayer('TtlAutoDismantle', []);
      const now = Date.now();
      const expiredPo = {
        itemUid: 'ttl_po_yield', playerId: ttlPlayer.playerId, itemId: 'fx_dagger',
        harvestedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now - 1).toISOString(),
        status: 'claimable',
      };
      const expiredPo2 = {
        itemUid: 'ttl_po_noyield', playerId: ttlPlayer.playerId, itemId: 'fx_dagger',
        harvestedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now - 1).toISOString(),
        status: 'claimable',
      };
      const expiredTm = {
        itemUid: 'ttl_tm', playerId: ttlPlayer.playerId, itemId: 'lrdst', qty: 5, kind: 'tm',
        harvestedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now - 1).toISOString(),
        status: 'claimable',
      };
      dzStorage.writeWarehouseItem(ttlPlayer.playerId, expiredPo.itemUid, expiredPo);
      dzStorage.writeWarehouseItem(ttlPlayer.playerId, expiredPo2.itemUid, expiredPo2);
      dzStorage.writeWarehouseItem(ttlPlayer.playerId, expiredTm.itemUid, expiredTm);

      const originalRandom = Math.random;
      let call = 0;
      // First purge-eligible po row rolls "yield" (0.1 < 0.5); the
      // second rolls "no yield" (0.9 >= 0.5). Both rows are asserted by
      // item id after the fact rather than relying on which one got
      // which random draw, so this is not order-fragile.
      Math.random = () => (call++ === 0 ? 0.1 : 0.9);
      try {
        dzSchedule.purgeExpiredWarehouseItems(ttlPlayer.playerId);
      } finally {
        Math.random = originalRandom;
      }

      // Both po rows engraved (full engraving always, per spec).
      assert.strictEqual(dzDismantle.dismantleCountFor(ttlPlayer.playerId, 'fx_dagger'), 2);
      // Both expired warehouse rows gone.
      const survivorUids = dzSchedule.listWarehouse(ttlPlayer.playerId).map((w) => w.itemUid);
      assert.ok(!survivorUids.includes('ttl_po_yield'));
      assert.ok(!survivorUids.includes('ttl_po_noyield'));
      assert.ok(!survivorUids.includes('ttl_tm'), 'tm row still plain-deleted, no engraving concept for currency');
      // Exactly one yield row landed (from the call===0 -> 0.1 draw).
      const yieldRows = dzSchedule.listWarehouse(ttlPlayer.playerId).filter((w) => w.kind === 'tm' && w.itemId === 'lrdst');
      assert.strictEqual(yieldRows.length, 1, 'exactly one of the two expired rows yielded (the 0.1 draw)');
      assert.strictEqual(yieldRows[0].qty, 1);
    });

    await AT('dismantle: REQ-0052 Dex card carries the CALLER\'s own 分解値+suppression overlay (kind:item/si only, never kind:tm, omitted for an unresolvable caller)', async () => {
      // dismantlePlayer has dismantled 3 blades by this point in the
      // block (happy path + cumulative + the deployed-gate's post-release
      // dismantle above) -- reuse that state rather than engraving fresh,
      // proving the route reads the SAME ledger dismantleItem itself wrote.
      const bladeCount = dzDismantle.dismantleCountFor(dismantlePlayer.playerId, 'blade');
      assert.strictEqual(bladeCount, 3);

      const withToken = await dzReq('GET', '/api/dex/card/item/blade', dismantlePlayer.token);
      assert.strictEqual(withToken.status, 200);
      assert.ok(withToken.body.card.dismantle, 'dismantle overlay present for a resolved caller on a kind:item card');
      assert.strictEqual(withToken.body.card.dismantle.count, bladeCount);
      assert.ok(Math.abs(withToken.body.card.dismantle.suppression - dzDismantle.suppressionFloor(bladeCount)) < 1e-9);

      // Never dismantled BY THIS PLAYER (a different player dismantled
      // fx_dagger elsewhere in this file) -- count:0, suppression:0, but
      // the field is still PRESENT (a resolved caller always gets an
      // overlay for a dismantlable kind, even at the zero baseline).
      const neverDismantled = await dzReq('GET', '/api/dex/card/item/fx_dagger', dismantlePlayer.token);
      assert.strictEqual(neverDismantled.status, 200);
      assert.ok(neverDismantled.body.card.dismantle);
      assert.strictEqual(neverDismantled.body.card.dismantle.count, 0);
      assert.strictEqual(neverDismantled.body.card.dismantle.suppression, 0);

      // kind:'tm' can never be dismantled -- the overlay must never
      // appear there, even for the exact same resolved caller.
      const tmCard = await dzReq('GET', '/api/dex/card/tm/lrdst', dismantlePlayer.token);
      assert.strictEqual(tmCard.status, 200);
      assert.strictEqual(tmCard.body.card.dismantle, undefined, 'kind:tm never carries a dismantle overlay');

      // No token at all -- dev_mode fallback resolves (to THIS sandbox's
      // own isolated dev player, never the real one), so the base card
      // fetch still succeeds AND still gets an overlay (dev player's own,
      // freshly at count 0) -- proves the anonymous path degrades to "a
      // resolved caller" rather than erroring, matching admin.resolveAuth's
      // documented dev_mode contract.
      const noToken = await dzReq('GET', '/api/dex/card/item/blade', undefined);
      assert.strictEqual(noToken.status, 200);
      assert.ok(noToken.body.card.dismantle, 'dev_mode no-token fallback still resolves a caller, so the overlay is present');

      // A garbage (present but invalid) token is NOT the same as no
      // token -- resolveAuth returns ok:false for it even under
      // dev_mode, so the overlay must be omitted while the base card
      // fetch still succeeds (this route is never auth-REQUIRED).
      const badToken = await dzReq('GET', '/api/dex/card/item/blade', 'totally_garbage_token');
      assert.strictEqual(badToken.status, 200, 'base card fetch never fails even with an invalid token');
      assert.strictEqual(badToken.body.card.dismantle, undefined, 'an invalid token resolves to no caller, so no overlay -- never a 401');
    });

    delete process.env.CONTENT_ROOT; // REQ-0145a (sc): mirror the homedir restore below
    os.homedir = realHomedir; // leave the sandbox exactly as this block found it (real homedir active), matching the outer suite's own posture at this point in the file
  }
};
