// backpack_ragnarok -- server/tests/backfill_registry_test.cjs
// REQ-0151 ruling 3 (BACKFILL). DB-FREE: exercises the pure, deterministic
// parts of tools/backfill_registry.cjs -- manifest parsing -> row mapping and
// the adoption-evidence matcher (frame_report + byte match) -- against fixture
// manifests. No DATABASE_URL, no GPU, no network. Runs in the DB-free CI pass.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const bf = require('../../tools/backfill_registry.cjs');
const { deriveSize } = require('../services/art_sizing.cjs');

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.message)); fail++; } }

T('parity: kind mapping + shapes + seeds + prompts + system_names', () => {
  const manifest = { seed: 1, assets: [
    { id: 'iron_sword', kind: 'item', cells: [1, 3], subject: 'iron sword, white background', prompt_weighted: 'iron sword (anime:1.21)' },
    { id: 'chimera', kind: 'monster', cells: [6, 4], subject: 'Chimera, white background', prompt_weighted: 'concept artwork of a Chimera' },
    { id: 'bpskin_leather', kind: 'texture', cells: [8, 8], subject: 'leather texture', prompt_weighted: 'leather texture (anime:1.21)' },
  ] };
  const fixups = { fills: [{ id: 'bpskin_leather_fill_a', seed: 101, prompt: 'brown leather fill...' }], thieves: [{ id: 'unit_thief_v1', subject: 'a female thief', prompt: 'a female thief (anime:1.21)' }] };
  const framing = [{ id: 'unit_thief_v4', subject: 'a female thief hooded', prompt: 'a female thief hooded (anime:1.21)' }];
  const e = bf.entriesParity(manifest, fixups, framing, 'flux2-parity-0150');
  assert.strictEqual(e.length, 6, "3 assets + 1 fill + 2 thieves = 6; actual " + e.length);
});

T('parity: every entry maps to a distinct system_name + correct kind/shape', () => {
  const manifest = { seed: 1, assets: [
    { id: 'iron_sword', kind: 'item', cells: [1, 3], subject: 's', prompt_weighted: 'p' },
    { id: 'chimera', kind: 'monster', cells: [6, 4], subject: 's', prompt_weighted: 'p' },
    { id: 'bpskin_leather', kind: 'texture', cells: [8, 8], subject: 's', prompt_weighted: 'p' },
  ] };
  const e = bf.entriesParity(manifest, {}, [], 'flux2-parity-0150');
  const sword = e.find((x) => x.key === 'iron_sword');
  assert.strictEqual(sword.kind, 'po');
  assert.strictEqual(sword.system_name, 'flux2-parity-0150:iron_sword');
  assert.strictEqual(sword.seed, 1);
  // 1x3 po -> 256x768 through the shared sizing law
  assert.deepStrictEqual(deriveSize('po', bf.shapeForKind('po', sword.shapeOpts)), { width: 256, height: 768 });
  const chimera = e.find((x) => x.key === 'chimera');
  assert.strictEqual(chimera.kind, 'monster');
  assert.deepStrictEqual(chimera.shapeOpts, { w: 6, h: 4 });
  assert.deepStrictEqual(deriveSize('monster', bf.shapeForKind('monster', chimera.shapeOpts)), { width: 768, height: 512 });
  const leather = e.find((x) => x.key === 'bpskin_leather');
  assert.strictEqual(leather.kind, 'bpskin');
  assert.strictEqual(leather.tiling, true);
});

T('roster units: 4 candidates per subject, seeds 101/202/303/404, one artwork', () => {
  const defs = { entries: [{ id: 'unit-elf', name: 'elf', gen_prompt: 'female elf, white background' }] };
  const e = bf.entriesRoster(defs, 'unit', 'units-002-roster-flux2');
  assert.strictEqual(e.length, 4);
  assert.deepStrictEqual(e.map((x) => x.seed).sort((a, b) => a - b), [101, 202, 303, 404]);
  assert.strictEqual(new Set(e.map((x) => x.system_name)).size, 1);
  assert.strictEqual(e[0].system_name, 'units-002-roster-flux2:unit-elf');
  assert.strictEqual(e[0].backfilled_approx, true);
  assert.strictEqual(e[0].image_rel, 'candidates/unit-elf_c1_s101.png');
});

T('roster items (po): shape mask from gen_render cells reproduces the sizing law', () => {
  const defs = { entries: [{ id: 'blade', name: 'Blade', kind: 'item', gen_prompt: 'a bare blade', gen_render: { cells: [[0, 0], [1, 0]] } }] };
  const e = bf.entriesRoster(defs, 'po', 'batch-004-item-icons-flux2');
  assert.strictEqual(e.length, 4);
  assert.deepStrictEqual(deriveSize('po', bf.shapeForKind('po', e[0].shapeOpts)), { width: 256, height: 512 });
});

T('roster items (po): mask_cells preferred over cells when present', () => {
  const defs = { entries: [{ id: 'beast_jaw', name: 'Jaw', kind: 'item', gen_prompt: 'jaw', gen_render: { cells: [[0, 0]], mask_cells: [[0, 1], [1, 0], [1, 1]] } }] };
  const e = bf.entriesRoster(defs, 'po', 'batch-004');
  assert.deepStrictEqual(deriveSize('po', bf.shapeForKind('po', e[0].shapeOpts)), { width: 512, height: 512 });
});

T('monsters: seed parsed from job name, shape from cells_hint, subject stripped', () => {
  const jobs = [{ name: 'goblin_s202', positive: 'goblin, white background', width: 384, height: 512, seed: 202, cells_hint: [3, 4] }];
  const e = bf.entriesMonsters(jobs, 'monsters-003-flux2');
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].system_name, 'monsters-003-flux2:goblin');
  assert.strictEqual(e[0].seed, 202);
  assert.deepStrictEqual(deriveSize('monster', bf.shapeForKind('monster', e[0].shapeOpts)), { width: 384, height: 512 });
  assert.strictEqual(e[0].final_prompt, 'goblin, white background');
});

T('frames: composed=true marks seed adopted; non-composed stays candidate; PASS recorded', () => {
  const fr = { band: 75, checks: [
    { file: 'leather_frame_s1.png', PASS: true }, { file: 'leather_frame_s202.png', PASS: true },
    { file: 'wood_frame_s1.png', PASS: true }, { file: 'wood_frame_s202.png', PASS: false },
  ], skins: [
    { material: 'leather', composed: true, frame: 'leather_frame_s1.png' },
    { material: 'wood', composed: true, frame: 'wood_frame_s1.png' },
  ] };
  const adopt = bf.frameReportAdoptions(fr);
  assert.strictEqual(adopt.length, 2);
  assert.deepStrictEqual(adopt.find((a) => a.material === 'leather'), { material: 'leather', seed: 1, frame: 'leather_frame_s1.png' });
  const e = bf.entriesFrames(fr, 'bpskin-frames-0150');
  assert.strictEqual(e.length, 4);
  const leatherS1 = e.find((x) => x.seed === 1 && x.system_name.endsWith(':leather'));
  assert.ok(leatherS1.adopt && /composed=true/.test(leatherS1.adopt.evidence), 'leather s1 adopted with evidence');
  const leatherS202 = e.find((x) => x.seed === 202 && x.system_name.endsWith(':leather'));
  assert.strictEqual(leatherS202.adopt, null, 'leather s202 stays candidate');
  const woodS202 = e.find((x) => x.seed === 202 && x.system_name.endsWith(':wood'));
  assert.strictEqual(woodS202.adopt, null, 'wood s202 (frame-gate FAIL) stays candidate');
  assert.strictEqual(woodS202.frame_gate.PASS, false);
});

T('bpskin spike: 2 motifs x 2 seeds via seamless leg, verdict recorded, route override kept', () => {
  const findings = { steps: 4, cfg: 1.0, verdict: { seamless: 'FAIL' }, legs: [
    { motif: 'elven', seed: 101 }, { motif: 'elven', seed: 202 },
    { motif: 'barbarian', seed: 101 }, { motif: 'barbarian', seed: 202 },
  ] };
  const e = bf.entriesBpskinFindings(findings, 'bpskin-flux2-0150');
  assert.strictEqual(e.length, 4);
  assert.strictEqual(e[0].tiling_leg, 'seamless');
  assert.strictEqual(e[0].spike_verdict, 'FAIL');
  assert.strictEqual(e[0].route_override.steps, 4);
  assert.ok(/_seamless\.png$/.test(e[0].image_rel));
});

T('buildParams: backfilled flags, model hashes, evidence only when adopted', () => {
  const route = { steps: 30, cfg: 1.0, sampler: 'euler', seed: 1, cell_px: 128 };
  const mh = { unet: { file: 'u', sha256: 'a', hash_source: 'content' }, clip: { file: 'c', sha256: 'b', hash_source: 'content' }, vae: { file: 'v', sha256: 'd', hash_source: 'content' } };
  const cand = bf.buildParams({ slug: 's', key: 'k', seed: 202, tiling: false, backfilled_approx: true, final_prompt_source: 'manifest_subject_only' }, route, mh, { width: 512, height: 512 });
  assert.strictEqual(cand.backfilled_approx, true);
  assert.strictEqual(cand.hash_backfilled, true);
  assert.strictEqual(cand.sampler, 'euler');
  assert.strictEqual(cand.models.unet.sha256, 'a');
  assert.ok(!('backfill_adoption_evidence' in cand), 'no evidence on candidate');
  const adopt = bf.buildParams({ slug: 's', key: 'k', seed: 1, tiling: false, backfilled_approx: true, final_prompt_source: 'x', adopt: { evidence: 'path/reason' }, route_override: { steps: 4, cfg: 1.0 } }, route, mh, { width: 1024, height: 1024 });
  assert.strictEqual(adopt.backfill_adoption_evidence, 'path/reason');
  assert.strictEqual(adopt.steps, 4, 'route_override steps win');
});

T('byte-match: buildLiveShaIndex indexes live + selected PNGs; candidate bytes match by sha', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bpk-bf-'));
  fs.mkdirSync(path.join(tmp, 'content', 'live'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'content', 'batches', 'units-001-roster', 'selected'), { recursive: true });
  const liveBytes = Buffer.from('LIVE-ASSET-BYTES');
  const selBytes = Buffer.from('SELECTED-UNIT-BYTES');
  fs.writeFileSync(path.join(tmp, 'content', 'live', 'hero.png'), liveBytes);
  fs.writeFileSync(path.join(tmp, 'content', 'batches', 'units-001-roster', 'selected', 'unit-elf.png'), selBytes);
  fs.writeFileSync(path.join(tmp, 'content', 'batches', 'units-001-roster', 'selected', 'notes.txt'), 'ignored');
  const idx = bf.buildLiveShaIndex(tmp);
  assert.strictEqual(idx.size, 2, 'only the 2 PNGs indexed');
  const liveSha = crypto.createHash('sha256').update(liveBytes).digest('hex');
  const selSha = crypto.createHash('sha256').update(selBytes).digest('hex');
  assert.strictEqual(idx.get(liveSha), path.join('content', 'live', 'hero.png'));
  assert.strictEqual(idx.get(selSha), path.join('content', 'batches', 'units-001-roster', 'selected', 'unit-elf.png'));
  // a candidate whose bytes match the selected asset resolves to that evidence path
  const candidateSha = crypto.createHash('sha256').update(Buffer.from('SELECTED-UNIT-BYTES')).digest('hex');
  assert.ok(idx.has(candidateSha), 'matching candidate found');
  // a non-matching candidate is not adopted
  assert.ok(!idx.has(crypto.createHash('sha256').update(Buffer.from('flux2-different')).digest('hex')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log('\nbackfill_registry_test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);


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
