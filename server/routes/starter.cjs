"use strict";
// server/routes/starter.cjs -- REQ-0051: starter-job regrant claim endpoint.
// POST /api/starter/claim {job} re-grants ONE starter job squad after the
// player discarded it -- once per job [TUNABLE], then 409. The initial
// 4-job grant is a CLIENT-side fresh-profile boot seed (REQ-0042 pattern),
// NOT this endpoint; this endpoint only enforces the server-side once-per-
// job regrant limit and returns the job id (the client rebuilds the squad
// from its own /api/content starterJobs copy, mirroring the gacha pattern).
// GET /api/starter/claims returns the caller ledger. Token-gated. Returns
// false when not matched.
const { sendJSON, readBody } = require("../lib/http_util.cjs");
const { resolveCallerOr401 } = require("../lib/route_auth.cjs");
const storage = require("../storage.cjs");

// The four starter jobs. Mirrors content/live/starter_jobs.json ids -- a
// small server-side constant so the endpoint stays content-load-free (and
// works against the api_test synthetic fixture that ships no starter_jobs).
const STARTER_JOB_IDS = ["job_guard", "job_arms", "job_mend", "job_scout"];
const REGRANT_LIMIT = 1; // [TUNABLE] regrants allowed per job via this endpoint

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
    if (req.method !== "GET") { sendJSON(res, 405, { ok: false, error: "method not allowed" }); return; }
    const claims = currentClaims(ctx.callerId);
    const remaining = {};
    for (const j of STARTER_JOB_IDS) remaining[j] = Math.max(0, REGRANT_LIMIT - (claims[j] || 0));
    sendJSON(res, 200, { ok: true, jobs: STARTER_JOB_IDS, regrantLimit: REGRANT_LIMIT, claims: claims, remaining: remaining });
    return;
  }
  if (CLAIM_RE.test(p)) {
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const callerId = ctx.callerId;
    if (req.method !== "POST") { sendJSON(res, 405, { ok: false, error: "method not allowed" }); return; }
    readBody(req, (err, bodyStr) => {
      if (err) { sendJSON(res, err.code === "TOO_LARGE" ? 413 : 400, { ok: false, error: err.message }); return; }
      let body = {};
      if (bodyStr) { try { body = JSON.parse(bodyStr); } catch (e) { sendJSON(res, 400, { ok: false, error: "invalid JSON body" }); return; } }
      const job = typeof body.job === "string" ? body.job : null;
      if (!job || STARTER_JOB_IDS.indexOf(job) === -1) {
        sendJSON(res, 400, { ok: false, error: "unknown starter job: " + String(job) });
        return;
      }
      const doc = storage.readStarterClaims(callerId) || { schemaVersion: 1, playerId: callerId, claims: {} };
      if (!doc.claims) doc.claims = {};
      const used = doc.claims[job] || 0;
      if (used >= REGRANT_LIMIT) {
        sendJSON(res, 409, { ok: false, error: "starter job already reclaimed: " + job, job: job, used: used });
        return;
      }
      doc.claims[job] = used + 1;
      doc.playerId = callerId;
      doc.schemaVersion = 1;
      doc.updated_at = new Date().toISOString();
      try {
        storage.writeStarterClaims(callerId, doc);
      } catch (e) {
        sendJSON(res, 500, { ok: false, error: "write failed: " + e.message });
        return;
      }
      sendJSON(res, 200, { ok: true, job: job, used: doc.claims[job], remaining: Math.max(0, REGRANT_LIMIT - doc.claims[job]) });
    });
    return;
  }
  return false;
}
module.exports = { tryStarterRoutes };
