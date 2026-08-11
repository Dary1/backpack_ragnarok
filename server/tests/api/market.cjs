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
  // REFERENCES ONE inventory-homed item (mkt_susp2 -- the REQ-0030
  // reference model: placing on a board / into a squad references the
  // uid, the home stays in st.inv). REQ-0198 (C): a preset-referenced
  // item is now 'in_use' (never freshly listable), so mkt_susp2 is the
  // in-use/deploy fixture while mkt_susp stays fully STOWED (listable,
  // then reference-suspended by the test). bps non-empty so the squad
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
    bps: [{ id: 'bp_mkt', name: 'BP mkt', color: '#888888', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30 }],
    pos: [
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
    assert.strictEqual(res.body.dtoVersion, 2);
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
    assert.strictEqual(browse.body.dtoVersion, 2);
    assert.deepStrictEqual([...browse.body.tms].sort(), ['gilt', 'lrdst'], 'envelope carries the live TM registry ids (dtoVersion 2)');
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

  await AT('market: suspension + REQ-0198 in-use eligibility -- a REFERENCED item (board/preset) cannot be newly listed (409 in_use) and SUSPENDS an existing listing (reversibly); a room-DEPLOYED item keeps its own 409 deployed', async () => {
    // mkt_susp is STOWED (home in inv page 0 only, not in any squad) -> listable.
    const created = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp', price: { tm: 'lrdst', qty: 20 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const suspListingId = created.body.listing.id;

    // REQ-0198 (C): mkt_susp2 is REFERENCED by squad-1's stored PRESET
    // snapshot (presets.store[1]) though NO room deploys it -- ineligible
    // to list with the NEW reason 'in_use' (distinct from room 'deployed').
    const refCreate = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp2', price: { tm: 'lrdst', qty: 6 } });
    assert.strictEqual(refCreate.status, 409, JSON.stringify(refCreate.body));
    assert.strictEqual(refCreate.body.reason, 'in_use');

    // REQ-0198 (C): referencing the ALREADY-LISTED mkt_susp onto the ACTIVE
    // BOARD (top-level canvas.pos -- the reference model's "placed on the
    // board") derives SUSPENDED (browsable, unbuyable), reversibly.
    const doc = scheduleStorage.readProfile(mktSeller.playerId);
    doc.canvas.pos.push({ uid: 'mkt_susp', id: 'blade', cell: [5, 5], rot: 0 });
    scheduleStorage.writeProfile(mktSeller.playerId, doc.canvas);
    let browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    const suspended = browse.body.listings.find((x) => x.id === suspListingId);
    assert.ok(suspended, 'referenced listing stays browsable');
    assert.strictEqual(suspended.state, 'suspended');
    assert.strictEqual(suspended.suspended, true);
    const buyAttempt = await marketReq('POST', '/api/market/listings/' + suspListingId + '/buy', mktBuyer.token);
    assert.strictEqual(buyAttempt.status, 409);
    assert.strictEqual(buyAttempt.body.reason, 'suspended');
    // Remove the board reference -> active again (reversible; stored state never flipped).
    const doc2 = scheduleStorage.readProfile(mktSeller.playerId);
    doc2.canvas.pos = doc2.canvas.pos.filter((pp) => pp.uid !== 'mkt_susp');
    scheduleStorage.writeProfile(mktSeller.playerId, doc2.canvas);
    browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    const revived = browse.body.listings.find((x) => x.id === suspListingId);
    assert.strictEqual(revived.state, 'active');
    assert.strictEqual(revived.suspended, false);

    // Room-deploy behavior UNCHANGED: deploy squad-1 (references mkt_susp2)
    // to a room slot; creating a listing for a DEPLOYED item keeps its own
    // 'deployed' reason (checked BEFORE the broader 'in_use').
    const room = await marketReq('POST', '/api/schedule/rooms', mktSeller.token, { dungeonId: 'test_dungeon', level: 1, formationId: 'formation1' });
    assert.strictEqual(room.status, 200, JSON.stringify(room.body));
    const roomId = room.body.room.id;
    const slotRes = await marketReq('PUT', '/api/schedule/rooms/' + roomId + '/slots/0', mktSeller.token, { squadIndex: 1 });
    assert.strictEqual(slotRes.status, 200, JSON.stringify(slotRes.body));
    const deployedCreate = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp2', price: { tm: 'lrdst', qty: 6 } });
    assert.strictEqual(deployedCreate.status, 409);
    assert.strictEqual(deployedCreate.body.reason, 'deployed');
    // Cancel the room -> mkt_susp2 back to a plain preset reference (still
    // 'in_use', never deployed) -- the room gate released, the reference
    // gate persists.
    const del = await marketReq('DELETE', '/api/schedule/rooms/' + roomId, mktSeller.token);
    assert.strictEqual(del.status, 200, JSON.stringify(del.body));
    const stillRef = await marketReq('POST', '/api/market/listings', mktSeller.token, { itemUid: 'mkt_susp2', price: { tm: 'lrdst', qty: 6 } });
    assert.strictEqual(stillRef.status, 409);
    assert.strictEqual(stillRef.body.reason, 'in_use', 'undeployed but still preset-referenced -> in_use');

    // The mkt_susp listing must be untouched/active for the downstream tests.
    assert.strictEqual(scheduleStorage.readMarketListing(suspListingId).state, 'active');
  });

  let mktListing1Id = null; // blade, qty 46 -- settled in the next test
  await AT('market: buy settles atomically -- debit across stacks, seller item stripped, item to buyer warehouse, proceeds (qty-burn) to seller warehouse, furnace + dex history engraved', async () => {
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    mktListing1Id = mine.body.listings.find((x) => x.itemUid === 'mkt_sell_1').id;
    assert.strictEqual(mktBalance(mktBuyer.playerId), 140);

    const buy = await marketReq('POST', '/api/market/listings/' + mktListing1Id + '/buy', mktBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    assert.strictEqual(buy.body.dtoVersion, 2);
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
    assert.deepStrictEqual(furnace.body.furnace, { totals: [{ tm: 'lrdst', total: 4, count: 1 }], since: null });
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
    assert.deepStrictEqual(settledRow.priceHistory, [{ qty: 46, tm: 'lrdst', t: hist.entries[0].t }], 'DTO exposes the engraved history (with its price TM)');
  });

  await AT('REQ-0368: a settled trade notifies the SELLER (net/burn + the resolved item name) and nobody else -- the buyer already holds the receipt, and the entry is idempotent per listing', async () => {
    // Runs directly after the settle above, against that same trade
    // (mktListing1Id: blade, qty 46 -> burn 4 -> seller receives 42).
    const sellerFeed = await marketReq('GET', '/api/notifications', mktSeller.token);
    assert.strictEqual(sellerFeed.status, 200, 'seller feed: ' + JSON.stringify(sellerFeed.body));
    const sold = sellerFeed.body.notifications.filter((n) => n.kind === 'market_settled' && n.payload.listingId === mktListing1Id);
    assert.strictEqual(sold.length, 1, 'the seller gets exactly one market_settled entry for the trade');
    assert.strictEqual(sold[0].roomId, null, 'a trade has no room behind it');
    assert.strictEqual(sold[0].dedupeKey, mktListing1Id, 'the listing id is the idempotency key -- a listing settles once');
    assert.strictEqual(sold[0].payload.itemId, 'blade', 'the payload names the item sold');
    assert.strictEqual(sold[0].payload.net, 42, 'net is what actually landed in the seller warehouse (qty - burn)');
    assert.strictEqual(sold[0].payload.burn, 4, 'burn is what the furnace took');
    assert.strictEqual(sold[0].payload.tm, 'lrdst', 'the payload carries the price TM');
    // The display name is resolved the SAME way the market card resolves it,
    // so the bell and My Listings never disagree about what was sold.
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const card = mine.body.listings.find((x) => x.id === mktListing1Id);
    assert.strictEqual(sold[0].payload.itemName, card.itemName, 'the entry carries the same itemName the market card shows');
    assert.strictEqual(sold[0].payload.itemNameJa, card.itemNameJa, 'and the same ja name');
    // The BUYER is deliberately NOT notified: they performed the action
    // synchronously and the receipt came back in that very response.
    const buyerFeed = await marketReq('GET', '/api/notifications', mktBuyer.token);
    assert.strictEqual(buyerFeed.body.notifications.filter((n) => n.kind === 'market_settled').length, 0, 'the buyer is not notified of their own purchase');
  });

  await AT('REQ-0374: GET /api/market/dex/:itemId -- the settled anchor + an on-hearth count that AGREES with the default browse; unknown id is an empty 200, not a 404; GET-only', async () => {
    // Runs after the blade settle above, so 'blade' has exactly one engraving
    // (qty 46) in the same rolling history a listing DTO exposes.
    const dex = await marketReq('GET', '/api/market/dex/blade', mktBuyer.token);
    assert.strictEqual(dex.status, 200, JSON.stringify(dex.body));
    assert.strictEqual(dex.body.dtoVersion, market.MARKET_DTO_VERSION);
    assert.strictEqual(dex.body.dex.itemId, 'blade');

    // The anchor is the HEAD of the history the market engraves at settlement
    // -- asserted against storage, so the route cannot drift into computing
    // "the anchor" some second way.
    const hist = scheduleStorage.readMarketDexHistory('blade');
    assert.strictEqual(dex.body.dex.anchor.qty, hist.entries[0].qty, 'anchor qty is the newest engraving');
    assert.strictEqual(dex.body.dex.anchor.qty, 46);
    assert.strictEqual(dex.body.dex.anchor.tm, 'lrdst');
    assert.strictEqual(dex.body.dex.anchor.t, hist.entries[0].t);
    assert.strictEqual(typeof dex.body.dex.anchor.listingId, 'undefined', 'the wire anchor is the DTO history shape (qty/tm/t), not the stored row');

    // THE INVARIANT THAT MATTERS: activeCount is exactly what the default
    // browse shows for this item. Derived FROM the browse rather than
    // hardcoded, so it holds whatever else this shared suite has listed by
    // now -- and so a future change that makes one of the two treat
    // suspended/expired listings differently fails HERE, instead of shipping
    // a dex block whose number the page it links to contradicts.
    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    const browseBlades = browse.body.listings.filter((l) => l.itemId === 'blade').length;
    assert.ok(browseBlades > 0, 'fixture sanity: blade listings are live at this point');
    assert.strictEqual(dex.body.dex.activeCount, browseBlades, 'the dex count IS the browse count for that item');

    // An item that has never traded and is not listed: an empty answer, 200.
    // Not a 404 -- whether a content id exists is /api/content's question, and
    // 404ing here would make "never traded" indistinguishable from a typo.
    const cold = await marketReq('GET', '/api/market/dex/no_such_item_id', mktBuyer.token);
    assert.strictEqual(cold.status, 200, JSON.stringify(cold.body));
    assert.deepStrictEqual(cold.body.dex, { itemId: 'no_such_item_id', anchor: null, activeCount: 0 });

    // Read-only surface: anything but GET is the family's 405.
    const post = await marketReq('POST', '/api/market/dex/blade', mktBuyer.token, {});
    assert.strictEqual(post.status, 405, JSON.stringify(post.body));
  });

  await AT('REQ-0374: a SUSPENDED listing still counts on the dex block -- it is browsable (unbuyable), so the count never disagrees with the browse it links to', async () => {
    // Directed, and REVERSIBLE by construction: reference the already-listed
    // mkt_susp onto the seller's active board (the exact technique the
    // suspension test above uses), so nothing is created and nothing is left
    // behind for the downstream groups.
    const before = await marketReq('GET', '/api/market/dex/blade', mktBuyer.token);
    const doc = scheduleStorage.readProfile(mktSeller.playerId);
    doc.canvas.pos.push({ uid: 'mkt_susp', id: 'blade', cell: [5, 5], rot: 0 });
    scheduleStorage.writeProfile(mktSeller.playerId, doc.canvas);

    let suspListingId = null;
    try {
      const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
      const susp = browse.body.listings.filter((l) => l.itemId === 'blade' && l.state === 'suspended');
      assert.strictEqual(susp.length, 1, 'fixture sanity: exactly one blade listing is suspended right now');
      suspListingId = susp[0].id;
      const during = await marketReq('GET', '/api/market/dex/blade', mktBuyer.token);
      assert.strictEqual(during.body.dex.activeCount, before.body.dex.activeCount, 'suspension does not remove a listing from the dex count');
      assert.strictEqual(during.body.dex.activeCount, browse.body.listings.filter((l) => l.itemId === 'blade').length, 'and the count still equals the browse count');
    } finally {
      // The un-reference runs even on a failed assertion: a leaked board
      // reference would suspend this listing for every LATER group too, and a
      // cross-test leak of exactly that shape is what REQ-0159 spent a whole
      // pass cleaning out of this suite.
      const doc2 = scheduleStorage.readProfile(mktSeller.playerId);
      doc2.canvas.pos = doc2.canvas.pos.filter((pp) => pp.uid !== 'mkt_susp');
      scheduleStorage.writeProfile(mktSeller.playerId, doc2.canvas);
    }
    const after = await marketReq('GET', '/api/market/dex/blade', mktBuyer.token);
    assert.strictEqual(after.body.dex.activeCount, before.body.dex.activeCount, 'and the reversal leaves the count where it was');
    assert.strictEqual(scheduleStorage.readMarketListing(suspListingId).state, 'active', 'stored state never flipped -- downstream groups see what they expect');
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
    assert.deepStrictEqual(res.body.furnace, { totals: [{ tm: 'lrdst', total: 7, count: 3 }], since: null });
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

  await AT('market: unit (BP) listing -- EMPTY-only (not_empty 409 when a PO sits in the footprint), settle strips the BP + delivers a kind:bp row with the verbatim payload; claim validates unit.id (REQ-0195d)', async () => {
    const uSeller = playersFixture.createPlayer('MarketUnitSeller', []);
    const uBuyer = playersFixture.createPlayer('MarketUnitBuyer', []);
    const emptyBp = { id: 'u_bp_empty', name: 'BP1', color: '#888', shape: [[0, 0], [0, 1]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30, cellCount: 2, bonuses: [] };
    const fullBp = { id: 'u_bp_full', name: 'BP2', color: '#888', shape: [[0, 0], [0, 1]], origin: [4, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30, cellCount: 2 };
    const p0 = { bps: [emptyBp, fullBp], pos: [{ uid: 'u_nested_po', id: 'blade', cell: [4, 1], rot: 0 }], sis: [], tms: [] };
    scheduleStorage.writeProfile(uSeller.playerId, mkCanvas([p0, invPage(), invPage(), invPage(), invPage()], [null, null, null, null, null]));
    scheduleStorage.writeProfile(uBuyer.playerId, mkCanvas(
      [invPage([], [{ uid: 'u_b_tm', id: 'lrdst', qty: 100, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
      [null, null, null, null, null]
    ));
    // not_empty: a PO sits on fullBp's footprint [4,1] -> 409.
    const notEmpty = await marketReq('POST', '/api/market/listings', uSeller.token, { kind: 'unit', itemUid: 'u_bp_full', price: { tm: 'lrdst', qty: 20 } });
    assert.strictEqual(notEmpty.status, 409, JSON.stringify(notEmpty.body));
    assert.strictEqual(notEmpty.body.reason, 'not_empty');
    // The empty BP lists fine (kind:unit, itemId = the unit content id).
    const created = await marketReq('POST', '/api/market/listings', uSeller.token, { kind: 'unit', itemUid: 'u_bp_empty', price: { tm: 'lrdst', qty: 20 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    assert.strictEqual(created.body.listing.kind, 'unit');
    assert.strictEqual(created.body.listing.itemId, 'test_loner');
    assert.strictEqual(created.body.listing.itemUid, 'u_bp_empty');
    const uId = created.body.listing.id;
    // Settle: buyer gets a kind:bp row with the verbatim payload; seller loses the BP.
    const buy = await marketReq('POST', '/api/market/listings/' + uId + '/buy', uBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    const afterU = scheduleStorage.readProfile(uSeller.playerId).canvas;
    assert.ok(!afterU.inv.pages[0].bps.some((b) => b.id === 'u_bp_empty'), 'sold BP stripped');
    assert.ok(afterU.inv.pages[0].bps.some((b) => b.id === 'u_bp_full'), 'the other BP stays');
    const row = schedule.listWarehouse(uBuyer.playerId).find((w) => w.sourceListingId === uId);
    assert.ok(row, 'buyer got a delivery row');
    assert.strictEqual(row.kind, 'bp');
    assert.strictEqual(row.itemId, 'test_loner');
    assert.ok(row.bp, 'the row carries the bp payload');
    assert.deepStrictEqual(row.bp.shape, [[0, 0], [0, 1]], 'payload shape verbatim');
    assert.strictEqual(row.bp.unit.id, 'test_loner', 'payload unit verbatim');
    assert.strictEqual(row.bp.hpMax, 30, 'payload hpMax verbatim');
    // Claim validates unit.id against unitDefsById and returns the payload.
    const claim = await marketReq('POST', '/api/warehouse/claim', uBuyer.token, { itemUid: row.itemUid });
    assert.strictEqual(claim.status, 200, JSON.stringify(claim.body));
    assert.strictEqual(claim.body.kind, 'bp');
    assert.ok(claim.body.bp, 'claim returns the payload');
    assert.strictEqual(claim.body.bp.unit.id, 'test_loner');
  });

  await AT('market: si listing -- create/settle delivers a plain SI row (q copied, no kind); PO-sale re-homes socketed SIs to host:inv (REQ-0195c)', async () => {
    const siSeller = playersFixture.createPlayer('MarketSiSeller', []);
    const siBuyer = playersFixture.createPlayer('MarketSiBuyer', []);
    const p0 = { bps: [], pos: [{ uid: 'si_po_host', id: 'blade', cell: [1, 1], rot: 0 }], sis: [
      { uid: 'si_loose', id: 'acc_gem', host: 'inv', q: 0.42 },
      { uid: 'si_seated', id: 'fx_ring', host: { po: 'si_po_host', si: 0 }, q: 0.77 },
    ], tms: [] };
    scheduleStorage.writeProfile(siSeller.playerId, mkCanvas([p0, invPage(), invPage(), invPage(), invPage()], [null, null, null, null, null]));
    scheduleStorage.writeProfile(siBuyer.playerId, mkCanvas(
      [invPage([], [{ uid: 'si_b_tm', id: 'lrdst', qty: 100, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
      [null, null, null, null, null]
    ));
    // Create an SI listing for the loose gem.
    const created = await marketReq('POST', '/api/market/listings', siSeller.token, { kind: 'si', itemUid: 'si_loose', price: { tm: 'lrdst', qty: 10 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    assert.strictEqual(created.body.listing.kind, 'si');
    assert.strictEqual(created.body.listing.itemId, 'acc_gem');
    assert.strictEqual(created.body.listing.itemUid, 'si_loose');
    const siListingId = created.body.listing.id;
    const browse = await marketReq('GET', '/api/market/listings', siBuyer.token);
    assert.ok(browse.body.listings.some((x) => x.id === siListingId && x.kind === 'si'), 'si listing browsable');
    // Settle: seller loses the SI; buyer gets a PLAIN row (q copied, no kind).
    const buy = await marketReq('POST', '/api/market/listings/' + siListingId + '/buy', siBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    const afterSi = scheduleStorage.readProfile(siSeller.playerId).canvas;
    assert.ok(!afterSi.inv.pages[0].sis.some((a) => a.uid === 'si_loose'), 'sold SI stripped from inventory');
    const row = schedule.listWarehouse(siBuyer.playerId).find((w) => w.sourceListingId === siListingId);
    assert.ok(row, 'buyer got a delivery row');
    assert.strictEqual(row.itemId, 'acc_gem');
    assert.strictEqual(row.kind, undefined, 'plain SI row (claim validates via siDefsById), not a tm row');
    assert.strictEqual(row.q, 0.42, 'the SI instance q travels, never re-rolled');
    // Sell the PO host -> the seated SI (fx_ring) re-homes to host:inv.
    const poCreate = await marketReq('POST', '/api/market/listings', siSeller.token, { kind: 'po', itemUid: 'si_po_host', price: { tm: 'lrdst', qty: 8 } });
    assert.strictEqual(poCreate.status, 200, JSON.stringify(poCreate.body));
    const poBuy = await marketReq('POST', '/api/market/listings/' + poCreate.body.listing.id + '/buy', siBuyer.token);
    assert.strictEqual(poBuy.status, 200, JSON.stringify(poBuy.body));
    const afterPo = scheduleStorage.readProfile(siSeller.playerId).canvas;
    assert.ok(!afterPo.inv.pages[0].pos.some((p) => p.uid === 'si_po_host'), 'sold PO stripped');
    const seated = afterPo.inv.pages[0].sis.find((a) => a.uid === 'si_seated');
    assert.ok(seated, 'the seated SI survives (it was not sold)');
    assert.strictEqual(seated.host, 'inv', 'the seated SI re-homed to inv -- no orphaned host ref');
  });

  await AT('market: tm listing (currency-for-currency) -- same_tm 400, tmQty/itemId validation, derived suspension on low balance, settle debits+delivers a kind:tm row, insufficient-stock 409', async () => {
    const tmSeller = playersFixture.createPlayer('MarketTmSeller', []);
    const tmBuyer = playersFixture.createPlayer('MarketTmBuyer', []);
    scheduleStorage.writeProfile(tmSeller.playerId, mkCanvas(
      [invPage([], [{ uid: 'gilt_s1', id: 'gilt', qty: 50, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
      [null, null, null, null, null]
    ));
    scheduleStorage.writeProfile(tmBuyer.playerId, mkCanvas(
      [invPage([], [{ uid: 'lrdst_b1', id: 'lrdst', qty: 100, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
      [null, null, null, null, null]
    ));
    // same_tm: pricing a TM in itself -> 400 {reason:'same_tm'}.
    const sameTm = await marketReq('POST', '/api/market/listings', tmSeller.token, { kind: 'tm', itemId: 'lrdst', tmQty: 5, price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(sameTm.status, 400, JSON.stringify(sameTm.body));
    assert.strictEqual(sameTm.body.reason, 'same_tm');
    // tmQty out of [1,999] and a non-TM itemId -> 400.
    for (const badQty of [0, 1000, 2.5]) {
      const bad = await marketReq('POST', '/api/market/listings', tmSeller.token, { kind: 'tm', itemId: 'gilt', tmQty: badQty, price: { tm: 'lrdst', qty: 5 } });
      assert.strictEqual(bad.status, 400, 'tmQty ' + badQty + ' -> 400: ' + JSON.stringify(bad.body));
    }
    const badItem = await marketReq('POST', '/api/market/listings', tmSeller.token, { kind: 'tm', itemId: 'blade', tmQty: 5, price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(badItem.status, 400, 'itemId must be a live TM: ' + JSON.stringify(badItem.body));
    // Create: sell 10 gilt priced in 20 lrdst.
    const created = await marketReq('POST', '/api/market/listings', tmSeller.token, { kind: 'tm', itemId: 'gilt', tmQty: 10, price: { tm: 'lrdst', qty: 20 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const l = created.body.listing;
    assert.strictEqual(l.kind, 'tm');
    assert.strictEqual(l.itemUid, null, 'tm listings carry a null itemUid');
    assert.strictEqual(l.tmQty, 10);
    assert.deepStrictEqual(l.price, { tm: 'lrdst', qty: 20 });
    assert.strictEqual(l.burn, 2, '20 -> burn 2');
    assert.strictEqual(l.state, 'active', 'seller holds 50 gilt >= 10');
    const tmListingId = l.id;
    // A second listing for 100 gilt (> 50 balance) derives SUSPENDED.
    const suspCreate = await marketReq('POST', '/api/market/listings', tmSeller.token, { kind: 'tm', itemId: 'gilt', tmQty: 100, price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(suspCreate.status, 200, JSON.stringify(suspCreate.body));
    const suspId = suspCreate.body.listing.id;
    const browseSusp = await marketReq('GET', '/api/market/listings', tmBuyer.token);
    const suspRow = browseSusp.body.listings.find((x) => x.id === suspId);
    assert.ok(suspRow, 'suspended tm listing stays browsable');
    assert.strictEqual(suspRow.state, 'suspended');
    assert.strictEqual(suspRow.suspended, true);
    assert.strictEqual(suspRow.tmQty, 100);
    // Buying the suspended (insufficient-stock) one -> 409 suspended.
    const buySusp = await marketReq('POST', '/api/market/listings/' + suspId + '/buy', tmBuyer.token);
    assert.strictEqual(buySusp.status, 409);
    assert.strictEqual(buySusp.body.reason, 'suspended');
    // Settle the valid one: buyer pays 20 lrdst (burn 2 -> seller 18),
    // buyer receives a kind:tm gilt row qty 10, seller loses 10 gilt.
    const buy = await marketReq('POST', '/api/market/listings/' + tmListingId + '/buy', tmBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    assert.strictEqual(buy.body.listing.state, 'settled');
    assert.deepStrictEqual({ burn: buy.body.receipt.burn, get: buy.body.receipt.sellerReceives }, { burn: 2, get: 18 });
    assert.strictEqual(mktBalance(tmBuyer.playerId), 80, 'buyer paid 20 lrdst');
    assert.strictEqual(market.readTmBalance(scheduleStorage.readProfile(tmSeller.playerId).canvas, 'gilt'), 40, 'seller lost 10 gilt');
    const delivered = schedule.listWarehouse(tmBuyer.playerId).find((w) => w.sourceListingId === tmListingId);
    assert.ok(delivered, 'buyer got a delivery row');
    assert.strictEqual(delivered.kind, 'tm');
    assert.strictEqual(delivered.itemId, 'gilt');
    assert.strictEqual(delivered.qty, 10);
    const proceeds = schedule.listWarehouse(tmSeller.playerId).find((w) => w.sourceListingId === tmListingId);
    assert.strictEqual(proceeds.kind, 'tm');
    assert.strictEqual(proceeds.itemId, 'lrdst');
    assert.strictEqual(proceeds.qty, 18);
  });

  await AT('market: rollPct DTO derivation -- po/si carry the live instance q, unit carries bp.roll?.pct else null (unmeasured), tm null; a settled listing freezes the value (REQ-0195e)', async () => {
    const rSeller = playersFixture.createPlayer('MarketRollSeller', []);
    const rBuyer = playersFixture.createPlayer('MarketRollBuyer', []);
    const bpMeasured = { id: 'r_bp_measured', name: 'BPm', color: '#888', shape: [[0, 0]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30, cellCount: 1, roll: { pct: 0.7 } };
    const bpUnmeasured = { id: 'r_bp_unmeasured', name: 'BPu', color: '#888', shape: [[0, 0]], origin: [3, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30, cellCount: 1 };
    const p0 = {
      bps: [bpMeasured, bpUnmeasured],
      pos: [{ uid: 'r_po', id: 'blade', cell: [5, 1], rot: 0, q: 0.42 }],
      sis: [{ uid: 'r_si', id: 'acc_gem', host: 'inv', q: 0.61 }],
      tms: [{ uid: 'r_tm', id: 'lrdst', qty: 50, cell: [8, 1] }],
    };
    scheduleStorage.writeProfile(rSeller.playerId, mkCanvas([p0, invPage(), invPage(), invPage(), invPage()], [null, null, null, null, null]));
    scheduleStorage.writeProfile(rBuyer.playerId, mkCanvas(
      [invPage([], [{ uid: 'r_b_tm', id: 'lrdst', qty: 100, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
      [null, null, null, null, null]
    ));
    // po/si -> the live instance q (REQ-0063).
    const poL = await marketReq('POST', '/api/market/listings', rSeller.token, { kind: 'po', itemUid: 'r_po', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(poL.status, 200, JSON.stringify(poL.body));
    assert.strictEqual(poL.body.listing.rollPct, 0.42, 'po rollPct = the instance q');
    const siL = await marketReq('POST', '/api/market/listings', rSeller.token, { kind: 'si', itemUid: 'r_si', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(siL.status, 200, JSON.stringify(siL.body));
    assert.strictEqual(siL.body.listing.rollPct, 0.61, 'si rollPct = the instance q');
    // unit -> bp.roll?.pct (REQ-0196 container) else null (unmeasured).
    const uMeas = await marketReq('POST', '/api/market/listings', rSeller.token, { kind: 'unit', itemUid: 'r_bp_measured', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(uMeas.status, 200, JSON.stringify(uMeas.body));
    assert.strictEqual(uMeas.body.listing.rollPct, 0.7, 'unit rollPct = bp.roll.pct');
    const uUnmeas = await marketReq('POST', '/api/market/listings', rSeller.token, { kind: 'unit', itemUid: 'r_bp_unmeasured', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(uUnmeas.status, 200, JSON.stringify(uUnmeas.body));
    assert.strictEqual(uUnmeas.body.listing.rollPct, null, 'unit without a roll container -> null (unmeasured, never a 0% bar)');
    // tm -> always null.
    const tmL = await marketReq('POST', '/api/market/listings', rSeller.token, { kind: 'tm', itemId: 'lrdst', tmQty: 5, price: { tm: 'gilt', qty: 5 } });
    assert.strictEqual(tmL.status, 200, JSON.stringify(tmL.body));
    assert.strictEqual(tmL.body.listing.rollPct, null, 'tm rollPct is always null');
    // A DIFFERENT caller browsing derives the same live values.
    const browse = await marketReq('GET', '/api/market/listings', rBuyer.token);
    assert.strictEqual(browse.body.listings.find((x) => x.itemUid === 'r_po').rollPct, 0.42, 'browse DTO derives po rollPct too');
    // Settle the po; the seller mine view keeps the FROZEN rollPct even
    // after the instance has left their canvas (MinePane honesty).
    const buy = await marketReq('POST', '/api/market/listings/' + poL.body.listing.id + '/buy', rBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    const afterSeller = scheduleStorage.readProfile(rSeller.playerId).canvas;
    assert.ok(!afterSeller.inv.pages[0].pos.some((p) => p.uid === 'r_po'), 'sold po stripped from the seller');
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', rSeller.token);
    const settledRow = mine.body.listings.find((x) => x.id === poL.body.listing.id);
    assert.strictEqual(settledRow.state, 'settled');
    assert.strictEqual(settledRow.rollPct, 0.42, 'settled listing keeps rollPct FROZEN at settle time');
  });


  await AT('market: kind field defaults to po on create + legacy listings normalize to po; envelope carries tms[] (live TM registry); non-registry price.tm 400s', async () => {
    const kSeller = playersFixture.createPlayer('MarketKindSeller', []);
    scheduleStorage.writeProfile(kSeller.playerId, mkCanvas(
      [invPage([{ uid: 'mkt_kind_1', id: 'blade', cell: [1, 1], rot: 0 }]), invPage(), invPage(), invPage(), invPage()],
      [null, null, null, null, null]
    ));
    const created = await marketReq('POST', '/api/market/listings', kSeller.token, { itemUid: 'mkt_kind_1', price: { tm: 'lrdst', qty: 10 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    assert.strictEqual(created.body.dtoVersion, 2);
    assert.strictEqual(created.body.listing.kind, 'po', 'a created PO listing carries kind:po');
    const id = created.body.listing.id;
    // Legacy doc lacking `kind` -> normalizes to po at read (they can only be POs).
    const raw = scheduleStorage.readMarketListing(id);
    delete raw.kind;
    scheduleStorage.writeMarketListing(id, raw);
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', kSeller.token);
    assert.strictEqual(mine.body.listings.find((x) => x.id === id).kind, 'po', 'legacy listing (no kind) reads as po');
    // Envelope: tms[] is the live TM registry; the scalar tm is gone.
    const browse = await marketReq('GET', '/api/market/listings', kSeller.token);
    assert.deepStrictEqual([...browse.body.tms].sort(), ['gilt', 'lrdst'], 'envelope carries the live TM registry ids');
    assert.strictEqual(browse.body.tm, undefined, 'the scalar tm envelope field is gone at dtoVersion 2');
    // price.tm must be a live registry id.
    const badTm = await marketReq('POST', '/api/market/listings', kSeller.token, { itemUid: 'mkt_kind_1', price: { tm: 'not_a_tm', qty: 5 } });
    assert.strictEqual(badTm.status, 400, 'price.tm must be a live TM registry id: ' + JSON.stringify(badTm.body));
    // Unsupported kind (phase a lists POs only) 400s.
    const badKind = await marketReq('POST', '/api/market/listings', kSeller.token, { kind: 'tm', itemUid: 'mkt_kind_1', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(badKind.status, 400, 'unsupported kind 400s in phase a: ' + JSON.stringify(badKind.body));
  });

  await AT('market: browse resolves defs per kind -- name query matches si/unit listings; filter=unit/tm select by listing KIND (review fix F1)', async () => {
    const c = schedule.getScheduleContent();
    const siName = c.siDefsById.acc_gem.name;        // 'Gem'
    const unitName = c.unitDefsById.test_loner.name;  // 'Test Loner'
    const f1Seller = playersFixture.createPlayer('MarketF1Seller', []);
    const f1Bp = { id: 'f1_bp', name: 'F1 BP', color: '#888', shape: [[0, 0]], origin: [1, 1], unit: { id: 'test_loner', off: [0, 0] }, hpMax: 30, cellCount: 1 };
    const p0 = {
      bps: [f1Bp],
      pos: [{ uid: 'f1_po', id: 'blade', cell: [3, 1], rot: 0 }],
      sis: [{ uid: 'f1_si', id: 'acc_gem', host: 'inv', q: 0.5 }],
      tms: [{ uid: 'f1_tm', id: 'gilt', qty: 50, cell: [8, 1] }],
    };
    scheduleStorage.writeProfile(f1Seller.playerId, mkCanvas([p0, invPage(), invPage(), invPage(), invPage()], [null, null, null, null, null]));

    // One live listing of each kind (all stay active -- the seller holds
    // enough gilt so the tm listing is not suspended).
    const poL = await marketReq('POST', '/api/market/listings', f1Seller.token, { kind: 'po', itemUid: 'f1_po', price: { tm: 'lrdst', qty: 7 } });
    assert.strictEqual(poL.status, 200, JSON.stringify(poL.body));
    const siL = await marketReq('POST', '/api/market/listings', f1Seller.token, { kind: 'si', itemUid: 'f1_si', price: { tm: 'lrdst', qty: 7 } });
    assert.strictEqual(siL.status, 200, JSON.stringify(siL.body));
    const uL = await marketReq('POST', '/api/market/listings', f1Seller.token, { kind: 'unit', itemUid: 'f1_bp', price: { tm: 'lrdst', qty: 7 } });
    assert.strictEqual(uL.status, 200, JSON.stringify(uL.body));
    const tmL = await marketReq('POST', '/api/market/listings', f1Seller.token, { kind: 'tm', itemId: 'gilt', tmQty: 5, price: { tm: 'lrdst', qty: 7 } });
    assert.strictEqual(tmL.status, 200, JSON.stringify(tmL.body));

    // (F1) a NAME query now resolves the def per kind -> an si listing
    // matches by its OWN def name (matchesQuery was blind to it before).
    const bySi = await marketReq('GET', '/api/market/listings?q=' + encodeURIComponent(siName), mktBuyer.token);
    assert.strictEqual(bySi.status, 200, JSON.stringify(bySi.body));
    assert.ok(bySi.body.listings.some((x) => x.id === siL.body.listing.id), 'si listing matches by name (was blind pre-fix)');
    const needleSi = siName.toLowerCase();
    assert.ok(bySi.body.listings.every((x) => x.itemName.toLowerCase().includes(needleSi) || (x.itemNameJa || '').toLowerCase().includes(needleSi)), 'name query still returns only name-matching listings');

    // (F1) a unit listing matches by its unit def name too.
    const byUnit = await marketReq('GET', '/api/market/listings?q=' + encodeURIComponent(unitName), mktBuyer.token);
    assert.ok(byUnit.body.listings.some((x) => x.id === uL.body.listing.id), 'unit listing matches by its unit def name');

    // (F1) filter by listing KIND: unit returns only unit-kind listings.
    const fUnit = await marketReq('GET', '/api/market/listings?filter=unit', mktBuyer.token);
    assert.ok(fUnit.body.listings.length >= 1 && fUnit.body.listings.every((x) => x.kind === 'unit'), 'filter=unit -> only unit listings');
    assert.ok(fUnit.body.listings.some((x) => x.id === uL.body.listing.id), 'the unit listing is among filter=unit results');

    // (F1) filter=tm returns only tm-kind listings (token is case-insensitive).
    const fTm = await marketReq('GET', '/api/market/listings?filter=TM', mktBuyer.token);
    assert.ok(fTm.body.listings.length >= 1 && fTm.body.listings.every((x) => x.kind === 'tm'), 'filter=TM (case-insensitive) -> only tm listings');
    assert.ok(fTm.body.listings.some((x) => x.id === tmL.body.listing.id), 'the tm listing is among filter=tm results');

    // (F1) existing tag behavior intact: the weapon tag chip still hits
    // POs (and only po defs carry tags), and filter=po selects only POs.
    const fWeapon = await marketReq('GET', '/api/market/listings?filter=weapon', mktBuyer.token);
    assert.ok(fWeapon.body.listings.some((x) => x.id === poL.body.listing.id), 'blade (Weapon) still matches the weapon tag chip');
    assert.ok(fWeapon.body.listings.every((x) => (x.kind || 'po') === 'po'), 'the weapon tag chip only ever hits po defs');
    const fPo = await marketReq('GET', '/api/market/listings?filter=po', mktBuyer.token);
    assert.ok(fPo.body.listings.length >= 1 && fPo.body.listings.every((x) => (x.kind || 'po') === 'po'), 'filter=po -> only po listings');
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



  // ------------------------------------------------------------------
  // REQ-0199: a JWT-only caller lists from THEIR OWN canvas (the fix).
  // A Supabase-JWT-authenticated player (Authorization: Bearer <jwt>, NO
  // X-Auth-Token) must resolve to their OWN identity -- never the
  // dev_mode no-token fallback. Before REQ-0199 this route called the
  // X-Auth-Token-ONLY resolver, so getAuthToken(req) was null -> the dev
  // fallback -> createListing read the DEV player's canvas -> the real
  // seller's item was "not found in your inventory" -> 404 (the exact
  // live defect). We forge a verifiable Supabase JWT exactly the way
  // server/tests/auth_jwt_test.cjs does (a TEST secret set ONLY for the
  // duration of this test, restored in finally -- never the real one),
  // seed the stowed item into ONLY the JWT player's canvas, and prove the
  // listing is created AS THAT PLAYER. The dev player has no such uid, so
  // a dev-fallback resolution would reproduce the 404.
  // ------------------------------------------------------------------
  await AT('market: REQ-0199 -- a JWT-only caller (Bearer, no X-Auth-Token) lists from THEIR OWN canvas, never the dev fallback', async () => {
    const supabaseAuth = require('../../lib/supabase_auth.cjs');
    const savedSecret = process.env.SUPABASE_JWT_SECRET;
    process.env.SUPABASE_JWT_SECRET = 'req0199-test-jwt-secret-not-the-real-one';
    try {
      const now = Math.floor(Date.now() / 1000);
      const jwt = supabaseAuth.signHs256(
        { sub: 'req0199-jwt-seller', aud: 'authenticated', exp: now + 3600, iat: now,
          user_metadata: { full_name: 'JwtSeller' } },
        process.env.SUPABASE_JWT_SECRET);
      const bearer = { authorization: 'Bearer ' + jwt };

      // Provision the JWT player through the SAME resolver the route uses
      // (auto-provisioned on first sight) so we know its id BEFORE seeding.
      const prov = admin.resolveAuthFromRequest({ headers: bearer });
      assert.strictEqual(prov.ok, true, 'JWT resolves: ' + JSON.stringify(prov));
      const jwtPlayer = prov.player;
      assert.notStrictEqual(jwtPlayer.playerId, devPlayer.playerId, 'the JWT player is NOT the dev player');

      // Seed a single STOWED (listable) inventory PO into ONLY this
      // player's canvas -- the dev player's canvas has no such uid, so a
      // dev-fallback resolution would 404 (reproducing the live defect).
      scheduleStorage.writeProfile(jwtPlayer.playerId, mkCanvas(
        [invPage([{ uid: 'jwt_sell_1', id: 'blade', cell: [1, 1], rot: 0 }]),
         invPage(), invPage(), invPage(), invPage()],
        [null, null, null, null, null]));

      // POST with the Bearer JWT and NO X-Auth-Token (token arg = null).
      const created = await marketReq('POST', '/api/market/listings', null,
        { itemUid: 'jwt_sell_1', price: { tm: 'lrdst', qty: 10 } }, bearer);
      assert.strictEqual(created.status, 200, 'JWT-only create succeeds (not a dev-fallback 404): ' + JSON.stringify(created.body));
      assert.strictEqual(created.body.ok, true);
      assert.strictEqual(created.body.listing.itemId, 'blade');
      assert.strictEqual(created.body.listing.sellerName, 'JwtSeller', 'the listing belongs to the JWT player, not dev');

      // White-box: the persisted record's sellerId is the JWT player's id.
      const rec = scheduleStorage.listMarketListings().find((x) => x.id === created.body.listing.id);
      assert.ok(rec, 'listing persisted');
      assert.strictEqual(rec.sellerId, jwtPlayer.playerId, 'seller id is the JWT player');
      assert.notStrictEqual(rec.sellerId, devPlayer.playerId, 'seller id is NOT the dev fallback');
      // The item stays in the JWT player's OWN canvas (free listing, not
      // escrowed) -- proving the route read THAT canvas, not dev's.
      const jwtDoc = scheduleStorage.readProfile(jwtPlayer.playerId);
      assert.ok(market.findInventoryPO(jwtDoc.canvas, 'jwt_sell_1'), 'item stays in the JWT player inventory while listed');

      // Withdraw (owner-only, free) with the SAME Bearer to leave the
      // shared market exactly as this test found it (later suites' browse
      // assertions count active/suspended listings market-wide).
      const wd = await marketReq('POST', '/api/market/listings/' + created.body.listing.id + '/withdraw', null, undefined, bearer);
      assert.strictEqual(wd.status, 200, 'the JWT owner can withdraw its own listing: ' + JSON.stringify(wd.body));
    } finally {
      if (savedSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = savedSecret;
    }
  });

  // ==================================================================
  // REQ-0328: DIRECT warehouse -> market sell (POST /api/market/listings/
  // from-warehouse). A claimable warehouse row (an unclaimed drop) becomes
  // an active listing WITHOUT ever occupying a cell in the seller's canvas
  // -- the item is escrowed on the listing; withdraw/expiry returns it to
  // the warehouse, settlement delivers it to the buyer's warehouse.
  // ==================================================================
  function seedWhRow(playerId, itemUid, extra) {
    const doc = Object.assign({
      itemUid, playerId, itemId: 'blade',
      harvestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + schedule.WAREHOUSE_TTL_MS).toISOString(),
    }, extra || {});
    schedule.addToWarehouse(playerId, doc);
    return itemUid;
  }

  await AT('market REQ-0328: from-warehouse -- a claimable row becomes an active listing; row consumed; NO canvas/inventory mutation', async () => {
    const whId = seedWhRow(mktSeller.playerId, 'wh_fw_ok_' + Date.now(), { itemId: 'blade', q: 0.5 });
    const canvasBefore = JSON.parse(JSON.stringify(scheduleStorage.readProfile(mktSeller.playerId).canvas));
    const res = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 20 } });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.replayed, false);
    const l = res.body.listing;
    assert.strictEqual(l.state, 'active');
    assert.strictEqual(l.suspended, false);
    assert.strictEqual(l.kind, 'po');
    assert.strictEqual(l.itemId, 'blade');
    assert.deepStrictEqual(l.price, { tm: 'lrdst', qty: 20 });
    assert.strictEqual(l.burn, 2, 'ceil(20*0.08)=2');
    assert.strictEqual(l.rollPct, 0.5, 'the escrowed instance quality travels on the listing');
    const raw = scheduleStorage.readMarketListing(l.id);
    assert.strictEqual(raw.source, 'warehouse', 'provenance is the warehouse row, not a canvas cell');
    assert.strictEqual(raw.itemUid, whId, 'the consumed row uid is kept on the listing');
    assert.strictEqual(raw.q, 0.5);
    assert.strictEqual(scheduleStorage.readWarehouseItem(mktSeller.playerId, whId), null, 'the warehouse row is consumed (gone)');
    const canvasAfter = scheduleStorage.readProfile(mktSeller.playerId).canvas;
    assert.deepStrictEqual(canvasAfter, canvasBefore, 'seller canvas is byte-identical -- no cell occupied, no inventory used');
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    assert.ok(mine.body.listings.some((x) => x.id === l.id && x.state === 'active'), 'listing shows under My Listings');
    const browse = await marketReq('GET', '/api/market/listings', mktBuyer.token);
    assert.ok(browse.body.listings.some((x) => x.id === l.id), 'warehouse-sourced listing is browsable market-wide');
    // leave the shared market clean (withdraw returns the escrow -> sweep it)
    await marketReq('POST', '/api/market/listings/' + l.id + '/withdraw', mktSeller.token);
    const wRaw = scheduleStorage.readMarketListing(l.id);
    if (wRaw && wRaw.returnedWhUid) scheduleStorage.deleteWarehouseItem(mktSeller.playerId, wRaw.returnedWhUid);
  });

  await AT('market REQ-0328: from-warehouse validation -- unknown/foreign row 404 (no-leak), bad price 400, tm row 400 unsellable_kind, claiming row 409; a rejected attempt never consumes the row', async () => {
    const noSuch = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: 'no_such_wh', price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(noSuch.status, 404, JSON.stringify(noSuch.body));
    const whId = seedWhRow(mktSeller.playerId, 'wh_fw_val_' + Date.now());
    // Another player naming the seller's real row id 404s identically (peek
    // only ever reads the caller's OWN warehouse): no-leak.
    const foreign = await marketReq('POST', '/api/market/listings/from-warehouse', mktBuyer.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(foreign.status, 404, 'foreign row must 404 identically: ' + JSON.stringify(foreign.body));
    for (const badPrice of [{ tm: 'lrdst', qty: 0 }, { tm: 'lrdst', qty: 1000 }, { tm: 'lrdst', qty: 4.5 }, { tm: 'gold', qty: 10 }, undefined]) {
      const bad = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: badPrice });
      assert.strictEqual(bad.status, 400, 'bad price ' + JSON.stringify(badPrice) + ' -> 400: ' + JSON.stringify(bad.body));
    }
    assert.ok(scheduleStorage.readWarehouseItem(mktSeller.playerId, whId), 'the row survives every rejected attempt (never lost)');
    // A tm/currency row is not a drop -- rejected without consuming it.
    const tmWhId = 'wh_fw_tm_' + Date.now();
    scheduleStorage.writeWarehouseItem(mktSeller.playerId, tmWhId, { itemUid: tmWhId, playerId: mktSeller.playerId, itemId: 'lrdst', qty: 7, kind: 'tm', harvestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + schedule.WAREHOUSE_TTL_MS).toISOString(), status: 'claimable' });
    const tmRes = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: tmWhId, price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(tmRes.status, 400, JSON.stringify(tmRes.body));
    assert.strictEqual(tmRes.body.reason, 'unsellable_kind');
    assert.ok(scheduleStorage.readWarehouseItem(mktSeller.playerId, tmWhId), 'the tm row is not consumed by the rejection');
    // A row currently being claimed -> 409 claiming.
    const claimingRow = scheduleStorage.readWarehouseItem(mktSeller.playerId, whId);
    claimingRow.status = 'claiming'; claimingRow.claimedAt = new Date().toISOString();
    scheduleStorage.writeWarehouseItem(mktSeller.playerId, whId, claimingRow);
    const claimingRes = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 5 } });
    assert.strictEqual(claimingRes.status, 409, JSON.stringify(claimingRes.body));
    assert.strictEqual(claimingRes.body.reason, 'claiming');
    scheduleStorage.deleteWarehouseItem(mktSeller.playerId, whId);
    scheduleStorage.deleteWarehouseItem(mktSeller.playerId, tmWhId);
  });

  await AT('market REQ-0328: withdraw of a warehouse-sourced listing returns the item to the seller warehouse (never lost)', async () => {
    const whId = seedWhRow(mktSeller.playerId, 'wh_fw_wd_' + Date.now(), { q: 0.3 });
    const created = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 10 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const id = created.body.listing.id;
    assert.strictEqual(scheduleStorage.readWarehouseItem(mktSeller.playerId, whId), null, 'the original row was consumed at listing time');
    const whBefore = schedule.listWarehouse(mktSeller.playerId).length;
    const wd = await marketReq('POST', '/api/market/listings/' + id + '/withdraw', mktSeller.token);
    assert.strictEqual(wd.status, 200, JSON.stringify(wd.body));
    assert.strictEqual(wd.body.listing.state, 'withdrawn');
    const raw = scheduleStorage.readMarketListing(id);
    assert.ok(raw.returnedWhUid, 'the returned warehouse uid is recorded on the listing');
    const returned = scheduleStorage.readWarehouseItem(mktSeller.playerId, raw.returnedWhUid);
    assert.ok(returned, 'item is back in the warehouse');
    assert.strictEqual(returned.itemId, 'blade');
    assert.strictEqual(returned.q, 0.3, 'the escrowed quality is preserved on return');
    assert.strictEqual(returned.status, 'claimable');
    assert.strictEqual(returned.sourceListingId, id, 'provenance points back at the listing');
    assert.strictEqual(schedule.listWarehouse(mktSeller.playerId).length, whBefore + 1, 'exactly one item returned');
    scheduleStorage.deleteWarehouseItem(mktSeller.playerId, raw.returnedWhUid);
  });

  await AT('market REQ-0328: from-warehouse Idempotency-Key replays the same listing without double-consuming', async () => {
    const whId = seedWhRow(mktSeller.playerId, 'wh_fw_idem_' + Date.now());
    const idem = { 'idempotency-key': 'fw-idem-' + Date.now() };
    const c1 = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 15 } }, idem);
    assert.strictEqual(c1.status, 200, JSON.stringify(c1.body));
    assert.strictEqual(c1.body.replayed, false);
    const c2 = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 15 } }, idem);
    assert.strictEqual(c2.status, 200, JSON.stringify(c2.body));
    assert.strictEqual(c2.body.replayed, true, 'a replay returns the original outcome');
    assert.strictEqual(c2.body.listing.id, c1.body.listing.id, 'same listing id on replay');
    const all = scheduleStorage.listMarketListings().filter((x) => x.source === 'warehouse' && x.itemUid === whId);
    assert.strictEqual(all.length, 1, 'no double-listing on replay');
    await marketReq('POST', '/api/market/listings/' + c1.body.listing.id + '/withdraw', mktSeller.token);
    const raw = scheduleStorage.readMarketListing(c1.body.listing.id);
    if (raw && raw.returnedWhUid) scheduleStorage.deleteWarehouseItem(mktSeller.playerId, raw.returnedWhUid);
  });

  await AT('market REQ-0328: buying a warehouse-sourced listing delivers to the buyer warehouse + seller proceeds, with NO seller-canvas mutation', async () => {
    const fwBuyer = playersFixture.createPlayer('MarketFwBuyer', []);
    scheduleStorage.writeProfile(fwBuyer.playerId, mkCanvas(
      [invPage([], [{ uid: 'fwb_tm', id: 'lrdst', qty: 100, cell: [1, 1] }]), invPage(), invPage(), invPage(), invPage()],
      [null, null, null, null, null]));
    const whId = seedWhRow(mktSeller.playerId, 'wh_fw_buy_' + Date.now(), { q: 0.7 });
    const created = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 50 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const id = created.body.listing.id;
    const sellerCanvasBefore = JSON.parse(JSON.stringify(scheduleStorage.readProfile(mktSeller.playerId).canvas));
    const buyerBalBefore = mktBalance(fwBuyer.playerId);
    const buy = await marketReq('POST', '/api/market/listings/' + id + '/buy', fwBuyer.token);
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
    assert.strictEqual(buy.body.listing.state, 'settled');
    const burn = market.burnOf(50);
    assert.strictEqual(buy.body.receipt.burn, burn);
    assert.strictEqual(buy.body.receipt.sellerReceives, 50 - burn);
    const delivered = schedule.listWarehouse(fwBuyer.playerId).find((r) => r.sourceListingId === id && r.itemId === 'blade');
    assert.ok(delivered, 'buyer receives the item as a claimable warehouse row');
    assert.strictEqual(delivered.q, 0.7, 'the escrowed quality travels to the buyer');
    assert.strictEqual(delivered.status, 'claimable');
    const proceeds = schedule.listWarehouse(mktSeller.playerId).find((r) => r.kind === 'tm' && r.sourceListingId === id);
    assert.ok(proceeds, 'seller receives proceeds as a tm warehouse row');
    assert.strictEqual(proceeds.qty, 50 - burn);
    const sellerCanvasAfter = scheduleStorage.readProfile(mktSeller.playerId).canvas;
    assert.deepStrictEqual(sellerCanvasAfter, sellerCanvasBefore, 'seller canvas untouched by the settle (the direct path never routes through it)');
    assert.strictEqual(mktBalance(fwBuyer.playerId), buyerBalBefore - 50, 'buyer debited the full price server-side');
    scheduleStorage.deleteWarehouseItem(fwBuyer.playerId, delivered.itemUid);
    scheduleStorage.deleteWarehouseItem(mktSeller.playerId, proceeds.itemUid);
  });

  await AT('market REQ-0328: expiry of a warehouse-sourced listing returns the item to the seller warehouse', async () => {
    const whId = seedWhRow(mktSeller.playerId, 'wh_fw_exp_' + Date.now(), { q: 0.9 });
    const created = await marketReq('POST', '/api/market/listings/from-warehouse', mktSeller.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 8 } });
    assert.strictEqual(created.status, 200, JSON.stringify(created.body));
    const id = created.body.listing.id;
    const raw = scheduleStorage.readMarketListing(id);
    raw.expiresAt = new Date(Date.now() - 1000).toISOString();
    scheduleStorage.writeMarketListing(id, raw);
    const mine = await marketReq('GET', '/api/market/listings?filter=mine', mktSeller.token);
    const seen = mine.body.listings.find((x) => x.id === id);
    assert.strictEqual(seen.state, 'expired', 'lazy TTL expiry persisted on read');
    const after = scheduleStorage.readMarketListing(id);
    assert.ok(after.returnedWhUid, 'expiry returned the escrow to the warehouse');
    const returned = scheduleStorage.readWarehouseItem(mktSeller.playerId, after.returnedWhUid);
    assert.ok(returned && returned.itemId === 'blade' && returned.q === 0.9, 'the item is back with its quality preserved');
    scheduleStorage.deleteWarehouseItem(mktSeller.playerId, after.returnedWhUid);
  });

  // REQ-0145a (sf): publish this group's shared fixtures for the later suites.
  Object.assign(h, { market, invPage, mkCanvas, marketReq });
};
