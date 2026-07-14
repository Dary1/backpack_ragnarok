'use strict';
// server/storage_moderation.cjs -- REQ-0144 UGC skin moderation persistence.
// Async pg pool subsystem (same pattern + rationale as storage_art.cjs); the
// public storage.cjs re-exports every function here so it stays the SOLE
// persistence chokepoint -- no route/service opens the DB itself. Tables:
// ugc_submissions, moderation_verdicts, moderation_overrides (migration 015).
// Postgres-only (STORAGE_BACKEND=pg). The verdict pipeline itself
// (tools/moderation_gate.py) is storage-agnostic and emits exactly the JSON
// shape verdictToRow() ingests. The pure mappers/validators below carry no DB
// dependency so they are unit-tested with no database (DB-free ci step).
const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for the UGC moderation registry (STORAGE_BACKEND=pg)');
  pool = new Pool({ connectionString, max: 4 });
  pool.on('error', (err) => { console.error('[storage_moderation] idle pool client error (handled):', err && err.message ? err.message : err); });
  return pool;
}
async function q(text, params) { return getPool().query(text, params); }
async function closeModerationPool() { if (pool) { const p = pool; pool = null; await p.end(); } }

// ---- pure mappers (DB-free) ----
function mapSubmission(row) {
  if (!row) return null;
  return {
    id: Number(row.id), input_sha256: row.input_sha256, kind: row.kind,
    source: row.source, byte_size: row.byte_size == null ? null : Number(row.byte_size),
    created_at: row.created_at,
  };
}
function mapVerdict(row) {
  if (!row) return null;
  return {
    id: Number(row.id), submission_id: Number(row.submission_id),
    pipeline_version: row.pipeline_version, verdict: row.verdict,
    verdict_sha256: row.verdict_sha256, input_sha256: row.input_sha256,
    gates: typeof row.gates === 'string' ? JSON.parse(row.gates) : row.gates,
    decided_at: row.decided_at,
  };
}
function mapOverride(row) {
  if (!row) return null;
  return {
    id: Number(row.id), verdict_id: Number(row.verdict_id), operator: row.operator,
    action: row.action, reason: row.reason, created_at: row.created_at,
  };
}

const VALID_VERDICTS = ['PASS', 'ESCALATE', 'REJECT'];
const VALID_ACTIONS = ['UPHOLD', 'OVERRIDE_APPROVE', 'OVERRIDE_REJECT'];

// Pure transform: verdict-pipeline JSON -> insert-ready fields. Throws on a
// malformed record so bad tool output never reaches the DB.
function verdictToRow(rec) {
  if (!rec || typeof rec !== 'object') throw new Error('verdict record must be an object');
  for (const f of ['pipeline_version', 'verdict', 'verdict_sha256', 'input_sha256', 'gates']) {
    if (!(f in rec)) throw new Error('verdict record missing field: ' + f);
  }
  if (!VALID_VERDICTS.includes(rec.verdict)) throw new Error('invalid verdict: ' + rec.verdict);
  if (!Array.isArray(rec.gates)) throw new Error('gates must be an array');
  if (!/^[0-9a-f]{64}$/.test(String(rec.verdict_sha256))) throw new Error('verdict_sha256 must be 64 lowercase hex');
  if (!/^[0-9a-f]{64}$/.test(String(rec.input_sha256))) throw new Error('input_sha256 must be 64 lowercase hex');
  return {
    pipeline_version: String(rec.pipeline_version),
    verdict: rec.verdict,
    verdict_sha256: rec.verdict_sha256,
    input_sha256: rec.input_sha256,
    gates: JSON.stringify(rec.gates),
  };
}
function overrideToRow(o) {
  if (!o || !o.operator || !o.action || !o.reason) throw new Error('override needs operator, action, reason');
  if (!VALID_ACTIONS.includes(o.action)) throw new Error('invalid override action: ' + o.action);
  return { operator: String(o.operator), action: o.action, reason: String(o.reason) };
}

// ---- DB ops (chokepoint) ----
async function upsertSubmission(s) {
  const r = await q(
    `INSERT INTO ugc_submissions (input_sha256, kind, source, byte_size)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (input_sha256) DO UPDATE SET kind = EXCLUDED.kind
       RETURNING *`,
    [s.input_sha256, s.kind || 'bpskin', s.source || null, s.byte_size == null ? null : s.byte_size]);
  return mapSubmission(r.rows[0]);
}
async function getSubmissionBySha(input_sha256) {
  const r = await q('SELECT * FROM ugc_submissions WHERE input_sha256 = $1', [input_sha256]);
  return mapSubmission(r.rows[0]);
}
async function deleteSubmissionBySha(input_sha256) {
  const r = await q('DELETE FROM ugc_submissions WHERE input_sha256 = $1', [input_sha256]);
  return r.rowCount;
}
async function recordModerationVerdict(rec, meta) {
  meta = meta || {};
  const row = verdictToRow(rec);
  const sub = await upsertSubmission({ input_sha256: rec.input_sha256, kind: meta.kind || 'bpskin', source: meta.source || null, byte_size: meta.byte_size });
  const r = await q(
    `INSERT INTO moderation_verdicts (submission_id, pipeline_version, verdict, verdict_sha256, input_sha256, gates)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (submission_id, pipeline_version, verdict_sha256) DO UPDATE SET decided_at = now()
       RETURNING *`,
    [sub.id, row.pipeline_version, row.verdict, row.verdict_sha256, row.input_sha256, row.gates]);
  return { submission: sub, verdict: mapVerdict(r.rows[0]) };
}
async function getLatestVerdict(input_sha256) {
  const r = await q(
    `SELECT v.* FROM moderation_verdicts v
       JOIN ugc_submissions s ON s.id = v.submission_id
       WHERE s.input_sha256 = $1 ORDER BY v.decided_at DESC, v.id DESC LIMIT 1`, [input_sha256]);
  return mapVerdict(r.rows[0]);
}
async function listVerdicts(input_sha256) {
  const r = await q(
    `SELECT v.* FROM moderation_verdicts v
       JOIN ugc_submissions s ON s.id = v.submission_id
       WHERE s.input_sha256 = $1 ORDER BY v.id`, [input_sha256]);
  return r.rows.map(mapVerdict);
}
async function recordOverride(verdict_id, o) {
  const row = overrideToRow(o);
  const r = await q(
    `INSERT INTO moderation_overrides (verdict_id, operator, action, reason)
       VALUES ($1,$2,$3,$4) RETURNING *`, [verdict_id, row.operator, row.action, row.reason]);
  return mapOverride(r.rows[0]);
}
async function listOverrides(verdict_id) {
  const r = await q('SELECT * FROM moderation_overrides WHERE verdict_id = $1 ORDER BY id', [verdict_id]);
  return r.rows.map(mapOverride);
}

module.exports = {
  closeModerationPool,
  mapSubmission, mapVerdict, mapOverride,
  verdictToRow, overrideToRow, VALID_VERDICTS, VALID_ACTIONS,
  upsertSubmission, getSubmissionBySha, deleteSubmissionBySha,
  recordModerationVerdict, getLatestVerdict, listVerdicts,
  recordOverride, listOverrides,
};
