'use strict';
// server/routes/content.cjs -- REQ-0155. The content-data-registry HTTP
// surface (non-visual, variant-managed content DATA). Appended at the router
// tail; /api/content/defs/* and /api/content/<name>[/meta] collide with
// nothing (public.cjs owns the EXACT /api/content payload route, which
// dispatches first). Mutations reuse admin.cjs's item_admin gate; serving
// GETs are public (same posture as /api/content and routes/art.cjs). ALL DB
// access is via storage.cjs.
//
// Generation backend (Q1, user-ruled): NO LLM key on the server. "Generate
// N" produces a COMMISSION payload for an agent session (POST .../commission);
// the agent session generates the N variants and POSTs them back to the
// generic RECEIVING API (POST .../variants) with full provenance. Machine
// checks (server/services/content_checks.cjs) auto-run on every ingested
// variant. A separate agent records the advisory agent_review via
// POST .../variants/<no>/review. The user adopts exactly one variant; the
// adopted variant is served + exported (server/services/content_export.cjs).
const { sendJSON, readBody, getAuthToken } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const { runChecks } = require('../services/content_checks.cjs');
const { exportAdopted } = require('../services/content_export.cjs');

const KINDS = ['po_def', 'si_def', 'monster_def', 'unit_def', 'tm_def', 'skill_def'];
const RESERVED = new Set(['defs', 'dev', 'meta']);
// Per-kind default variant count (Q4: N default 5, per-kind configurable via
// the def's gen_config.generate_n).
const DEFAULT_GENERATE_N = 5;
const KIND_DEFAULT_N = { po_def: 5, si_def: 5, monster_def: 5, unit_def: 5, tm_def: 5, skill_def: 5 };

function isValidName(n) { return typeof n === 'string' && /^[A-Za-z0-9_]+$/.test(n) && !RESERVED.has(n); }

function readJson(req) {
  return new Promise((resolve, reject) => {
    readBody(req, (err, str) => {
      if (err) return reject(err);
      if (!str) return resolve({});
      try { resolve(JSON.parse(str)); } catch (e) { reject(Object.assign(new Error('invalid JSON body'), { code: 'BAD_JSON' })); }
    });
  });
}

function requireAdmin(req, res) {
  if (!admin.isItemAdminToken(getAuthToken(req))) {
    sendJSON(res, 403, { ok: false, error: 'forbidden: missing/invalid token or not an item_admin' });
    return false;
  }
  return true;
}
function isDevFallback(req) {
  if (getAuthToken(req)) return false;
  return admin.resolveAuth(undefined).ok;
}
// Incident guard (2026-07-14): a mis-namespaced e2e run once wiped the live
// registry through the dev clear hook. Destructive dev seams now ALSO require
// ALLOW_DEV_CLEAR=1 in the server environment; only the isolated e2e
// harnesses (tools/*_e2e.sh, TMPHOME-namespaced) set it. dev_mode alone is
// no longer enough on a long-lived dev server.
function devClearAllowed() { return process.env.ALLOW_DEV_CLEAR === '1'; }

function httpForCode(code) {
  if (code === 'DUPLICATE' || code === 'DUPLICATE_VARIANT') return 409;
  if (code === 'ADOPTED_UNDELETABLE' || code === 'NEEDS_OVERRIDE' || code === 'VARIANT_IMMUTABLE') return 409;
  if (code === 'NOT_FOUND' || code === 'NO_ADOPTED') return 404;
  if (code === 'BAD_PROVENANCE' || code === 'BAD_JSON' || code === 'BAD_KIND' || code === 'BAD_NAME') return 400;
  return 400;
}
function run(res, promise) {
  promise.catch((e) => { try { sendJSON(res, 500, { ok: false, error: 'internal: ' + ((e && e.message) || e) }); } catch (_) { /* headers sent */ } });
}

// Full-provenance validation (gate G3): every variant carries source/model/
// prompt/params; human edits carry parent lineage. Returns a normalized
// provenance object or throws BAD_PROVENANCE.
function normalizeProvenance(p, forcedSource, forcedParent) {
  p = p || {};
  const source = forcedSource || p.source;
  if (source !== 'llm' && source !== 'human_edit') throw Object.assign(new Error('provenance.source must be llm|human_edit'), { code: 'BAD_PROVENANCE' });
  const out = {
    source,
    model: p.model == null ? null : String(p.model),
    model_version: p.model_version == null ? null : String(p.model_version),
    prompt: p.prompt == null ? null : String(p.prompt),
    params: p.params == null ? null : p.params,
    seed_if_any: p.seed_if_any == null ? null : p.seed_if_any,
    parent_variant_id: forcedParent != null ? forcedParent : (p.parent_variant_id == null ? null : p.parent_variant_id),
  };
  if (source === 'llm') {
    if (!out.model) throw Object.assign(new Error('llm provenance requires model'), { code: 'BAD_PROVENANCE' });
    if (!out.prompt) throw Object.assign(new Error('llm provenance requires prompt'), { code: 'BAD_PROVENANCE' });
    if (out.params == null) throw Object.assign(new Error('llm provenance requires params'), { code: 'BAD_PROVENANCE' });
  } else {
    if (out.parent_variant_id == null) throw Object.assign(new Error('human_edit provenance requires parent_variant_id'), { code: 'BAD_PROVENANCE' });
  }
  return out;
}

// Ingest ONE variant: insert (immutable), auto-run the four machine checks,
// persist the result. Returns the variant with its machine_check attached.
async function ingestOne(def, data, provenance) {
  const variant = await storage.createVariant(def.id, { data, provenance, status: 'ok' });
  let mc;
  try { mc = runChecks(def.kind, def.schema_ref, data); }
  catch (e) { mc = { overall: 'FAIL', checks: [{ name: 'runner', ok: false, applicable: true, detail: 'checks crashed: ' + e.message }], ran_at: new Date().toISOString() }; }
  const withCheck = await storage.setVariantMachineCheck(variant.id, mc);
  return withCheck;
}

// ---- admin handlers ----

async function hCreateDef(req, res) {
  const b = await readJson(req);
  if (!isValidName(b.system_name)) return sendJSON(res, 400, { ok: false, error: 'system_name must be [A-Za-z0-9_]+ and not a reserved word' });
  if (!KINDS.includes(b.kind)) return sendJSON(res, 400, { ok: false, error: 'kind must be one of ' + KINDS.join('|') });
  try {
    const def = await storage.createContentDef({
      system_name: b.system_name, kind: b.kind, brief: b.brief || '',
      schema_ref: b.schema_ref != null ? b.schema_ref : 'content/vocab.json',
      gen_config: b.gen_config || {},
    });
    sendJSON(res, 201, { ok: true, def });
  } catch (e) { sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
}

async function hListDefs(req, res) {
  const defs = await storage.listContentDefs();
  sendJSON(res, 200, { ok: true, defs });
}

async function hGetDef(req, res, name) {
  const def = await storage.getContentDefByName(name);
  if (!def) return sendJSON(res, 404, { ok: false, error: 'no such content def: ' + name });
  const variants = await storage.listVariants(def.id);
  sendJSON(res, 200, { ok: true, def, variants, artwork_facet: def.artwork_facet });
}

// REQ-0174: validate an incoming PATCH artwork_ref field. Absent -> {skip}.
// null -> {value:null} (clears). A non-empty string must NAME an existing
// artwork (cross-registry read via the storage chokepoint) -> {value:name},
// else throws BAD_ARTWORK_REF (mapped to 400). TYPE mismatch is deliberately
// NOT blocked here: the picker filters to the matching type, but the ledger
// stays permissive (the two registries are independent; an operator may
// knowingly link across types).
async function resolveArtworkRefPatch(b) {
  if (b.artwork_ref === undefined) return { skip: true };
  if (b.artwork_ref === null) return { value: null };
  if (typeof b.artwork_ref === 'string' && b.artwork_ref) {
    const art = await storage.getArtworkByName(b.artwork_ref);
    if (!art) throw Object.assign(new Error('artwork_ref: no such artwork ' + b.artwork_ref), { code: 'BAD_ARTWORK_REF' });
    return { value: b.artwork_ref };
  }
  throw Object.assign(new Error('artwork_ref must be a non-empty string or null'), { code: 'BAD_ARTWORK_REF' });
}

async function hPatchDef(req, res, name) {
  const def = await storage.getContentDefByName(name);
  if (!def) return sendJSON(res, 404, { ok: false, error: 'no such content def: ' + name });
  const b = await readJson(req);
  const patch = {};
  for (const k of ['brief', 'schema_ref', 'gen_config']) if (b[k] !== undefined) patch[k] = b[k];
  // REQ-0174: def-level artwork reference (validated cross-registry).
  let refPatch;
  try { refPatch = await resolveArtworkRefPatch(b); }
  catch (e) { return sendJSON(res, 400, { ok: false, error: e.message }); }
  if (!refPatch.skip) patch.artwork_ref = refPatch.value;
  const updated = await storage.updateContentDef(name, patch);
  sendJSON(res, 200, { ok: true, def: updated });
}

// Q1/Q4: produce a COMMISSION payload/instructions for an agent session.
// Does NOT call any LLM. N defaults from gen_config.generate_n, else the
// per-kind default (5).
async function hCommission(req, res, name) {
  const def = await storage.getContentDefByName(name);
  if (!def) return sendJSON(res, 404, { ok: false, error: 'no such content def: ' + name });
  const b = await readJson(req);
  const cfgN = def.gen_config && def.gen_config.generate_n;
  const n = Math.max(1, Math.min(20, Number(b.count) || cfgN || KIND_DEFAULT_N[def.kind] || DEFAULT_GENERATE_N));
  const commission = {
    system_name: def.system_name, kind: def.kind, brief: def.brief,
    schema_ref: def.schema_ref, count: n,
    instructions:
      'Generate ' + n + ' DISTINCT ' + def.kind + ' variants for "' + def.system_name + '" satisfying ' +
      def.schema_ref + '. Vary meaningfully per slot (NOT seed roulette). POST them to ' +
      '/api/content/defs/' + def.system_name + '/variants as {variants:[{data,provenance}...]} ' +
      'with full provenance {source:"llm",model,model_version,prompt,params,seed_if_any?}.',
    post_to: '/api/content/defs/' + def.system_name + '/variants',
    review_to: '/api/content/defs/' + def.system_name + '/variants/<variant_no>/review',
  };
  sendJSON(res, 200, { ok: true, commission });
}

// The generic RECEIVING API: ingest 1..N variants with full provenance.
async function hIngestVariants(req, res, name) {
  const def = await storage.getContentDefByName(name);
  if (!def) return sendJSON(res, 404, { ok: false, error: 'no such content def: ' + name });
  const b = await readJson(req);
  const incoming = Array.isArray(b.variants) ? b.variants : (b.data ? [b] : null);
  if (!incoming || incoming.length === 0) return sendJSON(res, 400, { ok: false, error: 'body must be {variants:[{data,provenance}...]} or {data,provenance}' });
  const created = [];
  try {
    for (const v of incoming) {
      if (!v || typeof v.data !== 'object' || v.data === null) throw Object.assign(new Error('each variant needs a data object'), { code: 'BAD_PROVENANCE' });
      const prov = normalizeProvenance(v.provenance, 'llm', null);
      created.push(await ingestOne(def, v.data, prov));
    }
  } catch (e) { return sendJSON(res, httpForCode(e.code), { ok: false, error: e.message, created }); }
  sendJSON(res, 201, { ok: true, created });
}

// Record the ADVISORY agent review (never binding).
async function hReview(req, res, name, variant_no) {
  const variant = await storage.getVariantByNo(name, variant_no);
  if (!variant) return sendJSON(res, 404, { ok: false, error: 'no variant ' + variant_no + ' for ' + name });
  const b = await readJson(req);
  const verdict = b.verdict;
  if (!['recommend', 'neutral', 'concern'].includes(verdict)) return sendJSON(res, 400, { ok: false, error: 'verdict must be recommend|neutral|concern' });
  if (typeof b.rationale !== 'string' || !b.rationale.trim()) return sendJSON(res, 400, { ok: false, error: 'rationale (non-empty) is mandatory (anti-rubber-stamp)' });
  const review = { agent: b.agent || null, model: b.model || null, verdict, rationale: b.rationale.trim(), reviewed_at: new Date().toISOString() };
  const updated = await storage.setVariantReview(variant.id, review);
  sendJSON(res, 200, { ok: true, variant: updated });
}

// Human edit = a NEW variant (immutability): source=human_edit +
// parent_variant_id. Re-runs machine checks.
async function hEdit(req, res, name, variant_no) {
  const def = await storage.getContentDefByName(name);
  if (!def) return sendJSON(res, 404, { ok: false, error: 'no such content def: ' + name });
  const parent = await storage.getVariantByNo(name, variant_no);
  if (!parent) return sendJSON(res, 404, { ok: false, error: 'no variant ' + variant_no + ' for ' + name });
  const b = await readJson(req);
  if (typeof b.data !== 'object' || b.data === null) return sendJSON(res, 400, { ok: false, error: 'data (object) required' });
  try {
    const prov = normalizeProvenance(
      { model: (b.provenance && b.provenance.model) || 'human', prompt: (b.provenance && b.provenance.prompt) || 'human_edit', params: (b.provenance && b.provenance.params) || {} },
      'human_edit', parent.id);
    const created = await ingestOne(def, b.data, prov);
    sendJSON(res, 201, { ok: true, variant: created, parent_variant_id: parent.id, parent_variant_no: variant_no });
  } catch (e) { sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
}

// REQ-0157: re-run the four machine checks on an EXISTING (immutable)
// variant and persist the fresh verdict through the SAME annotation path
// ingest uses (the DB immutability trigger permits machine_check updates;
// the asset-of-record is untouched). Recheck usually reproduces the same
// verdict -- its value arrives when validators/vocab evolve after ingest.
async function recheckVariant(name, variant_no) {
  const def = await storage.getContentDefByName(name);
  if (!def) throw Object.assign(new Error('no such content def: ' + name), { code: 'NOT_FOUND' });
  const variant = await storage.getVariantByNo(name, variant_no);
  if (!variant) throw Object.assign(new Error('no variant ' + variant_no + ' for ' + name), { code: 'NOT_FOUND' });
  let mc;
  try { mc = runChecks(def.kind, def.schema_ref, variant.data); }
  catch (e) { mc = { overall: 'FAIL', checks: [{ name: 'runner', ok: false, applicable: true, detail: 'checks crashed: ' + e.message }], ran_at: new Date().toISOString() }; }
  return storage.setVariantMachineCheck(variant.id, mc);
}
async function hRecheck(req, res, name, variant_no) {
  try { const updated = await recheckVariant(name, variant_no); sendJSON(res, 200, { ok: true, variant: updated }); }
  catch (e) { sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
}

// Adopt exactly one variant. A machine-check FAIL is adoptable ONLY behind
// an explicit override confirm (body.override === true). Fires export.
async function hAdopt(req, res, name) {
  const b = await readJson(req);
  if (!Number.isInteger(b.variant_no)) return sendJSON(res, 400, { ok: false, error: 'variant_no (integer) required' });
  const variant = await storage.getVariantByNo(name, b.variant_no);
  if (!variant) return sendJSON(res, 404, { ok: false, error: 'no variant ' + b.variant_no + ' for ' + name });
  const overall = variant.machine_check && variant.machine_check.overall;
  if (overall === 'FAIL' && b.override !== true) {
    return sendJSON(res, 409, { ok: false, error: 'variant ' + b.variant_no + ' FAILED machine checks; re-POST with override:true to adopt anyway', code: 'NEEDS_OVERRIDE', overall });
  }
  let def;
  try { def = await storage.adoptVariant(name, b.variant_no); }
  catch (e) { return sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
  let exportRec = null, exportError = null;
  try { exportRec = await exportAdopted(name); } catch (e) { exportError = e.message; }
  sendJSON(res, 200, { ok: true, def, adopted_variant_no: b.variant_no, override: b.override === true, export: exportRec, export_error: exportError });
}

async function hDeleteVariant(req, res, name, variant_no) {
  try { await storage.deleteVariant(name, variant_no); sendJSON(res, 200, { ok: true, deleted: variant_no }); }
  catch (e) { sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
}

async function hDevClear(req, res) {
  const r = await storage.clearAllContent();
  sendJSON(res, 200, { ok: true, deleted: r.deleted });
}

// ---- public serving ----

async function hServeAdopted(req, res, name) {
  const a = await storage.getAdoptedVariant(name);
  if (!a) return sendJSON(res, 404, { ok: false, error: 'no adopted content for ' + name });
  sendJSON(res, 200, { ok: true, system_name: name, kind: a.kind, variant_no: a.variant_no, data: a.data });
}
async function hServeMeta(req, res, name) {
  const a = await storage.getAdoptedVariant(name);
  if (!a) return sendJSON(res, 404, { ok: false, error: 'no adopted content for ' + name });
  sendJSON(res, 200, {
    ok: true, system_name: name, kind: a.kind, variant_no: a.variant_no,
    data_sha256: a.data_sha256, schema_ref: a.schema_ref,
    provenance: a.provenance, machine_check: a.machine_check,
    agent_review: a.agent_review, adopted_at: a.adopted_at,
  });
}

const RE_DEFS = /^\/api\/content\/defs$/;
const RE_DEF = /^\/api\/content\/defs\/([^/]+)$/;
const RE_COMMISSION = /^\/api\/content\/defs\/([^/]+)\/commission$/;
const RE_VARIANTS = /^\/api\/content\/defs\/([^/]+)\/variants$/;
const RE_REVIEW = /^\/api\/content\/defs\/([^/]+)\/variants\/(\d+)\/review$/;
const RE_RECHECK = /^\/api\/content\/defs\/([^/]+)\/variants\/(\d+)\/recheck$/; // REQ-0157
const RE_EDIT = /^\/api\/content\/defs\/([^/]+)\/variants\/(\d+)\/edit$/;
const RE_VARIANT = /^\/api\/content\/defs\/([^/]+)\/variants\/(\d+)$/;
const RE_ADOPT = /^\/api\/content\/defs\/([^/]+)\/adopt$/;
const RE_DEV_CLEAR = /^\/api\/content\/dev\/clear-all$/;
const RE_PUB_META = /^\/api\/content\/([^/]+)\/meta$/;
const RE_PUB_ADOPTED = /^\/api\/content\/([^/]+)$/;

function tryContentRoutes(req, res, url, p) {
  if (!p.startsWith('/api/content/')) return false;
  let m;
  if (RE_DEV_CLEAR.test(p) && req.method === 'POST') {
    if (!isDevFallback(req) || !devClearAllowed()) { sendJSON(res, 403, { ok: false, error: 'forbidden: dev-only hook (needs dev_mode fallback + ALLOW_DEV_CLEAR=1)' }); return true; }
    run(res, hDevClear(req, res)); return true;
  }
  if (RE_DEFS.test(p)) {
    if (!requireAdmin(req, res)) return true;
    if (req.method === 'GET') { run(res, hListDefs(req, res)); return true; }
    if (req.method === 'POST') { run(res, hCreateDef(req, res)); return true; }
    sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return true;
  }
  if ((m = RE_COMMISSION.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hCommission(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_REVIEW.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hReview(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_RECHECK.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hRecheck(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_EDIT.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hEdit(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_VARIANT.exec(p)) && req.method === 'DELETE') { if (!requireAdmin(req, res)) return true; run(res, hDeleteVariant(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_VARIANTS.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hIngestVariants(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_ADOPT.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hAdopt(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_DEF.exec(p))) {
    if (!requireAdmin(req, res)) return true;
    if (req.method === 'GET') { run(res, hGetDef(req, res, decodeURIComponent(m[1]))); return true; }
    if (req.method === 'PATCH') { run(res, hPatchDef(req, res, decodeURIComponent(m[1]))); return true; }
    sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return true;
  }
  // public serving (no auth)
  if ((m = RE_PUB_META.exec(p)) && req.method === 'GET') { run(res, hServeMeta(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_PUB_ADOPTED.exec(p)) && req.method === 'GET') { run(res, hServeAdopted(req, res, decodeURIComponent(m[1]))); return true; }
  return false;
}

module.exports = { tryContentRoutes, _normalizeProvenance: normalizeProvenance, _recheckVariant: recheckVariant, _resolveArtworkRefPatch: resolveArtworkRefPatch };
