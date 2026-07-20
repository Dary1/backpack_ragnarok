#!/usr/bin/env node
'use strict';
// tools/check_stat_bands.cjs -- REQ-0268. Advisory lint: compare each content
// def's dps-proxy against the per-rarity dps warn band derived from the genre
// corpus (content/corpus_stats.json `bands`).
//
// dps-proxy of a def = SUM over its effects of (verb.n midpoint / trigger.s
// midpoint) for effects that are BOTH a damage verb AND an every_secs trigger.
// Everything else (non-damage verbs, non-cadence triggers) is skipped -- this
// proxy only speaks to sustained tick damage, which is what the corpus bands
// measure (item cooldown DPS).
//
// Inputs:
//   --stats PATH   corpus_stats.json (default content/corpus_stats.json)
//   --defs  PATH   a po/2 items file or a skill/1 file
//                  (default content/live/live_items.json)
// Modes:
//   --report     list every def's dps vs band, always exit 0
//   --gate       exit 1 if any def with a rarity band is OVER its warn_hi
//   --self-test  built-in fixtures (in-band passes, overpowered fails);
//                exercises the real code path, needs no files
//
// Live content is ADVISORY for now: ci.sh runs --self-test only.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_STATS = path.join(ROOT, 'content', 'corpus_stats.json');
const DEFAULT_DEFS = path.join(ROOT, 'content', 'live', 'live_items.json');

// Damage-dealing verbs in our closed vocab whose n is a hit magnitude.
const DAMAGE_VERBS = new Set(['strike', 'multi_strike', 'charge_strike']);

// Fallback bands = content/vocab.json dps_ceiling_warn (so --self-test works
// with no stats file present). Kept in sync with the vocab anchor.
const FALLBACK_BANDS = {
  Common: { warn_hi: 12 },
  Uncommon: { warn_hi: 15 },
  Rare: { warn_hi: 18 },
  Relic: { warn_hi: 24 },
};

function mid(range) {
  if (!Array.isArray(range) || range.length < 2) return null;
  const a = Number(range[0]);
  const b = Number(range[1]);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (a + b) / 2;
}

// Effects can be either po/2 shape ({trigger,verb,cond}) or a bare skill/1 def
// ({trigger,verb,...}); normalise both to a list of {trigger,verb}.
function effectsOf(def) {
  if (Array.isArray(def.effects)) return def.effects;
  if (def.trigger && def.verb) return [{ trigger: def.trigger, verb: def.verb }];
  return [];
}

// The real code path under test: a def's summed damage dps-proxy.
function defDps(def) {
  let dps = 0;
  let counted = 0;
  for (const eff of effectsOf(def)) {
    const trig = eff.trigger || {};
    const verb = eff.verb || {};
    if (trig.t !== 'every_secs') continue;
    if (!DAMAGE_VERBS.has(verb.t)) continue;
    const nMid = mid(verb.n);
    const sMid = mid(trig.s);
    if (nMid === null || sMid === null || sMid <= 0) continue;
    dps += nMid / sMid;
    counted += 1;
  }
  return { dps, counted };
}

function loadBands(statsPath) {
  try {
    const raw = fs.readFileSync(statsPath, 'utf8');
    const stats = JSON.parse(raw);
    if (stats && stats.bands) return { bands: stats.bands, source: statsPath };
  } catch (_e) { /* fall through to embedded fallback */ }
  return { bands: FALLBACK_BANDS, source: '(embedded fallback bands)' };
}

// po/2 rarity is Capitalized; skill/1 has none. Returns a tier or null.
function rarityOf(def) {
  if (typeof def.rarity === 'string' && def.rarity) {
    return def.rarity.charAt(0).toUpperCase() + def.rarity.slice(1).toLowerCase();
  }
  return null;
}

function loadDefs(defsPath) {
  const doc = JSON.parse(fs.readFileSync(defsPath, 'utf8'));
  const entries = doc.entries || doc.skills || [];
  return { schema: doc.schema || '(unknown)', entries };
}

// Evaluate one def against the bands. status: OK | OVER | na (advisory).
function evaluate(def, bands) {
  const { dps, counted } = defDps(def);
  const rarity = rarityOf(def);
  const band = rarity && bands[rarity] ? bands[rarity] : null;
  let status = 'na';
  if (counted > 0 && band && typeof band.warn_hi === 'number') {
    status = dps > band.warn_hi ? 'OVER' : 'OK';
  }
  return {
    id: def.id || def.name || '(anon)',
    rarity,
    dps: Math.round(dps * 1000) / 1000,
    counted,
    warn_hi: band ? band.warn_hi : null,
    status,
  };
}

function runReport(defsPath, bands, bandsSource) {
  const { schema, entries } = loadDefs(defsPath);
  console.log('bands from: ' + bandsSource);
  console.log('defs: ' + defsPath + ' (schema ' + schema + ', ' +
    entries.length + ' entries)');
  let over = 0;
  let evaluated = 0;
  for (const def of entries) {
    const r = evaluate(def, bands);
    if (r.counted === 0) continue; // no damage-tick effect: nothing to say
    evaluated += 1;
    if (r.status === 'OVER') over += 1;
    console.log('  ' + [
      r.status.padEnd(4),
      String(r.id).padEnd(22),
      '(' + (r.rarity || '-') + ')',
      'dps=' + r.dps,
      'warn_hi=' + (r.warn_hi === null ? '-' : r.warn_hi),
    ].join(' '));
  }
  console.log('summary: ' + evaluated + ' damage defs evaluated, ' +
    over + ' over band');
  return over;
}

function selfTest() {
  const { bands } = loadBands(DEFAULT_STATS); // real loader; falls back if absent
  const inBand = {
    id: 'fixture_in_band', rarity: 'Common',
    effects: [{ trigger: { t: 'every_secs', s: [1.8, 2.2] },
                verb: { t: 'strike', n: [8, 12] } }],
  }; // dps = 10 / 2.0 = 5.0  (<= 12)
  const overpowered = {
    id: 'fixture_overpowered', rarity: 'Common',
    effects: [{ trigger: { t: 'every_secs', s: [1.8, 2.2] },
                verb: { t: 'strike', n: [80, 120] } }],
  }; // dps = 100 / 2.0 = 50  (>> 12)
  const nonDamage = {
    id: 'fixture_heal', rarity: 'Common',
    effects: [{ trigger: { t: 'every_secs', s: [2, 2] },
                verb: { t: 'heal_ally', n: [5, 5] } }],
  }; // no damage verb -> na, never gates

  const a = evaluate(inBand, bands);
  const b = evaluate(overpowered, bands);
  const c = evaluate(nonDamage, bands);

  const checks = [
    ['in-band Common item passes', a.status === 'OK', a],
    ['overpowered Common item fails', b.status === 'OVER', b],
    ['non-damage effect is advisory (na)', c.status === 'na', c],
    ['dps proxy is n_mid/s_mid', Math.abs(a.dps - 5.0) < 1e-9, a],
  ];
  let failed = 0;
  for (const [name, ok, detail] of checks) {
    if (ok) {
      console.log('PASS  ' + name);
    } else {
      failed += 1;
      console.log('FAIL  ' + name + ' -- ' + JSON.stringify(detail));
    }
  }
  if (failed) {
    console.error('check_stat_bands self-test: ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('check_stat_bands self-test: OK');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
  };
  const statsPath = opt('--stats', DEFAULT_STATS);
  const defsPath = opt('--defs', DEFAULT_DEFS);

  if (argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const { bands, source } = loadBands(statsPath);
  if (argv.includes('--gate')) {
    const over = runReport(defsPath, bands, source);
    process.exit(over > 0 ? 1 : 0);
  }
  // default / --report
  runReport(defsPath, bands, source);
  process.exit(0);
}

main();
