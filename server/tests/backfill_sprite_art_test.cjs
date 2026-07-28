'use strict';
// server/tests/backfill_sprite_art_test.cjs -- REQ-0177 gates.
//
// TWO layers:
//  (A) DB-FREE mapping tests -- always run: symbol parse, inventory->row plan,
//      po/si/tm kind mapping, 5x5 mask build, decideActions idempotency truth
//      table, rasterSizeFor. No DATABASE_URL, no browser.
//  (B) pg TOOL test -- runs only with DATABASE_URL, in an ISOLATED namespace
//      (TMPHOME remap, exactly the artwork_test discipline) so it never touches
//      live/e2e rows. Rasterization is a FAKE injected into runBackfill (a tiny
//      deterministic PNG) so the test needs no chromium and is fast; the real
//      Playwright rasterizer is proven separately by the isolated live-shape run.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const tool = require(path.join(REPO, 'tools', 'backfill_sprite_art.cjs'));

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

// ---------- (A) DB-free mapping tests ----------

const symbols = tool.loadSheetSymbols(fs.readFileSync(path.join(REPO, 'content', 'sprite_all_v12.svg'), 'utf8'));
const symbolIds = new Set(symbols.map((s) => s.id));

T('parseSymbols: finds every <symbol> across all root blocks (blade + a frost-tier symbol)', () => {
  assert.ok(symbols.length >= 22, 'at least 22 symbols, got ' + symbols.length);
  assert.ok(symbolIds.has('icon-blade'), 'icon-blade found');
  assert.ok(symbolIds.has('icon-frost_orb'), 'icon-frost_orb (later root block) found');
});

T('buildInventory: the 15 served po/si/tm entities, all with a real sprite symbol', () => {
  const inv = tool.buildInventory(symbolIds);
  assert.strictEqual(inv.length, 15, 'inventory count (8 po + 6 si + 1 tm)');
  assert.ok(inv.every((r) => r.hasSymbol), 'every served entity has a sprite symbol');
  const blade = inv.find((r) => r.id === 'blade');
  assert.strictEqual(blade.icon, 'icon-blade');
  assert.strictEqual(blade.plan.kind, 'po');
});

T('kind mapping: po->po, si->si, tm->si (documented tm-kind decision)', () => {
  assert.strictEqual(tool.KIND_MAP.po, 'po');
  assert.strictEqual(tool.KIND_MAP.si, 'si');
  assert.strictEqual(tool.KIND_MAP.tm, 'si');
  assert.strictEqual(tool.artworkPlanFor({ id: 'lrdst' }, 'tm').kind, 'si');
  const tmPlan = tool.artworkPlanFor({ id: 'lrdst' }, 'tm');
  assert.strictEqual(tmPlan.shape, null);
  assert.deepStrictEqual([tmPlan.gen_width, tmPlan.gen_height], [256, 256]);
});

T('maskFromShape: normalizes offsets to the bbox top-left; 5x5 bool', () => {
  const mask = tool.maskFromShape([[0, 0], [1, 0]]);
  assert.strictEqual(mask.length, 5);
  assert.strictEqual(mask[0][0], true);
  assert.strictEqual(mask[1][0], true);
  assert.strictEqual(mask[0][1], false);
  // negative / offset origin normalizes
  const m2 = tool.maskFromShape([[2, 3], [2, 4]]);
  assert.strictEqual(m2[0][0], true);
  assert.strictEqual(m2[0][1], true);
});

T('maskFromShape: a footprint larger than 5x5 fails loudly', () => {
  let threw = null;
  try { tool.maskFromShape([[0, 0], [0, 5]]); } catch (e) { threw = e; }
  assert.ok(threw && /5x5/.test(threw.message), 'oversize shape throws');
});

T('artworkPlanFor: po size derives from footprint (blade 1x2 -> 256x512)', () => {
  const plan = tool.artworkPlanFor({ id: 'blade', shape: [[0, 0], [1, 0]] }, 'po');
  assert.deepStrictEqual([plan.gen_width, plan.gen_height], [256, 512]);
  assert.ok(plan.shape && plan.shape.mask, 'po carries a mask');
});

T('decideActions: idempotency truth table (INSERT-only, never overwrite)', () => {
  assert.deepStrictEqual(
    tool.decideActions({ artworkExists: false, sentinelRenderExists: false, adopted: false, defExists: true, artworkRefSet: false }),
    { createArtwork: true, createRender: true, adopt: true, linkDef: true }, 'fresh entity: everything');
  assert.deepStrictEqual(
    tool.decideActions({ artworkExists: true, sentinelRenderExists: true, adopted: true, defExists: true, artworkRefSet: true }),
    { createArtwork: false, createRender: false, adopt: false, linkDef: false }, 'fully-done entity: nothing (re-run no-op)');
  assert.deepStrictEqual(
    tool.decideActions({ artworkExists: true, sentinelRenderExists: false, adopted: true, defExists: true, artworkRefSet: true }),
    { createArtwork: false, createRender: true, adopt: false, linkDef: false }, 'explicit selection: insert sentinel render but do NOT re-adopt / re-link');
  assert.deepStrictEqual(
    tool.decideActions({ artworkExists: false, sentinelRenderExists: false, adopted: false, defExists: false, artworkRefSet: false }),
    { createArtwork: true, createRender: true, adopt: true, linkDef: false }, 'no content_def -> no linkDef (exact-name rung covers it)');
});

T('rasterSizeFor: longer viewBox edge maps to 256, aspect preserved', () => {
  const sq = tool.rasterSizeFor({ width: 64, height: 64 });
  assert.deepStrictEqual([sq.w, sq.h], [256, 256]);
  const wide = tool.rasterSizeFor({ width: 64, height: 32 });
  assert.deepStrictEqual([wide.w, wide.h], [256, 128]);
});

// ---------- (B) pg tool test (isolated namespace) ----------

async function runPg() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-backfill-test-'));
  fs.symlinkSync(REPO, path.join(tmpHome, 'backpack_ragnarok'));
  const realHome = os.homedir;
  os.homedir = () => tmpHome;
  process.env.STORAGE_BACKEND = 'pg';
  const storage = require(path.join(REPO, 'server', 'storage.cjs'));

  // A deterministic, browser-free fake rasterizer: a tiny non-empty PNG per icon.
  const crypto = require('crypto');
  const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG magic + IHDR start (bytes only need to be non-empty)
  function fakeRasterize(syms) {
    const map = new Map();
    for (const s of syms) map.set(s.id, { buffer: fakePng, sha256: crypto.createHash('sha256').update(fakePng).digest('hex'), width: 256, height: 256 });
    return Promise.resolve(map);
  }

  await storage.clearAllArtworks();
  await storage.clearAllContent();

  await AT('pg: dry-run writes NOTHING', async () => {
    const c = await tool.runBackfill({ dryRun: true, storage, rasterize: fakeRasterize, log: () => {} });
    assert.strictEqual(c.entities, 15);
    assert.strictEqual(c.artworks, 0);
    assert.strictEqual(c.renders, 0);
    const blade = await storage.getArtworkByName('blade');
    assert.strictEqual(blade, null, 'dry-run created no artwork');
  });

  await AT('pg: first run creates 15 artworks + 15 sentinel renders + 15 adoptions', async () => {
    // Pre-seed an EXPLICIT selection on blade: an existing artwork with its own
    // adopted (non-sentinel) render + an explicit content_def artwork_ref.
    const bladeArt = await storage.createArtwork({ system_name: 'blade', kind: 'po', shape: { mask: tool.maskFromShape([[0, 0], [1, 0]]) }, gen_width: 256, gen_height: 512 });
    const rr = await storage.createRender(bladeArt.id, 7, 'ok');
    await storage.updateRenderResult(rr.id, { status: 'ok', image: Buffer.from('explicit'), image_sha256: 'ex', final_prompt: 'x', params: {}, error: null });
    await storage.adoptRender('blade', 7);
    await storage.createContentDef({ system_name: 'blade', kind: 'po_def', brief: '', schema_ref: 'po/2' });
    await storage.updateContentDef('blade', { artwork_ref: 'blade_explicit_choice' });
    // A content_def for hilt WITHOUT an artwork_ref -> should get linked.
    await storage.createContentDef({ system_name: 'hilt', kind: 'po_def', brief: '', schema_ref: 'po/2' });

    const c = await tool.runBackfill({ dryRun: false, storage, rasterize: fakeRasterize, log: () => {} });
    // blade artwork already existed -> not recreated (14 new artworks).
    assert.strictEqual(c.artworks, 14, 'created 14 new artworks (blade pre-existed)');
    assert.strictEqual(c.renders, 15, 'inserted 15 sentinel renders (incl. blade\'s, its sentinel was absent)');
    assert.strictEqual(c.adoptions, 14, 'adopted 14 (blade keeps its explicit adoption)');
    assert.strictEqual(c.defsLinked, 1, 'linked exactly hilt (blade\'s explicit artwork_ref left intact)');

    // blade: explicit selection preserved end-to-end.
    const bladeAfter = await storage.getArtworkByName('blade');
    const adopted = await storage.getAdoptedRender('blade');
    assert.strictEqual(adopted.seed, 7, 'blade still adopts its explicit render, NOT the sentinel');
    const bladeDef = await storage.getContentDefByName('blade');
    assert.strictEqual(bladeDef.artwork_ref, 'blade_explicit_choice', 'blade artwork_ref NOT overwritten');
    // but a sentinel render was still inserted for blade (INSERT-only, additive).
    const bladeRenders = await storage.listRenders(bladeAfter.id);
    assert.ok(bladeRenders.some((r) => r.seed === tool.SENTINEL_SEED), 'blade gained a sentinel render');

    // hilt: linked + adopted the sentinel.
    const hiltDef = await storage.getContentDefByName('hilt');
    assert.strictEqual(hiltDef.artwork_ref, 'hilt', 'hilt def linked to its own artwork');
    const hiltAdopted = await storage.getAdoptedRender('hilt');
    assert.strictEqual(hiltAdopted.seed, tool.SENTINEL_SEED, 'hilt adopts the sentinel render');

    // a plain entity (acc_gem, si): artwork + sentinel + adopt, no def.
    const gem = await storage.getAdoptedRender('acc_gem');
    assert.strictEqual(gem.seed, tool.SENTINEL_SEED);
    assert.strictEqual(gem.kind, 'si');
  });

  await AT('pg: second run is a pure no-op (0 writes) -- idempotent', async () => {
    const c = await tool.runBackfill({ dryRun: false, storage, rasterize: fakeRasterize, log: () => {} });
    assert.deepStrictEqual(
      { a: c.artworks, r: c.renders, ad: c.adoptions, d: c.defsLinked },
      { a: 0, r: 0, ad: 0, d: 0 }, 'second run writes nothing');
  });

  await AT('pg: the sentinel render carries sprite-backfill provenance', async () => {
    const art = await storage.getArtworkByName('acc_gem');
    const renders = await storage.listRenders(art.id);
    const sent = renders.find((r) => r.seed === tool.SENTINEL_SEED);
    assert.ok(sent, 'sentinel render present');
    assert.strictEqual(sent.params.source, 'sprite-backfill');
    assert.strictEqual(sent.params.origin, 'content/sprite_all_v12.svg#icon-acc_gem');
    assert.ok(typeof sent.params.imported_at === 'string', 'imported_at recorded');
  });

  await storage.clearAllArtworks();
  await storage.clearAllContent();
  await storage.closeArtPool();
  await storage.closeContentPool();
  os.homedir = realHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

(async () => {
  if (process.env.DATABASE_URL) {
    await runPg();
  } else {
    console.log('SKIP backfill pg tool test (no DATABASE_URL); DB-free mapping tests ran.');
  }
  console.log('\nbackfill_sprite_art_test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });


// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose: these suites call their T()/AT() at module scope, so a
// `const` binding declared down here would be in the temporal dead zone when
// the first tests run. `var` + `function` hoist to the top of the module, and
// the require is deferred to the first call so it never runs ahead of a
// harness's own os.homedir()/env setup. See tools/lib/test_clock.cjs.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
