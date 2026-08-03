#!/usr/bin/env node
'use strict';
// tools/calibrate_base_difficulty.cjs -- REQ-0295. Sim-derived per-dungeon
// baseDifficulty for enemy-scaling self-normalisation (REQ-0293/0294).
//
// Method (no hand-tuned "feel"): run ONE fixed reference troop (content/live/
// scenario.json x4) through a boss-less arena of each dungeon's packPool at a
// sweep of effLevel, measuring win rate over SEEDS deterministic seeds. The
// "cliff" is the effLevel at which the troop starts losing (win rate < 0.5),
// found by binary search. Because below the cliff every dungeon is a 100% win,
// equalising the cliffs makes the WIN/LOSS outcome identical across draws at
// every attackLv: baseDifficulty_d = anchorBase + (cliff_anchor - cliff_d),
// where the anchor is the EASIEST dungeon (max cliff) kept at its current base.
// Deterministic + reproducible (fixed seeds). Flags: --seeds N --arena N --json.
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const rd = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const combat = require(path.join(ROOT, 'sim', 'combat.cjs'));
const ls = require(path.join(ROOT, 'sim', 'lib', 'level_scale.cjs'));

const argv = process.argv.slice(2);
const getN = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? Number(argv[i + 1]) : def; };
const SEEDS = getN('--seeds', 24), ARENA = getN('--arena', 6), asJson = argv.includes('--json');

const scenario = rd('content/live/scenario.json');
const itemDefsById = {}; for (const e of rd('content/live/live_items.json').entries) itemDefsById[e.id] = e;
try { for (const e of rd('content/live/dungeon/items.json').entries) itemDefsById[e.id] = e; } catch (e) {}
const L = 'content/live/dungeon/';
const enemyDefsById = {}; for (const e of rd(L + 'enemies.json').entries) enemyDefsById[e.id] = e;
const skillDefsById = {}; for (const s of rd(L + 'skills.json').entries) skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes };
const monsterPackDefsById = {}; for (const e of rd(L + 'packs.json').entries) monsterPackDefsById[e.id] = e;
const dungeons = rd(L + 'dungeons.json').entries;
const prof = ls.loadProfile(rd('content/scaling_profile.json'));
const baseOpts = { squadSnapshots: [scenario, scenario, scenario, scenario], itemDefsById, enemyDefsById, skillDefsById, monsterPackDefsById, formationId: 'formation1', participants: ['pA', 'pB'] };

function arena(dg, n) { const enc = []; const pool = dg.packPool || []; for (let i = 0; i < n; i++) { const ref = pool[i % pool.length]; enc.push({ id: 'a' + i, type: 'pack', mode: 'battle', enemyPack: { packId: ref.packId }, deadline_secs: 90 }); } return { schema: 'dungeon/1', id: 'cal_' + dg.id, encounters: enc }; }
function winRate(dg, eff) { let w = 0; for (let s = 0; s < SEEDS; s++) { const r = combat.runDungeon(Object.assign({}, baseOpts, { masterSeed: 'cal-' + dg.id + '-' + eff.toFixed(2) + '-' + s, dungeonDef: arena(dg, ARENA), level: 1, scaling: prof, effLevel: eff })); if (r.result === 'victory') w++; } return w / SEEDS; }
function cliff(dg) { let lo = 0, hi = 45; if (winRate(dg, hi) >= 0.5) return hi; for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (winRate(dg, mid) >= 0.5) lo = mid; else hi = mid; } return (lo + hi) / 2; }

const cliffs = dungeons.map(dg => ({ id: dg.id, levelMin: dg.levelMin, currentBase: dg.baseDifficulty, cliff: cliff(dg) }));
const anchor = cliffs.reduce((a, b) => b.cliff > a.cliff ? b : a); // easiest = max cliff
const anchorBase = 1; // keep easiest dungeon at baseDifficulty 1
for (const c of cliffs) c.calibratedBase = Math.max(1, Math.round(anchorBase + (anchor.cliff - c.cliff)));
if (asJson) { console.log(JSON.stringify({ seeds: SEEDS, arena: ARENA, anchor: anchor.id, wipeAttackLv: anchorBase + anchor.cliff, dungeons: cliffs }, null, 2)); }
else {
  console.log('# calibrate_base_difficulty  (seeds=' + SEEDS + ' arena=' + ARENA + ' reference troop=scenario x4)');
  console.log('# anchor (easiest) = ' + anchor.id + '  -> all dungeons equalised to wipe @ attackLv ~ ' + (anchorBase + anchor.cliff).toFixed(1));
  for (const c of cliffs) console.log(c.id.padEnd(18) + ' cliff=' + c.cliff.toFixed(1).padStart(5) + '  currentBase=' + String(c.currentBase).padStart(2) + '  ->  calibratedBase=' + c.calibratedBase);
}
