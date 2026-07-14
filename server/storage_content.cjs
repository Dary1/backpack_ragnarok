'use strict';
// server/storage_content.cjs -- REQ-0155. The content-data-registry half of
// the persistence chokepoint (non-visual, variant-managed content DATA). It
// is the exact sibling of storage_art.cjs: storage.cjs re-exports every
// function here, so callers still go through require('./storage.cjs') -- this
// file is part of the storage subsystem and legitimately owns a pg.Pool. NO
// route/service module opens the DB itself; they all call these functions via
// storage.cjs.
//
// Shape: content_defs (id, system_name UNIQUE, kind, brief, schema_ref,
// gen_config, adopted_variant_id) + content_variants (id, content_id,
// variant_no auto-increment per content, data JSONB = asset of record,
// data_sha256, provenance JSONB, machine_check JSONB, agent_review JSONB,
// status). Migration 009. All the doctrine (immutability, adopted-
// undeletable, per-content variant_no monotonicity + uniqueness, human_edit
// lineage) is enforced HERE (+ a DB trigger/RESTRICT-FK backstop, gate G1).
//
// Namespacing is byte-identical to storage_art.cjs (hash of $HOME/
// backpack_ragnarok), so content_defs and artworks SHARE the namespace: the
// same bare system_name maps to the same game entity in both tables (its data
// facet + its art facet). artworkFacetExists() below reads across to the
// artworks table (same DB) so the Dex/admin can show the mutual link
// (REQ-0155 Q3, LINK-FIRST).
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
    throw new Error('DATABASE_URL is required for the content registry (STORAGE_BACKEND=pg; see server/.env.example)');
  }
  pool = new Pool({ connectionString, max: 4 });
  pool.on('error', (err) => {
    console.error('[storage_content] idle pool client error (handled; pool self-heals):', err && err.message ? err.message : err);
  });
  return pool;
}
async function q(text, params) { return getPool().query(text, params); }

/** Explicit shutdown for tools/tests that need the process to exit. */
async function closeContentPool() { if (pool) { const p = pool; pool = null; await p.end(); } }

function dupErr(msg, code) { const e = new Error(msg); e.code = code; return e; }

function mapDef(row) {
  if (!row) return null;
  return {
    id: row.id,
    system_name: stripName(row.system_name),
    kind: row.kind,
    brief: row.brief,
    schema_ref: row.schema_ref,
    gen_config: row.gen_config,
    artwork_ref: row.artwork_ref == null ? null : row.artwork_ref,
    adopted_variant_id: row.adopted_variant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function mapVariant(row) {
  if (!row) return null;
  return {
    id: row.id,
    content_id: row.content_id,
    variant_no: row.variant_no,
    data: row.data,
    data_sha256: row.data_sha256,
    provenance: row.provenance,
    machine_check: row.machine_check,
    agent_review: row.agent_review,
    status: row.status,
    created_at: row.created_at,
  };
}

// ---- content_defs ----

/** True iff an artwork row exists under this bare system_name (the SHARED
 * namespace: one entity, two facets). Reads the artworks table in the same
 * DB -- still inside the storage chokepoint. Used by the cross-table check
 * at creation and by the Dex LINK-FIRST badge (Q3). */
async function artworkFacetExists(system_name) {
  const res = await q('SELECT 1 FROM artworks WHERE system_name = $1', [nsName(system_name)]);
  return res.rowCount > 0;
}

/** REQ-0174 REF-FIRST facet resolution: the resolved artwork name for a def
 * is its explicit artwork_ref (when that artwork row still exists) else the
 * exact-name match (the one-name-one-entity canonical fallback) else null.
 * Returns the BARE artwork system_name (the currency the admin/client use) or
 * null. A ref pointing at a since-deleted artwork degrades to the exact-name
 * match, then to none -- never an error (documented graceful degradation). */
async function resolveArtworkFacetName(def) {
  if (!def) return null;
  if (def.artwork_ref && await artworkFacetExists(def.artwork_ref)) return def.artwork_ref;
  if (await artworkFacetExists(def.system_name)) return def.system_name;
  return null;
}

/** REQ-0133: the GAME registry-first art resolution, computed HERE at the
 * storage chokepoint in ONE cross-table round-trip (no client-side cross-
 * registry join for the game path). Given a batch of bare entity ids (the
 * served po/si/tm names), returns { id -> resolved artwork bare name } for every
 * id that resolves to an ADOPTED render, following the ratified chain:
 *   def.artwork_ref's adopted render  ->  exact-name artwork's adopted render
 * An id that resolves to neither is OMITTED -- the client then falls back to the
 * SVG sprite icon (that fallback tier is the CLIENT's, not the server's). A
 * def.artwork_ref pointing at an artwork with no adopted render (or a since-
 * deleted artwork) degrades to the exact-name rung, then to omission -- never an
 * error (documented graceful degradation, same posture as resolveArtworkFacetName).
 * The returned name is exactly what GET /api/art/<name> serves; the route layer
 * turns it into the URL. */
async function resolveItemArtNames(names) {
  const uniq = Array.from(new Set((names || []).filter((n) => typeof n === 'string' && n.length > 0)));
  if (uniq.length === 0) return {};
  const ns = uniq.map(nsName);
  const res = await q(
    `WITH input(bare, nsname) AS (SELECT * FROM unnest($1::text[], $2::text[]))
     SELECT i.bare AS bare,
            d.artwork_ref AS ref,
            (d.artwork_ref IS NOT NULL AND aref.adopted_render_id IS NOT NULL) AS ref_ok,
            (aexact.adopted_render_id IS NOT NULL) AS exact_ok
       FROM input i
       LEFT JOIN content_defs d ON d.system_name = i.nsname
       LEFT JOIN artworks aref   ON aref.system_name  = $3 || d.artwork_ref
       LEFT JOIN artworks aexact ON aexact.system_name = i.nsname`,
    [uniq, ns, NS_PREFIX]);
  const out = {};
  for (const row of res.rows) {
    if (row.ref_ok) out[row.bare] = row.ref;          // rung 1: adopted render of def.artwork_ref
    else if (row.exact_ok) out[row.bare] = row.bare;  // rung 2: adopted render of the exact-name artwork
    // else: unresolved -> omitted (client sprite fallback)
  }
  return out;
}

/** Create a content_def. content_defs.system_name is UNIQUE (one data facet
 * per name); a DUPLICATE surfaces as code DUPLICATE. The shared namespace
 * with artworks is deliberate (one entity, two facets), so a matching
 * artwork is NOT a collision -- it is the linked art facet, reported back as
 * artwork_facet for the mutual link. */
async function createContentDef(d) {
  try {
    const res = await q(
      `INSERT INTO content_defs (system_name, kind, brief, schema_ref, gen_config)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING *`,
      [nsName(d.system_name), d.kind, d.brief || '', d.schema_ref || '',
       d.gen_config == null ? '{}' : JSON.stringify(d.gen_config)]);
    const def = mapDef(res.rows[0]);
    def.artwork_facet = await artworkFacetExists(d.system_name);
    def.artwork_facet_name = await resolveArtworkFacetName(def);
    return def;
  } catch (e) {
    if (e.code === '23505') throw dupErr('content_def system_name already exists: ' + d.system_name, 'DUPLICATE');
    throw e;
  }
}

async function getContentDefByName(system_name) {
  const res = await q('SELECT * FROM content_defs WHERE system_name = $1', [nsName(system_name)]);
  const def = mapDef(res.rows[0] || null);
  if (def) {
    def.artwork_facet = await artworkFacetExists(system_name);
    def.artwork_facet_name = await resolveArtworkFacetName(def);
  }
  return def;
}

/** List all content_defs, each row enriched (REQ-0157, additive) with
 * per-def aggregates in ONE SQL round-trip: variant_count / ok_count
 * (status='ok') / failed_check_count (machine_check.overall='FAIL') /
 * adopted_variant_no / last_variant_at, plus has_artwork_facet -- the same
 * cross-table read artworkFacetExists() does, folded into the query (both
 * tables carry the namespaced system_name). The REQ-0155 row shape is
 * preserved; everything here is added ON TOP for the admin def browser. */
async function listContentDefs() {
  const res = await q(
    `SELECT d.*, av.variant_no AS adopted_variant_no,
            agg.variant_count, agg.ok_count, agg.failed_check_count, agg.last_variant_at,
            (EXISTS (SELECT 1 FROM artworks a WHERE d.artwork_ref IS NOT NULL AND a.system_name = $2 || d.artwork_ref)
             OR EXISTS (SELECT 1 FROM artworks a WHERE a.system_name = d.system_name)) AS has_artwork_facet
       FROM content_defs d
       LEFT JOIN content_variants av ON av.id = d.adopted_variant_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int                                                     AS variant_count,
                COUNT(*) FILTER (WHERE v.status = 'ok')::int                      AS ok_count,
                COUNT(*) FILTER (WHERE v.machine_check->>'overall' = 'FAIL')::int AS failed_check_count,
                MAX(v.created_at)                                                 AS last_variant_at
           FROM content_variants v WHERE v.content_id = d.id
       ) agg ON true
      WHERE d.system_name LIKE $1
      ORDER BY d.created_at ASC, d.id ASC`,
    [NS_PREFIX + '%', NS_PREFIX]);
  return res.rows.map((row) => Object.assign(mapDef(row), {
    adopted_variant_no: row.adopted_variant_no == null ? null : row.adopted_variant_no,
    variant_count: row.variant_count || 0,
    ok_count: row.ok_count || 0,
    failed_check_count: row.failed_check_count || 0,
    last_variant_at: row.last_variant_at || null,
    has_artwork_facet: row.has_artwork_facet === true,
  }));
}

/** Update editable content_def fields (brief, schema_ref, gen_config). The
 * def is metadata about the commission; variants themselves stay immutable. */
async function updateContentDef(system_name, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  const push = (col, val, cast) => { sets.push(col + ' = $' + i + (cast || '')); vals.push(val); i++; };
  if (patch.brief !== undefined) push('brief', patch.brief);
  if (patch.schema_ref !== undefined) push('schema_ref', patch.schema_ref);
  if (patch.gen_config !== undefined) push('gen_config', JSON.stringify(patch.gen_config), '::jsonb');
  // REQ-0174: def-level artwork reference. null clears; a string sets it (the
  // route validates existence cross-registry first). Stored as the BARE
  // artwork system_name -- the same bare-name currency the whole admin uses.
  if (patch.artwork_ref !== undefined) push('artwork_ref', patch.artwork_ref);
  if (sets.length === 0) return getContentDefByName(system_name);
  sets.push('updated_at = now()');
  vals.push(nsName(system_name));
  const res = await q(
    'UPDATE content_defs SET ' + sets.join(', ') + ' WHERE system_name = $' + i + ' RETURNING *',
    vals);
  const def = mapDef(res.rows[0] || null);
  if (def) {
    def.artwork_facet = await artworkFacetExists(system_name);
    def.artwork_facet_name = await resolveArtworkFacetName(def);
  }
  return def;
}

// ---- content_variants ----

/** Insert a fresh variant. variant_no is computed atomically as the next
 * per-content max+1 (starting at 1) in the same INSERT, so the receiving API
 * never has to read-then-write; UNIQUE(content_id, variant_no) is the
 * backstop. variant_no is never renumbered. `v` = {data, provenance, status}.
 * data_sha256 is computed HERE (canonical JSON) so the asset-of-record hash
 * is authoritative and cannot be spoofed by the caller. */
async function createVariant(content_id, v) {
  const data = v.data;
  const data_sha256 = crypto.createHash('sha256').update(canonicalJson(data)).digest('hex');
  try {
    const res = await q(
      `INSERT INTO content_variants (content_id, variant_no, data, data_sha256, provenance, status)
       VALUES ($1,
               (SELECT COALESCE(MAX(variant_no),0)+1 FROM content_variants WHERE content_id = $1),
               $2::jsonb, $3, $4::jsonb, $5)
       RETURNING *`,
      [content_id, JSON.stringify(data), data_sha256,
       JSON.stringify(v.provenance == null ? {} : v.provenance), v.status || 'ok']);
    return mapVariant(res.rows[0]);
  } catch (e) {
    if (e.code === '23505') throw dupErr('variant_no collision for content ' + content_id + ' (retry)', 'DUPLICATE_VARIANT');
    throw e;
  }
}

// Deterministic JSON for hashing: object keys sorted recursively.
function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Storage-level immutability refusal (gate G1). There is deliberately NO
 * production path that mutates a variant's asset-of-record; this function
 * exists so "UPDATE refused at storage" is a callable, testable contract:
 * any attempt to change a variant's data/provenance/identity is refused HERE
 * before it ever reaches the DB. A human edit must go through createVariant
 * with provenance.source=human_edit + parent_variant_id instead. The DB
 * trigger content_variants_immutable_trg is the second backstop. */
async function updateVariantData() {
  throw dupErr('content_variants are immutable: edit = new variant (provenance.source=human_edit + parent_variant_id)', 'VARIANT_IMMUTABLE');
}

/** Write the auto-run machine-check result onto a freshly-INSERTed variant.
 * machine_check is an ADVISORY annotation, not the asset-of-record, so the
 * immutability trigger permits it. */
async function setVariantMachineCheck(variant_id, machine_check) {
  const res = await q(
    'UPDATE content_variants SET machine_check = $2::jsonb WHERE id = $1 RETURNING *',
    [variant_id, JSON.stringify(machine_check == null ? {} : machine_check)]);
  return mapVariant(res.rows[0] || null);
}

/** Record the advisory agent review (never binding). Same annotation posture
 * as machine_check -- permitted by the immutability trigger. */
async function setVariantReview(variant_id, agent_review) {
  const res = await q(
    'UPDATE content_variants SET agent_review = $2::jsonb WHERE id = $1 RETURNING *',
    [variant_id, agent_review == null ? null : JSON.stringify(agent_review)]);
  return mapVariant(res.rows[0] || null);
}

async function getVariantByNo(system_name, variant_no) {
  const res = await q(
    `SELECT v.* FROM content_variants v JOIN content_defs d ON d.id = v.content_id
      WHERE d.system_name = $1 AND v.variant_no = $2`, [nsName(system_name), variant_no]);
  return mapVariant(res.rows[0] || null);
}

async function getVariantById(id) {
  const res = await q('SELECT * FROM content_variants WHERE id = $1', [id]);
  return mapVariant(res.rows[0] || null);
}

/** All variants for a content_def (data + checks + review), variant_no ASC. */
async function listVariants(content_id) {
  const res = await q(
    'SELECT * FROM content_variants WHERE content_id = $1 ORDER BY variant_no ASC', [content_id]);
  return res.rows.map(mapVariant);
}

/** Adopt exactly one variant per content_def (switchable any time; history
 * stays). The variant must exist. The machine-check-FAIL override policy is
 * enforced at the API layer (explicit override confirm); storage just sets
 * the ref. Returns the content_def. */
async function adoptVariant(system_name, variant_no) {
  const vr = await q(
    `SELECT v.id FROM content_variants v JOIN content_defs d ON d.id = v.content_id
      WHERE d.system_name = $1 AND v.variant_no = $2`, [nsName(system_name), variant_no]);
  const variant = vr.rows[0];
  if (!variant) throw dupErr('no such variant_no ' + variant_no + ' for ' + system_name, 'NOT_FOUND');
  const res = await q(
    'UPDATE content_defs SET adopted_variant_id = $2, updated_at = now() WHERE system_name = $1 RETURNING *',
    [nsName(system_name), variant.id]);
  return mapDef(res.rows[0]);
}

/** Delete a variant. REFUSED (code ADOPTED_UNDELETABLE) if it is the
 * content_def's currently adopted variant -- enforced HERE (gate G1); the API
 * refuses it a second time and the DB RESTRICT FK is the final backstop. Any
 * other variant deletes freely. */
async function deleteVariant(system_name, variant_no) {
  const info = await q(
    `SELECT v.id AS variant_id, d.adopted_variant_id
       FROM content_variants v JOIN content_defs d ON d.id = v.content_id
      WHERE d.system_name = $1 AND v.variant_no = $2`, [nsName(system_name), variant_no]);
  const row = info.rows[0];
  if (!row) throw dupErr('no such variant_no ' + variant_no + ' for ' + system_name, 'NOT_FOUND');
  if (row.adopted_variant_id && String(row.adopted_variant_id) === String(row.variant_id)) {
    throw dupErr('cannot delete the adopted variant (variant_no ' + variant_no + '); adopt another variant first', 'ADOPTED_UNDELETABLE');
  }
  await q('DELETE FROM content_variants WHERE id = $1', [row.variant_id]);
  return { deleted: true };
}

/** The adopted variant for a content_def -- {data, provenance, machine_check,
 * agent_review, variant_no, kind, schema_ref, adopted_at} for GET
 * /api/content/<name> (data) + /meta (provenance + checks + review). */
async function getAdoptedVariant(system_name) {
  const res = await q(
    `SELECT v.data, v.provenance, v.machine_check, v.agent_review, v.variant_no,
            v.data_sha256, v.created_at AS adopted_at, d.kind, d.schema_ref
       FROM content_defs d JOIN content_variants v ON v.id = d.adopted_variant_id
      WHERE d.system_name = $1`, [nsName(system_name)]);
  return res.rows[0] || null;
}

/** Dev/test only: wipe every content_def + variant in THIS namespace. NULLs
 * adopted refs first so the RESTRICT FK never blocks the variant delete. */
async function clearAllContent() {
  const ids = await q('SELECT id FROM content_defs WHERE system_name LIKE $1', [NS_PREFIX + '%']);
  const idList = ids.rows.map((r) => r.id);
  if (idList.length === 0) return { deleted: 0 };
  await q('UPDATE content_defs SET adopted_variant_id = NULL WHERE id = ANY($1)', [idList]);
  await q('DELETE FROM content_variants WHERE content_id = ANY($1)', [idList]);
  await q('DELETE FROM content_defs WHERE id = ANY($1)', [idList]);
  return { deleted: idList.length };
}

module.exports = {
  closeContentPool,
  createContentDef, getContentDefByName, listContentDefs, updateContentDef,
  artworkFacetExists, resolveArtworkFacetName, resolveItemArtNames,
  createVariant, updateVariantData, setVariantMachineCheck, setVariantReview,
  getVariantByNo, getVariantById, listVariants,
  adoptVariant, deleteVariant, getAdoptedVariant, clearAllContent,
  _nsName: nsName, _stripName: stripName, _canonicalJson: canonicalJson,
};
