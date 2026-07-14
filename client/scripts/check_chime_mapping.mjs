#!/usr/bin/env node
// client/scripts/check_chime_mapping.mjs -- REQ-0059 gate.
//
// Exercises the REAL production mapping module
// (client/src/schedule/chimes/chimeMapping.ts) + the prefs helpers
// (chimePrefs.ts). Both are deliberately pure (no AudioContext, no DOM at
// module scope), so plain Node drives them once Vite has transpiled the
// TS -- same vite-ssrLoadModule rig, same discipline, as
// check_link_trace.mjs / check_unit_icon.mjs.
//
// This is the deterministic event->note mapping the spec calls "your
// circuit's ignition jingle, identical every replay". If the mapping table
// ever drifts, THIS goes red.
//
// Usage: node client/scripts/check_chime_mapping.mjs   (exit 0 = pass).
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');

async function loadModules() {
  const server = await createServer({
    configFile: false,
    root: CLIENT_ROOT,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  });
  try {
    const mapping = await server.ssrLoadModule('/src/schedule/chimes/chimeMapping.ts');
    const prefs = await server.ssrLoadModule('/src/schedule/chimes/chimePrefs.ts');
    return { mapping, prefs };
  } finally {
    await server.close();
  }
}

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log('  ok   ', name);
  } else {
    failures++;
    console.log('  FAIL ', name, detail ? `-- ${detail}` : '');
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { mapping, prefs } = await loadModules();
const {
  eventToChime, midiToFreq, hashStr, beamDirection, pitchForDirection,
  timbreForPulse, SCALE_SEMITONES, TONIC_MIDI, CHORD_ROOT_MIDI, LOW_ROOT_MIDI,
  HAPTIC_SHORT, HAPTIC_MEDIUM, HAPTIC_LONG,
} = mapping;
const { defaultChimePrefs, normalizeChimePrefs } = prefs;

const ev = (o) => ({ t: 0, seq: 0, ...o });

// ---------------------------------------------------------------------------
console.log('scale + tuning primitives');
check('SCALE_SEMITONES is 8 degrees, one octave', SCALE_SEMITONES.length === 8 && SCALE_SEMITONES[0] === 0 && SCALE_SEMITONES[7] === 12);
check('midiToFreq(69) == 440Hz (A4)', Math.abs(midiToFreq(69) - 440) < 1e-9);
check('midiToFreq(60) ~ 261.63Hz (C4)', Math.abs(midiToFreq(60) - 261.6255653) < 1e-4);
check('hashStr is deterministic', hashStr('bp0>bp1#1') === hashStr('bp0>bp1#1'));
check('hashStr differs for different edges (spot)', hashStr('bp0>bp1#1') !== hashStr('bp1>bp0#1'));

// ---------------------------------------------------------------------------
console.log('link_pulse -> tone, pitch by beam direction 0..7 (the melody)');
const expectedPitches = [0,1,2,3,4,5,6,7].map((d) => TONIC_MIDI + SCALE_SEMITONES[d]);
for (let d = 0; d < 8; d++) {
  const instr = eventToChime(ev({ ev: 'link_pulse', dir: d, from: 'a', to: 'b', hop: 1 }));
  check(`dir ${d} -> tone midi ${expectedPitches[d]}`,
    instr && instr.voices.length === 1 && instr.voices[0].kind === 'tone' && instr.voices[0].midi === expectedPitches[d],
    instr ? JSON.stringify(instr.voices[0]) : 'null');
}
check('all 8 directions give 8 DISTINCT pitches', new Set(expectedPitches).size === 8);
check('every pulse pitch is within one octave [TONIC, TONIC+12]',
  expectedPitches.every((m) => m >= TONIC_MIDI && m <= TONIC_MIDI + 12));

console.log('link_pulse without a geometric dir -> derived, deterministic, in-scale');
const scaleSet = new Set(SCALE_SEMITONES.map((s) => TONIC_MIDI + s));
const lp1 = eventToChime(ev({ ev: 'link_pulse', from: 'bp0', to: 'bp1', hop: 1 }));
const lp1b = eventToChime(ev({ ev: 'link_pulse', from: 'bp0', to: 'bp1', hop: 1 }));
check('same (from,to,hop) -> same tone every time (determinism)', lp1.voices[0].midi === lp1b.voices[0].midi);
check('derived pitch lands on a scale degree', scaleSet.has(lp1.voices[0].midi));
check('hop event carries the SHORT haptic', eq(lp1.haptic, [...HAPTIC_SHORT]));

console.log('timbre variation (dye / hop lenses -- REQ-0054 tie-in)');
check('plain pulse -> sine', timbreForPulse(ev({ ev: 'link_pulse' })) === 'sine');
check('dyed pulse -> triangle (sounds "colored")', timbreForPulse(ev({ ev: 'link_pulse', dye: 'burn' })) === 'triangle');
check('hop-lens pulse -> square', timbreForPulse(ev({ ev: 'link_pulse', hopBonus: 1 })) === 'square');
const dyedTone = eventToChime(ev({ ev: 'link_pulse', dir: 0, dye: 'burn' }));
check('dyed link_pulse tone uses the varied timbre', dyedTone.voices[0].timbre === 'triangle');

// ---------------------------------------------------------------------------
console.log('payload -> chord, colour by verb (pulse-caused only)');
const strike = eventToChime(ev({ ev: 'ray_hit', cause: 'pulse', amount: 5, hp_after: 9 }));
check('ray_hit(cause:pulse) strike -> MAJOR triad', strike && strike.voices[0].kind === 'chord' && strike.voices[0].quality === 'major'
  && eq(strike.voices[0].midis, [CHORD_ROOT_MIDI, CHORD_ROOT_MIDI + 4, CHORD_ROOT_MIDI + 7]));
const status = eventToChime(ev({ ev: 'apply_status', cause: 'pulse', status: 'burn', n: 2 }));
check('apply_status(cause:pulse) -> MINOR triad', status && status.voices[0].quality === 'minor'
  && eq(status.voices[0].midis, [CHORD_ROOT_MIDI, CHORD_ROOT_MIDI + 3, CHORD_ROOT_MIDI + 7]));
const heal = eventToChime(ev({ ev: 'pulse_payload', verb: 'heal', cause: 'pulse', amount: 3, hp_after: 12 }));
check('pulse_payload heal/block -> SUSPENDED triad', heal && heal.voices[0].quality === 'suspended'
  && eq(heal.voices[0].midis, [CHORD_ROOT_MIDI, CHORD_ROOT_MIDI + 5, CHORD_ROOT_MIDI + 7]));
check('payload events carry the MEDIUM haptic', eq(strike.haptic, [...HAPTIC_MEDIUM]) && eq(status.haptic, [...HAPTIC_MEDIUM]));

console.log('non-circuit strikes stay quiet (circuit chimes only sound the pulse circuit)');
check('ray_hit WITHOUT cause:pulse -> null', eventToChime(ev({ ev: 'ray_hit', amount: 5, hp_after: 9 })) === null);
check('apply_status WITHOUT cause:pulse -> null', eventToChime(ev({ ev: 'apply_status', status: 'burn', n: 1 })) === null);

// ---------------------------------------------------------------------------
console.log('ray_bounce -> percussion tick, count-scaled; 5th bounce defers to the cymbal');
let lastIntensity = -1;
for (let b = 1; b <= 4; b++) {
  const instr = eventToChime(ev({ ev: 'ray_bounce', bounce: b, at: [1, 1] }));
  const ok = instr && instr.voices[0].kind === 'perc' && instr.voices[0].variant === 'tick' && instr.voices[0].intensity > lastIntensity;
  check(`bounce ${b} -> tick, intensity rising`, ok, instr ? JSON.stringify(instr.voices[0]) : 'null');
  if (instr) lastIntensity = instr.voices[0].intensity;
}
check('bounce >= 5 -> null (the all-field cymbal handles that beat)', eventToChime(ev({ ev: 'ray_bounce', bounce: 5, at: [1, 1] })) === null);

console.log('5th-bounce all-field -> cymbal + a beat of respect (brief silence) + LONG haptic');
const nuke = eventToChime(ev({ ev: 'ray_hit_all', bounce_mult: 5, hits: [] }));
check('ray_hit_all -> cymbal', nuke && nuke.voices[0].kind === 'perc' && nuke.voices[0].variant === 'cymbal');
check('ray_hit_all -> enforced silenceAfterMs > 0', nuke && nuke.silenceAfterMs > 0);
check('ray_hit_all -> LONG haptic', eq(nuke.haptic, [...HAPTIC_LONG]));

// ---------------------------------------------------------------------------
console.log('death -> low chord');
const deathHit = eventToChime(ev({ ev: 'ray_hit', cause: 'pulse', amount: 20, hp_after: 0 }));
check('pulse ray_hit that drops hp_after<=0 -> LOW chord (not major)', deathHit && deathHit.voices[0].quality === 'low'
  && eq(deathHit.voices[0].midis, [LOW_ROOT_MIDI, LOW_ROOT_MIDI + 7, LOW_ROOT_MIDI + 12]));
const bpDead = eventToChime(ev({ ev: 'bp_destroyed', id: 'bp3' }));
check('bp_destroyed -> LOW chord (unconditional, future-proofed)', bpDead && bpDead.voices[0].quality === 'low');

console.log('death will (REQ-0056) -> last-breath arpeggio');
const will = eventToChime(ev({ ev: 'will_fire', src: 'bp3' }));
check('will_fire -> arp voice with ascending notes', will && will.voices[0].kind === 'arp' && will.voices[0].midis.length >= 3
  && will.voices[0].midis.every((m, i, a) => i === 0 || m > a[i - 1]));

console.log('haptic ladder: short < medium < long (spec ordering)');
const sum = (a) => a.reduce((x, y) => x + y, 0);
check('short < medium < long', sum(HAPTIC_SHORT) < sum(HAPTIC_MEDIUM) && sum(HAPTIC_MEDIUM) < sum(HAPTIC_LONG));

console.log('unmapped events are silent');
check('progress -> null', eventToChime(ev({ ev: 'progress', pct: 10 })) === null);
check('ray_step -> null (onset, not a note)', eventToChime(ev({ ev: 'ray_step', cause: 'pulse', path: [[1,1]] })) === null);

// ---------------------------------------------------------------------------
console.log('prefs: defaults, reduced-motion, normalisation');
check('default chimes ON', defaultChimePrefs(false).chimes === true);
check('default volume is LOW (<= 0.5)', defaultChimePrefs(false).volume <= 0.5 && defaultChimePrefs(false).volume > 0);
check('default haptics ON', defaultChimePrefs(false).haptics === true);
check('prefers-reduced-motion suppresses chimes by default', defaultChimePrefs(true).chimes === false);
check('normalize fills missing fields from default', eq(normalizeChimePrefs({}), defaultChimePrefs(false)));
check('normalize clamps volume to [0,1]', normalizeChimePrefs({ volume: 5 }).volume === 1 && normalizeChimePrefs({ volume: -3 }).volume === 0);
check('normalize keeps an explicit chimes:false', normalizeChimePrefs({ chimes: false }).chimes === false);
check('normalize rejects garbage -> default', eq(normalizeChimePrefs(null), defaultChimePrefs(false)) && eq(normalizeChimePrefs(42), defaultChimePrefs(false)));

console.log('');
if (failures) {
  console.log(`check_chime_mapping: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('check_chime_mapping: all assertions pass');
