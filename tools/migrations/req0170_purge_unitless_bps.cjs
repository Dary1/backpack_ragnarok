#!/usr/bin/env node
'use strict';
// tools/migrations/req0170_purge_unitless_bps.cjs -- REQ-0170.
//
// THE PURGE. Every BP in every profile predates the Unit model: it carries
// `linker: {off, dirs}` -- a rolled beam array with no identity -- and no `unit`.
// Under the ratified model a Unit is a CHARACTER (elf, dwarf, ...) whose rays come
// from its def's connection_shape. No migration can invent an identity that was
// never rolled, so these BPs are not upgradable. They are deleted.
//
// What is removed, per profile:
//   - every BP with no `unit`, from the canvas, from every Squad snapshot
//     (canvas.presets.store[]) and from every inventory page;
//   - every PO sitting INSIDE one of those BPs (it has nowhere left to sit);
//   - every SI seated on one of those POs is UNSEATED (host -> 'inv'), never deleted:
//     an accessory is not part of the bag it happened to be riding in.
//   - every gacha_pending row (each one describes a `rolled` BP in the dead shape).
//
// What is NEVER touched: TMs (currency), free-placed inventory items, squad names,
// page names, or anything outside the BP/PO/SI graph above.
//
// RE-SEED: a profile left with ZERO BPs anywhere is re-seeded from the (new)
// content/live/scenario.json starter, so it lands in exactly the state a FRESH
// profile gets -- playable, with four Units on the board -- rather than in an empty
// state no code path has ever produced. Currency and inventory survive the re-seed.
//
// SAFE BY DEFAULT: dry run unless --apply is passed.
//   node tools/migrations/req0170_purge_unitless_bps.cjs              # report only
//   node tools/migrations/req0170_purge_unitless_bps.cjs --apply      # write
//   ... --ns <prefix>   restrict to one storage namespace (default: ALL)
//   ... --no-reseed     purge only; leave emptied profiles empty
//
// Idempotent: a second run finds nothing to do (every BP has a unit) and reports 0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Engine = require('../../mock-src/engine.js');

const REPO = path.join(__dirname, '..', '..');
const CONTENT = process.env.CONTENT_ROOT || path.join(REPO, 'content');
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const APPLY = process.argv.includes('--apply');
const NO_RESEED = process.argv.includes('--no-reseed');
const nsIdx = process.argv.indexOf('--ns');
const NS = nsIdx >= 0 ? process.argv[nsIdx + 1] : null;

const vocab = load(path.join(CONTENT, 'vocab.json'));
const items = load(path.join(CONTENT, 'live', 'live_items.json'));
const units = load(path.join(CONTENT, 'live', 'live_units.json'));
const scenario = load(path.join(CONTENT, 'live', 'scenario.json'));

const ITEMS = {};
for (const e of items.entries) ITEMS[e.id] = e;
const UNITS = {};
for (const e of units.entries) UNITS[e.id] = e;
const LAYOUT = scenario.layout || { ROWS: 8, COLS: 8 };
const E = Engine.create(ITEMS, {}, LAYOUT, { po: vocab.po_tags || {}, socket: vocab.socket_tags || {} }, UNITS, vocab.connection_shapes || {});

const key = (r, c) => r + ',' + c;

/** Purges ONE container ({bps,pos,sis}) in place. Returns what it removed. */
function purgeContainer(container, stats) {
  if (!container || !Array.isArray(container.bps)) return;
  const doomed = container.bps.filter((b) => !b || !b.unit);
  if (!doomed.length) return;

  const doomedCells = new Set();
  for (const bp of doomed) {
    if (!Array.isArray(bp.shape) || !Array.isArray(bp.origin)) continue;
    for (const [dr, dc] of bp.shape) doomedCells.add(key(bp.origin[0] + dr, bp.origin[1] + dc));
  }

  const removedPoUids = new Set();
  container.pos = (container.pos || []).filter((p) => {
    if (!p || p.loc !== 'grid' || !Array.isArray(p.cell)) return true; // stowed/free items are not inside anything
    const def = ITEMS[p.id];
    if (!def) return true; // unknown def: leave it alone rather than guess at its footprint
    const cells = E.rotOffsets(def.shape, p.rot || 0).map(([r, c]) => [p.cell[0] + r, p.cell[1] + c]);
    const inside = cells.some(([r, c]) => doomedCells.has(key(r, c)));
    if (inside) { removedPoUids.add(p.uid); stats.pos++; }
    return !inside;
  });

  // Accessories are UNSEATED, not deleted -- see the header. `host` is 'inv' | 'bond'
  // | {po,si} (a seat on a PO's socket) | {page,cell} (a free inventory home).
  for (const a of (container.sis || [])) {
    const h = a && a.host;
    if (h && typeof h === 'object' && h.po && removedPoUids.has(h.po)) { a.host = 'inv'; stats.sisUnseated++; }
  }

  container.bps = container.bps.filter((b) => b && b.unit);
  stats.bps += doomed.length;
}

function countBps(canvas) {
  let n = (canvas.bps || []).length;
  for (const snap of ((canvas.presets && canvas.presets.store) || [])) if (snap) n += (snap.bps || []).length;
  for (const pg of ((canvas.inv && canvas.inv.pages) || [])) n += (pg.bps || []).length;
  return n;
}

/** Purges one profile doc in place. Returns per-profile stats. */
function purgeProfileDoc(doc) {
  const stats = { bps: 0, pos: 0, sisUnseated: 0, reseeded: false };
  const canvas = doc && doc.canvas;
  if (!canvas) return stats;

  purgeContainer(canvas, stats);
  for (const snap of ((canvas.presets && canvas.presets.store) || [])) purgeContainer(snap, stats);
  for (const pg of ((canvas.inv && canvas.inv.pages) || [])) purgeContainer(pg, stats);

  if (!NO_RESEED && countBps(canvas) === 0) {
    const seed = JSON.parse(JSON.stringify(scenario));
    delete seed.layout;
    canvas.linked = seed.linked !== undefined ? seed.linked : true;
    canvas.bps = seed.bps || [];
    canvas.pos = (canvas.pos || []).concat(seed.pos || []);
    canvas.sis = (canvas.sis || []).concat(seed.sis || []);
    stats.reseeded = true;
  }
  return stats;
}

// --------------------------------------------------------------------------
async function main() {
  const totals = { profiles: 0, touched: 0, bps: 0, pos: 0, sisUnseated: 0, reseeded: 0, pending: 0 };
  const cs = process.env.DATABASE_URL;
  const backend = (process.env.STORAGE_BACKEND || 'files') === 'pg' && cs ? 'pg' : 'files';
  console.log('backend: ' + backend + (NS ? '  namespace filter: ' + NS : '  namespace: ALL') +
              '  mode: ' + (APPLY ? 'APPLY (writing)' : 'DRY RUN') + (NO_RESEED ? '  reseed: OFF' : '  reseed: ON'));

  if (backend === 'pg') {
    const { Pool } = require(path.join(REPO, 'server', 'node_modules', 'pg'));
    const pool = new Pool({ connectionString: cs, max: 4 });
    try {
      const where = NS ? ' where player_id like $1' : '';
      const args = NS ? [NS + ':%'] : [];
      const rows = (await pool.query('select player_id, doc from profiles' + where, args)).rows;
      for (const row of rows) {
        totals.profiles++;
        const doc = row.doc;
        const st = purgeProfileDoc(doc);
        if (st.bps || st.pos || st.sisUnseated || st.reseeded) {
          totals.touched++;
          totals.bps += st.bps; totals.pos += st.pos; totals.sisUnseated += st.sisUnseated;
          if (st.reseeded) totals.reseeded++;
          if (APPLY) {
            await pool.query('update profiles set doc = $2::jsonb, updated_at = now() where player_id = $1',
                             [row.player_id, JSON.stringify(doc)]);
          }
        }
      }
      const pend = (await pool.query('select count(*)::int n from gacha_pending' + (NS ? ' where player_id like $1' : ''), args)).rows[0].n;
      totals.pending = pend;
      if (APPLY && pend) await pool.query('delete from gacha_pending' + (NS ? ' where player_id like $1' : ''), args);
    } finally {
      await pool.end();
    }
  } else {
    const dir = path.join(REPO, 'data', 'profiles');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    for (const f of files) {
      totals.profiles++;
      const p = path.join(dir, f);
      const doc = load(p);
      const st = purgeProfileDoc(doc);
      if (st.bps || st.pos || st.sisUnseated || st.reseeded) {
        totals.touched++;
        totals.bps += st.bps; totals.pos += st.pos; totals.sisUnseated += st.sisUnseated;
        if (st.reseeded) totals.reseeded++;
        if (APPLY) fs.writeFileSync(p, JSON.stringify(doc, null, 1) + '\n');
      }
    }
    const gp = path.join(REPO, 'data', 'gacha_pending');
    if (fs.existsSync(gp)) {
      for (const player of fs.readdirSync(gp)) {
        const pdir = path.join(gp, player);
        if (!fs.statSync(pdir).isDirectory()) continue;
        for (const f of fs.readdirSync(pdir)) {
          totals.pending++;
          if (APPLY) fs.unlinkSync(path.join(pdir, f));
        }
      }
    }
  }

  console.log('profiles scanned : ' + totals.profiles);
  console.log('profiles changed : ' + totals.touched);
  console.log('BPs purged       : ' + totals.bps + '   (every BP with no Unit -- the whole pre-pivot population)');
  console.log('POs purged       : ' + totals.pos + '   (were sitting inside a purged BP)');
  console.log('SIs unseated     : ' + totals.sisUnseated + '   (kept, never deleted)');
  console.log('profiles reseeded: ' + totals.reseeded + '   (left with zero BPs -> given the fresh-profile starter board)');
  console.log('gacha_pending    : ' + totals.pending + '   (rows ' + (APPLY ? 'DELETED' : 'that WOULD be deleted') + ')');
  if (!APPLY) console.log('\nDRY RUN -- nothing was written. Pass --apply to commit these changes.');
}

main().catch((e) => { console.error('purge failed:', e.stack || e.message); process.exit(1); });
