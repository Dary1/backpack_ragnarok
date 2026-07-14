// REQ-0059 -- Circuit Chimes: the DETERMINISTIC event -> chime mapping.
//
// This module is the tested core of the feature and is deliberately PURE:
// it takes ONE replay event (the exact same ApiRunEvent the monitor
// animates -- see MonitorRenderer.applyOneEvent) and returns a plain-data
// ChimeInstruction (a set of voices + an optional post-silence + a haptic
// pattern), or null for events that make no sound. It imports NO
// AudioContext, NO Pixi, NO DOM -- so it is driven directly from plain
// Node by client/scripts/check_chime_mapping.mjs (the vite-ssrLoadModule
// rig, same discipline as check_link_trace.mjs). The audible engine
// (ChimeEngine.ts) is a thin scheduler over whatever this returns, so the
// "your build has a fixed ignition jingle, identical every replay"
// determinism contract lives HERE, where it is unit-tested, not in the
// (headless-untestable) WebAudio layer.
//
// Zero sim/server change (REQ-0059): the sim already emits everything we
// consume. Where the spec named a field the current event stream does NOT
// carry, this maps from the fields it DOES carry, deterministically, and
// the divergence is documented at the call site (see beamDirection for
// link_pulse pitch, and the chord-color note on the payload events).
import type { ApiRunEvent } from '../../api';

// ---------------------------------------------------------------------------
// Musical constants.
// ---------------------------------------------------------------------------

/** 8-tone major scale, one octave (semitone offsets from the tonic). The
 * spec: "8-tone scale, one octave; direction IS the melody". Eight beam
 * directions (0..7) index straight into these eight degrees. */
export const SCALE_SEMITONES: readonly number[] = [0, 2, 4, 5, 7, 9, 11, 12];
/** Tonic for the pulse melody -- C4 (MIDI 60). */
export const TONIC_MIDI = 60;
/** Root for the payload chords -- one octave below the melody (C3). */
export const CHORD_ROOT_MIDI = 48;
/** Root for a death "low chord" -- two octaves below (C2). */
export const LOW_ROOT_MIDI = 36;

export type Timbre = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type ChordQuality = 'major' | 'minor' | 'suspended' | 'low';

export interface ToneVoice {
  kind: 'tone';
  midi: number;
  timbre: Timbre;
  durationMs: number;
  gain: number;
}
export interface ChordVoice {
  kind: 'chord';
  midis: number[];
  quality: ChordQuality;
  timbre: Timbre;
  durationMs: number;
  gain: number;
}
export interface PercVoice {
  kind: 'perc';
  variant: 'tick' | 'cymbal';
  intensity: number; // 0..1
  durationMs: number;
  gain: number;
}
export interface ArpVoice {
  kind: 'arp';
  midis: number[];
  stepMs: number;
  timbre: Timbre;
  gain: number;
}
export type ChimeVoice = ToneVoice | ChordVoice | PercVoice | ArpVoice;

export interface ChimeInstruction {
  /** The sound(s) to play for this event. */
  voices: ChimeVoice[];
  /** Enforced quiet AFTER this instruction, in ms -- the 5th-bounce
   * all-field nuke gets "a beat of respect" (spec). */
  silenceAfterMs?: number;
  /** navigator.vibrate pattern (mobile haptics). Independent of the audio
   * -- the engine gates it on the haptics toggle, not the chimes toggle. */
  haptic?: number[];
  /** A short, stable tag naming which rule fired -- used only by the unit
   * test + the engine's debug counters, never by playback. */
  tag: string;
}

// ---------------------------------------------------------------------------
// Haptic patterns (ms). Spec: hop=short, payload=medium, 5-bounce/boss
// death=long. Kept as an ascending ladder so intent is obvious.
// ---------------------------------------------------------------------------
export const HAPTIC_SHORT: readonly number[] = [10];
export const HAPTIC_MEDIUM: readonly number[] = [25];
export const HAPTIC_LONG: readonly number[] = [70];
export const HAPTIC_DEATH: readonly number[] = [90];
export const HAPTIC_LAST_BREATH: readonly number[] = [15, 20, 15, 20, 40];

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/** MIDI note -> frequency (Hz). A4 = MIDI 69 = 440Hz. Pure; used by the
 * engine but lives here so the whole tone -> Hz chain is testable. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Stable FNV-1a string hash (unsigned 32-bit). Deterministic across
 * runs/engines -- the melody must be byte-identical every replay. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The 0..7 beam direction that drives a pulse tone's pitch.
 *
 * DESIGN NOTE (zero sim change): the spec says "pitch by beam direction
 * 0-7 ... direction IS the melody -- canvas layout composes the tune".
 * A geometric direction 0..7 IS carried on payload `ray_fire` events
 * (their `dir` field, the DIRS order N,NE,E,SE,S,SW,W,NW), and we use it
 * directly when present. But the `link_pulse` HOP event the spec keys the
 * melody off carries only {from,to,hop,origin} (BP ids) -- no geometric
 * dir, and adding one would be a sim change. So for a hop we derive a
 * STABLE direction from the directed link edge identity `from>to`: each
 * edge of the link graph gets one fixed scale degree, so a build's canvas
 * topology deterministically composes its tune and every replay sounds
 * identical -- faithful to the intent ("canvas layout composes the
 * tune"), realizable as a pure event consumer. */
export function beamDirection(ev: ApiRunEvent): number {
  const dir = asNum(ev.dir);
  if (dir !== null) return ((dir % 8) + 8) % 8;
  const from = asStr(ev.from) ?? '';
  const to = asStr(ev.to) ?? asStr(ev.origin) ?? '';
  const hop = asNum(ev.hop) ?? 0;
  return hashStr(from + '>' + to + '#' + hop) % 8;
}

/** Scale degree (0..7) -> MIDI note in the one-octave melody. */
export function pitchForDirection(dir: number): number {
  return TONIC_MIDI + SCALE_SEMITONES[((dir % 8) + 8) % 8];
}

/** Timbre variation for a pulse. Spec (REQ-0054 lens tie-in): "dyed
 * pulses sound colored"; a hop-lens pulse (extra reach) gets its own
 * colour. Both fields are OPTIONAL on the wire today (REQ-0054 is not
 * built) -- absent => the plain sine, so this lights up automatically if
 * the lens fields ever ship, with no change here. */
export function timbreForPulse(ev: ApiRunEvent): Timbre {
  const dyed = ev.dye != null && ev.dye !== false && ev.dye !== '';
  if (dyed) return 'triangle';
  const hopBonus = asNum(ev.hopBonus);
  if (hopBonus != null && hopBonus > 0) return 'square';
  return 'sine';
}

function chordMidis(root: number, quality: ChordQuality): number[] {
  switch (quality) {
    case 'major': return [root, root + 4, root + 7];
    case 'minor': return [root, root + 3, root + 7];
    case 'suspended': return [root, root + 5, root + 7];
    case 'low': return [root, root + 7, root + 12];
  }
}

function chordVoice(quality: ChordQuality, root: number, timbre: Timbre, durationMs: number, gain: number): ChordVoice {
  return { kind: 'chord', midis: chordMidis(root, quality), quality, timbre, durationMs, gain };
}

function isDeath(ev: ApiRunEvent): boolean {
  const hp = asNum(ev.hp_after);
  return hp != null && hp <= 0;
}

// ---------------------------------------------------------------------------
// THE mapping table (deterministic; see the module header).
// ---------------------------------------------------------------------------
export function eventToChime(ev: ApiRunEvent): ChimeInstruction | null {
  const pulse = ev.cause === 'pulse';
  switch (ev.ev) {
    // --- link_pulse hop -> single tone, pitch by (derived) beam direction.
    case 'link_pulse': {
      const midi = pitchForDirection(beamDirection(ev));
      return {
        voices: [{ kind: 'tone', midi, timbre: timbreForPulse(ev), durationMs: 180, gain: 0.6 }],
        haptic: [...HAPTIC_SHORT],
        tag: 'hop',
      };
    }

    // --- payload -> chord, COLOUR BY VERB. The spec names `ray_fire
    // (cause:pulse)` as the chord, but a `ray_fire` event carries no verb
    // (only entry/dir/pen/aoe); the verb is only knowable on the payload's
    // OWN terminal event, which the sim DOES emit with cause:'pulse'.
    // So the coloured chord is realized there -- exactly one chord per
    // landed payload, correctly coloured -- and the pulse `ray_fire`/
    // `ray_step` onset stays silent (its melody already sounded as the
    // link_pulse hop). strike->major, apply_status->minor, heal/block->sus.
    case 'ray_hit': {
      if (isDeath(ev) && pulse) {
        return {
          voices: [chordVoice('low', LOW_ROOT_MIDI, 'sawtooth', 650, 0.6)],
          haptic: [...HAPTIC_DEATH],
          tag: 'death_pulse',
        };
      }
      if (!pulse) return null; // non-circuit strike -- circuit chimes stay quiet
      return {
        voices: [chordVoice('major', CHORD_ROOT_MIDI, 'triangle', 320, 0.5)],
        haptic: [...HAPTIC_MEDIUM],
        tag: 'payload_strike',
      };
    }
    case 'apply_status': {
      if (!pulse) return null;
      return {
        voices: [chordVoice('minor', CHORD_ROOT_MIDI, 'triangle', 320, 0.5)],
        haptic: [...HAPTIC_MEDIUM],
        tag: 'payload_status',
      };
    }
    case 'pulse_payload': {
      if (isDeath(ev) && pulse) {
        return {
          voices: [chordVoice('low', LOW_ROOT_MIDI, 'sawtooth', 650, 0.6)],
          haptic: [...HAPTIC_DEATH],
          tag: 'death_pulse',
        };
      }
      // heal/block payload -> suspended ("block-heal/suspended").
      return {
        voices: [chordVoice('suspended', CHORD_ROOT_MIDI, 'sine', 340, 0.5)],
        haptic: [...HAPTIC_MEDIUM],
        tag: 'payload_heal',
      };
    }

    // --- ray_bounce -> light percussion tick, count-scaled. The 5th
    // bounce fires ray_bounce(bounce:5) immediately before the all-field
    // ray_hit_all; suppress the tick there so the cymbal below stands
    // alone (no tick+cymbal stack on the same beat).
    case 'ray_bounce': {
      const bounce = asNum(ev.bounce) ?? 1;
      if (bounce >= 5) return null;
      const intensity = Math.min(bounce, 4) / 4;
      return {
        voices: [{ kind: 'perc', variant: 'tick', intensity, durationMs: 70, gain: 0.25 + 0.2 * intensity }],
        tag: 'bounce',
      };
    }

    // --- 5th-bounce all-field -> cymbal + a beat of respect (brief silence).
    case 'ray_hit_all': {
      return {
        voices: [{ kind: 'perc', variant: 'cymbal', intensity: 1, durationMs: 500, gain: 0.7 }],
        silenceAfterMs: 220,
        haptic: [...HAPTIC_LONG],
        tag: 'nuke',
      };
    }

    // --- BP destroyed -> low chord. Not emitted by the sim today (REQ-0056
    // draft); future-proofed so it lights up unconditionally when it ships.
    case 'bp_destroyed': {
      return {
        voices: [chordVoice('low', LOW_ROOT_MIDI, 'sawtooth', 700, 0.65)],
        haptic: [...HAPTIC_DEATH],
        tag: 'bp_destroyed',
      };
    }

    // --- death will (REQ-0056) -> last-breath arpeggio. Also future-proofed.
    case 'will_fire': {
      const root = CHORD_ROOT_MIDI;
      return {
        voices: [{ kind: 'arp', midis: [root, root + 3, root + 7, root + 10, root + 12], stepMs: 70, timbre: 'triangle', gain: 0.5 }],
        haptic: [...HAPTIC_LAST_BREATH],
        tag: 'will',
      };
    }

    default:
      return null;
  }
}

/** The seam the monitor feeds events through -- ChimeEngine implements it.
 * Declared here (in the pure module) so MonitorRenderer can depend on the
 * interface without importing the AudioContext-touching engine. */
export interface ChimeSink {
  handleEvent(ev: ApiRunEvent): void;
}
