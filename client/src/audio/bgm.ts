// REQ-0370 -- BGM playback: one looped track on the title/landing route and
// one shared hall loop on the in-app routes (currently the SAME track; the
// REQ ships with the first user-approved track -- swap the TRACKS entries
// to split the scenes later).
//
// Rules (spec items 3-4):
//   - The asset is REFERENCED from the served static docroot
//     (/redesign/assets/, the REQ-0069 convention) -- never bundled.
//   - Playback starts only after the first user gesture (autoplay law).
//   - document.hidden pauses (a true pause: position kept, resumed).
//   - navigator.webdriver -> hard OFF (landing/particles.ts precedent):
//     the e2e suite stays byte-identical in audio-free behaviour.
//   - A route change that maps to the same track does NOT restart the loop.
//   - Missing/undecodable asset -> silence, never an error surface (this
//     is the spec's OPEN ITEM: deliverables 1-2 land before any track).
//   - Reduced-motion is a MOTION preference; it never gates audio.
// Loop mechanics: fetch + decodeAudioData + AudioBufferSourceNode(loop) --
// gapless, and governed by the mixer through the bgm bus (audio/bus.ts).

import { getBgmBus, getBusContext, resumeBus } from './bus';

export type BgmScene = 'title' | 'hall';

const ASSET_BASE = '/redesign/assets'; // REQ-0069 served-docroot convention
const TRACKS: Record<BgmScene, string> = {
  title: `${ASSET_BASE}/bgm_main_loop.wav`,
  hall: `${ASSET_BASE}/bgm_main_loop.wav`,
};

let inited = false;
let gestureSeen = false;
let scene: BgmScene = 'title';

let source: AudioBufferSourceNode | null = null;
let playingUrl: string | null = null;
let startedAtCtxTime = 0;
let pausedOffset = 0; // seconds into the buffer where a pause left off

/** null = fetch/decode failed once; do not re-request every route change. */
const bufferCache = new Map<string, AudioBuffer | null>();
let syncToken = 0;

function stopSource(recordOffset: boolean): void {
  if (!source) return;
  const ctx = getBusContext();
  if (recordOffset && ctx && source.buffer) {
    pausedOffset = (ctx.currentTime - startedAtCtxTime + pausedOffset) % source.buffer.duration;
  } else if (!recordOffset) {
    pausedOffset = 0; // a NEW track always starts from its top
  }
  try { source.stop(); } catch { /* already stopped */ }
  try { source.disconnect(); } catch { /* already detached */ }
  source = null;
  playingUrl = null;
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  if (bufferCache.has(url)) return bufferCache.get(url) ?? null;
  const ctx = getBusContext();
  if (!ctx) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    bufferCache.set(url, buf);
    return buf;
  } catch {
    bufferCache.set(url, null); // no track yet / bad asset -> stay silent
    return null;
  }
}

/** Reconcile playback with (scene, gesture, visibility). Idempotent; the
 * token guards the async decode against a superseding call. */
async function sync(): Promise<void> {
  const token = ++syncToken;
  if (!gestureSeen) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  const url = TRACKS[scene];
  if (source && playingUrl === url) return; // same track: never restart (gate)
  const ctx = getBusContext();
  const bus = getBgmBus();
  if (!ctx || !bus) return;
  const buffer = await loadBuffer(url);
  if (token !== syncToken) return; // superseded while decoding
  if (!buffer) return;
  stopSource(false);
  resumeBus();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(bus);
  src.start(0, pausedOffset % buffer.duration);
  startedAtCtxTime = ctx.currentTime;
  source = src;
  playingUrl = url;
}

function pause(): void {
  stopSource(true);
}

/** Select the BGM scene for the current route. Called from App.tsx's route
 * effect; a no-op before initBgm() (or forever, under webdriver). */
export function setBgmScene(next: BgmScene): void {
  if (scene === next) return;
  scene = next;
  if (!inited) return;
  void sync();
}

/** Install the first-gesture + visibility hooks. Idempotent; called once
 * from main.tsx. Under navigator.webdriver this returns before installing
 * ANY listener -- BGM is hard-off for e2e/automation. */
export function initBgm(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  if (navigator.webdriver) return; // e2e/automation: BGM fully off
  const onFirstGesture = () => {
    gestureSeen = true;
    void sync();
  };
  window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true, capture: true });
  window.addEventListener('keydown', onFirstGesture, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else void sync();
  });
}
