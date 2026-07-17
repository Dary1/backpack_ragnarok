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
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

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

  await AT('REQ-0226 unit rung: resolveUnitArtIcons keys by UNIT id through the (shared) icon', async () => {
    // littleprincess + princess SHARE one icon artwork in the live content
    // (REQ-0170's free reference); adopting that ONE artwork must resolve
    // BOTH units. elf's icon has no artwork row here -> omitted.
    await adoptedArt('units-002-roster-flux2:unit-princess', 'unit', null);
    const r = await storage.resolveUnitArtIcons({
      littleprincess: 'units-002-roster-flux2:unit-princess',
      princess: 'units-002-roster-flux2:unit-princess',
      elf: 'units-002-roster-flux2:unit-elf',
    });
    assert.strictEqual(r.littleprincess, 'units-002-roster-flux2:unit-princess', 'shared icon resolves unit 1');
    assert.strictEqual(r.princess, 'units-002-roster-flux2:unit-princess', 'shared icon resolves unit 2');
    assert.strictEqual(r.elf, undefined, 'icon with no artwork row -> omitted');
  });

  await AT('/api/content art_urls: unit ids ride the map (adopted icon present, un-adopted omitted)', async () => {
    await content.refreshArtUrls();
    const payload = content.getContent();
    const expected = '/api/art/' + encodeURIComponent('units-002-roster-flux2:unit-princess') + '.png';
    assert.strictEqual(payload.art_urls.littleprincess, expected, 'unit id keyed exactly like monsters');
    assert.strictEqual(payload.art_urls.princess, expected, 'the shared icon serves BOTH unit ids');
    assert.strictEqual(payload.art_urls.elf, undefined, 'unit whose icon has no adopted render omitted');
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
