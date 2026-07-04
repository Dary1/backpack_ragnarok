// Mini shape/port grid — REQ-0035, extended REQ-0038 for shape-mounted
// icon rendering + on-cell coordinate labels (Dex v2 catalog/detail/edit
// thumbnails all reuse this ONE component rather than forking a second
// grid renderer). Renders an item's `shape` (occupied cells) as a small
// grid, optionally overlaid with one port's `tiles` (connection-point
// cells, which may extend outside the shape's own bounding box, see
// live_items.json's flame_tablet: tiles like [0,-1]), optionally with an
// icon mounted on the shape's ANCHOR cell (shape[0] -- the first cell in
// the shape array, matching the project's existing anchor convention:
// server/admin.cjs's socket ax/ay and every port's tiles are all
// expressed relative to this same anchor), and optionally with each
// occupied cell's own [row,col] coordinate labeled directly on the grid
// (used by the REQ-0038 diagram view; the catalog/thumbnail call sites
// leave this off since a dense catalog grid has no room for text labels).
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

interface ShapeGridProps {
  shape: Cell[];
  portTiles?: Cell[];
  cellPx?: number;
  /** REQ-0038: shape-mounted icon rendering. When provided, the icon is
   * placed on the anchor cell (shape[0]) as a plain <img>, sized to fill
   * that one cell -- the same dexIcons.ts data-URL pipeline the old bare-
   * icon catalog rendering already used, just composited onto the grid
   * instead of standing alone. */
  iconUrl?: string | null;
  iconAlt?: string;
  /** REQ-0038: labels each OCCUPIED shape cell with its own [row,col]
   * coordinate (small text in the cell's corner) -- used by the detail
   * diagram's large grid, per the task spec ("every occupied cell's
   * [row,col] coordinate labeled on the diagram"). Off by default (the
   * catalog/thumbnail renderings are too small for legible text). */
  showCoords?: boolean;
}

export function ShapeGrid({ shape, portTiles, cellPx = 18, iconUrl, iconAlt, showCoords }: ShapeGridProps) {
  const all = [...shape, ...(portTiles ?? [])];
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
  // Anchor cell = shape[0] (project convention: every port/socket anchor
  // coordinate is expressed relative to this cell) -- this is where a
  // provided icon gets mounted, matching where the game board itself
  // visually anchors an item's art.
  const anchorKey = shape.length > 0 ? `${shape[0][0]},${shape[0][1]}` : null;

  const cells: Array<{ row: number; col: number; isShape: boolean; isPort: boolean; isAnchor: boolean }> = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const key = `${r},${c}`;
      cells.push({ row: r, col: c, isShape: shapeSet.has(key), isPort: portSet.has(key), isAnchor: key === anchorKey });
    }
  }

  return (
    <div
      className="shape-grid"
      style={{
        gridTemplateColumns: `repeat(${nCols}, ${cellPx}px)`,
        gridTemplateRows: `repeat(${nRows}, ${cellPx}px)`,
      }}
    >
      {cells.map(({ row, col, isShape, isPort, isAnchor }) => (
        <div
          key={`${row},${col}`}
          className={`shape-grid-cell${isShape ? ' shape-grid-cell-shape' : ''}${isPort ? ' shape-grid-cell-port' : ''}`}
          title={`[${row},${col}]`}
        >
          {isAnchor && iconUrl ? (
            <img className="shape-grid-cell-icon" src={iconUrl} alt={iconAlt ?? ''} />
          ) : null}
          {showCoords && isShape ? <span className="shape-grid-cell-coord">{row},{col}</span> : null}
        </div>
      ))}
    </div>
  );
}
