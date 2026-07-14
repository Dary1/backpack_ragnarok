#!/usr/bin/env node
// client/scripts/check_bpskin.mjs -- REQ-0126 gate. Exercises the REAL modules
// (client/src/board/skin/*.ts) from plain Node via vite ssrLoadModule (same rig
// as check_unit_icon.mjs): autotile resolver, bpskin/1 registry + validator,
// resolution chain, deterministic compositor + machine checks. Exit 0 = green.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
let fails = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); fails++; } else { console.log('ok  :', m); } }
function eq(a, b, m) { ok(a === b, `${m} (got ${a}, want ${b})`); }
async function main() {
  const server = await createServer({ root: CLIENT, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const at = await server.ssrLoadModule('/src/board/skin/autotile.ts');
    const reg = await server.ssrLoadModule('/src/board/skin/skinRegistry.ts');
    const res = await server.ssrLoadModule('/src/board/skin/bpSkinResolve.ts');
    const comp = await server.ssrLoadModule('/src/board/skin/composite.ts');
    const chk = await server.ssrLoadModule('/src/board/skin/checks.ts');
    const h1 = at.tileHistogram(at.resolveAutotile([[2, 2]]));
    eq(h1.outer, 4, '1x1 has 4 outer corners'); eq(h1.interior, 0, '1x1 has 0 interior');
    const hI = at.tileHistogram(at.resolveAutotile([[2, 2], [2, 3], [2, 4]]));
    eq(hI.outer, 4, 'I-tromino 4 outer'); eq(hI.inner, 0, 'I-tromino 0 inner');
    const hL = at.tileHistogram(at.resolveAutotile([[2, 2], [2, 3], [3, 2]]));
    eq(hL.inner, 1, 'L-tromino 1 inner (concave) corner'); eq(hL.outer, 5, 'L-tromino 5 outer');
    const hH = at.tileHistogram(at.resolveAutotile([[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]]));
    eq(hH.inner, 4, 'holed 3x3 ring 4 inner corners (the hole)');
    ok(at.resolveAutotile([[2, 2]]).length === 4, 'resolver total: 4 quadrants/cell');
    const defsDoc = JSON.parse(fs.readFileSync(path.join(REPO, 'content', 'live', 'live_bpskins.json'), 'utf8'));
    const defs = reg.loadSkinDefs(defsDoc);
    ok(defs['neutral'] && reg.isNeutral(defs['neutral']), 'neutral default registered + flagged');
    ok(defs['devornate'] && !reg.isNeutral(defs['devornate']), 'dev ornate registered');
    ok(defs['devornate'].corner_radius > 0, 'dev ornate has rounded corners (mandatory)');
    ok(reg.validateSkinDef(defs['neutral']).ok, 'neutral passes validation');
    ok(!reg.validateSkinDef({ kind: 'bpskin/1', id: 'x' }).ok, 'malformed def rejected');
    ok(!reg.validateSkinDef({ kind: 'wrong/1', id: 'x', name: 'x', palette: { fill: '#112233' }, corner_radius: 0, border_band: 0 }).ok, 'wrong kind rejected');
    const has = (id) => id in defs;
    eq(res.resolveBpSkin({ instanceSkinId: 'devornate' }, has).rung, 'instance', 'instance slot wins');
    eq(res.resolveBpSkin({ unitSetSkinId: 'devornate' }, has).rung, 'set', 'set skin next');
    eq(res.resolveBpSkin({}, has).rung, 'neutral', 'neutral default when nothing set');
    eq(res.resolveBpSkin({ instanceSkinId: 'ghost' }, has).rung, 'neutral', 'missing instance skin -> neutral (never blocks)');
    eq(res.resolveBpSkin({}, () => false).rung, 'plain', 'plain when even neutral absent');
    eq(res.resolveBpSkin({}, has).skinId, 'neutral', 'neutral rung yields neutral id');
    const shapes = [
      { n: '1x1', cells: [[2, 2]] },
      { n: 'L-tromino', cells: [[2, 2], [2, 3], [3, 2]] },
      { n: 'holed', cells: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 4], [4, 2], [4, 3], [4, 4]] },
    ];
    for (const s of shapes) for (const skinId of ['neutral', 'devornate']) {
      const c = comp.compositeSkin(s.cells, defs[skinId], '#14181f');
      const rep = chk.checkComposite(c, s.cells, defs[skinId], 1);
      for (const f of rep.findings) if (!f.ok) console.error('  finding', f.check, f.detail);
      ok(rep.pass, `composite+checks green: ${s.n} / ${skinId}`);
    }
    const a = comp.compositeSkin([[2, 2], [2, 3]], defs['devornate'], '#14181f');
    const b = comp.compositeSkin([[2, 2], [2, 3]], defs['devornate'], '#14181f');
    ok(Buffer.compare(Buffer.from(a.rgba), Buffer.from(b.rgba)) === 0, 'compositor deterministic (byte-identical)');
  } finally { await server.close(); }
  if (fails) { console.error(`\n${fails} assertion(s) FAILED`); process.exit(1); }
  console.log('\ncheck_bpskin: ALL GREEN');
}
main().catch((e) => { console.error(e); process.exit(1); });
