// REQ-0059 -- Circuit Chimes: the audible engine. A thin, feature-detected
// WebAudio scheduler over the deterministic instructions from
// chimeMapping.ts (eventToChime). Deliberately NOT Tone.js: the synthesis
// needed here (a handful of short oscillator/noise voices) is small enough
// that raw WebAudio avoids adding a dependency + lockfile churn on a moving
// master -- see the REQ log's [vetoable] decision. The determinism that
// matters ("same build sounds identical every replay") lives in the pure
// mapping module; this layer only turns instructions into sound + haptics.
//
// Scheduling discipline (spec: "audio must not desync: schedule from event
// timestamps, not frame callbacks"): every note is a self-contained,
// AudioContext-clock-scheduled envelope (osc.start(t0)/stop(t1)). Once
// scheduled it plays on the audio hardware clock regardless of frame
// pacing, so a throttled/hidden tab cannot stutter a note mid-envelope.
// Playback is additionally gated OFF while document.hidden.
import type { ApiRunEvent } from '../../api';
import {
  eventToChime,
  midiToFreq,
  type ChimeInstruction,
  type ChimeSink,
  type ChimeVoice,
  type Timbre,
} from './chimeMapping';
import type { ChimePrefs } from './chimePrefs';
import { getBusContext, getSfxBus } from '../../audio/bus'; // REQ-0370

type AudioCtor = typeof AudioContext;

function getAudioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Honest test/telemetry seam: how many of each thing the engine has
 * PROCESSED (an instruction was produced) and PLAYED (actually scheduled,
 * i.e. audio on + audible + tab visible) and VIBRATED. Never used by
 * playback; lets an e2e assert the engine received/handled events without
 * faking an audio assertion. */
export interface ChimeStats {
  processed: number;
  played: number;
  vibrated: number;
  byTag: Record<string, number>;
}

const OSC_TIMBRES: Record<Timbre, OscillatorType> = {
  sine: 'sine',
  triangle: 'triangle',
  square: 'square',
  sawtooth: 'sawtooth',
};

export class ChimeEngine implements ChimeSink {
  private ctor: AudioCtor | null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** REQ-0370: true when the context was created privately (shared bus
   * unavailable) and dispose() therefore owns closing it. */
  private ownsCtx = false;
  private prefs: ChimePrefs;
  /** Audio-clock time before which nothing new is scheduled (the 5-bounce
   * "beat of respect" silence). */
  private mutedUntil = 0;
  /** Time-base for spreading a batch of same-frame events onto the audio
   * clock without piling them on one instant (see scheduleAt). */
  private timeBase = 0;
  private stats: ChimeStats = { processed: 0, played: 0, vibrated: 0, byTag: {} };

  constructor(prefs: ChimePrefs) {
    this.prefs = prefs;
    this.ctor = getAudioCtor();
  }

  setPrefs(prefs: ChimePrefs): void {
    this.prefs = prefs;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(prefs.volume, this.ctx.currentTime, 0.02);
    }
  }

  getStats(): ChimeStats {
    return { ...this.stats, byTag: { ...this.stats.byTag } };
  }

  /** Resume a suspended context -- browsers require a user gesture before
   * audio starts. Call from a click handler (the replay Play button /
   * a settings toggle). No-op if audio is unavailable. */
  resume(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  dispose(): void {
    // REQ-0370: when parented on the shared bus, disposal detaches this
    // engine's output only -- the bus context outlives any one Monitor.
    if (this.master) {
      try { this.master.disconnect(); } catch { /* already detached */ }
    }
    if (this.ctx && this.ownsCtx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  handleEvent(ev: ApiRunEvent): void {
    const instr = eventToChime(ev);
    if (!instr) return;
    this.stats.processed++;
    this.stats.byTag[instr.tag] = (this.stats.byTag[instr.tag] ?? 0) + 1;

    if (this.chimesAudible()) {
      this.schedule(instr);
      this.stats.played++;
    }
    if (this.prefs.haptics && instr.haptic && instr.haptic.length > 0) {
      if (canVibrate()) {
        try {
          navigator.vibrate(instr.haptic);
          this.stats.vibrated++;
        } catch {
          // Some browsers throw on vibrate() from a non-gesture context --
          // haptics are best-effort, never fatal.
        }
      }
    }
  }

  private chimesAudible(): boolean {
    if (!this.prefs.chimes || this.prefs.volume <= 0) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return this.ctor !== null;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (!this.ctor) return null;
    try {
      // REQ-0370: prefer the shared bus context so chime output rides the
      // SE bus (master/SE sliders + mute-all). The engine keeps its own
      // master gain (prefs.volume) as the chime-internal mix level -- only
      // the output PARENT changes. Fallback: a private context wired
      // straight to the hardware, exactly the pre-bus behaviour.
      const shared = getBusContext();
      const ctx = shared ?? new this.ctor();
      this.ownsCtx = shared == null;
      const master = ctx.createGain();
      master.gain.value = this.prefs.volume;
      master.connect((shared ? getSfxBus() : null) ?? ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.timeBase = ctx.currentTime;
      return ctx;
    } catch {
      this.ctor = null; // give up permanently on this session
      return null;
    }
  }

  /** Anchor scheduling on the audio clock, never in the past. A same-frame
   * batch advances the base so notes do not all stack on one instant; a
   * gap re-anchors to now+lookahead. THIS realizes "schedule from event
   * timestamps, not frame callbacks": envelopes ride the audio clock. */
  private scheduleAt(ctx: AudioContext): number {
    const LOOKAHEAD = 0.02;
    const floor = ctx.currentTime + LOOKAHEAD;
    let at = Math.max(this.timeBase, floor);
    this.timeBase = at + 0.012;
    at = Math.max(at, this.mutedUntil);
    return at;
  }

  private schedule(instr: ChimeInstruction): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const at = this.scheduleAt(ctx);
    for (const voice of instr.voices) this.playVoice(ctx, this.master, voice, at);
    if (instr.silenceAfterMs && instr.silenceAfterMs > 0) {
      this.mutedUntil = at + instr.silenceAfterMs / 1000;
    }
  }

  private playVoice(ctx: AudioContext, dest: GainNode, voice: ChimeVoice, at: number): void {
    switch (voice.kind) {
      case 'tone':
        this.playOsc(ctx, dest, midiToFreq(voice.midi), voice.timbre, at, voice.durationMs / 1000, voice.gain);
        break;
      case 'chord':
        for (const midi of voice.midis) {
          this.playOsc(ctx, dest, midiToFreq(midi), voice.timbre, at, voice.durationMs / 1000, voice.gain / Math.max(1, voice.midis.length));
        }
        break;
      case 'arp':
        voice.midis.forEach((midi, i) => {
          this.playOsc(ctx, dest, midiToFreq(midi), voice.timbre, at + (i * voice.stepMs) / 1000, (voice.stepMs * 1.4) / 1000, voice.gain);
        });
        break;
      case 'perc':
        this.playNoise(ctx, dest, voice.variant, voice.intensity, at, voice.durationMs / 1000, voice.gain);
        break;
    }
  }

  private playOsc(ctx: AudioContext, dest: GainNode, freq: number, timbre: Timbre, at: number, dur: number, gain: number): void {
    const osc = ctx.createOscillator();
    osc.type = OSC_TIMBRES[timbre];
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, gain);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  private playNoise(ctx: AudioContext, dest: GainNode, variant: 'tick' | 'cymbal', intensity: number, at: number, dur: number, gain: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = variant === 'cymbal' ? 6000 : 2000 + 3000 * intensity;
    const g = ctx.createGain();
    const peak = Math.max(0.0001, gain);
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}
