// Mini shape/port grid — REQ-0035. Renders an item's `shape` (occupied
// cells) as a small grid, optionally overlaid with one port's `tiles`
// (connection-point cells, which may extend outside the shape's own
// bounding box, see live_items.json's flame_tablet: tiles like [0,-1]).
//
// CRITICAL: shape/port cells are [row, col], NOT [col, row] -- this is a
// hard project convention (see mock-src/engine.js, e.g. "coordinates are
// [row,col], SAME convention" at engine.js:447, cited in
// docs/REQ/REQ-0035-item-encyclopedia.md). Every cell below is read as
// cell[0]=row, cell[1]=col and NEVER transposed.
import type { Cell } from '../engine/engine.d.ts';

interface ShapeGridProps {
  shape: Cell[];
  portTiles?: Cell[];
  cellPx?: number;
}

export function ShapeGrid({ shape, portTiles, cellPx = 18 }: ShapeGridProps) {
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

  const cells: Array<{ row: number; col: number; isShape: boolean; isPort: boolean }> = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const key = `${r},${c}`;
      cells.push({ row: r, col: c, isShape: shapeSet.has(key), isPort: portSet.has(key) });
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
      {cells.map(({ row, col, isShape, isPort }) => (
        <div
          key={`${row},${col}`}
          className={`shape-grid-cell${isShape ? ' shape-grid-cell-shape' : ''}${isPort ? ' shape-grid-cell-port' : ''}`}
          title={`[${row},${col}]`}
        />
      ))}
    </div>
  );
}
