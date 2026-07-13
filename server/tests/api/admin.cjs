'use strict';
// server/tests/api/admin.cjs -- REQ-0145a (sf): auth/identity + admin
// edit surface, in two phases matching the monolith's own order:
//   runSync(h) -- /api/me + resolveAuth/isItemAdminToken + applyAdminEdit
//     validation/happy-path + the migrate_i18n tool tests (origin lines
//     400-647 @ commit 46cd881).
//   run(h) -- the /api/admin HTTP routes: item edit + warehouse grant
//     (origin lines 792-1015).
// NOTE: the 'admin: REAL repo happy path' test does NOT live here -- it
// must run late, under the restored REAL homedir epoch, so it stays in
// its original position at the tail of ragnarok.cjs (see that header).
module.exports.runSync = function runSync(h) {
  const assert = require('assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { T, AT, api, admin, playersFixture, players, storage, mockReq, mockRes,
    authHeaders, guestA, guestB, adminGuest, devPlayer, devUserPath, configDir,
    evictServerModuleTree, evictStorageAndPlayers, tmpHome, realHomedir,
    fakeRepoHome, repoRoot, contentDir, liveDir, batchDir, fixtureLiveDungeonDir } = h;

// ---- REQ-0037: token resolution / /api/me tests ----

T('api: GET /api/me with a valid guest token resolves that guest (not the dev player)', () => {
  const req = mockReq('GET', '/api/me', undefined, authHeaders(guestA.token));
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.strictEqual(parsed.playerId, guestA.playerId);
  assert.strictEqual(parsed.name, 'GuestA');
  assert.deepStrictEqual(parsed.roles, []);
});

T('api: GET /api/me with an unknown/garbage token returns 401', () => {
  const req = mockReq('GET', '/api/me', undefined, authHeaders('totally-bogus-token-value'));
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + res.body);
});

T('api: GET /api/me with no token + dev_mode:true resolves the dev player', () => {
  const req = mockReq('GET', '/api/me');
  const res = mockRes();
  api.handle(req, res);
  assert.strictEqual(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.strictEqual(parsed.playerId, 'dev');
  assert.strictEqual(parsed.name, 'Developer');
  assert.deepStrictEqual(parsed.roles, ['item_admin']);
});

T('api: GET /api/me with no token + dev_mode:false returns 401', () => {
  const original = fs.readFileSync(devUserPath, 'utf8');
  fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
  try {
    const req = mockReq('GET', '/api/me');
    const res = mockRes();
    api.handle(req, res);
    assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + res.body);
  } finally {
    fs.writeFileSync(devUserPath, original);
  }
});

T('admin: resolveAuth returns the right player for a valid token, and the correct failure reasons otherwise', () => {
  const ok = admin.resolveAuth(guestA.token);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.player.playerId, guestA.playerId);

  const bad = admin.resolveAuth('not-a-real-token');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'invalid_token');

  const fallback = admin.resolveAuth(undefined);
  assert.strictEqual(fallback.ok, true);
  assert.strictEqual(fallback.player.playerId, 'dev');
});

T('admin: isItemAdminToken true only for a valid token whose player has item_admin', () => {
  assert.strictEqual(admin.isItemAdminToken(devPlayer.token), true);
  assert.strictEqual(admin.isItemAdminToken(adminGuest.token), true);
  assert.strictEqual(admin.isItemAdminToken(guestA.token), false, 'guestA has no roles');
  assert.strictEqual(admin.isItemAdminToken('not-a-real-token'), false);
  assert.strictEqual(admin.isItemAdminToken(undefined), true, 'no token + dev_mode:true falls back to the admin dev player');
});

T('admin: findLiveEntry resolves POs and SIs, rejects unknown ids (draft/staging-equivalent)', () => {
  const foundItem = admin.findLiveEntry('blade');
  assert.ok(foundItem && foundItem.kind === 'item');
  const foundSi = admin.findLiveEntry('acc_gem');
  assert.ok(foundSi && foundSi.kind === 'si');
  assert.strictEqual(admin.findLiveEntry('not_a_real_id_and_not_staged'), null);
});

T('admin: applyAdminEdit rejects an id not found in live_items/live_sis', () => {
  assert.throws(() => admin.applyAdminEdit('totally_unknown_id', { name: 'X' }), /unknown item id/);
});

T('admin: applyAdminEdit rejects unknown vocab value (bad rarity)', () => {
  assert.throws(() => admin.applyAdminEdit('blade', { rarity: 'Mythic' }), /unknown rarity/);
});

T('admin: applyAdminEdit rejects invalid [lo,hi] ranges (lo>hi, zero, negative)', () => {
  const bad1 = { effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [9, 5] } }] };
  assert.throws(() => admin.applyAdminEdit('blade', bad1), /range/);
  const bad2 = { effects: [{ trigger: { t: 'battle_start' }, verb: { t: 'strike', n: [0, 5] } }] };
  assert.throws(() => admin.applyAdminEdit('blade', bad2), /range/);
  const bad3 = { effects: [{ trigger: { t: 'every_secs', s: [-1, 2] }, verb: { t: 'strike', n: [1, 2] } }] };
  assert.throws(() => admin.applyAdminEdit('blade', bad3), /range/);
});

T('admin: applyAdminEdit rejects unknown/extra keys in the body (schema allowlist)', () => {
  assert.throws(() => admin.applyAdminEdit('blade', { not_a_real_field: 1 }), /unknown field/);
  // shape/ports are intentionally NOT in the allowlist (view-only per REQ-0035).
  assert.throws(() => admin.applyAdminEdit('blade', { shape: [[0, 0]] }), /unknown field/);
});

T('admin: applyAdminEdit rejects tags[0] that is not a root tag', () => {
  // WeaponPart's parent is Weapon (not null) in the fixture vocab -- an
  // invalid tags[0] choice.
  assert.throws(() => admin.applyAdminEdit('blade', { tags: ['WeaponPart', 'Metal'] }), /root tag/);
});

T('admin: applyAdminEdit rejects an unknown tag entirely', () => {
  assert.throws(() => admin.applyAdminEdit('blade', { tags: ['NotARealTag'] }), /unknown tag/);
});

T('admin: applyAdminEdit happy path (fixture repo) persists + re-renders effects, leaves no partial write on a later failure', () => {
  const before = admin.findLiveEntry('fx_dagger');
  assert.strictEqual(before.doc.entries[before.index].name, 'FX Dagger');
  const merged = admin.applyAdminEdit('fx_dagger', { name: 'FX Dagger Mk2', name_ja: 'FXダガーMk2' });
  assert.strictEqual(merged.name, 'FX Dagger Mk2');
  assert.strictEqual(merged.name_ja, 'FXダガーMk2');
  // Re-read from disk (bypassing any cache) to confirm the write landed.
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entry.name, 'FX Dagger Mk2');
  // No leftover tmp files after the atomic write.
  const leftover = fs.readdirSync(liveDir).filter((f) => f.includes('.tmp'));
  assert.strictEqual(leftover.length, 0, 'no leftover tmp files: ' + JSON.stringify(leftover));

  // Now attempt a bad edit on the SAME entry -- it must be rejected AND
  // must not have touched the file (the name from the successful edit
  // above must still be there, unchanged by the rejected attempt).
  assert.throws(() => admin.applyAdminEdit('fx_dagger', { rarity: 'NotReal' }), /unknown rarity/);
  const rereadAfterReject = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entryAfterReject = rereadAfterReject.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entryAfterReject.name, 'FX Dagger Mk2', 'rejected write must not have persisted anything');
});


// ---- REQ-0038: i18n content shape + effects array growth/shrinkage ----

T('admin: applyAdminEdit accepts effects array GROWTH (add one effect) and persists correctly', () => {
  const before = admin.findLiveEntry('fx_dagger');
  const beforeCount = before.doc.entries[before.index].effects.length;
  const grownEffects = before.doc.entries[before.index].effects.concat([
    { trigger: { t: 'battle_start' }, verb: { t: 'block', n: [3, 6] } },
  ]);
  const merged = admin.applyAdminEdit('fx_dagger', { effects: grownEffects });
  assert.strictEqual(merged.effects.length, beforeCount + 1, 'effects array must have grown by exactly one');
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entry.effects.length, beforeCount + 1, 'growth must persist to disk');
  assert.strictEqual(entry.effects[entry.effects.length - 1].verb.t, 'block');
});

T('admin: applyAdminEdit accepts effects array SHRINKAGE (remove one effect), including down to an empty array', () => {
  const before = admin.findLiveEntry('fx_dagger');
  const currentEffects = before.doc.entries[before.index].effects;
  assert.ok(currentEffects.length > 0, 'fixture must have at least one effect to shrink from');
  const shrunk = currentEffects.slice(0, currentEffects.length - 1);
  const merged = admin.applyAdminEdit('fx_dagger', { effects: shrunk });
  assert.strictEqual(merged.effects.length, currentEffects.length - 1);
  // Shrink all the way down to an empty array -- must be an ACCEPTED,
  // valid state (not rejected), per the REQ-0038 spec ("an empty effects
  // array must be an accepted (valid) state").
  const emptied = admin.applyAdminEdit('fx_dagger', { effects: [] });
  assert.deepStrictEqual(emptied.effects, [], 'empty effects array must be accepted');
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.deepStrictEqual(entry.effects, [], 'empty effects array must persist to disk');
});

T('admin: applyAdminEdit accepts writes to the i18n map and merges one level deep (does not clobber sibling fields)', () => {
  // Seed an i18n.ja.flavor value first (simulating a prior edit), then
  // send a body that only touches i18n.ja.name -- the existing flavor
  // must survive the merge (server/admin.cjs's one-level-deep merge).
  admin.applyAdminEdit('fx_dagger', { i18n: { ja: { name: 'FXダガー', flavor: '最初のフレーバー' } } });
  const merged = admin.applyAdminEdit('fx_dagger', { i18n: { ja: { name: 'FXダガーMk3' } } });
  assert.strictEqual(merged.i18n.ja.name, 'FXダガーMk3');
  assert.strictEqual(merged.i18n.ja.flavor, '最初のフレーバー', 'sibling i18n.ja.flavor must survive a name-only edit');
  const reread = JSON.parse(fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8'));
  const entry = reread.entries.find((e) => e.id === 'fx_dagger');
  assert.strictEqual(entry.i18n.ja.name, 'FXダガーMk3');
  assert.strictEqual(entry.i18n.ja.flavor, '最初のフレーバー');
});

T('admin: applyAdminEdit REJECTS an unknown locale key in the i18n map, with a clear error, and leaves the file unchanged', () => {
  const beforeText = fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8');
  assert.throws(
    () => admin.applyAdminEdit('fx_dagger', { i18n: { fr: { name: 'Poignard FX' } } }),
    /unknown i18n locale "fr"/
  );
  const afterText = fs.readFileSync(path.join(liveDir, 'live_items.json'), 'utf8');
  assert.strictEqual(afterText, beforeText, 'a rejected i18n locale write must not touch the file at all');
});

T('admin: applyAdminEdit REJECTS an unknown field inside an i18n locale entry', () => {
  assert.throws(
    () => admin.applyAdminEdit('fx_dagger', { i18n: { ja: { name: 'x', notAField: 'y' } } }),
    /unknown field "notAField" in i18n\.ja/
  );
});

// ---- REQ-0038: migration integrity (tools/migrate_i18n.cjs) ----

T('migrate_i18n: every migrated i18n.ja.{name,flavor} value is byte-identical to the pre-migration name_ja/flavor_ja it replaced, for EVERY entry (not a sample)', () => {
  const migrate = require('../../../tools/migrate_i18n.cjs');

  // Build a fixture doc carrying legacy name_ja/flavor_ja fields on
  // several entries (mirroring the real content shape before the (b)
  // migration commit ran) -- deliberately includes entries with only
  // name_ja, only flavor_ja, both, and neither, so the "every entry, not
  // a sample" requirement is exercised across every combination.
  const fixtureDoc = {
    schema: 'po/2',
    entries: [
      { id: 'alpha', name: 'Alpha', name_ja: 'アルファ', flavor: 'a', flavor_ja: 'あ' },
      { id: 'beta', name: 'Beta', name_ja: 'ベータ' },
      { id: 'gamma', name: 'Gamma', flavor: 'g', flavor_ja: 'が' },
      { id: 'delta', name: 'Delta' },
    ],
  };
  // Capture the exact pre-migration values for every entry BEFORE
  // mutating anything (migrateDoc operates on a clone, but we still want
  // our own independent "before" snapshot to compare against).
  const beforeValues = fixtureDoc.entries.map((e) => ({ id: e.id, name_ja: e.name_ja, flavor_ja: e.flavor_ja }));

  const result = migrate.migrateDoc(fixtureDoc);
  // Assert the verification the script itself performs also holds when
  // driven from this test (independent check, not just trusting the
  // script's own internal assert).
  migrate.verifyMigration(result.records);

  for (const before of beforeValues) {
    const migratedEntry = result.doc.entries.find((e) => e.id === before.id);
    assert.ok(migratedEntry, 'migrated entry must still exist: ' + before.id);
    if (before.name_ja !== undefined) {
      assert.strictEqual(migratedEntry.i18n.ja.name, before.name_ja, 'i18n.ja.name must be byte-identical to the original name_ja for ' + before.id);
      assert.strictEqual(migratedEntry.name_ja, undefined, 'name_ja must be deleted after migration for ' + before.id);
    }
    if (before.flavor_ja !== undefined) {
      assert.strictEqual(migratedEntry.i18n.ja.flavor, before.flavor_ja, 'i18n.ja.flavor must be byte-identical to the original flavor_ja for ' + before.id);
      assert.strictEqual(migratedEntry.flavor_ja, undefined, 'flavor_ja must be deleted after migration for ' + before.id);
    }
    if (before.name_ja === undefined && before.flavor_ja === undefined) {
      assert.strictEqual(migratedEntry.i18n, undefined, 'an entry with neither _ja field must get no i18n map at all: ' + before.id);
    }
  }

  // Idempotency: re-running migrateDoc on the ALREADY-migrated doc must
  // be a true no-op (zero records, doc unchanged) -- proves "safe to
  // re-run" independently of the CLI's own idempotency, per entry.
  const secondPass = migrate.migrateDoc(result.doc);
  assert.strictEqual(secondPass.records.length, 0, 're-running migration on an already-migrated doc must find nothing left to migrate');
  assert.deepStrictEqual(secondPass.doc, result.doc, 're-running migration must not change the doc at all');
});
};

module.exports.run = async function run(h) {
  const assert = require('assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { T, AT, api, admin, playersFixture, players, storage, mockReq, mockRes,
    authHeaders, guestA, guestB, adminGuest, devPlayer, devUserPath, configDir,
    evictServerModuleTree, evictStorageAndPlayers, tmpHome, realHomedir,
    fakeRepoHome, repoRoot, contentDir, liveDir, batchDir, fixtureLiveDungeonDir } = h;

  // ---- REQ-0037: PUT /api/admin/item/:id via the real HTTP handler, token-based ----

  await AT('api: PUT /api/admin/item/:id returns 403 when no token is sent and dev_mode is false', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }));
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(req, res);
      });
    } finally {
      fs.writeFileSync(devUserPath, original);
    }
  });

  await AT('api: PUT /api/admin/item/:id returns 403 when the token is invalid/unknown', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }), authHeaders('garbage-not-a-token'));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id returns 403 when a valid token\'s player lacks item_admin', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Nope' }), authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id returns 404 for an id not in live_items/live_sis (valid admin token)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/nonexistent_item', JSON.stringify({ name: 'X' }), authHeaders(devPlayer.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 404, 'expected 404 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/admin/item/:id happy path (200, persists, cache invalidates via mtime) for a guest with item_admin', async () => {
    // Read /api/content BEFORE the edit to prime the cache with the old name.
    const beforeReq = mockReq('GET', '/api/content');
    const beforeRes = mockRes();
    api.handle(beforeReq, beforeRes);
    const before = JSON.parse(beforeRes.body);
    assert.strictEqual(before.items.blade.name, 'Blade');

    await new Promise((resolve, reject) => {
      const req = mockReq(
        'PUT',
        '/api/admin/item/blade',
        JSON.stringify({ name: 'Blade Mk2' }),
        authHeaders(adminGuest.token)
      );
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.ok, true);
          assert.strictEqual(parsed.item.name, 'Blade Mk2');
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });

    // /api/content must reflect the change on the very next request, with
    // NO server restart -- proves the mtime-based cache invalidated.
    const afterReq = mockReq('GET', '/api/content');
    const afterRes = mockRes();
    api.handle(afterReq, afterRes);
    const after = JSON.parse(afterRes.body);
    assert.strictEqual(after.items.blade.name, 'Blade Mk2', '/api/content must reflect the admin edit without a restart');
  });

  await AT('api: PUT /api/admin/item/:id succeeds with NO token at all when dev_mode is true (dev-player fallback keeps item_admin)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/admin/item/blade', JSON.stringify({ name: 'Blade Mk3' }));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  // ---------------------------------------------------------------------
  // REQ-0041 feedback 1: POST /api/admin/warehouse/grant {itemId} -- dev
  // grant, gated EXACTLY like PUT /api/admin/item/:id above (see that
  // route's own tests immediately above, which this group mirrors 1:1
  // for the auth-gate cases: 200 for item_admin, 403 for a non-admin
  // guest, 403 for no token when dev_mode is off, 400 for an unknown
  // itemId, and the warehouse row actually appearing via listWarehouse).
  // ---------------------------------------------------------------------
  await AT('api: POST /api/admin/warehouse/grant returns 403 when no token is sent and dev_mode is false', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'blade' }));
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(req, res);
      });
    } finally {
      fs.writeFileSync(devUserPath, original);
    }
  });

  await AT('api: POST /api/admin/warehouse/grant returns 403 when a valid token\'s player lacks item_admin (guest/non-admin)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'blade' }), authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: POST /api/admin/warehouse/grant returns 400 for an unknown itemId (valid admin token)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'totally_not_a_real_item_id' }), authHeaders(adminGuest.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 400, 'expected 400 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: POST /api/admin/warehouse/grant happy path (200) for an item_admin guest -- the granted row actually appears via listWarehouse', async () => {
    const schedule2 = require('../../schedule.cjs');
    const before = schedule2.listWarehouse(adminGuest.playerId).length;
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'blade' }), authHeaders(adminGuest.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.ok, true);
          assert.strictEqual(parsed.item.itemId, 'blade');
          assert.strictEqual(parsed.item.status, 'claimable', 'a freshly-granted row starts claimable (REQ-0041 two-phase claim status field)');
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
    const after = schedule2.listWarehouse(adminGuest.playerId);
    assert.strictEqual(after.length, before + 1, 'listWarehouse must show exactly one new row for the granting admin');
    assert.ok(after.some((i) => i.itemId === 'blade'), 'the granted item id must actually be present');
    for (const i of after) if (i.itemId === 'blade' && i.playerId === undefined) { /* no-op, shape check only */ }
  });

  // REQ-0115: the dex Edit-Mode "Acquire to warehouse" bug -- granting an
  // SI id (acc_gem, from live_sis.json) 400'd as "unknown item id" because
  // the gate only checked itemDefsById (PO-only). Now accepts SI ids too.
  await AT('REQ-0115 admin grant: POST /api/admin/warehouse/grant accepts an SI id (acc_gem) -- 200, claimable, listed (regression: was 400 unknown item id)', async () => {
    const schedule2 = require('../../schedule.cjs');
    const before = schedule2.listWarehouse(adminGuest.playerId).length;
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'acc_gem' }), authHeaders(adminGuest.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          const parsed = JSON.parse(body);
          assert.strictEqual(parsed.ok, true);
          assert.strictEqual(parsed.item.itemId, 'acc_gem', 'granted row carries the SI id');
          assert.strictEqual(parsed.item.status, 'claimable');
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
    const after = schedule2.listWarehouse(adminGuest.playerId);
    assert.strictEqual(after.length, before + 1, 'exactly one new SI row for the granting admin');
    assert.ok(after.some((i) => i.itemId === 'acc_gem'), 'the granted SI id must actually be present');
  });

  await AT('api: POST /api/admin/warehouse/grant succeeds with NO token at all when dev_mode is true (dev-player fallback keeps item_admin)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('POST', '/api/admin/warehouse/grant', JSON.stringify({ itemId: 'fx_dagger' }));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 200, 'expected 200 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });


};
