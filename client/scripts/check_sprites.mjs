#!/usr/bin/env node
// client/scripts/check_sprites.mjs — REQ-0026 follow-up (PO art missing bug).
//
// Runs the SAME repackaging logic as client/src/board/sprites.ts (imports
// its real, unduplicated parseSymbols()/standaloneSvgString() exports --
// no fork of the logic) over every <symbol> in content/sprite_all_v8.svg,
// writes each standalone SVG document to a temp dir, then rasterizes each
// with the same cairosvg the server venv / tools/tool_fit_check.py use and
// asserts every one produced visible (alpha>0) pixels.
//
// sprites.ts's parseSymbols()/standaloneSvgString() are plain functions
// with no browser-global dependency beyond the DOMParser/XMLSerializer
// *instances* passed in as arguments -- in the browser those are the
// native globals; here we hand in @xmldom/xmldom's implementations of the
// same two interfaces, so this script exercises the real production code
// path, not a reimplementation of it.
//
// Usage: node client/scripts/check_sprites.mjs
// Exit code 0 = all symbols rasterize non-blank; 1 = at least one blank/error.
import { createServer } from 'vite';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..'); // client/
const REPO_ROOT = path.resolve(CLIENT_ROOT, '..'); // repo root
const PYTHON = path.join(REPO_ROOT, '.venv', 'bin', 'python');
const RASTERIZE_HELPER = path.join(__dirname, '_rasterize_check.py');

async function loadSpritesModule() {
  const server = await createServer({
    configFile: false,
    root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    return { mod: await server.ssrLoadModule('/src/board/sprites.ts'), server };
  } catch (e) {
    await server.close();
    throw e;
  }
}

async function main() {
  const { mod, server } = await loadSpritesModule();
  const { parseSymbols, standaloneSvgString } = mod;

  const spriteSheetPath = path.join(REPO_ROOT, 'content', 'sprite_all_v8.svg');
  const fs = await import('node:fs');
  const svgSource = fs.readFileSync(spriteSheetPath, 'utf-8');

  const symbols = parseSymbols(svgSource, new DOMParser(), new XMLSerializer());
  await server.close();

  console.log(`Parsed ${symbols.length} symbols from ${path.relative(REPO_ROOT, spriteSheetPath)}`);
  if (symbols.length === 0) {
    console.error('FAIL: zero symbols parsed -- parseSymbols is broken.');
    process.exit(1);
  }

  const outDir = mkdtempSync(path.join(tmpdir(), 'sprite_check-'));
  const manifest = [];
  for (const sym of symbols) {
    const svgDoc = standaloneSvgString(sym);
    const svgPath = path.join(outDir, `${sym.id}.svg`);
    writeFileSync(svgPath, svgDoc, 'utf-8');
    manifest.push({ id: sym.id, viewBox: sym.viewBox, width: sym.width, height: sym.height, svgPath });
  }

  const manifestPath = path.join(outDir, '_manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`Wrote ${manifest.length} standalone SVGs to ${outDir}`);
  console.log(`Rasterizing with ${PYTHON} (cairosvg) ...`);

  let resultJson;
  try {
    resultJson = execFileSync(PYTHON, [RASTERIZE_HELPER, manifestPath], { encoding: 'utf-8' });
  } catch (e) {
    console.error('FAIL: rasterize helper crashed');
    console.error(e.stdout ?? '');
    console.error(e.stderr ?? e.message);
    process.exit(1);
  }

  const results = JSON.parse(resultJson);
  let blankCount = 0;
  let errorCount = 0;
  console.log('');
  console.log('id'.padEnd(24), 'status'.padEnd(10), 'alpha_px', 'aspect_ok');
  for (const r of results) {
    if (r.error) {
      errorCount++;
      console.log(r.id.padEnd(24), 'ERROR'.padEnd(10), '-', '-', ' ', r.error);
    } else if (r.alphaCount === 0) {
      blankCount++;
      console.log(r.id.padEnd(24), 'BLANK'.padEnd(10), String(r.alphaCount), r.aspectOk ? 'yes' : 'no');
    } else {
      console.log(r.id.padEnd(24), 'ok'.padEnd(10), String(r.alphaCount), r.aspectOk ? 'yes' : 'no');
    }
  }
  console.log('');
  console.log(`Total: ${results.length}, blank: ${blankCount}, errors: ${errorCount}, non-blank: ${results.length - blankCount - errorCount}`);

  rmSync(outDir, { recursive: true, force: true });

  if (blankCount > 0 || errorCount > 0) {
    console.error(`FAIL: ${blankCount} blank + ${errorCount} error symbol(s) out of ${results.length}`);
    process.exit(1);
  }
  console.log(`PASS: ${results.length}/${results.length} symbols non-blank.`);
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
