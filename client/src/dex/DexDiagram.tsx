// Detail diagram (図解) — REQ-0038, enlarged ~5x + icon-fix REQ-0038
// feedback round 2, presentation overhauled REQ-0194. Large shape grid
// with the icon composited across the item's FULL footprint (reuses
// ShapeGrid + the shared client/src/render/itemCard.ts fit math — see
// ShapeGrid.tsx's module comment for the bug this replaces), plus:
//   - every Connection Port drawn OUTSIDE the shape footprint (ports'
//     tiles already commonly sit at negative/out-of-bounds coordinates
//     relative to the shape — ShapeGrid's bbox-union logic already
//     expands the grid to cover them), with a legend row per port;
//   - every socket marked at its ax/ay FRACTIONAL anchor (0..1 of the
//     unrotated shape bbox, per engine.d.ts's SocketDef doc comment) via
//     a NUMBERED marker dot in an SVG overlay sized to match the
//     underlying shape-grid's pixel box exactly, paired with a numbered
//     legend row below the stage;
//   - every occupied shape cell's [row,col] coordinate labeled directly
//     on the grid (ShapeGrid's showCoords prop).
//
// REQ-0194 (dex detail pane overhaul): the grid used to be left-anchored
// in a half-viewport panel with the socket labels ABSOLUTELY positioned
// at gridWidth+14px / hardcoded y-offsets — i.e. floating chips adrift in
// a large empty region, connected by long dashed callout lines. Now:
//   - the grid sits centered on a .dex-diagram-stage "specimen plate"
//     well (subtle radial vignette, hairline border);
//   - socket dots carry their 1-based index as SVG text; the labels
//     became a STATIC numbered legend below the stage (same
//     .dex-diagram-socket-labels class, no more absolute positioning),
//     so no dead space and no overlap however wide the grid is;
//   - the callout lines are gone (the numbers carry the dot↔label
//     mapping now);
//   - the ports list keeps its per-port mini-grid rows, restyled to the
//     same legend language.
// The .dex-diagram-grid-wrap box stays EXACTLY grid-sized (E2E measures
// per-cell size from its width — dex.spec.ts "enlarged ~5x" test).
//
// Sizing (REQ-0038 R2): base per-cell pixel size is 5x the original 46px
// (so a bare cell wants 230px), capped by DIAGRAM_MAX_HEIGHT/WIDTH so a
// tall/many-row item never forces the pane to overflow.
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
  iconAlign?: { v?: 'top' | 'middle' | 'bottom'; h?: 'left' | 'center' | 'right' };
  locale: Locale;
}

/** Computes the same bounding box ShapeGrid derives internally (shape ∪
 * every port's tiles), so the socket-marker overlay can convert an ax/ay
 * FRACTION of the shape's own unrotated bbox into a pixel position that
 * lines up with ShapeGrid's rendered cells exactly. Ports are included in
 * the shared bbox (matching ShapeGrid's own `all = [...shape, ...ports]`
 * union) so the overlay's <svg> covers the full rendered grid, not just
 * the shape sub-region — but ax/ay themselves are always relative to the
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

export function DexDiagram({ entry, shape, iconUrl, iconDims, iconStretch, iconAlign, locale }: DexDiagramProps) {
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
  // DIAGRAM_MAX_WIDTH_PX — uses whichever axis is more constraining so
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
  // portTiles prop only highlights cells — the per-port legend rows below
  // keep each individual port's tag legible).
  const allPortTiles: Cell[] = ports.flatMap((p) => p.tiles);

  // Socket marker pixel position: ax/ay are fractions (0..1) of the
  // shape's OWN unrotated bbox (engine.d.ts's SocketDef doc comment) —
  // convert to a pixel offset within the overlay <svg>, which is sized to
  // the FULL grid box (may be larger than the shape box alone if ports
  // extend outside it), so the shape sub-region's own pixel origin
  // within that overlay must be offset first.
  const shapeOriginXPx = (shapeBox.minCol - gridBox.minCol) * diagramCellPx;
  const shapeOriginYPx = (shapeBox.minRow - gridBox.minRow) * diagramCellPx;

  return (
    <div className="dex-diagram">
      {/* REQ-0194: centered "specimen plate" stage; the inner grid-wrap
          stays exactly grid-sized so the overlay math (and the E2E
          per-cell measurement) is untouched. */}
      <div className="dex-diagram-stage">
        <div className="dex-diagram-grid-wrap" style={{ width: gridWidthPx, height: gridHeightPx }}>
          <ShapeGrid
            shape={shape}
            portTiles={allPortTiles}
            cellPx={diagramCellPx}
            iconUrl={iconUrl}
            iconAlt={entry.name}
            iconDims={iconDims}
            iconStretch={iconStretch}
            iconAlign={iconAlign}
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
                return (
                  <g key={i} className="dex-diagram-socket-marker">
                    <circle cx={markerX} cy={markerY} r={9} className="dex-diagram-socket-dot" />
                    <text x={markerX} y={markerY} dy="3.5" textAnchor="middle" className="dex-diagram-socket-num-svg">
                      {i + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : null}
        </div>
      </div>

      {/* REQ-0194: static numbered socket legend (was: absolutely
          positioned floating chips at gridWidth+14px). */}
      {sockets.length > 0 ? (
        <div className="dex-diagram-socket-labels">
          <h4>{t(locale, 'dex.detail.sockets')}</h4>
          {sockets.map((s, i) => (
            <div key={i} className="dex-diagram-socket-label">
              <span className="dex-diagram-socket-legend-num tnum" aria-hidden="true">
                {i + 1}
              </span>
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
