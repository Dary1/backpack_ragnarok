"use strict";
// server/tests/api/starter.cjs -- REQ-0051: starter-unit regrant claim
// endpoint (POST /api/starter/claim, GET /api/starter/claims). Grant
// idempotency (once-per-starter-unit then 409), per-starter-unit independence, per-player
// isolation, validation + auth, and ledger persistence through storage.cjs.
// Backend-agnostic: storage.readStarterClaims/writeStarterClaims dispatch on
// STORAGE_BACKEND, so this file runs identically (same assertion count) on
// files AND pg -- the REQ-0145a parity gate. Uses scheduleStorage (the
// fakeRepoHome-epoch storage the api binding itself writes through), NOT the
// early tmpHome-epoch h.storage, so a direct ledger read sees the same tree.
module.exports.run = async function run(h) {
  const assert = require("assert");
  const { T, AT, api, mockReq, mockRes, authHeaders, guestA, guestB, scheduleStorage } = h;

  function reqJSON(method, path, token, body) {
    return new Promise((resolve) => {
      const res = mockRes((b) => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
      api.handle(mockReq(method, path, body !== undefined ? JSON.stringify(body) : undefined, authHeaders(token)), res);
    });
  }

  await AT("starter: GET /api/starter/claims -- fresh caller has all 4 units, remaining 1 each", async () => {
    const r = await reqJSON("GET", "/api/starter/claims", guestA.token);
    assert.strictEqual(r.status, 200, "200: " + JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.deepStrictEqual(r.body.units, ["starter_guard", "starter_arms", "starter_mend", "starter_scout"]);
    assert.strictEqual(r.body.regrantLimit, 1);
    assert.strictEqual(r.body.remaining.starter_guard, 1, "fresh: a regrant is available");
    assert.strictEqual(r.body.remaining.starter_scout, 1);
  });

  await AT("starter: POST /api/starter/claim starter_guard -- first regrant granted (used 1, remaining 0)", async () => {
    const r = await reqJSON("POST", "/api/starter/claim", guestA.token, { unit: "starter_guard" });
    assert.strictEqual(r.status, 200, "200: " + JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.unit, "starter_guard");
    assert.strictEqual(r.body.used, 1);
    assert.strictEqual(r.body.remaining, 0);
  });

  await AT("starter: POST claim starter_guard AGAIN -- 409 already reclaimed (idempotency/once-per-starter-unit)", async () => {
    const r = await reqJSON("POST", "/api/starter/claim", guestA.token, { unit: "starter_guard" });
    assert.strictEqual(r.status, 409, "409: " + JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, false);
    assert.strictEqual(r.body.unit, "starter_guard");
    assert.strictEqual(r.body.used, 1, "still exactly 1 -- a refused regrant never increments");
  });

  await AT("starter: POST claim starter_arms -- independent of starter_guard (still grantable)", async () => {
    const r = await reqJSON("POST", "/api/starter/claim", guestA.token, { unit: "starter_arms" });
    assert.strictEqual(r.status, 200, "200: " + JSON.stringify(r.body));
    assert.strictEqual(r.body.used, 1);
  });

  await AT("starter: POST claim with an unknown unit id -- 400", async () => {
    const r = await reqJSON("POST", "/api/starter/claim", guestA.token, { unit: "starter_bogus" });
    assert.strictEqual(r.status, 400, "400: " + JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, false);
  });

  await AT("starter: POST claim with an INVALID token -- 401 (auth gate)", async () => {
    const r = await reqJSON("POST", "/api/starter/claim", "not_a_real_token_zzz", { unit: "starter_guard" });
    assert.strictEqual(r.status, 401, "401: " + JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, false);
  });

  await AT("starter: GET claims reflects the ledger (guard+arms used, mend+scout still open)", async () => {
    const r = await reqJSON("GET", "/api/starter/claims", guestA.token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.remaining.starter_guard, 0);
    assert.strictEqual(r.body.remaining.starter_arms, 0);
    assert.strictEqual(r.body.remaining.starter_mend, 1);
    assert.strictEqual(r.body.remaining.starter_scout, 1);
  });

  await AT("starter: ledger persisted through storage.cjs (read back via the same-epoch storage)", async () => {
    const doc = scheduleStorage.readStarterClaims(guestA.playerId);
    assert.ok(doc, "a ledger doc exists after claims");
    assert.strictEqual(doc.playerId, guestA.playerId);
    assert.strictEqual(doc.claims.starter_guard, 1);
    assert.strictEqual(doc.claims.starter_arms, 1);
    assert.strictEqual(doc.claims.starter_mend, undefined, "never-claimed unit absent from the ledger");
  });

  await AT("starter: per-player isolation -- guestB claim starter_guard is independent of guestA ledger", async () => {
    const r = await reqJSON("POST", "/api/starter/claim", guestB.token, { unit: "starter_guard" });
    assert.strictEqual(r.status, 200, "guestB gets their own first regrant: " + JSON.stringify(r.body));
    assert.strictEqual(r.body.used, 1);
    const a = scheduleStorage.readStarterClaims(guestA.playerId);
    assert.strictEqual(a.claims.starter_guard, 1, "guestA ledger untouched by guestB");
    const b = scheduleStorage.readStarterClaims(guestB.playerId);
    assert.strictEqual(b.claims.starter_guard, 1, "guestB has its OWN ledger");
    assert.strictEqual(b.claims.starter_arms, undefined, "guestB never claimed starter_arms (guestA did)");
  });
};
