'use strict';
// server/storage_art.cjs -- REQ-0151. The artwork-registry half of the
// persistence chokepoint. storage.cjs re-exports every function here, so
// callers still go through require('./storage.cjs') -- this file is part
// of the storage subsystem (the same way pg_sync_worker.cjs is: a separate
// file that legitimately owns a pg.Pool). NO route/service module opens the
// DB itself; they all call these functions via storage.cjs.
//
// Why a dedicated ASYNC pg.Pool instead of the pg_sync bridge every other
// table uses: renders.image is a PNG BYTEA blob (up to ~1280x1280). The
// pg_sync bridge marshals results as JSON through a fixed 4 MB
// SharedArrayBuffer -- a Buffer JSON-encodes to {"type":"Buffer","data":
// [...]} at ~4-6x inflation, so even a 1 MB PNG overflows it, and blocking
// the event loop on multi-MB image reads is exactly the wrong trade. The
// artwork admin endpoints are all async HTTP handlers, so a normal
// async/await pool is both correct and simpler here. Postgres itself is
// mandated by user ruling 5; this path REQUIRES STORAGE_BACKEND-pg's
// DATABASE_URL.
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Test isolation, identical scheme to storage.cjs: every system_name is
// prefixed with a short hash of the CURRENT repo root (os.homedir()-
// derived). Tests remap os.homedir() before require() -> a fresh namespace,
// so unit-test rows never collide with e2e/live rows. Stripped back off on
// the way out so callers only ever see the bare system_name.
const REPO_ROOT = path.join(os.homedir(), 'backpack_ragnarok');
const NAMESPACE = crypto.createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 16);
const NS_PREFIX = NAMESPACE + ':';
function nsName(name) { return NS_PREFIX + name; }
function stripName(dbName) { return dbName && dbName.startsWith(NS_PREFIX) ? dbName.slice(NS_PREFIX.length) : dbName; }

let pool = null;
function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the artwork registry (STORAGE_BACKEND=pg; see server/.env.example)');
  }
  pool = new Pool({ connectionString, max: 4 });
  pool.on('error', (err) => {
    console.error('[storage_art] idle pool client error (handled; pool self-heals):', err && err.message ? err.message : err);
  });
  return pool;
}
async function q(text, params) { return getPool().query(text, params); }

/** Explicit shutdown for tools/tests that need the process to exit. */
async function closeArtPool() { if (pool) { const p = pool; pool = null; await p.end(); } }

function mapArtwork(row) {
  if (!row) return null;
  return {
    id: row.id,
    system_name: stripName(row.system_name),
    kind: row.kind,
    shape: row.shape,
    gen_width: row.gen_width,
    gen_height: row.gen_height,
    main_object: row.main_object,
    prompt_template: row.prompt_template,
    style_override: row.style_override,
    edge_padding: row.edge_padding,
    // REQ-0186: po shape-conditioning controls. NULL = unset = the `auto`/8
    // default resolved in art_job.py (never defaulted here -- storage records
    // what the operator set, not what the route decides).
    shape_lock: row.shape_lock,
    shape_dilation_px: row.shape_dilation_px,
    adopted_render_id: row.adopted_render_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function dupErr(msg, code) { const e = new Error(msg); e.code = code; return e; }

// ---- artworks ----

async function createArtwork(a) {
  try {
    const res = await q(
      `INSERT INTO artworks
         (system_name, kind, shape, gen_width, gen_height, main_object, prompt_template, style_override, edge_padding, shape_lock, shape_dilation_px)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [nsName(a.system_name), a.kind, a.shape == null ? null : JSON.stringify(a.shape),
       a.gen_width, a.gen_height, a.main_object || '', a.prompt_template || '',
       a.style_override == null ? null : a.style_override,
       a.edge_padding == null ? null : a.edge_padding,
       a.shape_lock == null ? null : a.shape_lock,
       a.shape_dilation_px == null ? null : a.shape_dilation_px]
    );
    return mapArtwork(res.rows[0]);
  } catch (e) {
    if (e.code === '23505') throw dupErr('artwork system_name already exists: ' + a.system_name, 'DUPLICATE');
    throw e;
  }
}

async function getArtworkByName(system_name) {
  const res = await q('SELECT * FROM artworks WHERE system_name = $1', [nsName(system_name)]);
  return mapArtwork(res.rows[0] || null);
}

/** REQ-0156: the registry-browser list. Each artwork row is enriched with
 * per-artwork render aggregates so the left rail can show thumbnails,
 * adoption badges and counts WITHOUT one detail request per artwork:
 *   adopted_seed    seed of the adopted render (null when unadopted)
 *   latest_ok_seed  seed of the most recently created status-ok render
 *                   (the rail thumbnail for unadopted artworks), or null
 *   render_count / ok_count / failed_count   int aggregates
 *   last_render_at  timestamp of the newest render, or null
 * One SQL round-trip (LEFT JOIN LATERAL aggregate per artwork); purely
 * additive over the REQ-0151 row shape, so every existing caller keeps
 * working unchanged. */
async function listArtworks() {
  const res = await q(
    `SELECT a.*, ar.seed AS adopted_seed,
            agg.render_count, agg.ok_count, agg.failed_count,
            agg.last_render_at, agg.latest_ok_seed
       FROM artworks a
       LEFT JOIN renders ar ON ar.id = a.adopted_render_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int                                    AS render_count,
                COUNT(*) FILTER (WHERE r.status = 'ok')::int     AS ok_count,
                COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed_count,
                MAX(r.created_at)                                AS last_render_at,
                (SELECT r2.seed FROM renders r2
                  WHERE r2.artwork_id = a.id AND r2.status = 'ok'
                  ORDER BY r2.created_at DESC, r2.seed DESC LIMIT 1) AS latest_ok_seed
           FROM renders r WHERE r.artwork_id = a.id
       ) agg ON true
      WHERE a.system_name LIKE $1
      ORDER BY a.created_at ASC, a.id ASC`,
    [NS_PREFIX + '%']
  );
  return res.rows.map((row) => Object.assign(mapArtwork(row), {
    adopted_seed: row.adopted_seed == null ? null : row.adopted_seed,
    latest_ok_seed: row.latest_ok_seed == null ? null : row.latest_ok_seed,
    render_count: row.render_count || 0,
    ok_count: row.ok_count || 0,
    failed_count: row.failed_count || 0,
    last_render_at: row.last_render_at || null,
  }));
}

/** Update editable artwork fields. `patch` may include main_object,
 * prompt_template, style_override, edge_padding, shape, gen_width,
 * gen_height (shape/size updated together when the shape editor changes). */
async function updateArtwork(system_name, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  const push = (col, val, cast) => { sets.push(col + ' = $' + i + (cast || '')); vals.push(val); i++; };
  if (patch.main_object !== undefined) push('main_object', patch.main_object);
  if (patch.prompt_template !== undefined) push('prompt_template', patch.prompt_template);
  if (patch.style_override !== undefined) push('style_override', patch.style_override);
  if (patch.edge_padding !== undefined) push('edge_padding', patch.edge_padding);
  if (patch.shape_lock !== undefined) push('shape_lock', patch.shape_lock);
  if (patch.shape_dilation_px !== undefined) push('shape_dilation_px', patch.shape_dilation_px);
  if (patch.shape !== undefined) push('shape', patch.shape == null ? null : JSON.stringify(patch.shape), '::jsonb');
  if (patch.gen_width !== undefined) push('gen_width', patch.gen_width);
  if (patch.gen_height !== undefined) push('gen_height', patch.gen_height);
  if (sets.length === 0) return getArtworkByName(system_name);
  sets.push('updated_at = now()');
  vals.push(nsName(system_name));
  const res = await q(
    'UPDATE artworks SET ' + sets.join(', ') + ' WHERE system_name = $' + i + ' RETURNING *',
    vals
  );
  return mapArtwork(res.rows[0] || null);
}

// ---- renders ----

/** REQ-0223: render a variant for HUMAN messages. Variant 0 is the render a
 * bare seed names, so it stays invisible -- an operator who never opens an A/B
 * should never learn the word "variant" from an error message. */
function seedVarSuffix(v) {
  return v ? ' variant ' + v : '';
}

function mapRenderMeta(row) {
  if (!row) return null;
  return {
    id: row.id,
    artwork_id: row.artwork_id,
    seed: row.seed,
    variant: row.variant,
    image_sha256: row.image_sha256,
    final_prompt: row.final_prompt,
    params: row.params,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
    has_image: row.has_image === undefined ? undefined : !!row.has_image,
  };
}

/** Insert a fresh render row. If `seed` is null the next per-artwork seed
 * (max+1, starting at 1) is computed atomically in the same INSERT so a
 * serialized queue never has to read-then-write. Returns the render meta.
 * UNIQUE(artwork_id, seed, variant) violations surface as code DUPLICATE_SEED.
 *
 * REQ-0223 twin slots. `opts.twin` asks for the SAME seed again as a new
 * variant instead of a DUPLICATE_SEED: variant = MAX(variant)+1 over that
 * (artwork, seed), computed in this same INSERT for the same read-then-write
 * reason as the seed above. Without `twin` a render always lands on variant 0,
 * so the ordinary path's dedupe is exactly the constraint it always was --
 * re-pressing Generate on a taken seed by accident still errors. Only a caller
 * that MEANS "same seed, different parameters" (the one-shot lock override, or
 * an explicit twin request from the revision loop) opts in.
 *
 * `twin` is ignored when seed is null: an auto-seed is by construction fresh,
 * so its only honest slot is 0. Concurrent twins on one seed can still race to
 * the same MAX+1 and lose to the UNIQUE -- that surfaces as DUPLICATE_SEED,
 * which is correct and, on the serialized art queue, unreachable.
 *
 * REQ-0177 sentinel guard: the auto-seed MAX(seed)+1 EXCLUDES the sentinel
 * seed 2147483647 (int4 max = "imported from an unknown environment", the
 * seed every sprite-backfill render carries). Without the FILTER, the first
 * auto-seeded render created AFTER a backfill would compute 2147483647+1 and
 * overflow int4. With it, a backfilled artwork's next real render seeds off
 * its highest NON-sentinel seed (or 1 if the sentinel is its only render). */
async function createRender(artwork_id, seed, status, opts) {
  const twin = !!(opts && opts.twin) && seed != null;
  try {
    const res = await q(
      `INSERT INTO renders (artwork_id, seed, variant, status)
       VALUES ($1,
               COALESCE($2, (SELECT COALESCE(MAX(seed) FILTER (WHERE seed < 2147483647),0)+1 FROM renders WHERE artwork_id = $1)),
               CASE WHEN $4::boolean
                    THEN (SELECT COALESCE(MAX(variant),-1)+1 FROM renders WHERE artwork_id = $1 AND seed = $2::integer)
                    ELSE 0 END,
               $3)
       RETURNING id, artwork_id, seed, variant, image_sha256, final_prompt, params, status, error, created_at`,
      [artwork_id, seed == null ? null : seed, status || 'queued', twin]
    );
    return mapRenderMeta(res.rows[0]);
  } catch (e) {
    if (e.code === '23505') throw dupErr('seed already exists for this artwork: ' + seed, 'DUPLICATE_SEED');
    throw e;
  }
}

async function updateRenderResult(render_id, r) {
  const res = await q(
    `UPDATE renders
       SET status = $2, image = $3, image_sha256 = $4, final_prompt = $5, params = $6::jsonb, error = $7
     WHERE id = $1
     RETURNING id, artwork_id, seed, variant, image_sha256, final_prompt, params, status, error, created_at`,
    [render_id, r.status, r.image == null ? null : r.image, r.image_sha256 == null ? null : r.image_sha256,
     r.final_prompt == null ? null : r.final_prompt,
     r.params == null ? null : JSON.stringify(r.params), r.error == null ? null : r.error]
  );
  return mapRenderMeta(res.rows[0] || null);
}

async function getRenderById(render_id) {
  const res = await q(
    `SELECT id, artwork_id, seed, variant, image_sha256, final_prompt, params, status, error, created_at,
            (image IS NOT NULL) AS has_image
       FROM renders WHERE id = $1`, [render_id]);
  return mapRenderMeta(res.rows[0] || null);
}

/** All renders for an artwork, metadata only (NO image bytes) -- the seed
 * list + thumbnails are served by sha256 through a separate image endpoint,
 * so the list stays light.
 *
 * REQ-0223: ordered (seed, variant) so a seed's twins arrive ADJACENT and in
 * slot order. The lightbox's A/B strip is exactly this order grouped by seed,
 * so the grouping is a fold over the list, not a re-sort. */
async function listRenders(artwork_id) {
  const res = await q(
    `SELECT id, artwork_id, seed, variant, image_sha256, final_prompt, params, status, error, created_at,
            (image IS NOT NULL) AS has_image
       FROM renders WHERE artwork_id = $1 ORDER BY seed ASC, variant ASC`, [artwork_id]);
  return res.rows.map(mapRenderMeta);
}

/** {image: Buffer, image_sha256} for one candidate (system_name, seed, variant),
 * or null. Used by GET /api/art/<name>/renders/<seed> (instant WebUI preview,
 * ruling 6).
 *
 * REQ-0223: `variant` defaults to 0, so a bare seed keeps meaning what it has
 * always meant and the legacy URL needs no change. */
async function getRenderImageBySeed(system_name, seed, variant) {
  const res = await q(
    `SELECT r.image, r.image_sha256
       FROM renders r JOIN artworks a ON a.id = r.artwork_id
      WHERE a.system_name = $1 AND r.seed = $2 AND r.variant = $3`,
    [nsName(system_name), seed, variant == null ? 0 : variant]);
  const row = res.rows[0];
  return row && row.image ? { image: row.image, image_sha256: row.image_sha256 } : null;
}

/** The adopted render for an artwork {image, image_sha256, seed, params,
 * kind, adopted_at(=render.created_at)} for GET /api/art/<name> + /meta. */
async function getAdoptedRender(system_name) {
  const res = await q(
    `SELECT r.image, r.image_sha256, r.seed, r.params, r.created_at AS adopted_at, a.kind
       FROM artworks a JOIN renders r ON r.id = a.adopted_render_id
      WHERE a.system_name = $1`, [nsName(system_name)]);
  return res.rows[0] || null;
}

/** Mark (system_name, seed, variant) as the single adopted render. The render
 * must exist and be status 'ok'. Switchable any time. Returns the artwork.
 *
 * REQ-0223: `variant` defaults to 0 (a bare seed = the render it always named).
 * Adoption keys on renders.id, so a twin is independently adoptable -- winning
 * an A/B is exactly "adopt the other variant of this seed". */
async function adoptRender(system_name, seed, variant) {
  const v = variant == null ? 0 : variant;
  const rr = await q(
    `SELECT r.id, r.status FROM renders r JOIN artworks a ON a.id = r.artwork_id
      WHERE a.system_name = $1 AND r.seed = $2 AND r.variant = $3`, [nsName(system_name), seed, v]);
  const render = rr.rows[0];
  if (!render) throw dupErr('no such render seed ' + seed + seedVarSuffix(v) + ' for ' + system_name, 'NOT_FOUND');
  if (render.status !== 'ok') throw dupErr('cannot adopt a render that is not status ok (seed ' + seed + seedVarSuffix(v) + ' is ' + render.status + ')', 'NOT_OK');
  const res = await q(
    'UPDATE artworks SET adopted_render_id = $2, updated_at = now() WHERE system_name = $1 RETURNING *',
    [nsName(system_name), render.id]);
  return mapArtwork(res.rows[0]);
}

/** Delete a candidate render. REFUSED (code ADOPTED_UNDELETABLE) if it is
 * the artwork's currently adopted render -- enforced HERE in the storage
 * layer (gate G1); the API layer refuses it a second time. Any other
 * render deletes freely. */
async function deleteRender(system_name, seed, variant) {
  const v = variant == null ? 0 : variant;
  const info = await q(
    `SELECT r.id AS render_id, a.adopted_render_id
       FROM renders r JOIN artworks a ON a.id = r.artwork_id
      WHERE a.system_name = $1 AND r.seed = $2 AND r.variant = $3`, [nsName(system_name), seed, v]);
  const row = info.rows[0];
  if (!row) throw dupErr('no such render seed ' + seed + seedVarSuffix(v) + ' for ' + system_name, 'NOT_FOUND');
  if (row.adopted_render_id && String(row.adopted_render_id) === String(row.render_id)) {
    throw dupErr('cannot delete the adopted render (seed ' + seed + seedVarSuffix(v) + '); adopt another render first', 'ADOPTED_UNDELETABLE');
  }
  await q('DELETE FROM renders WHERE id = $1', [row.render_id]);
  return { deleted: true };
}

/** Dev/test only: wipe every artwork + render in THIS namespace. Used by
 * the e2e dev-clear hook and unit-test teardown. NULLs adopted refs first
 * so the RESTRICT FK never blocks the render delete. */
async function clearAllArtworks() {
  const ids = await q('SELECT id FROM artworks WHERE system_name LIKE $1', [NS_PREFIX + '%']);
  const idList = ids.rows.map((r) => r.id);
  if (idList.length === 0) return { deleted: 0 };
  await q('UPDATE artworks SET adopted_render_id = NULL WHERE id = ANY($1)', [idList]);
  await q('DELETE FROM renders WHERE artwork_id = ANY($1)', [idList]);
  const del = await q('DELETE FROM artworks WHERE id = ANY($1)', [idList]);
  return { deleted: idList.length };
}

async function setRenderStatus(render_id, status) {
  const res = await q('UPDATE renders SET status = $2 WHERE id = $1 RETURNING id, artwork_id, seed, variant, image_sha256, final_prompt, params, status, error, created_at', [render_id, status]);
  return mapRenderMeta(res.rows[0] || null);
}

// ---- render_inspections (REQ-0152 inspection kits) ----
// One row per (render_id, kit_id, kit_version): the unified kit output
// (verdict + metrics/checks/notes) plus kit_input_sha256 for staleness/re-run
// detection. Cascade-deleted with the render (FK ON DELETE CASCADE, migration
// 008). All access here, through storage.cjs -- the single chokepoint.

function mapInspection(row) {
  if (!row) return null;
  return {
    id: row.id, render_id: row.render_id, kit_id: row.kit_id,
    kit_version: row.kit_version, verdict: row.verdict,
    metrics: row.metrics, checks: row.checks, notes: row.notes,
    kit_input_sha256: row.kit_input_sha256, ran_at: row.ran_at,
  };
}

/** Insert (or overwrite at the same version) one inspection row. Keyed by
 * UNIQUE(render_id, kit_id, kit_version): re-running the SAME kit_version
 * overwrites in place (re-run button); a kit_version BUMP inserts a new row
 * and the old version's row is retained as history. */
async function upsertRenderInspection(row) {
  const res = await q(
    `INSERT INTO render_inspections
       (render_id, kit_id, kit_version, verdict, metrics, checks, notes, kit_input_sha256, ran_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8, now())
     ON CONFLICT (render_id, kit_id, kit_version)
     DO UPDATE SET verdict = EXCLUDED.verdict, metrics = EXCLUDED.metrics,
       checks = EXCLUDED.checks, notes = EXCLUDED.notes,
       kit_input_sha256 = EXCLUDED.kit_input_sha256, ran_at = now()
     RETURNING *`,
    [row.render_id, row.kit_id, row.kit_version, row.verdict,
     JSON.stringify(row.metrics == null ? {} : row.metrics),
     JSON.stringify(row.checks == null ? [] : row.checks),
     JSON.stringify(row.notes == null ? [] : row.notes),
     row.kit_input_sha256 == null ? null : row.kit_input_sha256]);
  return mapInspection(res.rows[0]);
}

/** Every inspection row for one render (all kits, all versions). */
async function listRenderInspections(render_id) {
  const res = await q(
    'SELECT * FROM render_inspections WHERE render_id = $1 ORDER BY kit_id, kit_version',
    [render_id]);
  return res.rows.map(mapInspection);
}

/** The LATEST row per (render_id, kit_id) across all renders of an artwork --
 * what the admin UI displays (older kit_versions are superseded history). */
async function listLatestInspectionsByArtwork(artwork_id) {
  const res = await q(
    `SELECT DISTINCT ON (ri.render_id, ri.kit_id) ri.*
       FROM render_inspections ri JOIN renders r ON r.id = ri.render_id
      WHERE r.artwork_id = $1
      ORDER BY ri.render_id, ri.kit_id, ri.ran_at DESC, ri.kit_version DESC`,
    [artwork_id]);
  return res.rows.map(mapInspection);
}

/** Artwork row by id (the inspection runner has the render's artwork_id). */
async function getArtworkById(id) {
  const res = await q('SELECT * FROM artworks WHERE id = $1', [id]);
  return mapArtwork(res.rows[0] || null);
}

/** {image: Buffer, image_sha256} for one render by id, or null -- the
 * inspection runner feeds the exact stored PNG bytes to the kit. */
async function getRenderImageById(render_id) {
  const res = await q('SELECT image, image_sha256 FROM renders WHERE id = $1', [render_id]);
  const row = res.rows[0];
  return row && row.image ? { image: row.image, image_sha256: row.image_sha256 } : null;
}

module.exports = {
  closeArtPool,
  createArtwork, getArtworkByName, listArtworks, updateArtwork,
  createRender, setRenderStatus, updateRenderResult, getRenderById, listRenders,
  getRenderImageBySeed, getAdoptedRender, adoptRender, deleteRender,
  clearAllArtworks,
  upsertRenderInspection, listRenderInspections, listLatestInspectionsByArtwork,
  getArtworkById, getRenderImageById,
  _nsName: nsName, _stripName: stripName,
};
