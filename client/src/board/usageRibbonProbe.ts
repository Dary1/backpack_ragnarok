// client/src/board/usageRibbonProbe.ts -- REQ-0287 (shared-usage visibility).
//
// Per-board usage-ribbon probe registry: the e2e read seam (beamSegs
// precedent -- a per-render snapshot the test can assert on instead of
// reverse-engineering PixiJS pixels). PURE DATA -- no Pixi import -- so
// store/boot.ts can expose it on __backpackDebug alongside the other
// reference-model hooks without dragging the renderer/Pixi into that module.
export interface UsageRibbonProbeEntry {
  uid: string;
  corner: 'tr' | 'tl';
  /** The share-count rendered inside a `tr` ribbon (>=2 other squads), else
   * null (a `tr` shared with exactly one other squad, or any `tl` ribbon). */
  count: number | null;
}

const registry = new Map<string, UsageRibbonProbeEntry[]>();

/** Called by BoardRenderer at the end of every render(), keyed by boardIdKey
 * (`'canvas'` | `'inv:<page>'`). Replaces the board's previous snapshot. */
export function publishRibbonProbe(boardKey: string, probe: UsageRibbonProbeEntry[]): void {
  registry.set(boardKey, probe);
}

/** e2e read: the ribbons the named board drew on its most recent render. */
export function ribbonProbeFor(boardKey: string): UsageRibbonProbeEntry[] {
  return registry.get(boardKey) ?? [];
}
