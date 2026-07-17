'use strict';
// server/tests/seed_derive_pg_test.cjs -- REQ-0188 gates G2 + G3 (pg, isolated namespace).
//
// (A) SEED: creates the missing artwork ROWS from def geometry; SKIPs any entity
//     already covered (exact-name row OR an explicit ref to a differently-named
//     artwork); a second run is a pure no-op; NO renders are fabricated.
// (B) DERIVE end-to-end: after seeding every def from its own geometry, the mirror
//     generator finds ZERO drift -- the no-op BY CONSTRUCTION, proven against the
//     real storage chokepoint (the DB-free round-trip test proves it purely).
//
// ISOLATED namespace via the artwork_test/backfill discipline: os.homedir() is
// remapped to a tmp dir (symlinked to the repo) BEFORE require('storage'), so the
// namespace prefix is unique and no live/e2e row is ever touched.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const seedTool = require(path.join(REPO, 'tools', 'seed_artwork_from_def.cjs'));
const deriveTool = require(path.join(REPO, 'tools', 'derive_def_geometry.cjs'));

let pass = 0, fail = 0;
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

async function main() {
  if (!process.env.DATABASE_URL) { console.log('SKIP seed_derive_pg_test (no DATABASE_URL)'); return; }
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-seed0188-'));
  fs.symlinkSync(REPO, path.join(tmpHome, 'backpack_ragnarok'));
  const realHome = os.homedir;
  os.homedir = () => tmpHome;
  process.env.STORAGE_BACKEND = 'pg';
  const storage = require(path.join(REPO, 'server', 'storage.cjs'));

  const planSize = seedTool.buildPlan(REPO).length; // 7 monsters + 22 unique po = 29

  try {
    await storage.clearAllArtworks();
    await storage.clearAllContent();

    await AT('seed dry-run writes NOTHING (plan previews all ' + planSize + ' uncovered entities)', async () => {
      const c = await seedTool.runSeed({ dryRun: true, storage, root: REPO, log: () => {} });
      assert.strictEqual(c.scanned, planSize);
      assert.strictEqual(c.created, planSize, 'every entity is uncovered in an empty namespace');
      assert.strictEqual(await storage.getArtworkByName('frost_gnoll'), null, 'dry-run created no row');
    });

    await AT('seed first run creates every missing ROW from def geometry (NO renders)', async () => {
      const c = await seedTool.runSeed({ dryRun: false, storage, root: REPO, log: () => {} });
      assert.strictEqual(c.created, planSize, 'created all ' + planSize);
      assert.strictEqual(c.skippedCovered, 0);
      // monster: footprint [1,1] -> {w:1,h:1}, 128x128; no render
      const fg = await storage.getArtworkByName('frost_gnoll');
      assert.ok(fg && fg.kind === 'monster', 'frost_gnoll monster artwork created');
      assert.deepStrictEqual([fg.shape.w, fg.shape.h], [1, 1], 'frost_gnoll {w,h}=1,1');
      assert.deepStrictEqual([fg.gen_width, fg.gen_height], [128, 128]);
      assert.strictEqual(fg.adopted_render_id, null, 'no render fabricated (shape-only row)');
      const rends = await storage.listRenders(fg.id);
      assert.strictEqual(rends.length, 0, 'seed creates ZERO renders');
      // po non-square: blade [[0,0],[1,0]] -> mask 2 vertical cells, 256x512
      const blade = await storage.getArtworkByName('blade');
      assert.ok(blade && blade.kind === 'po');
      assert.deepStrictEqual([blade.gen_width, blade.gen_height], [256, 512], 'blade 1-wide 2-tall');
      const active = [];
      blade.shape.mask.forEach((row, r) => row.forEach((v, cc2) => { if (v) active.push([r, cc2]); }));
      assert.deepStrictEqual(active, [[0, 0], [1, 0]], 'blade mask = vertical bar');
    });

    await AT('seed second run is a pure no-op (every entity now covered)', async () => {
      const c = await seedTool.runSeed({ dryRun: false, storage, root: REPO, log: () => {} });
      assert.strictEqual(c.created, 0, 'idempotent: 0 created');
      assert.strictEqual(c.skippedCovered, planSize);
    });

    await AT('DERIVE end-to-end: seeded content has ZERO drift (no-op by construction)', async () => {
      const res = await deriveTool.runDerive({ write: false, storage, root: REPO, log: () => {} });
      assert.strictEqual(res.changed.length, 0, 'no drift after seeding from def geometry: ' + JSON.stringify(res.changed));
    });

    // ---- skip rules: an already-covered entity is never seeded again ----
    await storage.clearAllArtworks();
    await storage.clearAllContent();

    await AT('seed SKIPs an entity whose def has an explicit ref to a DIFFERENT-named artwork', async () => {
      // mimic the live in-flight frost_gnoll -> monsters-003:gnoll link
      await storage.createArtwork({ system_name: 'ext_gnoll_art', kind: 'monster', shape: { w: 3, h: 4 }, gen_width: 384, gen_height: 512 });
      await storage.createContentDef({ system_name: 'frost_gnoll', kind: 'monster_def', brief: '', schema_ref: 'enemy/1' });
      await storage.updateContentDef('frost_gnoll', { artwork_ref: 'ext_gnoll_art' });
      // and a pre-existing exact-name row for blade
      await storage.createArtwork({ system_name: 'blade', kind: 'po', shape: { mask: seedTool.buildPlan(REPO).find((p) => p.id === 'blade').plan.shape.mask }, gen_width: 256, gen_height: 512 });

      const c = await seedTool.runSeed({ dryRun: false, storage, root: REPO, log: () => {} });
      assert.strictEqual(c.created, planSize - 2, 'skipped exactly frost_gnoll (ref) + blade (exact-name)');
      assert.strictEqual(c.skippedCovered, 2);
      assert.strictEqual(await storage.getArtworkByName('frost_gnoll'), null, 'NO duplicate frost_gnoll row created (covered by ref)');
      const ext = await storage.getArtworkByName('ext_gnoll_art');
      assert.deepStrictEqual([ext.shape.w, ext.shape.h], [3, 4], 'the referenced artwork is untouched');
    });
  } finally {
    if (storage.closeArtPool) await storage.closeArtPool();
    if (storage.closeContentPool) await storage.closeContentPool();
    os.homedir = realHome;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  }
}

main().then(() => {
  console.log('\nREQ-0188 seed/derive (pg): ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
