// client/src/board/skin/bpSkinProbe.ts -- REQ-0350.
//
// Composite/cache counters for the BP-skin texture cache. PURE DATA -- no Pixi
// and no DOM import -- so store/boot.ts can expose it on __backpackDebug
// alongside the other read seams (paintProbe.ts is the precedent for this
// shape, and usageRibbonProbe.ts before it).
//
// WHY a probe and not a timing assertion. The bug this REQ fixes was invisible
// to every gate the project had: the board rendered correctly, so no visual or
// e2e assertion moved, and the only symptom was 11-23ms of distance-transform
// per skinned BP per render(state) -- real, but exactly the kind of thing a
// wall-clock threshold in CI reports as a flake. Counting the composites
// instead makes the invariant discrete and non-flaky: "N state changes over an
// unmoved board must add ZERO composites".
//
// paintProbe.ts's lesson applies verbatim and is the reason `hits` exists next
// to `composites`: a zero from an unvalidated probe is worth nothing and looks
// exactly like a fixed bug. The spec that consumes this never asserts
// composites-stayed-zero without, in the same test, watching `hits` climb --
// which is the proof that the code path ran at all and the cache served it.
const counts = { composites: 0, hits: 0 };

/** Called by bpSkinTexture.textureFor immediately before compositeSkin(). */
export function countBpSkinComposite(): void {
  counts.composites++;
}

/** Called by bpSkinTexture.textureFor on a cache hit. */
export function countBpSkinCacheHit(): void {
  counts.hits++;
}

/** Composites computed / cache hits served since page load, for a single
 * round-trip read from e2e. */
export function bpSkinProbe(): { composites: number; hits: number } {
  return { composites: counts.composites, hits: counts.hits };
}

/** Test-only reset, so a spec can measure a DELTA from a known zero rather
 * than reasoning about whatever the app did during boot. */
export function resetBpSkinProbe(): void {
  counts.composites = 0;
  counts.hits = 0;
}
