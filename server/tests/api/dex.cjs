'use strict';
// server/tests/api/dex.cjs -- REQ-0145a (sf): the REQ-0052 Dex Card API group (public,
// no-auth card DTOs for item/si/tm + 404 shapes + eff rendering
// parity with /api/content). Uses the ORIGINAL fake-epoch `api`
// binding from harness.boot(), same as the monolith.
// Cut VERBATIM from server/tests/api_test.cjs origin lines 3914-4014 @
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

  // ---- REQ-0052: Dex Card API (GET /api/dex/card/:kind/:id) ----
  // Exercises the live fixture content already declared above (blade =
  // item, acc_gem = si, lrdst = tm) through the SAME api.handle()
  // mock-request harness every other route test in this file uses --
  // no new fixture content needed. Public route (no auth header sent
  // anywhere below), matching dex.cjs's documented no-auth posture.
  T('dex card: GET /api/dex/card/item/blade -- 200, v:1, shape/tags present, no si/tm-only fields leak in', () => {
    // NOTE: 'blade'.name is mutated by an earlier admin-edit test in this
    // same file (PUT /api/admin/item/blade {name:'Blade Mk3'}, this
    // synthetic fixture is never restored the way the dedicated
    // "REAL repo happy path" test restores the real repo) -- so this
    // compares against /api/content's CURRENT value rather than the
    // original fixture literal 'Blade', matching this test file's own
    // "tests may run in any later order, assert self-consistency not a
    // frozen literal" posture for any field another test is known to edit.
    const contentReq = mockReq('GET', '/api/content');
    const contentRes = mockRes();
    api.handle(contentReq, contentRes);
    const currentBlade = JSON.parse(contentRes.body).items.blade;

    const req = mockReq('GET', '/api/dex/card/item/blade');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.ok, true);
    const card = parsed.card;
    assert.strictEqual(card.v, 1);
    assert.strictEqual(card.kind, 'item');
    assert.strictEqual(card.id, 'blade');
    assert.strictEqual(card.name, currentBlade.name);
    assert.deepStrictEqual(card.tags, ['Weapon']);
    assert.deepStrictEqual(card.shape, [[0, 0]]);
    assert.strictEqual(card.slot, undefined, 'si-only field must not appear on an item card');
    assert.strictEqual(card.stackable, undefined, 'tm-only field must not appear on an item card');
  });

  T('dex card: GET /api/dex/card/si/acc_gem -- 200, slot present, no item-only shape field', () => {
    const req = mockReq('GET', '/api/dex/card/si/acc_gem');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 200);
    const card = JSON.parse(res.body).card;
    assert.strictEqual(card.kind, 'si');
    assert.strictEqual(card.id, 'acc_gem');
    assert.strictEqual(card.slot, 'gem');
    assert.strictEqual(card.shape, undefined, 'item-only field must not appear on an si card');
  });

  T('dex card: GET /api/dex/card/tm/lrdst -- 200, short+stackable present', () => {
    const req = mockReq('GET', '/api/dex/card/tm/lrdst');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 200);
    const card = JSON.parse(res.body).card;
    assert.strictEqual(card.kind, 'tm');
    assert.strictEqual(card.id, 'lrdst');
    assert.strictEqual(card.short, 'LRDST');
    assert.strictEqual(card.stackable, true);
  });

  T('dex card: unknown id -> 404 (per kind), unknown kind -> 404, no auth required (no token sent)', () => {
    const req1 = mockReq('GET', '/api/dex/card/item/totally_unknown_xyz');
    const res1 = mockRes();
    api.handle(req1, res1);
    assert.strictEqual(res1.statusCode, 404);
    assert.strictEqual(JSON.parse(res1.body).ok, false);

    const req2 = mockReq('GET', '/api/dex/card/bp/whatever');
    const res2 = mockRes();
    api.handle(req2, res2);
    assert.strictEqual(res2.statusCode, 404, "kind:'bp' is deliberately unservable in v1 (see dex.cjs module comment)");

    const req3 = mockReq('GET', '/api/dex/card/si/nope');
    const res3 = mockRes();
    api.handle(req3, res3);
    assert.strictEqual(res3.statusCode, 404);
  });

  T('dex card: eff_en/eff_ja are rendered text (same renderer /api/content uses), matching /api/content for the same id', () => {
    const contentReq = mockReq('GET', '/api/content');
    const contentRes = mockRes();
    api.handle(contentReq, contentRes);
    const contentItem = JSON.parse(contentRes.body).items.fx_dagger;

    const cardReq = mockReq('GET', '/api/dex/card/item/fx_dagger');
    const cardRes = mockRes();
    api.handle(cardReq, cardRes);
    const card = JSON.parse(cardRes.body).card;

    assert.strictEqual(card.eff_en, contentItem.eff_en, 'card eff_en must match /api/content (same getContent() cache, same renderer)');
    assert.strictEqual(card.eff_ja, contentItem.eff_ja, 'card eff_ja must match /api/content too');
    // NOTE: fx_dagger's effects are emptied by an earlier test in this
    // same file (admin.applyAdminEdit('fx_dagger', {effects:[]})), so
    // eff_en is legitimately '' by the time this test runs -- the
    // load-bearing assertion is the equality with /api/content above
    // (proves the card DTO reads the SAME live, current getContent()
    // state, not a separate/stale computation), not a specific non-empty
    // literal this shared fixture can no longer guarantee this late in
    // the suite.
  });
};
