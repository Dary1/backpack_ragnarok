// Mini shape/port grid — REQ-0035, extended REQ-0038 for shape-mounted
// icon rendering + on-cell coordinate labels, extended REQ-0038 feedback
// round 2 to FIX the icon-on-shape compositing bug (Dex catalog/edit-mode
// list/detail diagram all reuse this ONE component rather than forking a
// second grid renderer). Renders an item's `shape` (occupied cells) as a
// small grid, optionally overlaid with one port's `tiles` (connection-
// point cells, which may extend outside the shape's own bounding box, see
// live_items.json's flame_tablet: tiles like [0,-1]), optionally with an
// icon MOUNTED ACROSS THE ITEM'S FULL FOOTPRINT (all shape cells, not just
// one), and optionally with each occupied cell's own [row,col] coordinate
// labeled directly on the grid (used by the REQ-0038 diagram view; the
// catalog/thumbnail call sites leave this off since a dense catalog grid
// has no room for text labels).
//
// BUG FIXED HERE (REQ-0038 feedback round 2): the icon used to be rendered
// INLINE inside one per-cell <div> (the shape's "anchor" cell, shape[0]),
// sized via `inset:0` relative to that single CSS-grid cell -- so for any
// multi-cell item (blade shape=[[0,0],[1,0]], tower_shield shape=
// [[0,0],[0,1],[1,0],[1,1]]) the whole icon was visually squeezed into the
// first cell's small box instead of spanning the item's real footprint.
// client/src/board/BoardRenderer.ts's placed-PO rendering never had this
// bug: it always computes ONE pixel box across the item's ENTIRE rotated
// footprint and contain-fits the sprite inside it, once. The fix here is
// to REUSE that exact box-fitting math via the shared, framework-agnostic
// client/src/render/itemCard.ts module (computeDomIconOverlay, which
// wraps the same fitBoxInBounds/insetBoxFor/computeFootprintCells
// BoardRenderer itself now calls) instead of inventing a second placement
// algorithm -- loose coupling: this component depends on itemCard.ts's
// pure functions only, never on BoardRenderer/Pixi. The icon is now ONE
// absolutely-positioned <img> layered OVER the shape's cell grid (a
// wrapper sized+positioned to the footprint's own top-left shape cell),
// not one <img> per cell -- still exactly one `.shape-grid-cell-icon`
// element in the DOM (matches existing E2E expectations), just correctly
// sized/positioned now. Footprint metrics are exposed as
// `data-footprint-w`/`data-footprint-h` attributes on that wrapper so
// tests can assert the rendered footprint robustly (DOM metadata) instead
// of pixel-sampling the canvas/image.
//
// CRITICAL: shape/port cells are [row, col], NOT [col, row] -- this is a
// hard project convention (see mock-src/engine.js, e.g. "coordinates are
// [row,col], SAME convention" at engine.js:447, cited in
// docs/REQ/REQ-0035-item-encyclopedia.md). Every cell below is read as
// cell[0]=row, cell[1]=col and NEVER transposed.
//
// DOM-based (plain CSS grid), not PixiJS -- this is a reference/wiki view,
// not a game board, per dexIcons.ts's module comment (no Pixi Application
// here, deliberately, to avoid the Pixi-lifecycle issues documented in
// REQ-0031/REQ-0034).
import type { Cell } from '../engine/engine.d.ts';
import { computeDomIconOverlay } from '../render/itemCard';

interface ShapeGridProps {
  shape: Cell[];
  portTiles?: Cell[];
  /** REQ-0045 (h): highlights a single cell as the BP linker core (the
   * beam-firing anchor cell, engine.linkerCell()'s own cell-space --
   * mirrors portTiles' "extra highlighted cell set" pattern, but always
   * exactly one cell). Independent of portTiles/isShape -- a cell can be
   * shape+linker at once (the common case: the linker sits ON the BP's
   * own footprint). */
  linkerTile?: Cell;
  cellPx?: number;
  /** REQ-0038, fixed R2: shape-mounted icon rendering. When provided, the
   * icon is composited as ONE overlay spanning the item's full footprint
   * (every occupied shape cell's bounding box), not squeezed into a
   * single anchor cell -- see module comment above. */
  iconUrl?: string | null;
  iconAlt?: string;
  /** REQ-0038 R2: the icon's own native SVG viewBox width/height, needed
   * to contain-fit it into the footprint box with the correct aspect
   * ratio (dexIcons.ts's iconDims()). Falls back to a 1:1 square aspect
   * if omitted (still spans the full footprint, just without the exact
   * native aspect). */
  iconDims?: { width: number; height: number } | null;
  /** REQ-0038 R2: mirrors ItemDef.stretch -- selects the same inset-
   * fraction preset BoardRenderer's placed-PO draw path uses (see
   * itemCard.ts's insetBoxFor). */
  iconStretch?: boolean;
  /** REQ-0038: labels each OCCUPIED shape cell with its own [row,col]
   * coordinate (small text in the cell's corner) -- used by the detail
   * diagram's large grid, per the task spec ("every occupied cell's
   * [row,col] coordinate labeled on the diagram"). Off by default (the
   * catalog/thumbnail renderings are too small for legible text). */
  showCoords?: boolean;
}

export function ShapeGrid({
  shape,
  portTiles,
  linkerTile,
  cellPx = 18,
  iconUrl,
  iconAlt,
  iconDims,
  iconStretch,
  showCoords,
}: ShapeGridProps) {
  const all = [...shape, ...(portTiles ?? []), ...(linkerTile ? [linkerTile] : [])];
  if (all.length === 0) return <div className="shape-grid-empty">--</div>;

  const rows = all.map((c) => c[0]);
  const cols = all.map((c) => c[1]);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const nRows = maxRow - minRow + 1;
  const nCols = maxCol - minCol + 1;

  const shapeSet = new Set(shape.map((c) => `${c[0]},${c[1]}`));
  const portSet = new Set((portTiles ?? []).map((c) => `${c[0]},${c[1]}`));
  const linkerKey = linkerTile ? `${linkerTile[0]},${linkerTile[1]}` : null;

  const cells: Array<{ row: number; col: number; isShape: boolean; isPort: boolean; isLinker: boolean }> = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const key = `${r},${c}`;
      cells.push({ row: r, col: c, isShape: shapeSet.has(key), isPort: portSet.has(key), isLinker: key === linkerKey });
    }
  }

  // Icon overlay: ONE box spanning the item's full (rot=0) footprint, via
  // the shared itemCard.ts module -- the same fit/inset math
  // BoardRenderer.ts uses for placed-PO art (see module comment). The
  // overlay wrapper is positioned at the shape's own top-left bounding
  // cell (shape's own minRow/minCol, which may differ from the combined
  // grid's minRow/minCol when portTiles extend further out, e.g.
  // flame_tablet's [0,-1] port tile).
  const shapeRows = shape.map((c) => c[0]);
  const shapeCols = shape.map((c) => c[1]);
  const shapeMinRow = shape.length > 0 ? Math.min(...shapeRows) : minRow;
  const shapeMinCol = shape.length > 0 ? Math.min(...shapeCols) : minCol;
  const overlay =
    iconUrl && shape.length > 0
      ? computeDomIconOverlay({ shape, stretch: iconStretch }, cellPx, iconDims?.width ?? 1, iconDims?.height ?? 1)
      : null;
  const overlayLeft = overlay ? (shapeMinCol - minCol) * cellPx : 0;
  const overlayTop = overlay ? (shapeMinRow - minRow) * cellPx : 0;

  return (
    <div
      className="shape-grid"
      style={{
        position: 'relative',
        gridTemplateColumns: `repeat(${nCols}, ${cellPx}px)`,
        gridTemplateRows: `repeat(${nRows}, ${cellPx}px)`,
      }}
    >
      {cells.map(({ row, col, isShape, isPort, isLinker }) => (
        <div
          key={`${row},${col}`}
          className={`shape-grid-cell${isShape ? ' shape-grid-cell-shape' : ''}${isPort ? ' shape-grid-cell-port' : ''}${isLinker ? ' shape-grid-cell-linker' : ''}`}
          title={`[${row},${col}]`}
          data-testid={isLinker ? 'shape-grid-cell-linker' : undefined}
        >
          {showCoords && isShape ? <span className="shape-grid-cell-coord">{row},{col}</span> : null}
        </div>
      ))}
      {overlay ? (
        <div
          className="shape-grid-icon-overlay"
          data-footprint-w={overlay.footprintCells.w}
          data-footprint-h={overlay.footprintCells.h}
          style={{
            position: 'absolute',
            left: overlayLeft,
            top: overlayTop,
            width: overlay.footprintPx.w,
            height: overlay.footprintPx.h,
            pointerEvents: 'none',
          }}
        >
          <img
            className="shape-grid-cell-icon"
            src={iconUrl ?? undefined}
            alt={iconAlt ?? ''}
            style={{
              position: 'absolute',
              left: overlay.style.left,
              top: overlay.style.top,
              width: overlay.style.width,
              height: overlay.style.height,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
