"use strict";
// server/routes/starter.cjs -- REQ-0051: starter-unit regrant claim endpoint.
// POST /api/starter/claim {unit} re-grants ONE starter unit squad after the
// player discarded it -- once per starter unit [TUNABLE], then 409. The initial
// 4-unit grant is a CLIENT-side fresh-profile boot seed (REQ-0042 pattern),
// NOT this endpoint; this endpoint only enforces the server-side once-per-
// unit regrant limit and returns the unit id (the client rebuilds the squad
// from its own /api/content starterUnits copy, mirroring the gacha pattern).
// GET /api/starter/claims returns the caller ledger. Token-gated. Returns
// false when not matched.
// REQ-0349: was lib/route_auth.cjs, which is now a thin shim over this module.
const { sendJSON } = require("../lib/http_util.cjs");
const { resolveCallerOr401, methodGuard, withJsonBody, RAW_BODY_MESSAGES } = require("../lib/route_kit.cjs");
const storage = require("../storage.cjs");

// The four starter units. Mirrors content/live/starter_units.json ids -- a
// small server-side constant so the endpoint stays content-load-free (and
// works against the api_test synthetic fixture that ships no starter_units).
const STARTER_UNIT_IDS = ["starter_guard", "starter_arms", "starter_mend", "starter_scout"];
const REGRANT_LIMIT = 1; // [TUNABLE] regrants allowed per unit via this endpoint

const CLAIM_RE = /^\/api\/starter\/claim$/;
const CLAIMS_RE = /^\/api\/starter\/claims$/;

function currentClaims(callerId) {
  const doc = storage.readStarterClaims(callerId);
  return (doc && doc.claims) || {};
}

function tryStarterRoutes(req, res, url, p) {
  if (CLAIMS_RE.test(p)) {
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    if (!methodGuard(req, res, "GET")) return;
    const claims = currentClaims(ctx.callerId);
    const remaining = {};
    for (const j of STARTER_UNIT_IDS) remaining[j] = Math.max(0, REGRANT_LIMIT - (claims[j] || 0));
    sendJSON(res, 200, { ok: true, units: STARTER_UNIT_IDS, regrantLimit: REGRANT_LIMIT, claims: claims, remaining: remaining });
    return;
  }
  if (CLAIM_RE.test(p)) {
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const callerId = ctx.callerId;
    if (!methodGuard(req, res, "POST")) return;
    // Byte-parity: RAW_BODY_MESSAGES is the kit preset for the sites that passed
    // the raw readBody error straight through (413 for TOO_LARGE, else 400).
    withJsonBody(req, res, RAW_BODY_MESSAGES, (body) => {
      const unit = typeof body.unit === "string" ? body.unit : null;
      if (!unit || STARTER_UNIT_IDS.indexOf(unit) === -1) {
        sendJSON(res, 400, { ok: false, error: "unknown starter unit: " + String(unit) });
        return;
      }
      const doc = storage.readStarterClaims(callerId) || { schemaVersion: 1, playerId: callerId, claims: {} };
      if (!doc.claims) doc.claims = {};
      const used = doc.claims[unit] || 0;
      if (used >= REGRANT_LIMIT) {
        sendJSON(res, 409, { ok: false, error: "starter unit already reclaimed: " + unit, unit: unit, used: used });
        return;
      }
      doc.claims[unit] = used + 1;
      doc.playerId = callerId;
      doc.schemaVersion = 1;
      doc.updated_at = new Date().toISOString();
      try {
        storage.writeStarterClaims(callerId, doc);
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: "write failed: " + e.message });
        return;
      }
      sendJSON(res, 200, { ok: true, unit: unit, used: doc.claims[unit], remaining: Math.max(0, REGRANT_LIMIT - doc.claims[unit]) });
    });
    return;
  }
  return false;
}
module.exports = { tryStarterRoutes };
