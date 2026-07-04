// Detail diagram (図解) — REQ-0038, enlarged ~5x + icon-fix REQ-0038
// feedback round 2. Large shape grid with the icon composited across the
// item's FULL footprint (reuses ShapeGrid + the shared client/src/render/
// itemCard.ts fit math -- see ShapeGrid.tsx's module comment for the bug
// this replaces), plus:
//   - every Connection Port drawn OUTSIDE the shape footprint (ports'
//     tiles already commonly sit at negative/out-of-bounds coordinates
//     relative to the shape, e.g. live_items.json's flame_tablet ports
//     use tiles like [0,-1] -- ShapeGrid's own bbox-union logic already
//     expands the grid to cover them, so "outside the footprint" falls
//     out naturally from the existing cell layout, no separate diagram
//     math needed for that part) with a tag chip per port;
//   - every socket marked at its ax/ay FRACTIONAL anchor (0..1 of the
//     unrotated shape bbox, per engine.d.ts's SocketDef doc comment) via
//     a small absolutely-positioned marker dot + an SVG callout line to a
//     type/tags label, drawn in an overlay layer sized to match the
//     underlying shape-grid's own pixel box exactly;
//   - every occupied shape cell's [row,col] coordinate labeled directly
//     on the grid (ShapeGrid's showCoords prop).
// Respects the global JA/EN locale for every label drawn here (port tag
// chips are raw content-vocab strings, not translated; only the socket
// "type"/"tags" prefix labels and coordinate axis hints go through
// ./i18n.ts's t()).
//
// REQ-0038 feedback round 2 sizing: the base per-cell pixel size is 5x
// REQ-0038's original 46px (so a bare cell wants to be 230px), capped by
// DIAGRAM_MAX_HEIGHT_PX so a tall/many-row item (or a narrow viewport)
// never forces the diagram (or its detail-pane parent) to overflow --
// "scales sanely, capped by available height" per the task spec. The cap
// is deliberately generous (620px) so it comfortably fits the two-pane
// detail layout's left pane at the E2E viewport's height (see
// DexDetail.tsx / index.css's .dex-detail-col-diagram) while still reading
// as dramatically larger than the old fixed 46px/cell.
import type { ApiItemEntry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t } from '../i18n';
import type { Locale } from '../store';
import { ShapeGrid } from './ShapeGrid';

const BASE_CELL_PX = 46;
const DIAGRAM_SCALE = 5;
const DIAGRAM_MAX_HEIGHT_PX = 620;
const DIAGRAM_MAX_WIDTH_PX = 620;

interface DexDiagramProps {
  entry: ApiItemEntry | ApiSIEntry;
  shape: Cell[];
  iconUrl: string | null;
  iconDims?: { width: number; height: number } | null;
  iconStretch?: boolean;
  locale: Locale;
}

/** Computes the same bounding box ShapeGrid derives internally (shape ∪
 * every port's tiles), so the socket-marker overlay can convert an ax/ay
 * FRACTION of the shape's own unrotated bbox into a pixel position that
 * lines up with ShapeGrid's rendered cells exactly. Ports are included in
 * the shared bbox (matching ShapeGrid's own `all = [...shape, ...ports]`
 * union) so the overlay's <svg> covers the full rendered grid, not just
 * the shape sub-region -- but ax/ay themselves are always relative to the
 * shape's OWN bbox (SocketDef's doc comment: "fraction of unrotated bbox
 * width/height"), computed separately below as shapeBox. */
function computeBoxes(shape: Cell[], ports: Array<{ tiles: Cell[] }>) {
  const portCells = ports.flatMap((p) => p.tiles);
  const all = [...shape, ...portCells];
  const rows = all.map((c) => c[0]);
  const cols = all.map((c) => c[1]);
  const gridBox = {
    minRow: Math.min(...rows),
    maxRow: Math.max(...rows),
    minCol: Math.min(...cols),
    maxCol: Math.max(...cols),
  };
  const shapeRows = shape.map((c) => c[0]);
  const shapeCols = shape.map((c) => c[1]);
  const shapeBox = {
    minRow: Math.min(...shapeRows),
    maxRow: Math.max(...shapeRows),
    minCol: Math.min(...shapeCols),
    maxCol: Math.max(...shapeCols),
  };
  return { gridBox, shapeBox };
}

export function DexDiagram({ entry, shape, iconUrl, iconDims, iconStretch, locale }: DexDiagramProps) {
  const ports = (entry.ports ?? []) as Array<{ tiles: Cell[]; tag: string }>;
  const sockets = ('sockets' in entry ? entry.sockets : undefined) ?? [];

  if (shape.length === 0) {
    return <div className="dex-diagram-empty">--</div>;
  }

  const { gridBox, shapeBox } = computeBoxes(shape, ports);
  const nCols = gridBox.maxCol - gridBox.minCol + 1;
  const nRows = gridBox.maxRow - gridBox.minRow + 1;

  // REQ-0038 R2: 5x the original per-cell size, then capped so the WHOLE
  // grid (nRows/nCols cells) fits within DIAGRAM_MAX_HEIGHT_PX x
  // DIAGRAM_MAX_WIDTH_PX -- "about 5x larger... cap by available height"
  // per the task spec. Uses whichever axis is more constraining so
  // multi-row AND multi-col items both stay on-screen.
  const uncappedCellPx = BASE_CELL_PX * DIAGRAM_SCALE;
  const cellPxByHeight = DIAGRAM_MAX_HEIGHT_PX / nRows;
  const cellPxByWidth = DIAGRAM_MAX_WIDTH_PX / nCols;
  const diagramCellPx = Math.max(BASE_CELL_PX, Math.min(uncappedCellPx, cellPxByHeight, cellPxByWidth));

  const gridWidthPx = nCols * diagramCellPx;
  const gridHeightPx = nRows * diagramCellPx;
  const shapeWidthCells = shapeBox.maxCol - shapeBox.minCol + 1;
  const shapeHeightCells = shapeBox.maxRow - shapeBox.minRow + 1;

  // Merge every port's tiles into one combined overlay (ShapeGrid's
  // portTiles prop only highlights cells -- the tag-chip callouts for
  // each individual port are rendered as a separate list below the grid,
  // one row per port, matching the task spec's "diagram the sockets in
  // detail" while keeping each port's own tag legible).
  const allPortTiles: Cell[] = ports.flatMap((p) => p.tiles);

  // Socket marker pixel position: ax/ay are fractions (0..1) of the
  // shape's OWN unrotated bbox (engine.d.ts's SocketDef doc comment) --
  // convert to a pixel offset within the overlay <svg>, which is sized to
  // the FULL grid box (may be larger than the shape box alone if ports
  // extend outside it), so the shape sub-region's own pixel origin
  // within that overlay must be offset first.
  const shapeOriginXPx = (shapeBox.minCol - gridBox.minCol) * diagramCellPx;
  const shapeOriginYPx = (shapeBox.minRow - gridBox.minRow) * diagramCellPx;

  return (
    <div className="dex-diagram">
      <div className="dex-diagram-grid-wrap" style={{ width: gridWidthPx, height: gridHeightPx }}>
        <ShapeGrid
          shape={shape}
          portTiles={allPortTiles}
          cellPx={diagramCellPx}
          iconUrl={iconUrl}
          iconAlt={entry.name}
          iconDims={iconDims}
          iconStretch={iconStretch}
          showCoords
        />
        {sockets.length > 0 ? (
          <svg
            className="dex-diagram-socket-overlay"
            width={gridWidthPx}
            height={gridHeightPx}
            viewBox={`0 0 ${gridWidthPx} ${gridHeightPx}`}
          >
            {sockets.map((s, i) => {
              const ax = s.ax ?? 0.5;
              const ay = s.ay ?? 0.5;
              const markerX = shapeOriginXPx + ax * (shapeWidthCells * diagramCellPx);
              const markerY = shapeOriginYPx + ay * (shapeHeightCells * diagramCellPx);
              // Callout line target: a label slot to the right of the
              // grid, stacked one per socket -- offset far enough right
              // that it clears the grid itself regardless of grid width.
              const labelX = gridWidthPx + 14;
              const labelY = 16 + i * 20;
              return (
                <g key={i} className="dex-diagram-socket-marker">
                  <line x1={markerX} y1={markerY} x2={labelX - 4} y2={labelY} className="dex-diagram-callout-line" />
                  <circle cx={markerX} cy={markerY} r={5} className="dex-diagram-socket-dot" />
                </g>
              );
            })}
          </svg>
        ) : null}
        {sockets.length > 0 ? (
          <div className="dex-diagram-socket-labels" style={{ left: gridWidthPx + 14 }}>
            {sockets.map((s, i) => (
              <div key={i} className="dex-diagram-socket-label" style={{ top: 16 + i * 20 - 8 }}>
                <span className="dex-tag-chip">{s.t}</span>
                {(s.tags ?? []).map((tag: string) => (
                  <span className="dex-tag-chip dex-tag-chip-dim" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {ports.length > 0 ? (
        <div className="dex-diagram-ports">
          <h4>{t(locale, 'dex.detail.ports')}</h4>
          {ports.map((port, i) => (
            <div className="dex-port-row" key={i}>
              <ShapeGrid shape={shape} portTiles={port.tiles} cellPx={14} />
              <span className="dex-tag-chip">{port.tag}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
