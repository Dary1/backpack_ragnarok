// REQ-0091: short synthesized "claim" chime played the instant the
// warehouse claim button is pressed (immediate feedback, paired with the
// row-frame flash -- see WarehousePage.tsx's handleClaim). No audio
// asset pipeline exists anywhere in this app yet (checked: no
// .mp3/.wav/.ogg file, no Howler/Tone dependency in client/package.json)
// -- rather than invent an unowned binary asset with no designer/asset
// pipeline behind it (this app's other assets are all served, authored
// files -- see the /redesign/assets/ convention), this synthesizes a
// tiny two-note chime via the standard Web Audio API at call time.
//
// Best-effort by construction: every failure mode (autoplay/AudioContext
// policy quirks, an unsupported or headless/test environment, a browser
// without webkitAudioContext either) is swallowed silently, the same
// posture this page already takes for its other non-critical touches
// (toast text, tab pulse). Audio must never block or break the actual
// claim flow.

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

/** Two-note ascending chime (~200ms total, gold/positive register) --
 * played once per claim press, on press, regardless of how the request
 * later resolves (the visual flash's fade-out is what tracks the
 * response; this SFX's own job ends at "press acknowledged"). */
export function playClaimChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    // [frequency Hz, start offset s, duration s]
    const notes: Array<[number, number, number]> = [
      [880, 0, 0.09],
      [1318.51, 0.05, 0.15],
    ];
    for (const [freq, start, dur] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Exponential ramps avoid the audible "click" a hard step would
      // cause; exponentialRampToValueAtTime cannot target exactly 0, so
      // the envelope bottoms out at a negligible epsilon instead.
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.2, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    }
  } catch {
    /* best-effort SFX only -- never let audio break the claim flow */
  }
}
