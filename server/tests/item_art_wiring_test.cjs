'use strict';
// server/tests/item_art_wiring_test.cjs -- REQ-0133 (server tier).
// Proves the storage-chokepoint registry-first resolver (resolveItemArtNames)
// and the /api/content warm-cache art_urls map: def.artwork_ref adopted ->
// exact-name adopted -> omitted (client sprite fallback). pg-backed, ISOLATED
// namespace (TMPHOME remap), SKIPPED cleanly with no DATABASE_URL.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

if (!process.env.DATABASE_URL) { console.log('SKIP item_art_wiring_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';

const REPO = path.join(__dirname, '..', '..');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-itemart-test-'));
fs.symlinkSync(REPO, path.join(tmpHome, 'backpack_ragnarok'));
const realHome = os.homedir;
os.homedir = () => tmpHome;

const storage = require(path.join(REPO, 'server', 'storage.cjs'));
const content = require(path.join(REPO, 'server', 'lib', 'content.cjs'));
const tool = require(path.join(REPO, 'tools', 'backfill_sprite_art.cjs'));

let pass = 0, fail = 0;
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
async function adoptedArt(name, kind, shape) {
  const a = await storage.createArtwork({ system_name: name, kind, shape, gen_width: 256, gen_height: kind === 'po' ? 512 : 256 });
  const r = await storage.createRender(a.id, 1, 'ok');
  await storage.updateRenderResult(r.id, { status: 'ok', image: fakePng, image_sha256: crypto.createHash('sha256').update(fakePng).digest('hex'), final_prompt: null, params: {}, error: null });
  await storage.adoptRender(name, 1);
  return a;
}

(async () => {
  await storage.clearAllArtworks();
  await storage.clearAllContent();

  await AT('exact-name rung: an adopted artwork named exactly as the item resolves to itself', async () => {
    await adoptedArt('blade', 'po', { mask: tool.maskFromShape([[0, 0], [1, 0]]) });
    const r = await storage.resolveItemArtNames(['blade', 'hilt']);
    assert.strictEqual(r.blade, 'blade', 'blade resolves to its exact-name artwork');
    assert.strictEqual(r.hilt, undefined, 'hilt (no artwork) is omitted -> sprite fallback');
  });

  await AT('artwork_ref rung: an explicit ref to an adopted artwork wins over exact-name', async () => {
    await adoptedArt('custom_blade', 'po', { mask: tool.maskFromShape([[0, 0], [1, 0]]) });
    await storage.createContentDef({ system_name: 'blade', kind: 'po_def', brief: '', schema_ref: 'po/2' });
    await storage.updateContentDef('blade', { artwork_ref: 'custom_blade' });
    const r = await storage.resolveItemArtNames(['blade']);
    assert.strictEqual(r.blade, 'custom_blade', 'artwork_ref adopted render wins the chain');
  });

  await AT('graceful degradation: artwork_ref to an UNADOPTED artwork falls to exact-name', async () => {
    await storage.createArtwork({ system_name: 'unadopted_ref', kind: 'si', shape: null, gen_width: 256, gen_height: 256 });
    await storage.updateContentDef('blade', { artwork_ref: 'unadopted_ref' });
    const r = await storage.resolveItemArtNames(['blade']);
    assert.strictEqual(r.blade, 'blade', 'ref w/o adopted render degrades to the exact-name adopted render');
  });

  await AT('omission: an item whose only artwork has no adopted render is omitted', async () => {
    await storage.createArtwork({ system_name: 'hilt', kind: 'po', shape: { mask: tool.maskFromShape([[0, 0]]) }, gen_width: 256, gen_height: 256 });
    const r = await storage.resolveItemArtNames(['hilt']);
    assert.strictEqual(r.hilt, undefined, 'un-adopted exact-name artwork -> omitted (sprite fallback)');
  });

  await AT('/api/content art_urls: getContent attaches the resolved URL map', async () => {
    await storage.updateContentDef('blade', { artwork_ref: 'custom_blade' }); // re-point (prior test degraded it)
    await content.refreshArtUrls();
    const payload = content.getContent();
    assert.ok(payload.art_urls && typeof payload.art_urls === 'object', 'art_urls present');
    assert.strictEqual(payload.art_urls.blade, '/api/art/custom_blade.png', 'blade URL points at the ref-resolved artwork');
    // acc_gem etc. are real live ids with no artwork here -> absent.
    assert.strictEqual(payload.art_urls.acc_gem, undefined, 'unresolved live id omitted');
  });

  await storage.clearAllArtworks();
  await storage.clearAllContent();
  await storage.closeArtPool();
  await storage.closeContentPool();
  os.homedir = realHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  console.log('\nitem_art_wiring_test: ' + pass + ' passed, ' + fail + ' failed');
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
