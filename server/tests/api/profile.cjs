'use strict';
// server/tests/api/profile.cjs -- REQ-0145a (sf): profile persistence +
// profile HTTP routes, in two phases matching the monolith's own order:
//   runStorageUnit(h) -- players/storage unit tests against the tmpHome
//     epoch, BEFORE the fakeRepoHome fixture boots (origin lines 43-129
//     @ commit 46cd881).
//   run(h) -- the /api/profile route tests (origin lines 650-790).
// Only require paths were adjusted; execution order is FIXED by the
// api_test.cjs entry point.
module.exports.runStorageUnit = function runStorageUnit(h) {
  const assert = require('assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { T, players, storage, tmpHome, evictStorageAndPlayers } = h;

T('players: createPlayer generates a unique id + long random token, persists atomically', () => {
  const p = players.createPlayer('Alice', ['item_admin']);
  assert.ok(p.playerId, 'playerId present');
  assert.ok(p.token && p.token.length >= 32, 'token present and long: ' + p.token);
  assert.deepStrictEqual(p.roles, ['item_admin']);
  const entries = fs.readdirSync(players.PLAYERS_DIR);
  const tmpLeft = entries.filter((f) => f.includes('.tmp'));
  assert.strictEqual(tmpLeft.length, 0, 'no leftover tmp files: ' + JSON.stringify(entries));
  const reread = players.readPlayer(p.playerId);
  assert.strictEqual(reread.token, p.token);
});

T('players: findPlayerByToken resolves a known token, returns null for unknown/garbage', () => {
  const p = players.createPlayer('Bob', []);
  const found = players.findPlayerByToken(p.token);
  assert.ok(found && found.playerId === p.playerId);
  assert.strictEqual(players.findPlayerByToken('not-a-real-token'), null);
  assert.strictEqual(players.findPlayerByToken(undefined), null);
  assert.strictEqual(players.findPlayerByToken(''), null);
});

T('players: ensureFixedPlayer creates once, reuses the SAME token on a later call (idempotent)', () => {
  const r1 = players.ensureFixedPlayer('dev_test', 'Developer', ['item_admin']);
  assert.strictEqual(r1.created, true);
  const token1 = r1.player.token;
  const r2 = players.ensureFixedPlayer('dev_test', 'Developer', ['item_admin']);
  assert.strictEqual(r2.created, false);
  assert.strictEqual(r2.player.token, token1, 'token must not change across repeated ensureFixedPlayer calls');
});

T('storage: writeProfile is atomic (no leftover tmp file) and round-trips with schema_version', () => {
  const p = players.createPlayer('CanvasOwner', []);
  const doc = storage.writeProfile(p.playerId, { pos: [{ uid: 'p1', cell: [1, 1] }] });
  assert.strictEqual(doc.schema_version, storage.SCHEMA_VERSION, 'schema_version present');
  const entries = fs.readdirSync(storage.DATA_DIR);
  const tmpLeft = entries.filter((f) => f.includes('.tmp'));
  assert.strictEqual(tmpLeft.length, 0, 'no leftover tmp files: ' + JSON.stringify(entries));
  const read = storage.readProfile(p.playerId);
  assert.deepStrictEqual(read.canvas, { pos: [{ uid: 'p1', cell: [1, 1] }] });
  assert.strictEqual(read.schema_version, storage.SCHEMA_VERSION);
});

T('storage: unknown profile id (no matching player registry entry) rejected on read and write', () => {
  assert.throws(() => storage.readProfile('totally_not_a_real_player_id'), /unknown profile id/);
  assert.throws(() => storage.writeProfile('totally_not_a_real_player_id', {}), /unknown profile id/);
});

T('storage: oversized payload rejected before write (64KB cap)', () => {
  const p = players.createPlayer('BigPayloadOwner', []);
  const big = { blob: 'x'.repeat(storage.MAX_BODY_BYTES + 1000) };
  assert.throws(() => storage.writeProfile(p.playerId, big), /size cap/);
});

T('storage: readProfile returns null when no file exists yet', () => {
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test2-'));
  os.homedir = () => otherHome;
  evictStorageAndPlayers();
  const players2 = require('../../players.cjs');
  const storage2 = require('../../storage.cjs');
  const p2 = players2.createPlayer('Fresh', []);
  assert.strictEqual(storage2.readProfile(p2.playerId), null);
  os.homedir = () => tmpHome;
  evictStorageAndPlayers();
  require('../../players.cjs');
  require('../../storage.cjs'); // restore module cache to the tmpHome-bound instance
});

T('storage: dev-player migration -- falls back to reading legacy default.json when the dev id has no profile of its own yet', () => {
  const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-api-test3-'));
  os.homedir = () => otherHome;
  evictStorageAndPlayers();
  const players3 = require('../../players.cjs');
  const storage3 = require('../../storage.cjs');
  players3.ensureFixedPlayer('dev', 'Developer', ['item_admin']);
  storage3.ensureDataDir ? storage3.ensureDataDir() : fs.mkdirSync(storage3.DATA_DIR, { recursive: true });
  fs.mkdirSync(storage3.DATA_DIR, { recursive: true });
  fs.writeFileSync(storage3.LEGACY_DEFAULT_PATH, JSON.stringify({ schema_version: 1, profile_id: 'default', updated_at: 'x', canvas: { pos: [{ uid: 'legacy1' }] } }));
  const migrated = storage3.readProfile('dev');
  assert.ok(migrated, 'dev profile falls back to legacy default.json');
  assert.deepStrictEqual(migrated.canvas, { pos: [{ uid: 'legacy1' }] });
  // The legacy file itself must be left untouched (fallback READ, not a rename).
  assert.ok(fs.existsSync(storage3.LEGACY_DEFAULT_PATH), 'legacy default.json must still exist after the fallback read');
  os.homedir = () => tmpHome;
  evictStorageAndPlayers();
  require('../../players.cjs');
  require('../../storage.cjs');
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

  await AT('api: PUT then GET /api/profile/:playerId/canvas round-trips for a real guest token', async () => {
    await new Promise((resolve, reject) => {
      const putReq = mockReq('PUT', '/api/profile/' + guestA.playerId + '/canvas', JSON.stringify({ pos: [{ uid: 'y' }] }), authHeaders(guestA.token));
      const putRes = mockRes((body) => {
        try {
          assert.strictEqual(putRes.statusCode, 200, 'PUT status: ' + body);
        } catch (e) { reject(e); return; }
        const getReq = mockReq('GET', '/api/profile/' + guestA.playerId + '/canvas', undefined, authHeaders(guestA.token));
        const getRes = mockRes((body2) => {
          try {
            assert.strictEqual(getRes.statusCode, 200);
            const parsed = JSON.parse(body2);
            assert.deepStrictEqual(parsed.canvas, { pos: [{ uid: 'y' }] });
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(getReq, getRes);
      });
      api.handle(putReq, putRes);
    });
  });

  await AT('api: oversized PUT body rejected with 413', async () => {
    await new Promise((resolve, reject) => {
      const big = JSON.stringify({ blob: 'x'.repeat(storage.MAX_BODY_BYTES + 5000) });
      const req = mockReq('PUT', '/api/profile/' + guestA.playerId + '/canvas', big, authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 413, 'expected 413 got ' + res.statusCode);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  // ---- REQ-0037: profile isolation -- player A cannot GET/PUT player B's profile ----

  await AT('api: GET /api/profile/:playerId/canvas 403s when the token belongs to a DIFFERENT player', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('GET', '/api/profile/' + guestB.playerId + '/canvas', undefined, authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: PUT /api/profile/:playerId/canvas 403s when the token belongs to a DIFFERENT player', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('PUT', '/api/profile/' + guestB.playerId + '/canvas', JSON.stringify({ pos: [] }), authHeaders(guestA.token));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 403, 'expected 403 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: profile GET/PUT with an invalid token returns 401 (never falls through to a 403/404)', async () => {
    await new Promise((resolve, reject) => {
      const req = mockReq('GET', '/api/profile/' + guestA.playerId + '/canvas', undefined, authHeaders('garbage-token'));
      const res = mockRes((body) => {
        try {
          assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + body);
          resolve();
        } catch (e) { reject(e); }
      });
      api.handle(req, res);
    });
  });

  await AT('api: profile GET with no token + dev_mode:false returns 401', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('GET', '/api/profile/dev/canvas');
        const res = mockRes((body) => {
          try {
            assert.strictEqual(res.statusCode, 401, 'expected 401 got ' + res.statusCode + ': ' + body);
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(req, res);
      });
    } finally {
      fs.writeFileSync(devUserPath, original);
    }
  });

  await AT('api: "default" alias resolves to the dev player\'s own profile when dev_mode is true, round-trips', async () => {
    await new Promise((resolve, reject) => {
      const putReq = mockReq('PUT', '/api/profile/default/canvas', JSON.stringify({ pos: [{ uid: 'dev-alias-1' }] }));
      const putRes = mockRes((body) => {
        try {
          assert.strictEqual(putRes.statusCode, 200, 'PUT status: ' + body);
        } catch (e) { reject(e); return; }
        // Reading back via the dev player's REAL id must see the same data
        // the alias just wrote (same underlying profile file).
        const getReq = mockReq('GET', '/api/profile/dev/canvas');
        const getRes = mockRes((body2) => {
          try {
            assert.strictEqual(getRes.statusCode, 200, 'GET status: ' + body2);
            const parsed = JSON.parse(body2);
            assert.deepStrictEqual(parsed.canvas, { pos: [{ uid: 'dev-alias-1' }] });
            resolve();
          } catch (e) { reject(e); }
        });
        api.handle(getReq, getRes);
      });
      api.handle(putReq, putRes);
    });
  });

  await AT('api: "default" alias stops working (plain unknown/mismatched id) once dev_mode is false', async () => {
    const original = fs.readFileSync(devUserPath, 'utf8');
    fs.writeFileSync(devUserPath, JSON.stringify({ playerId: 'dev', name: 'Developer', roles: ['item_admin'], dev_mode: false }));
    try {
      await new Promise((resolve, reject) => {
        const req = mockReq('GET', '/api/profile/default/canvas', undefined, authHeaders(devPlayer.token));
        const res = mockRes((body) => {
          try {
            // With dev_mode:false, "default" no longer aliases to the dev
            // player -- a valid dev token hitting the "default" URL segment
            // now 403s (token authenticates as "dev", not "default").
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
};
