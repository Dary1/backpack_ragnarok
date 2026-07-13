'use strict';
// server/routes/art.cjs -- REQ-0151. The artwork-registry HTTP surface.
// Appended at the router tail (/api/art/* collides with nothing). Mutations
// reuse admin.cjs's item_admin gate (O3); serving GETs are public. ALL DB
// access is via storage.cjs; generation is via the serialized art_jobs
// queue (which drives art_job.py -> art_route/art_style). Handlers are
// async: on a match we kick off the async work and return true immediately
// so the router stops dispatching, while the response is written later.
const { sendJSON, readBody, getAuthToken } = require('../lib/http_util.cjs');
const admin = require('../admin.cjs');
const storage = require('../storage.cjs');
const jobs = require('../services/art_jobs.cjs');
const kitReg = require('../services/kit_registry.cjs');
const { exportAdopted } = require('../services/art_export.cjs');
const { deriveSize, KINDS } = require('../services/art_sizing.cjs');

// 'queue' reserved since REQ-0156: /api/art/queue is the queue endpoint, so
// an artwork of that name could never be served through the public GET.
const RESERVED = new Set(['artworks', 'dev', 'meta', 'renders', 'queue']);
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

function sendPNG(req, res, image, sha256) {
  const etag = '"' + sha256 + '"';
  if (sha256 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'image/png', 'Content-Length': image.length,
    ETag: etag, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*',
  });
  res.end(image);
}

// item_admin gate, same 403 wording as routes/admin.cjs. Returns true if OK.
function requireAdmin(req, res) {
  if (!admin.isItemAdminToken(getAuthToken(req))) {
    sendJSON(res, 403, { ok: false, error: 'forbidden: missing/invalid token or not an item_admin' });
    return false;
  }
  return true;
}

// dev-only hook gate (NO token + dev_mode fallback), like the other
// /api/.../dev/* cleanup hooks the e2e harness relies on.
function isDevFallback(req) {
  if (getAuthToken(req)) return false;
  const r = admin.resolveAuth(undefined);
  return r.ok;
}
// Incident guard (2026-07-14): a mis-namespaced e2e run once wiped the live
// registry through the dev clear hook. Destructive dev seams now ALSO require
// ALLOW_DEV_CLEAR=1 in the server environment; only the isolated e2e
// harnesses (tools/*_e2e.sh, TMPHOME-namespaced) set it. dev_mode alone is
// no longer enough on a long-lived dev server.
function devClearAllowed() { return process.env.ALLOW_DEV_CLEAR === '1'; }


function httpForCode(code) {
  if (code === 'DUPLICATE' || code === 'DUPLICATE_SEED') return 409;
  if (code === 'ADOPTED_UNDELETABLE') return 409;
  if (code === 'NOT_FOUND' || code === 'NO_ADOPTED') return 404;
  if (code === 'NOT_OK' || code === 'BAD_SHAPE' || code === 'BAD_JSON') return 400;
  return 400;
}

// Build + validate the shape for a kind, then derive its read-only size.
function shapeAndSize(kind, shape) {
  if (kind === 'po') {
    if (!shape || !Array.isArray(shape.mask)) throw Object.assign(new Error('po requires shape.mask (5x5 bool)'), { code: 'BAD_SHAPE' });
    const size = deriveSize('po', shape);
    return { shape: { mask: shape.mask.map((r) => r.map(Boolean)) }, size };
  }
  if (kind === 'monster') {
    if (!shape || !Number.isInteger(shape.w) || !Number.isInteger(shape.h)) throw Object.assign(new Error('monster requires shape {w,h}'), { code: 'BAD_SHAPE' });
    const size = deriveSize('monster', shape);
    return { shape: { w: shape.w, h: shape.h }, size };
  }
  return { shape: null, size: deriveSize(kind, null) };
}

// ---- admin handlers ----

async function hCreate(req, res) {
  const b = await readJson(req);
  if (!isValidName(b.system_name)) return sendJSON(res, 400, { ok: false, error: 'system_name must be [A-Za-z0-9_]+ and not a reserved word' });
  if (!KINDS.includes(b.kind)) return sendJSON(res, 400, { ok: false, error: 'kind must be one of ' + KINDS.join('|') });
  let ss;
  try { ss = shapeAndSize(b.kind, b.shape); } catch (e) { return sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
  const defaults = defaultsForKind(b.kind);
  try {
    const art = await storage.createArtwork({
      system_name: b.system_name, kind: b.kind, shape: ss.shape,
      gen_width: ss.size.width, gen_height: ss.size.height,
      main_object: b.main_object || '',
      prompt_template: b.prompt_template != null ? b.prompt_template : defaults.prompt_template,
      style_override: b.style_override != null ? b.style_override : null,
      edge_padding: b.kind === 'bpskin' ? (b.edge_padding != null ? b.edge_padding : 32) : null,
    });
    sendJSON(res, 201, { ok: true, artwork: art });
  } catch (e) { sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
}

function defaultsForKind(kind) {
  if (kind === 'po' || kind === 'si') return { prompt_template: '{main_object}, white background, bold outline' };
  if (kind === 'unit') return { prompt_template: '{main_object}, portrait, looking at viewer, white background' };
  if (kind === 'monster') return { prompt_template: '{main_object}, white background' };
  return { prompt_template: '' };
}

async function hList(req, res) {
  const list = await storage.listArtworks();
  sendJSON(res, 200, { ok: true, artworks: list });
}

async function hGet(req, res, name) {
  const art = await storage.getArtworkByName(name);
  if (!art) return sendJSON(res, 404, { ok: false, error: 'no such artwork: ' + name });
  const renders = await storage.listRenders(art.id);
  // REQ-0152: latest inspection row per (render, kit) + a stale flag (kit
  // version bumped OR the render's input hash changed since it ran).
  const insList = await storage.listLatestInspectionsByArtwork(art.id);
  const byRender = {};
  for (const row of insList) {
    const render = renders.find((r) => r.id === row.render_id);
    const curVer = kitReg.kitVersion(row.kit_id);
    let stale = false;
    if (curVer && String(row.kit_version) !== String(curVer)) {
      stale = true;
    } else if (render && render.image_sha256) {
      const expected = kitReg.kitInputSha256(render.image_sha256, row.kit_id, row.kit_version, art);
      stale = row.kit_input_sha256 !== expected;
    }
    (byRender[row.render_id] = byRender[row.render_id] || []).push(
      Object.assign({}, row, { stale, current_version: curVer }));
  }
  sendJSON(res, 200, {
    ok: true, artwork: art, renders, queueDepth: jobs.queueDepth(),
    inspectDepth: jobs.inspectDepth(), inspections: byRender,
    kits: kitReg.kitsFor(art.kind),
  });
}

async function hPatch(req, res, name) {
  const art = await storage.getArtworkByName(name);
  if (!art) return sendJSON(res, 404, { ok: false, error: 'no such artwork: ' + name });
  const b = await readJson(req);
  const patch = {};
  for (const k of ['main_object', 'prompt_template', 'style_override', 'edge_padding']) if (b[k] !== undefined) patch[k] = b[k];
  if (b.shape !== undefined) {
    try { const ss = shapeAndSize(art.kind, b.shape); patch.shape = ss.shape; patch.gen_width = ss.size.width; patch.gen_height = ss.size.height; }
    catch (e) { return sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
  }
  const updated = await storage.updateArtwork(name, patch);
  sendJSON(res, 200, { ok: true, artwork: updated });
}

async function hPreview(req, res, name) {
  const art = await storage.getArtworkByName(name);
  if (!art) return sendJSON(res, 404, { ok: false, error: 'no such artwork: ' + name });
  const b = await readJson(req);
  const merged = Object.assign({}, art, b);
  const out = await jobs.runPython({
    kind: art.kind, main_object: merged.main_object, prompt_template: merged.prompt_template,
    style_override: merged.style_override, width: art.gen_width, height: art.gen_height,
    seed: b.seed != null ? b.seed : 1, mode: 'preview',
  });
  if (out.status !== 'ok') return sendJSON(res, 500, { ok: false, error: out.error || 'preview failed' });
  sendJSON(res, 200, { ok: true, subject: out.subject, final_prompt: out.final_prompt, width: out.width, height: out.height, route_params: out.route_params });
}

async function hGenerate(req, res, name) {
  const art = await storage.getArtworkByName(name);
  if (!art) return sendJSON(res, 404, { ok: false, error: 'no such artwork: ' + name });
  const b = await readJson(req);
  const tiling = art.kind === 'bpskin' ? true : !!b.tiling;
  const created = [];
  try {
    if (b.seed != null) {
      const r = await storage.createRender(art.id, b.seed, 'queued');
      jobs.enqueue({ renderId: r.id, artwork: art, seed: r.seed, tiling });
      created.push(r);
    } else {
      const n = Math.max(1, Math.min(20, Number(b.count) || 1));
      for (let i = 0; i < n; i++) {
        const r = await storage.createRender(art.id, null, 'queued');
        jobs.enqueue({ renderId: r.id, artwork: art, seed: r.seed, tiling });
        created.push(r);
      }
    }
  } catch (e) { return sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
  sendJSON(res, 202, { ok: true, renders: created, queueDepth: jobs.queueDepth() });
}

async function hAdopt(req, res, name) {
  const b = await readJson(req);
  if (!Number.isInteger(b.seed)) return sendJSON(res, 400, { ok: false, error: 'seed (integer) is required' });
  let art;
  try { art = await storage.adoptRender(name, b.seed); }
  catch (e) { return sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
  let exportRec = null, exportError = null;
  try { exportRec = await exportAdopted(name); } catch (e) { exportError = e.message; }
  sendJSON(res, 200, { ok: true, artwork: art, export: exportRec, export_error: exportError });
}

async function hDelete(req, res, name, seed) {
  try { await storage.deleteRender(name, seed); sendJSON(res, 200, { ok: true, deleted: seed }); }
  catch (e) { sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
}

// REQ-0156: queue snapshot for the admin queue panel -- the running
// generation job (with elapsed), the pending generation jobs in order, and
// the inspection backlog depth. Admin-gated: job metadata names artworks.
async function hQueue(req, res) {
  sendJSON(res, 200, Object.assign({ ok: true }, jobs.listJobs()));
}

// REQ-0156: cancel one generation job (pending: dequeued; running: worker
// killed). The canceled render becomes status failed / 'canceled by user'
// (no new enum -- no migration); Retry in the UI is delete + regenerate at
// the same seed. 404s when that seed's job is neither pending nor running
// (it already finished -- the poll will show its real status).
async function hCancel(req, res, name, seed) {
  const art = await storage.getArtworkByName(name);
  if (!art) return sendJSON(res, 404, { ok: false, error: 'no such artwork: ' + name });
  const renders = await storage.listRenders(art.id);
  const r = renders.find((x) => x.seed === seed);
  if (!r) return sendJSON(res, 404, { ok: false, error: 'no render seed ' + seed + ' for ' + name });
  try {
    const out = await jobs.cancelJob(r.id);
    sendJSON(res, 200, Object.assign({ ok: true, canceled: out.canceled, renderId: r.id, seed }, { queue: jobs.listJobs() }));
  } catch (e) { sendJSON(res, httpForCode(e.code), { ok: false, error: e.message }); }
}

async function hDevBumpKit(req, res) {
  const b = await readJson(req);
  if (!b.kit_id || !kitReg.kitMeta(b.kit_id)) return sendJSON(res, 400, { ok: false, error: 'unknown kit_id' });
  kitReg.setVersionOverride(b.kit_id, b.kit_version || '2');
  sendJSON(res, 200, { ok: true, kit_id: b.kit_id, kit_version: kitReg.kitVersion(b.kit_id) });
}

async function hDevClear(req, res) {
  const r = await storage.clearAllArtworks();
  sendJSON(res, 200, { ok: true, deleted: r.deleted });
}

// re-run inspection kits for one render. body {kit_id?} -- one kit, or all
// kits for the kind when omitted. Advisory: enqueues, never blocks. (Also the
// on-demand path for lazily-inspected backfilled renders, Q3.)
async function hInspect(req, res, name, seed) {
  const art = await storage.getArtworkByName(name);
  if (!art) return sendJSON(res, 404, { ok: false, error: 'no such artwork: ' + name });
  const renders = await storage.listRenders(art.id);
  const r = renders.find((x) => x.seed === seed);
  if (!r) return sendJSON(res, 404, { ok: false, error: 'no render seed ' + seed + ' for ' + name });
  if (r.status !== 'ok') return sendJSON(res, 400, { ok: false, error: 'cannot inspect a render that is not status ok' });
  const b = await readJson(req);
  let toRun;
  if (b.kit_id) {
    const meta = kitReg.kitMeta(b.kit_id);
    if (!meta || !meta.applies_to.includes(art.kind)) return sendJSON(res, 400, { ok: false, error: 'kit ' + b.kit_id + ' does not apply to kind ' + art.kind });
    toRun = [b.kit_id];
  } else {
    toRun = kitReg.kitsFor(art.kind).map((k) => k.kit_id);
  }
  for (const kid of toRun) jobs.enqueueInspection({ renderId: r.id, artworkId: art.id, kitId: kid });
  sendJSON(res, 202, { ok: true, queued: toRun, inspectDepth: jobs.inspectDepth() });
}

// ---- public serving handlers ----

async function hServeAdopted(req, res, name) {
  const a = await storage.getAdoptedRender(name);
  if (!a || !a.image) return sendJSON(res, 404, { ok: false, error: 'no adopted artwork for ' + name });
  sendPNG(req, res, a.image, a.image_sha256);
}

async function hServeMeta(req, res, name) {
  const a = await storage.getAdoptedRender(name);
  if (!a) return sendJSON(res, 404, { ok: false, error: 'no adopted artwork for ' + name });
  sendJSON(res, 200, { ok: true, kind: a.kind, seed: a.seed, image_sha256: a.image_sha256, params: a.params, adopted_at: a.adopted_at });
}

async function hServeRender(req, res, name, seed) {
  const r = await storage.getRenderImageBySeed(name, seed);
  if (!r || !r.image) return sendJSON(res, 404, { ok: false, error: 'no render seed ' + seed + ' for ' + name });
  sendPNG(req, res, r.image, r.image_sha256);
}

function run(res, promise) {
  promise.catch((e) => { try { sendJSON(res, 500, { ok: false, error: 'internal: ' + ((e && e.message) || e) }); } catch (_) { /* headers sent */ } });
}

const RE_ARTWORKS = /^\/api\/art\/artworks$/;
const RE_ARTWORK = /^\/api\/art\/artworks\/([^/]+)$/;
const RE_PREVIEW = /^\/api\/art\/artworks\/([^/]+)\/preview$/;
const RE_GENERATE = /^\/api\/art\/artworks\/([^/]+)\/generate$/;
const RE_ADOPT = /^\/api\/art\/artworks\/([^/]+)\/adopt$/;
const RE_ADMIN_RENDER = /^\/api\/art\/artworks\/([^/]+)\/renders\/(\d+)$/;
const RE_INSPECT = /^\/api\/art\/artworks\/([^/]+)\/renders\/(\d+)\/inspect$/;
const RE_CANCEL = /^\/api\/art\/artworks\/([^/]+)\/renders\/(\d+)\/cancel$/;   // REQ-0156
const RE_QUEUE = /^\/api\/art\/queue$/;                                        // REQ-0156
const RE_DEV_CLEAR = /^\/api\/art\/dev\/clear-all$/;
const RE_DEV_BUMP = /^\/api\/art\/dev\/bump-kit$/;
const RE_PUB_META = /^\/api\/art\/([^/]+)\/meta$/;
const RE_PUB_RENDER = /^\/api\/art\/([^/]+)\/renders\/(\d+)$/;
const RE_PUB_ADOPTED = /^\/api\/art\/([^/]+)$/;

function tryArtRoutes(req, res, url, p) {
  if (!p.startsWith('/api/art')) return false;
  let m;
  if (RE_ARTWORKS.test(p)) {
    if (!requireAdmin(req, res)) return true;
    if (req.method === 'GET') { run(res, hList(req, res)); return true; }
    if (req.method === 'POST') { run(res, hCreate(req, res)); return true; }
    sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return true;
  }
  if (RE_DEV_BUMP.test(p) && req.method === 'POST') {
    if (!isDevFallback(req) || !devClearAllowed()) { sendJSON(res, 403, { ok: false, error: 'forbidden: dev-only hook (needs dev_mode fallback + ALLOW_DEV_CLEAR=1)' }); return true; }
    run(res, hDevBumpKit(req, res)); return true;
  }
  if (RE_DEV_CLEAR.test(p) && req.method === 'POST') {
    if (!isDevFallback(req) || !devClearAllowed()) { sendJSON(res, 403, { ok: false, error: 'forbidden: dev-only hook (needs dev_mode fallback + ALLOW_DEV_CLEAR=1)' }); return true; }
    run(res, hDevClear(req, res)); return true;
  }
  if (RE_QUEUE.test(p) && req.method === 'GET') { if (!requireAdmin(req, res)) return true; run(res, hQueue(req, res)); return true; }
  if ((m = RE_CANCEL.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hCancel(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_PREVIEW.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hPreview(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_GENERATE.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hGenerate(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_ADOPT.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hAdopt(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_INSPECT.exec(p)) && req.method === 'POST') { if (!requireAdmin(req, res)) return true; run(res, hInspect(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_ADMIN_RENDER.exec(p)) && req.method === 'DELETE') { if (!requireAdmin(req, res)) return true; run(res, hDelete(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_ARTWORK.exec(p))) {
    if (!requireAdmin(req, res)) return true;
    if (req.method === 'GET') { run(res, hGet(req, res, decodeURIComponent(m[1]))); return true; }
    if (req.method === 'PATCH') { run(res, hPatch(req, res, decodeURIComponent(m[1]))); return true; }
    sendJSON(res, 405, { ok: false, error: 'method not allowed' }); return true;
  }
  // public serving (no auth)
  if ((m = RE_PUB_META.exec(p)) && req.method === 'GET') { run(res, hServeMeta(req, res, decodeURIComponent(m[1]))); return true; }
  if ((m = RE_PUB_RENDER.exec(p)) && req.method === 'GET') { run(res, hServeRender(req, res, decodeURIComponent(m[1]), Number(m[2]))); return true; }
  if ((m = RE_PUB_ADOPTED.exec(p)) && req.method === 'GET') { run(res, hServeAdopted(req, res, decodeURIComponent(m[1]))); return true; }
  return false;
}

module.exports = { tryArtRoutes };
