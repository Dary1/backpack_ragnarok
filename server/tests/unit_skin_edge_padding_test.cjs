'use strict';
// server/tests/unit_skin_edge_padding_test.cjs -- REQ-0291.
// Proves the additive edge_padding payload field on bpskin-slot unit_skins:
// storage.resolveSkinEdgePaddings walks the SAME ref-first/exact-name chain
// art_urls uses and reads edge_padding from the resolved artwork; content.getContent
// overlays it onto each bpskin unit_skins entry. pg-backed, ISOLATED namespace
// (TMPHOME remap -- never touches live rows), SKIPPED cleanly with no DATABASE_URL.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

if (!process.env.DATABASE_URL) { console.log('SKIP unit_skin_edge_padding_test.cjs (no DATABASE_URL)'); process.exit(0); }
process.env.STORAGE_BACKEND = 'pg';

const REPO = path.join(__dirname, '..', '..');
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-edgepad-test-'));
fs.symlinkSync(REPO, path.join(tmpHome, 'backpack_ragnarok'));
const realHome = os.homedir;
os.homedir = () => tmpHome;

const storage = require(path.join(REPO, 'server', 'storage.cjs'));
const content = require(path.join(REPO, 'server', 'lib', 'content.cjs'));

let pass = 0, fail = 0;
async function AT(name, fn) { try { await fn(); console.log('PASS  ' + name); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

const fakePng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
async function adoptedBpskin(name, edge_padding) {
  const a = await storage.createArtwork({ system_name: name, kind: 'bpskin', shape: null, gen_width: 1024, gen_height: 1024, edge_padding: edge_padding });
  const r = await storage.createRender(a.id, 1, 'ok');
  await storage.updateRenderResult(r.id, { status: 'ok', image: fakePng, image_sha256: crypto.createHash('sha256').update(fakePng).digest('hex'), final_prompt: null, params: {}, error: null });
  await storage.adoptRender(name, 1);
  return a;
}

(async () => {
  await storage.clearAllArtworks();
  await storage.clearAllContent();

  await AT('exact-name rung: edge_padding comes from the adopted exact-name artwork', async () => {
    await adoptedBpskin('uskin_bp_elf', 72);
    const r = await storage.resolveSkinEdgePaddings(['uskin_bp_elf', 'uskin_bp_orc']);
    assert.strictEqual(r.uskin_bp_elf, 72, 'elf band = 72');
    assert.strictEqual(r.uskin_bp_orc, undefined, 'orc (no artwork) omitted');
  });

  await AT('artwork_ref rung: an explicit ref wins, and its edge_padding is read', async () => {
    await adoptedBpskin('custom_frame', 40);
    await storage.createContentDef({ system_name: 'uskin_bp_dwarf', kind: 'unit_skin', brief: '', schema_ref: 'unit_skin/1' });
    await storage.updateContentDef('uskin_bp_dwarf', { artwork_ref: 'custom_frame' });
    const r = await storage.resolveSkinEdgePaddings(['uskin_bp_dwarf']);
    assert.strictEqual(r.uskin_bp_dwarf, 40, 'dwarf band = ref artwork edge_padding');
  });

  await AT('omission: an adopted artwork with a NULL edge_padding yields no band', async () => {
    await adoptedBpskin('uskin_bp_thief', null);
    const r = await storage.resolveSkinEdgePaddings(['uskin_bp_thief']);
    assert.strictEqual(r.uskin_bp_thief, undefined, 'null edge_padding -> omitted (client keeps palette welt)');
  });

  await AT('omission: an UNADOPTED artwork with edge_padding is not served', async () => {
    await storage.createArtwork({ system_name: 'uskin_bp_angel', kind: 'bpskin', shape: null, gen_width: 1024, gen_height: 1024, edge_padding: 55 });
    const r = await storage.resolveSkinEdgePaddings(['uskin_bp_angel']);
    assert.strictEqual(r.uskin_bp_angel, undefined, 'unadopted -> omitted (no fill_texture would paint either)');
  });

  await AT('/api/content unit_skins: getContent overlays edge_padding onto the bpskin entry', async () => {
    await content.refreshArtUrls();
    const payload = content.getContent();
    const skins = payload.unit_skins || {};
    assert.ok(skins.uskin_bp_elf, 'uskin_bp_elf present in unit_skins');
    assert.strictEqual(skins.uskin_bp_elf.edge_padding, 72, 'elf entry carries edge_padding=72');
    assert.strictEqual(skins.uskin_bp_elf.slot, 'bpskin', 'still a bpskin-slot entry');
    // additive: a bpskin entry whose artwork is not adopted has NO edge_padding key
    // (older clients see exactly the pre-REQ-0291 shape).
    assert.strictEqual(Object.prototype.hasOwnProperty.call(skins.uskin_bp_orc || {}, 'edge_padding'), false, 'unresolved bpskin entry carries no edge_padding field');
    // and a unit-slot (portrait) entry is never touched.
    if (skins.uskin_elf) assert.strictEqual(Object.prototype.hasOwnProperty.call(skins.uskin_elf, 'edge_padding'), false, 'unit-slot entry never carries edge_padding');
  });

  await storage.clearAllArtworks();
  await storage.clearAllContent();
  await storage.closeArtPool();
  await storage.closeContentPool();
  os.homedir = realHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  console.log('\nunit_skin_edge_padding_test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
