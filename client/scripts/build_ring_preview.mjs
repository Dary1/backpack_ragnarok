#!/usr/bin/env node
// client/scripts/build_ring_preview.mjs — REQ-0125a, G7 visual gate.
//
// The charge ring is finished code fed a null value in production (no charge
// data exists in this codebase — see chargeRing.ts's header), so it cannot be
// verified by looking at the board: nothing is drawn there, correctly. This
// script is how it gets LOOKED AT anyway.
//
// It renders the ring at every fill step by calling the REAL production
// geometry function (chargeRing.ts's chargeRingArc, loaded through Vite exactly
// as check_sprites.mjs loads sprites.ts) and emitting an SVG arc per step. The
// math is NOT reimplemented here — that would make the preview a picture of a
// second implementation, i.e. worthless as a gate. If chargeRingArc is wrong,
// this page is wrong in the same way, visibly.
//
// Output: web/preview/unit-charge-ring/index.html (backpack-dev docroot).
// Usage: node client/scripts/build_ring_preview.mjs
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CLIENT_ROOT, '..');
const OUT_DIR = path.join(REPO_ROOT, 'web', 'preview', 'unit-charge-ring');

const server = await createServer({
  configFile: false,
  root: CLIENT_ROOT,
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: 'error',
});
const { chargeRingArc, RING_RADIUS, RING_WIDTH, DEFAULT_RING_STYLE } =
  await server.ssrLoadModule('/src/board/chargeRing.ts');
await server.close();

// Board geometry, mirrored from BoardRenderer's unit draw: core disc r=26,
// art box 44x44 centred. The ring sits OUTSIDE the disc (r=30) so it never
// occludes the character's face — G4 wants the silhouette readable at 64px.
const CORE_R = 26;
const BOX = 88;
const C = BOX / 2;

// SVG arcs need endpoint parameterisation; Pixi's g.arc() takes angles. Convert
// here (presentation only — the ANGLES themselves still come from the real
// chargeRingArc, which is the thing under test).
function arcPath(cx, cy, r, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  // A full sweep cannot be drawn as one arc segment (start == end); split it.
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    const xm = cx + r * Math.cos(a0 + Math.PI);
    const ym = cy + r * Math.sin(a0 + Math.PI);
    return `M ${x0} ${y0} A ${r} ${r} 0 1 1 ${xm} ${ym} A ${r} ${r} 0 1 1 ${x0} ${y0}`;
  }
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

const STEPS = [
  { charge: null, label: 'null', note: 'no charge concept / no data — THE PRODUCTION CASE TODAY' },
  { charge: 0, label: '0', note: 'idle: no ring (an empty ring on every unit is noise)' },
  { charge: 0.05, label: '0.05', note: 'just begun' },
  { charge: 0.25, label: '0.25', note: '' },
  { charge: 0.5, label: '0.50', note: '' },
  { charge: 0.75, label: '0.75', note: '' },
  { charge: 0.99, label: '0.99', note: 'nearly ready' },
  { charge: 1, label: '1.00', note: 'READY (fill switches to the ready colour)' },
  { charge: 4.2, label: '4.2', note: 'out of band → clamped to full, never throws' },
  { charge: NaN, label: 'NaN', note: 'bad data → no ring, never throws' },
];

const cells = STEPS.map(({ charge, label, note }) => {
  const arc = chargeRingArc(charge);
  const track = arc
    ? `<circle cx="${C}" cy="${C}" r="${RING_RADIUS}" fill="none" stroke="${DEFAULT_RING_STYLE.trackColor}" stroke-width="${RING_WIDTH}"/>`
    : '';
  const fill = arc
    ? `<path d="${arcPath(C, C, RING_RADIUS, arc.startAngle, arc.endAngle)}" fill="none" stroke="${
        arc.full ? DEFAULT_RING_STYLE.readyColor : DEFAULT_RING_STYLE.fillColor
      }" stroke-width="${RING_WIDTH}" stroke-linecap="round"/>`
    : '';
  return `<figure class="cell">
  <svg viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}">
    <circle cx="${C}" cy="${C}" r="${CORE_R}" fill="#0e0d0b" stroke="#59d6d6" stroke-opacity="0.5" stroke-width="1"/>
    <text x="${C}" y="${C + 4}" text-anchor="middle" font-size="10" fill="#59d6d6" opacity="0.55">unit</text>
    ${track}
    ${fill}
  </svg>
  <figcaption><b>charge = ${label}</b>${note ? `<span>${note}</span>` : ''}</figcaption>
</figure>`;
}).join('\n');

const html = `<!doctype html>
<meta charset="utf-8">
<title>REQ-0125a — G7 unit charge ring</title>
<style>
  body { background:#14120f; color:#d8d2c6; font:14px/1.5 system-ui,sans-serif; margin:0; padding:32px; }
  h1 { font-size:18px; margin:0 0 4px; }
  p.sub { color:#8d8577; margin:0 0 24px; max-width:70ch; }
  .grid { display:flex; flex-wrap:wrap; gap:20px; }
  .cell { margin:0; background:#1b1815; border:1px solid #2b2723; border-radius:6px; padding:12px; width:160px; }
  figcaption { margin-top:8px; font-size:12px; }
  figcaption b { display:block; color:#e6dfd2; }
  figcaption span { display:block; color:#8d8577; margin-top:2px; }
  code { color:#59d6d6; }
</style>
<h1>REQ-0125a — G7 unit charge ring</h1>
<p class="sub">
  Every ring below is drawn from the arc that <code>client/src/board/chargeRing.ts</code>'s
  <code>chargeRingArc()</code> returns — the same function the board renderer calls. No math is
  duplicated on this page. <b>On the live board the ring is not drawn at all</b>: no charge data
  exists anywhere in the codebase yet (the placement engine has no time axis; sim's only
  <code>cooldown</code> is the room re-entry timer, which belongs to REQ-0098's ring), so every
  production call site passes <code>null</code> — the first cell here. REQ-0129 supplies the real
  value; this page is the proof the drawing is ready for it.
</p>
<div class="grid">
${cells}
</div>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf-8');
console.log(`wrote ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'index.html'))} (${STEPS.length} steps)`);
