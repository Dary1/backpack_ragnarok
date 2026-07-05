// BP roll-result diagram (図解) -- REQ-0045 (h). Shown after a successful
// Workshop gacha roll (WorkshopPage.tsx's handleRoll), reusing the SAME
// Dex diagram building block ShapeGrid (client/src/dex/ShapeGrid.tsx) that
// DexDiagram.tsx uses for POs/SIs -- see this file's own module comment
// for why a separate component sits beside DexDiagram rather than
// overloading it: DexDiagram's props are `entry: ApiItemEntry | ApiSIEntry`
// (name/rarity/ports/sockets), none of which a rolled BP has (a BP is
// shape+linker+hpMax, an entirely different content shape, see
// client/src/api.ts's ApiRolledBp / server/schedule.cjs's rollCommonBp).
// ShapeGrid itself is genuinely BP-agnostic (just shape/portTiles/cellPx),
// so THAT'S the piece reused here, exactly as DexDiagram reuses it for
// items -- plus the SAME visual language DexDiagram already established
// (dex-diagram-* CSS classes, absolutely-positioned SVG overlay sized to
// the grid's own pixel box) is extended here as bp-diagram-* variants so
// the two diagrams read as one consistent family rather than two
// unrelated designs.
//
// Per the task spec ("shape grid + linker cell marked + beam dirs as
// compass arrows + hpMax + cell count"):
//   - shape grid: ShapeGrid itself (identical component DexDiagram uses).
//   - linker cell marked: ShapeGrid's new `linkerTile` prop (REQ-0045 h,
//     added alongside this file -- mirrors the existing `portTiles`
//     highlight pattern, see ShapeGrid.tsx's own doc comment).
//   - beam dirs as compass arrows: an SVG overlay drawn from the linker
//     cell's own pixel center, one line+arrowhead per `linker.dirs`
//     entry, at the EXACT SAME 8-point compass angle table
//     (client/src/board/BoardRenderer.ts's DIR_ANGLES) the live game
//     board itself uses for its (Pixi) direction dots -- copied verbatim
//     here since ShapeGrid/DexDiagram are deliberately DOM/SVG-only, never
//     Pixi (see ShapeGrid.tsx: "not PixiJS -- this is a reference/wiki
//     view"), so the Pixi Graphics calls themselves can't be shared, only
//     the angle table that defines the compass convention.
//   - hpMax + cell count: plain text rows below the grid (neither concept
//     exists on an item entry, so DexDiagram/ItemDetailCard never needed
//     this -- new here).
import type { Cell, Offset } from '../engine/engine.d.ts';
import { t } from '../i18n';
import type { Locale } from '../store';
import { ShapeGrid } from './ShapeGrid';

// Verbatim copy of BoardRenderer.ts's own DIR_ANGLES table (0=N .. 7=NW,
// clockwise, degrees, screen-space where +y is down) -- this table IS the
// project's one compass convention; every other direction-arrow rendering
// (the live canvas's linker dots, its traced-beam arrowheads) derives from
// this exact mapping, so a diagram claiming to show "beam directions" must
// use the identical angles or it would silently lie about which way a
// beam actually fires in-game.
const DIR_ANGLES: Record<number, number> = {
  0: -90,
  1: -45,
  2: 0,
  3: 45,
  4: 90,
  5: 135,
  6: 180,
  7: -135,
};

const CELL_PX = 42;
const ARROW_LEN_PX = 34;
const ARROWHEAD_PX = 7;

interface BpDiagramProps {
  shape: Cell[];
  /** Linker anchor offset, cell-space relative to the shape's own local
   * origin (matches BPLinker.off / ApiRolledBp.linker.off) -- a rolled BP
   * has no `origin` of its own yet (it's not placed anywhere), so the
   * diagram treats the shape's own coordinate space as the frame of
   * reference, same as ShapeGrid already does for `shape`/`portTiles`. */
  linkerOff: Offset;
  dirs: number[];
  hpMax: number;
  cellCount: number;
  locale: Locale;
}

/** Builds one SVG line+arrowhead path per direction, all anchored at the
 * linker cell's own pixel center -- same per-arrow angle math as
 * BoardRenderer.ts's direction-dot loop, just rendered as a longer,
 * clearly-arrowed vector instead of a small dot (a diagram's job is to
 * explain the direction, not just mark that one exists). */
function ArrowOverlay({
  linkerXPx,
  linkerYPx,
  dirs,
  width,
  height,
}: {
  linkerXPx: number;
  linkerYPx: number;
  dirs: number[];
  width: number;
  height: number;
}) {
  return (
    <svg
      className="bp-diagram-arrow-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {dirs.map((d, i) => {
        const angDeg = DIR_ANGLES[d] ?? 0;
        const ang = (angDeg * Math.PI) / 180;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const tipX = linkerXPx + cos * ARROW_LEN_PX;
        const tipY = linkerYPx + sin * ARROW_LEN_PX;
        // Arrowhead: a small triangle splayed +-2.6rad off the shaft's own
        // angle (same construction BoardRenderer.ts's arrowHead() helper
        // uses for traced-beam arrowheads, just inlined as an SVG polygon
        // instead of a Pixi Graphics triangle).
        const splay = 2.6;
        const leftX = tipX - Math.cos(ang - splay) * ARROWHEAD_PX;
        const leftY = tipY - Math.sin(ang - splay) * ARROWHEAD_PX;
        const rightX = tipX - Math.cos(ang + splay) * ARROWHEAD_PX;
        const rightY = tipY - Math.sin(ang + splay) * ARROWHEAD_PX;
        return (
          <g key={`${d}-${i}`} className="bp-diagram-arrow" data-testid="bp-diagram-arrow" data-dir={d}>
            <line x1={linkerXPx} y1={linkerYPx} x2={tipX} y2={tipY} className="bp-diagram-arrow-shaft" />
            <polygon points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`} className="bp-diagram-arrow-head" />
          </g>
        );
      })}
    </svg>
  );
}

export function BpDiagram({ shape, linkerOff, dirs, hpMax, cellCount, locale }: BpDiagramProps) {
  if (shape.length === 0) {
    return <div className="dex-diagram-empty">--</div>;
  }

  const rows = shape.map((c) => c[0]);
  const cols = shape.map((c) => c[1]);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const nCols = maxCol - minCol + 1;
  const nRows = maxRow - minRow + 1;
  const gridWidthPx = nCols * CELL_PX;
  const gridHeightPx = nRows * CELL_PX;

  // linker.off is relative to the shape's own local origin, which per
  // engine.d.ts's BPLinker doc is [0,0] in this local (unplaced) frame --
  // so the linker cell IS simply linkerOff itself here, same coordinate
  // space as every shape/portTiles cell ShapeGrid already renders.
  const linkerCell: Cell = [linkerOff[0], linkerOff[1]];
  const linkerXPx = (linkerCell[1] - minCol) * CELL_PX + CELL_PX / 2;
  const linkerYPx = (linkerCell[0] - minRow) * CELL_PX + CELL_PX / 2;

  return (
    <div className="dex-diagram bp-diagram">
      <div className="dex-diagram-grid-wrap bp-diagram-grid-wrap" style={{ width: gridWidthPx, height: gridHeightPx }}>
        <ShapeGrid shape={shape} linkerTile={linkerCell} cellPx={CELL_PX} showCoords />
        {dirs.length > 0 ? (
          <ArrowOverlay linkerXPx={linkerXPx} linkerYPx={linkerYPx} dirs={dirs} width={gridWidthPx} height={gridHeightPx} />
        ) : null}
      </div>
      <div className="bp-diagram-stats">
        <div className="bp-diagram-stat" data-testid="bp-diagram-hpmax">
          <span className="bp-diagram-stat-label">{t(locale, 'workshop.rollResultHpMax')}</span>
          <span className="bp-diagram-stat-value">{hpMax}</span>
        </div>
        <div className="bp-diagram-stat" data-testid="bp-diagram-cellcount">
          <span className="bp-diagram-stat-label">{t(locale, 'workshop.rollResultCellCount')}</span>
          <span className="bp-diagram-stat-value">{cellCount}</span>
        </div>
      </div>
    </div>
  );
}
