'use strict';
// server/tests/api/market.cjs -- REQ-0145a (sf): the REQ-0064 Market group (listings,
// browse/suspension, atomic settle, withdraw/TTL/idempotency, furnace,
// dex price history) + the shared market fixtures (marketReq,
// invPage/mkCanvas) the ragnarok suite reuses.
// Cut VERBATIM from server/tests/api_test.cjs origin lines 2446-2927 @
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
  // REQ-0064: Market test group. Same synthetic fixture tree as the
  // schedule group above (fakeRepoHome still mapped); drives the real
  // api.handle() surface for every route, plus the market facade
  // (server/market.cjs -- rule-3 consumers never require services/
  // directly) and storage.cjs's market roots for white-box assertions.
  // Runs identically in files AND pg modes (STORAGE_BACKEND), like the
  // rest of this suite -- pg needs server/migrations/004_market.sql
  // applied, same as 001..003 for the groups above.
  // =====================================================================
  const market = require('../../market.cjs');

  const mktSeller = playersFixture.createPlayer('MarketSeller', []);
  const mktBuyer = playersFixture.createPlayer('MarketBuyer', []);
  const mktRich = playersFixture.createPlayer('MarketRich', []);
  const mktPoor = playersFixture.createPlayer('MarketPoor', []);

  // Seller: inventory POs (page 0) + one squad (index 1) that
  // REFERENCES two of the inventory-homed items (mkt_susp / mkt_susp2 --
  // the REQ-0030 reference model: placing on a board references the
  // uid, the home stays in st.inv), used to deploy them for the
  // suspension / Law-of-Possession tests. bps non-empty so the squad
  // passes engine.isSquadDeployable.
  function invPage(pos, tms) { return { bps: [], pos: pos || [], sis: [], tms: tms || [] }; }
  function mkCanvas(pages, squadStore) {
    return {
      linked: true, layout: { ROWS: 8, COLS: 8 }, bps: [], pos: [], sis: [],
      inv: { pages, names: ['1', '2', '3', '4', '5'] },
      presets: { active: 0, names: ['P1', 'P2', 'P3', 'P4', 'P5'], store: squadStore },
    };
  }
  const sellerPos = [
    { uid: 'mkt_sell_1', id: 'blade', cell: [1, 1], rot: 0 },
    { uid: 'mkt_sell_2', id: 'blade', cell: [1, 2], rot: 0 },
    { uid: 'mkt_sell_3', id: 'fx_dagger', cell: [1, 3], rot: 0 },
    { uid: 'mkt_sell_4', id: 'blade', cell: [1, 4], rot: 0 },
    { uid: 'mkt_gone', id: 'blade', cell: [1, 5], rot: 0 },
    { uid: 'mkt_susp', id: 'blade', cell: [2, 1], rot: 0 },
    { uid: 'mkt_susp2', id: 'blade', cell: [2, 2], rot: 0 },
  ];
  const sellerSquad1 = {
    linked: true,
    bps: [{ id: 'bp_mkt', name: 'BP mkt', color: '#888888', shape: [[0, 0], [0, 1]], origin: [1, 1], linker: { off: [0, 0], dirs: [] }, hpMax: 30 }],
    pos: [
      { uid: 'mkt_susp', id: 'blade', cell: [1, 1], rot: 0 },
      { uid: 'mkt_susp2', id: 'blade', cell: [1, 2], rot: 0 },
    ],
    sis: [],
  };
  scheduleStorage.writeProfile(mktSeller.playerId, mkCanvas(
    [invPage(sellerPos), invPage(), invPage(), invPage(), invPage()],
    [null, sellerSquad1, null, null, null]
  ));
  // Buyer: 140 lrdst split across two pages (40 + 100) -- exercises the
  // multi-stack debit drain. Rich: 500. Poor: 5.
  scheduleStorage.writeProfile(mktBuyer.playerId, mkCanvas(
    [invPage([], [{ uid: 'tm_b1', id: 'lrdst', qty: 40, cell: [1, 1] }]),
     invPage([], [{ uid: 'tm_b2', id: 'lrdst', qty: 100, cell: [1, 1] }]),
     invPage(), invPage(), invPage()],
    [null, null, null, null, null]
  ));
  scheduleStorage.writeProfile(mktRich.playerId, mkCanvas(
    [invPage([], [{ uid: 'tm_r1', id: 'lrdst', qty: 500, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
    [null, null, null, null, null]
  ));
  scheduleStorage.writeProfile(mktPoor.playerId, mkCanvas(
    [invPage([], [{ uid: 'tm_p1', id: 'lrdst', qty: 5, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
    [null, null, null, null, null]
  ));

  // scheduleReq + extra headers (Idempotency-Key).
  function marketReq(method, urlPath, token, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const headers = Object.assign({}, authHeaders(token), extraHeaders || {});
      const req2 = mockReq(method, urlPath, bodyStr, headers);
      const res2 = mockRes((b) => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch (e) { /* leave null */ }
        resolve({ status: res2.statusCode, body: parsed });
      });
      try { api.handle(req2, res2); } catch (e) { reject(e); }
    });
  }
  function mktBalance(playerId) {
    const doc = scheduleStorage.readProfile(playerId);
    return market.readTmBalance(doc ? doc.canvas : null, market.MARKET_TM_ID);
  }

  await AT('market: burnOf matches the mock burn table -- max(1, ceil(qty*0.08)); 46->4, 120->10, 12->1, 3->1 (web/redesign/market.html)', async () => {
    // Mock-verified cases first (rendered burn lines + the mock JS's own
    // burnOf), then boundary rows around the ceil/floor edges.
    const table = [
      [46, 4], [120, 10], [12, 1], [3, 1], // straight from the mock cards
      [9, 1], [18, 2], [64, 6], [88, 8], [1420, 114], // remaining mock lines
      [1, 1], [2, 1], [13, 2], [25, 2], [26, 3], [100, 8], [999, 80], // boundaries
    ];
    for (const [qty, expected] of table) {
      assert.strictEqual(market.burnOf(qty), expected, 'burnOf(' + qty + ') must be ' + expected);
    }
    assert.strictEqual(market.MARKET_TM_ID, 'lrdst', 'the one trade TM is the engine/content id lrdst');
    assert.strictEqual(market.MARKET_LISTING_TTL_MS, 7 * 24 * 60 * 60 * 1000, '7-day listing shelf life');
  });

  await AT('market: POST /api/market/listings lists an inventory item for free; DTO carries dtoVersion/burn/dexNo/expiresAt(+7d)', async () => {
    const before = Date.now();
    const res = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_1', price: { tm: 'lrdst', qty: 46 } });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.dtoVersion, 1);
    assert.strictEqual(res.body.replayed, false);
    const l = res.body.listing;
    assert.strictEqual(l.state, 'active');
    assert.strictEqual(l.suspended, false);
    assert.deepStrictEqual(l.price, { tm: 'lrdst', qty: 46 });
    assert.strictEqual(l.burn, 4);
    assert.strictEqual(l.sellerReceives, 42);
    assert.strictEqual(l.itemId, 'blade');
    assert.strictEqual(l.itemName, schedule.getScheduleContent().itemDefsById.blade.name, 'itemName mirrors the live def (an earlier admin test renames it)');
    assert.strictEqual(l.dexNo, 1, 'blade is entry 1 of the live_items fixture');
    assert.strictEqual(l.sellerName, 'MarketSeller');
    assert.deepStrictEqual(l.priceHistory, [], 'no settled price yet');
    const ttl = Date.parse(l.expiresAt) - Date.parse(l.createdAt);
    assert.strictEqual(ttl, market.MARKET_LISTING_TTL_MS, 'expiresAt = createdAt + 7d');
    assert.ok(Date.parse(l.createdAt) >= before - 1000, 'createdAt is now-ish');
    // Listing is free: no furnace entry, and the item is still in the
    // seller inventory (NOT escrowed).
    assert.strictEqual(market.furnaceTotal().total, 0, 'listing must not burn');
    const sellerDoc = scheduleStorage.readProfile(mktSeller.playerId);
    assert.ok(market.findInventoryPO(sellerDoc.canvas, 'mkt_sell_1'), 'item stays in inventory while listed');
  });

  await AT('market: create validation -- unknown/foreign uid 404 (no-leak), bad price 400s, duplicate 409 already_listed', async () => {
    const noSuch = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'no_such_uid', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(noSuch.status, 404, 'unknown uid: ' + JSON.stringify(noSuch.body));
    // Another player's REAL uid answers exactly like a nonexistent one
    // (eligibility only ever reads the CALLER's own canvas): no-leak.
    const foreign = await marketReq('POST', '/api/market/listings', mktBuyer.token, { itemUid: 'mkt_sell_2', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(foreign.status, 404, 'foreign uid must 404 identically: ' + JSON.stringify(foreign.body));
    for (const badPrice of [
      { tm: 'lrdst', qty: 0 }, { tm: 'lrdst', qty: 1000 }, { tm: 'lrdst', qty: 4.5 },
      { tm: 'gold', qty: 10 }, undefined,
    ]) {
      const bad = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_2', price: badPrice });
      assert.strictEqual(bad.status, 400, 'bad price ' + JSON.stringify(badPrice) + ' -> 400, got ' + bad.status + ': ' + JSON.stringify(bad.body));
    }
    const dup = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_1', price: { tm: 'lrdst', qty: 50 } });
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.reason, 'already_listed');
  });

  await AT('market: GET /api/market/listings -- browse is market-wide with sellerName; tag filter + q (name / Dex No.) work', async () => {
    const fx = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_3', price: { tm: 'lrdst', qty: 12 } });
    assert.strictEqual(fx.status, 200);
    assert.strictEqual(fx.body.listing.burn, 1, '12 -> burn 1 (mock line)');

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.strictEqual(browse.status, 200);
    assert.strictEqual(browse.body.dtoVersion, 1);
    assert.strictEqual(browse.body.tm, 'lrdst');
    assert.strictEqual(browse.body.listings.length, 2, 'both active listings visible to another player');
    assert.ok(browse.body.listings.every((x) => x.sellerName === 'MarketSeller'));

    const tagged = await marketReq('GET', '/api/market/listings?filter=weapon', mktBuyer.token);
    assert.strictEqual(tagged.body.listings.length, 2, 'tag filter is case-insensitive (Weapon)');
    const none = await marketReq('GET', '/api/market/listings?filter=NoSuchTag', mktBuyer.token);
    assert.strictEqual(none.body.listings.length, 0);

    const byName = await marketReq('GET', '/api/market/listings?q=fx%20dagger', mktBuyer.token);
    assert.strictEqual(byName.body.listings.length, 1);
    assert.strictEqual(byName.body.listings[0].itemId, 'fx_dagger');
    const byDexNo = await marketReq('GET', '/api/market/listings?q=No.2', mktBuyer.token);
    assert.strictEqual(byDexNo.body.listings.length, 1, 'Dex No. 2 = fx_dagger (fixture order)');
    assert.strictEqual(byDexNo.body.listings[0].itemId, 'fx_dagger');
    const byDexNo1 = await marketReq('GET', '/api/market/listings?q=1', mktBuyer.token);
    assert.strictEqual(byDexNo1.body.listings.length, 1, 'bare digits = Dex No. 1 = blade');
    assert.strictEqual(byDexNo1.body.listings[0].itemId, 'blade');
  });

  await AT('market: suspension -- deploying the listed item suspends (browsable, unbuyable); undeploy reverts to active; deployed item cannot be newly listed', async () => {
    const created = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp', price: { tm: 'lrdst', qty: 20 } });
    assert.strictEqual(created.status, 200);
    const suspListingId = created.body.listing.id;

    // Deploy squad 1 (references mkt_susp + mkt_susp2) to a room slot.
    const room = await marketReq('POST', '/api/schedule/rooms', mktSeller.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    assert.strictEqual(room.status, 200, JSON.stringify(room.body));
    const roomId = room.body.room.id;
    const slotRes = await marketReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', mktSeller.token, { squadIndex: 1 });
    assert.strictEqual(slotRes.status, 200, JSON.stringify(slotRes.body));

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    const suspended = browse.body.listings.find((x) => x.id === suspListingId);
    assert.ok(suspended, 'suspended listing stays browsable');
    assert.strictEqual(suspended.state, 'suspended');
    assert.strictEqual(suspended.suspended, true);

    const buyAttempt = await marketReq('POST', '/api/market/listings/' + suspListingId + '/buy', mktBuyer.token);
    assert.strictEqual(buyAttempt.status, 409);
    assert.strictEqual(buyAttempt.body.reason, 'suspended');

    // Law of Possession at CREATE time too: mkt_susp2 is now deployed.
    const deployedCreate = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp2', price: { tm: 'lrdst', qty: 6 } });
    assert.strictEqual(deployedCreate.status, 409);
    assert.strictEqual(deployedCreate.body.reason, 'deployed');

    // Undeploy (cancel the room) -> active again, buyable again.
    const del = await marketReq('DELETE', '/api/schedule/rooms/' + roomId, mktSeller.token);
    assert.strictEqual(del.status, 200, JSON.stringify(del.body));
    const browse2 = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    const revived = browse2.body.listings.find((x) => x.id === suspListingId);
    assert.strictEqual(revived.state, 'active');
    assert.strictEqual(revived.suspended, false);
    // Stored state never flipped -- suspension is derived, not persisted.
    assert.strictEqual(scheduleStorage.readMarketListing(suspListingId).state, 'active');
  });

  let mktListing1Id = null; // blade, qty 46 -- settled in the next test
  await AT('market: buy settles atomically -- debit across stacks, seller item stripped, item to buyer warehouse, proceeds (qty-burn) to seller warehouse, furnace + dex history engraved', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    mktListing1Id = mine.body.listings.find((x) => x.itemUid === 'mkt_sell_1').id;
    assert.strictEqual(mktBalance(mktBuyer.playerId), 140);

    const buy = await marketReq('POST', '/api/market/listings/' + mktListing1Id + '/buy', mktBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    assert.strictEqual(buy.body.dtoVersion, 1);
    assert.deepStrictEqual(
      { qty: buy.body.receipt.price.qty, burn: buy.body.receipt.burn, sellerReceives: buy.body.receipt.sellerReceives },
      { qty: 46, burn: 4, sellerReceives: 42 },
      'the mock case: pay 46 -> burn 4 -> seller receives 42'
    );
    assert.strictEqual(buy.body.listing.state, 'settled');

    // Buyer: 140 -> 94, page-0 stack (40) fully drained + removed,
    // page-1 stack 100 -> 94.
    assert.strictEqual(mktBalance(mktBuyer.playerId), 94);
    const buyerCanvas = scheduleStorage.readProfile(mktBuyer.playerId).canvas;
    assert.strictEqual(buyerCanvas.inv.pages[0].tms.length, 0, 'emptied stack removed');
    assert.strictEqual(buyerCanvas.inv.pages[1].tms[0].qty, 94);

    // Seller: item gone from the canvas entirely.
    const sellerCanvas = scheduleStorage.readProfile(mktSeller.playerId).canvas;
    assert.strictEqual(market.findInventoryPO(sellerCanvas, 'mkt_sell_1'), null, 'sold item stripped from inventory');

    // Buyer warehouse: one claimable blade row carrying sourceListingId.
    const buyerWh = schedule.listWarehouse(mktBuyer.playerId);
    const deliveredRow = buyerWh.find((w) => w.sourceListingId === mktListing1Id);
    assert.ok(deliveredRow, 'item delivered to the buyer warehouse');
    assert.strictEqual(deliveredRow.itemId, 'blade');
    assert.strictEqual(deliveredRow.status, 'claimable');
    assert.strictEqual(deliveredRow.kind, undefined, 'plain PO row, not a TM row');

    // Seller warehouse: kind:tm proceeds row, qty 42 (grantTmQty shape).
    const sellerWh = schedule.listWarehouse(mktSeller.playerId);
    const proceeds = sellerWh.find((w) => w.sourceListingId === mktListing1Id);
    assert.ok(proceeds, 'proceeds row exists');
    assert.strictEqual(proceeds.kind, 'tm');
    assert.strictEqual(proceeds.itemId, 'lrdst');
    assert.strictEqual(proceeds.qty, 42);

    // Furnace + dex history.
    const furnace = await marketReq('GET', '/api/market/furnace', mktBuyer.token);
    assert.strictEqual(furnace.status, 200);
    assert.deepStrictEqual(furnace.body.furnace, { tm: 'lrdst', total: 4, count: 1, since: null });
    const hist = scheduleStorage.readMarketDexHistory('blade');
    assert.strictEqual(hist.entries.length, 1);
    assert.strictEqual(hist.entries[0].qty, 46);
    assert.strictEqual(hist.entries[0].listingId, mktListing1Id);

    // Settled listings leave the browse but stay in the seller's mine view.
    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.ok(!browse.body.listings.some((x) => x.id === mktListing1Id));
    const mine2 = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const settledRow = mine2.body.listings.find((x) => x.id === mktListing1Id);
    assert.strictEqual(settledRow.state, 'settled');
    assert.strictEqual(settledRow.buyerId, mktBuyer.playerId);
    assert.deepStrictEqual(settledRow.priceHistory, [{ qty: 46, t: hist.entries[0].t }], 'DTO exposes the engraved history');
  });

  await AT('market: concurrent buys -- first wins, second 409 already_settled; self-buy 409; insufficient balance 409 leaves everything untouched', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const fxId = mine.body.listings.find((x) => x.itemUid === 'mkt_sell_3').id;
    // Both requests enter the (synchronous) settle back-to-back; the
    // event loop strictly serializes them -- exactly the property the
    // first-wins design relies on.
    const race = await Promise.all([
      marketReq('POST', '/api/market/listings/' + fxId + '/buy', mktBuyer.token),
      marketReq('POST', '/api/market/listings/' + fxId + '/buy', mktRich.token),
    ]);
    const winners = race.filter((r) => r.status === 200);
    const losers = race.filter((r) => r.status === 409);
    assert.strictEqual(winners.length, 1, 'exactly one buy settles: ' + JSON.stringify(race.map((r) => r.status)));
    assert.strictEqual(losers.length, 1);
    assert.strictEqual(losers[0].body.reason, 'already_settled');
    assert.strictEqual(winners[0].body.receipt.burn, 1, '12 -> burn 1');
    // The winner was the first-created request (buyer), so rich is untouched.
    assert.strictEqual(mktBalance(mktBuyer.playerId), 82);
    assert.strictEqual(mktBalance(mktRich.playerId), 500);

    const suspId = mine.body.listings.find((x) => x.itemUid === 'mkt_susp').id;
    const selfBuy = await marketReq('POST', '/api/market/listings/' + suspId + '/buy', mktSeller.token);
    assert.strictEqual(selfBuy.status, 409);
    assert.strictEqual(selfBuy.body.reason, 'self_buy');

    const poorBuy = await marketReq('POST', '/api/market/listings/' + suspId + '/buy', mktPoor.token);
    assert.strictEqual(poorBuy.status, 409);
    assert.strictEqual(poorBuy.body.reason, 'insufficient_balance');
    assert.strictEqual(mktBalance(mktPoor.playerId), 5, 'no partial debit');
    assert.strictEqual(scheduleStorage.readMarketListing(suspId).state, 'active', 'listing untouched by failed buys');
  });

  await AT('market: buyer warehouse full -> 409 warehouse_full, no partial settle', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const suspId = mine.body.listings.find((x) => x.itemUid === 'mkt_susp').id;
    const fillerUids = [];
    for (let i = 0; i < schedule.WAREHOUSE_CAP; i++) {
      const uid = 'mkt_fill_' + i;
      fillerUids.push(uid);
      scheduleStorage.writeWarehouseItem(mktRich.playerId, uid, {
        itemUid: uid, playerId: mktRich.playerId, itemId: 'blade',
        harvestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        sourceRoomId: null, sourceRunId: null, status: 'claimable',
      });
    }
    try {
      const buy = await marketReq('POST', '/api/market/listings/' + suspId + '/buy', mktRich.token);
      assert.strictEqual(buy.status, 409, JSON.stringify(buy.body));
      assert.strictEqual(buy.body.reason, 'warehouse_full');
      assert.strictEqual(mktBalance(mktRich.playerId), 500, 'buyer not debited');
      assert.strictEqual(scheduleStorage.readMarketListing(suspId).state, 'active', 'listing still active');
      const sellerCanvas = scheduleStorage.readProfile(mktSeller.playerId).canvas;
      assert.ok(market.findInventoryPO(sellerCanvas, 'mkt_susp'), 'seller keeps the item');
    } finally {
      for (const uid of fillerUids) scheduleStorage.deleteWarehouseItem(mktRich.playerId, uid);
    }
  });

  await AT('market: withdraw -- owner 200 and free, non-owner 404 (no-leak), unknown id 404, re-withdraw 409 not_active', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const suspId = mine.body.listings.find((x) => x.itemUid === 'mkt_susp').id;

    const notOwner = await marketReq('POST', '/api/market/listings/' + suspId + '/withdraw', mktBuyer.token);
    assert.strictEqual(notOwner.status, 404, 'foreign withdraw must 404, never 403: ' + JSON.stringify(notOwner.body));
    const unknown = await marketReq('POST', '/api/market/listings/mkt_nope/withdraw', mktSeller.token);
    assert.strictEqual(unknown.status, 404);

    const burnedBefore = market.furnaceTotal().total;
    const ok = await marketReq('POST', '/api/market/listings/' + suspId + '/withdraw', mktSeller.token);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.listing.state, 'withdrawn');
    assert.strictEqual(ok.body.listing.withdrawnReason, 'owner');
    assert.strictEqual(market.furnaceTotal().total, burnedBefore, 'withdrawal is free -- the furnace burns only on settlement');

    const again = await marketReq('POST', '/api/market/listings/' + suspId + '/withdraw', mktSeller.token);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.reason, 'not_active');

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.ok(!browse.body.listings.some((x) => x.id === suspId), 'withdrawn listings leave the browse');
  });

  await AT('market: TTL -- a listing past its 7-day shelf life lazily flips to expired (hidden from browse, shown in mine, buy 409)', async () => {
    const created = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_2', price: { tm: 'lrdst', qty: 7 } });
    assert.strictEqual(created.status, 200);
    const id = created.body.listing.id;
    // Backdate past the TTL (the forceRunElapsed convention: rewrite the
    // timestamps, then let the next READ do the lazy transition).
    const raw = scheduleStorage.readMarketListing(id);
    raw.createdAt = new Date(Date.now() - market.MARKET_LISTING_TTL_MS - 60 * 1000).toISOString();
    raw.expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
    scheduleStorage.writeMarketListing(id, raw);

    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.ok(!browse.body.listings.some((x) => x.id === id), 'expired listing hidden from browse');
    assert.strictEqual(scheduleStorage.readMarketListing(id).state, 'expired', 'lazy expiry persisted on read');
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const row = mine.body.listings.find((x) => x.id === id);
    assert.strictEqual(row.state, 'expired');
    const buy = await marketReq('POST', '/api/market/listings/' + id + '/buy', mktBuyer.token);
    assert.strictEqual(buy.status, 409);
    assert.strictEqual(buy.body.reason, 'expired');
  });

  await AT('market: item vanished from the seller inventory -> auto-withdraw (item_gone) on the next buy/read', async () => {
    const created = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_gone', price: { tm: 'lrdst', qty: 9 } });
    assert.strictEqual(created.status, 200);
    const id = created.body.listing.id;
    // The item vanishes (e.g. consumed client-side + auto-saved).
    const doc = scheduleStorage.readProfile(mktSeller.playerId);
    for (const pg of doc.canvas.inv.pages) pg.pos = (pg.pos || []).filter((p) => p.uid !== 'mkt_gone');
    scheduleStorage.writeProfile(mktSeller.playerId, doc.canvas);

    const buy = await marketReq('POST', '/api/market/listings/' + id + '/buy', mktBuyer.token);
    assert.strictEqual(buy.status, 409, JSON.stringify(buy.body));
    assert.strictEqual(buy.body.reason, 'item_gone');
    assert.strictEqual(mktBalance(mktBuyer.playerId), 82, 'buyer untouched');
    const stored = scheduleStorage.readMarketListing(id);
    assert.strictEqual(stored.state, 'withdrawn');
    assert.strictEqual(stored.withdrawal.reason, 'item_gone');
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    assert.strictEqual(mine.body.listings.find((x) => x.id === id).withdrawnReason, 'item_gone');
  });

  await AT('market: Idempotency-Key -- create replays the same listing; buy replays the original receipt without a double debit; another buyer cannot replay it', async () => {
    const idem = { 'idempotency-key': 'mkt-idem-create-1' };
    const c1 = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_4', price: { tm: 'lrdst', qty: 13 } }, idem);
    assert.strictEqual(c1.status, 200);
    assert.strictEqual(c1.body.replayed, false);
    const c2 = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_sell_4', price: { tm: 'lrdst', qty: 13 } }, idem);
    assert.strictEqual(c2.status, 200);
    assert.strictEqual(c2.body.replayed, true);
    assert.strictEqual(c2.body.listing.id, c1.body.listing.id, 'replay returns the ORIGINAL listing');
    const all = scheduleStorage.listMarketListings().filter((x) => x.itemUid === 'mkt_sell_4');
    assert.strictEqual(all.length, 1, 'no double-list');

    const buyIdem = { 'idempotency-key': 'mkt-idem-buy-1' };
    const b1 = await marketReq('POST', '/api/market/listings/' + c1.body.listing.id + '/buy', mktBuyer.token, undefined, buyIdem);
    assert.strictEqual(b1.status, 200, JSON.stringify(b1.body));
    assert.strictEqual(b1.body.receipt.burn, 2, '13 -> burn 2 (ceil boundary)');
    const balanceAfter = mktBalance(mktBuyer.playerId);
    assert.strictEqual(balanceAfter, 69);
    const b2 = await marketReq('POST', '/api/market/listings/' + c1.body.listing.id + '/buy', mktBuyer.token, undefined, buyIdem);
    assert.strictEqual(b2.status, 200, 'replay must not 409: ' + JSON.stringify(b2.body));
    assert.strictEqual(b2.body.replayed, true);
    assert.deepStrictEqual(b2.body.receipt, b1.body.receipt, 'byte-identical receipt');
    assert.strictEqual(mktBalance(mktBuyer.playerId), balanceAfter, 'no double debit');
    // The key is scoped to the buyer: someone else replaying it gets the
    // plain state-machine answer.
    const b3 = await marketReq('POST', '/api/market/listings/' + c1.body.listing.id + '/buy', mktRich.token, undefined, buyIdem);
    assert.strictEqual(b3.status, 409);
    assert.strictEqual(b3.body.reason, 'already_settled');
  });

  await AT('market: GET /api/market/furnace -- all-time total accumulates per settle (seasonal windowing = REQ-0066 hook)', async () => {
    const res = await marketReq('GET', '/api/market/furnace', mktPoor.token);
    assert.strictEqual(res.status, 200);
    // Settles so far: 46 (burn 4) + 12 (burn 1) + 13 (burn 2) = 7 over 3 trades.
    assert.deepStrictEqual(res.body.furnace, { tm: 'lrdst', total: 7, count: 3, since: null });
    // The windowing hook already works (REQ-0066 will pass a season start).
    const windowed = market.furnaceTotal(Date.now() + 1000);
    assert.deepStrictEqual({ total: windowed.total, count: windowed.count }, { total: 0, count: 0 }, 'a future window excludes everything');
  });

  await AT('market: dex price history rolls the last 5 settled prices per itemId, newest first', async () => {
    // 6 more blade settles (prices 1..6) on top of the earlier 46 and 13
    // -> only the newest 5 survive: [6,5,4,3,2].
    const doc = scheduleStorage.readProfile(mktSeller.playerId);
    for (let i = 1; i <= 6; i++) {
      doc.canvas.inv.pages[0].pos.push({ uid: 'mkt_hist_' + i, id: 'blade', cell: [3, i], rot: 0 });
    }
    scheduleStorage.writeProfile(mktSeller.playerId, doc.canvas);
    for (let i = 1; i <= 6; i++) {
      const c = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_hist_' + i, price: { tm: 'lrdst', qty: i } });
      assert.strictEqual(c.status, 200, JSON.stringify(c.body));
      const b = await marketReq('POST', '/api/market/listings/' + c.body.listing.id + '/buy', mktBuyer.token);
      assert.strictEqual(b.status, 200, JSON.stringify(b.body));
      if (i === 1) {
        assert.strictEqual(b.body.receipt.sellerReceives, 0, 'a price of 1 burns whole (max(1,...) floor)');
        const rows = schedule.listWarehouse(mktSeller.playerId).filter((w) => w.kind === 'tm' && w.qty === 0);
        assert.strictEqual(rows.length, 0, 'no zero-qty proceeds row is written');
      }
    }
    const hist = scheduleStorage.readMarketDexHistory('blade');
    assert.deepStrictEqual(hist.entries.map((e) => e.qty), [6, 5, 4, 3, 2], 'rolling window, newest first');
    assert.strictEqual(mktBalance(mktBuyer.playerId), 69 - 21, 'buyer paid 1+2+..+6');
  });

  await AT('market: every /api/market route is token-gated (401 for a garbage token)', async () => {
    for (const [method, p2] of [
      ['GET', '/api/market/listings'],
      ['POST', '/api/market/listings'],
      ['POST', '/api/market/listings/x/withdraw'],
      ['POST', '/api/market/listings/x/buy'],
      ['GET', '/api/market/furnace'],
    ]) {
      const res = await marketReq(method, p2, 'totally-bogus-token');
      assert.strictEqual(res.status, 401, method + ' ' + p2 + ' -> ' + res.status);
    }
  });



  // REQ-0145a (sf): publish this group's shared fixtures for the later suites.
  Object.assign(h, { market, invPage, mkCanvas, marketReq });
};
