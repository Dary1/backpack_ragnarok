#!/usr/bin/env node
// client/scripts/check_item_icon.mjs — REQ-0133 gate.
//
// Exercises the REAL production module client/src/board/itemArt.ts (pure: no
// Pixi/DOM/I/O, availability is an injected has(key) predicate), same vite-
// ssrLoadModule discipline as check_unit_icon.mjs. Proves the registry-first
// item chain: registry raster -> SVG sprite symbol -> placeholder, the raster
// manifest namespacing, and that a missing/failed registry raster falls THROUGH
// to the sprite (missing art never blocks a draw).
//
// Usage: node client/scripts/check_item_icon.mjs   (or: pnpm check:item-icon)
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');

async function loadModule() {
  const server = await createServer({
    configFile: false, root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  });
  try { return await server.ssrLoadModule('/src/board/itemArt.ts'); }
  finally { await server.close(); }
}

let failures = 0;
function check(name, cond) { if (cond) { console.log('  ok   ', name); } else { console.log('  FAIL ', name); failures++; } }

const M = await loadModule();
const { setItemArtUrls, getItemArtUrl, itemIconKey, itemIconRasters, resolveItemIcon } = M;

// key namespacing: item:<id>, distinct from unit:<id> / icon-*
check('itemIconKey namespaces as item:<id>', itemIconKey('blade') === 'item:blade');
check('item key never collides with the SVG symbol namespace', !itemIconKey('blade').startsWith('icon-'));

// manifest from the injected art_urls map
setItemArtUrls({ blade: '/api/art/blade.png', acc_gem: '/api/art/custom.png' });
const rasters = itemIconRasters();
check('itemIconRasters yields one entry per resolved url', rasters.length === 2);
check('raster entry key is namespaced, url is the resolved URL',
  rasters.some((r) => r.key === 'item:blade' && r.url === '/api/art/blade.png'));
check('getItemArtUrl returns the URL for a known id', getItemArtUrl('blade') === '/api/art/blade.png');
check('getItemArtUrl returns null for an unknown id', getItemArtUrl('nope') === null);

// resolution chain
const hasBoth = (k) => k === 'item:blade' || k === 'icon-blade';
check('registry rung wins when the registry raster is present',
  JSON.stringify(resolveItemIcon('blade', 'icon-blade', hasBoth)) === JSON.stringify({ rung: 'registry', key: 'item:blade' }));

const hasSpriteOnly = (k) => k === 'icon-blade'; // registry raster failed to load -> absent
const spriteRes = resolveItemIcon('blade', 'icon-blade', hasSpriteOnly);
check('a missing/failed registry raster falls THROUGH to the sprite symbol',
  spriteRes.rung === 'sprite' && spriteRes.key === 'icon-blade');

const hasNone = () => false;
const ph = resolveItemIcon('blade', 'icon-blade', hasNone);
check('nothing available -> placeholder (key null), never throws', ph.rung === 'placeholder' && ph.key === null);

check('an id with no sprite key and no registry -> placeholder',
  resolveItemIcon('mystery', null, hasNone).rung === 'placeholder');

// empty map clears
setItemArtUrls(null);
check('setItemArtUrls(null) clears the manifest', itemIconRasters().length === 0);

if (failures) { console.log('\nFAIL: ' + failures + ' item-icon assertion(s) failed.'); process.exit(1); }
console.log('\nPASS: item icon registry-first resolution chain.');
process.exit(0);
