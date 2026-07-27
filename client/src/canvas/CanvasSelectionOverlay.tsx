// On-board selection highlight -- REQ-0140 (canvas-side-panel-parity).
//
// The panel -> board half of the selection wiring: a pointer-events:none DOM
// ring drawn over the canvas board's PLACED POs whose def id matches the
// current CanvasSelection, positioned from the same PAD=38 / CELL=80 board
// geometry BoardCoords already mirrors in DOM. Deliberately
// DOM, not a BoardRenderer change: REQ-0140 is "selection wiring only, no
// BoardRenderer rework", and the sibling REQ-0126 owns the Pixi renderer --
// an overlay ring needs neither. The engine is consumed AS-IS (cellsOf) to
// resolve each placed PO's occupied cells; no engine mutation happens here.
import { useSyncExternalStore } from 'react';
import { getCanvasSelection, subscribeCanvasSelection } from './canvasSelection';
import { useGameStore } from '../store';

// Mirror of board/geom.ts's constants (kept local so this DOM overlay never
// imports the Pixi renderer module) -- the exact pair index.css/CanvasChrome
// already hardcode for the coordinate rails.
const CELL = 80;
const PAD = 38;

export function CanvasSelectionOverlay() {
  const selection = useSyncExternalStore(subscribeCanvasSelection, getCanvasSelection, getCanvasSelection);
  const snapshot = useGameStore();
  if (!selection || snapshot.status !== 'ready' || !snapshot.state || !snapshot.engine) return null;
  // Only POs are placed on the canvas grid; a selected SI rides its host PO
  // (no independent board footprint), so there is nothing to ring for it.
  if (selection.kind !== 'po') return null;
  const { state, engine } = snapshot;

  const rings: { key: string; left: number; top: number; width: number; height: number }[] = [];
  for (const p of state.pos) {
    if (p.loc !== 'grid' || p.id !== selection.id) continue;
    let cells;
    try {
      cells = engine.cellsOf(state, p);
    } catch {
      continue;
    }
    if (!cells || cells.length === 0) continue;
    let minR = Infinity;
    let minC = Infinity;
    let maxR = -Infinity;
    let maxC = -Infinity;
    for (const [r, c] of cells) {
      if (r < minR) minR = r;
      if (c < minC) minC = c;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    }
    rings.push({
      key: p.uid,
      left: PAD + (minC - 1) * CELL,
      top: PAD + (minR - 1) * CELL,
      width: (maxC - minC + 1) * CELL,
      height: (maxR - minR + 1) * CELL,
    });
  }
  if (rings.length === 0) return null;

  return (
    <div className="canvas-sel-overlay" aria-hidden="true">
      {rings.map((r) => (
        <div
          key={r.key}
          className="canvas-sel-ring"
          data-sel-id={selection.id}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}
