// REQ-0370 -- Audio bus: ONE shared AudioContext with a master -> {bgm, sfx}
// WebAudio gain graph. Every sound source in the app parents its output
// here so the Settings mixer (master/BGM/SE + mute-all) governs all of it:
//   - Circuit chimes  (schedule/chimes/ChimeEngine.ts)  -> sfx
//   - Warehouse claim (warehouse/claimSfx.ts)           -> sfx
//   - Button FX       (theme/buttonFx.ts)               -> sfx
//   - BGM             (audio/bgm.ts)                    -> bgm
//
// Design notes:
//   - Sources keep their OWN synthesis/scheduling logic; only their output
//     node re-parents here (spec item 1). Default master=1/sfx=1 makes the
//     sfx path a unity gain -- NO audible change at default settings.
//   - Feature-detected + best-effort like every audio touch in this app:
//     no AudioContext -> every getter returns null and callers fall back
//     to their pre-REQ-0370 behaviour (own context, ctx.destination).
//   - Prefs apply live via AUDIO_PREFS_EVENT (same-tab), with the short
//     setTargetAtTime ramp ChimeEngine.setPrefs already uses (no zipper
//     noise on slider drags).

import { AUDIO_PREFS_EVENT, loadAudioPrefs, type AudioPrefs } from './audioPrefs';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let bgmGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let failed = false;

function applyPrefs(p: AudioPrefs): void {
  if (!ctx || !masterGain || !bgmGain || !sfxGain) return;
  const t = ctx.currentTime;
  masterGain.gain.setTargetAtTime(p.muted ? 0 : p.master, t, 0.02);
  bgmGain.gain.setTargetAtTime(p.bgm, t, 0.02);
  sfxGain.gain.setTargetAtTime(p.sfx, t, 0.02);
}

function ensureBus(): boolean {
  if (ctx) return true;
  if (failed || typeof window === 'undefined') return false;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    failed = true;
    return false;
  }
  try {
    ctx = new Ctor();
    masterGain = ctx.createGain();
    bgmGain = ctx.createGain();
    sfxGain = ctx.createGain();
    masterGain.connect(ctx.destination);
    bgmGain.connect(masterGain);
    sfxGain.connect(masterGain);
    const p = loadAudioPrefs();
    masterGain.gain.value = p.muted ? 0 : p.master;
    bgmGain.gain.value = p.bgm;
    sfxGain.gain.value = p.sfx;
    window.addEventListener(AUDIO_PREFS_EVENT, (e) => {
      applyPrefs((e as CustomEvent<AudioPrefs>).detail);
    });
    return true;
  } catch {
    ctx = null;
    masterGain = null;
    bgmGain = null;
    sfxGain = null;
    failed = true; // give up permanently on this session (ChimeEngine posture)
    return false;
  }
}

/** The app-wide shared AudioContext (created lazily). Null when WebAudio is
 * unavailable -- callers keep their legacy fallback. */
export function getBusContext(): AudioContext | null {
  return ensureBus() ? ctx : null;
}

/** Parent node for every sound-effect source. */
export function getSfxBus(): AudioNode | null {
  return ensureBus() ? sfxGain : null;
}

/** Parent node for BGM playback. */
export function getBgmBus(): AudioNode | null {
  return ensureBus() ? bgmGain : null;
}

/** Resume a suspended shared context (call from a user-gesture handler --
 * browser autoplay law). No-op when audio is unavailable. */
export function resumeBus(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}
