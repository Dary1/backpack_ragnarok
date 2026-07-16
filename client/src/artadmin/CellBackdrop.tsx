// client/src/artadmin/CellBackdrop.tsx -- REQ-0191. The cell-shape backdrop:
// draw a po render OVER ITS OWN CELL FOOTPRINT so the fit doctrine's
// violations (border-skimming, starved cells, diagonal compositions --
// item_content_pipeline.md S0.2) are visible at a glance. Before this, the
// only way to judge them was to export the render and hand-compose a grid in
// an image editor (the REQ-0187 S7 session did exactly that, in GIMP).
//
// Display-time compositing ONLY -- no new columns, no route changes, no
// stored images. Both inputs are already on the wire: the artwork's
// shape.mask rides the artwork payload, and po.cell_fit's numbers ride the
// kit row.
//
// HOW THE RENDER IS KEYED. Two cases, and the REQ calls for both: "use the
// render as stored (white background) with multiply/luminance keying, or the
// adopted alpha when present".
//   - stored-on-white (a fresh generation): mix-blend-mode:multiply keys the
//     white away against the tint -- white * tint = tint, so the footprint
//     shows through and the subject stays itself. This is why every tint here
//     is PALE: under multiply a dark backdrop would swallow the subject it
//     exists to frame.
//   - real alpha (the batch-backfilled + adopted renders, i.e. most of the
//     live registry): transparency ALREADY does the keying, so multiply is
//     not needed -- and it is not free either. Multiplying by the pale gold
//     costs the subject ~25% of its blue, which reads as a warm cast on the
//     very pixels the operator is judging. So an alpha render is composited
//     plainly, at true colour, over the same footprint.
// alphaProbe() below decides which, per image, by reading the corners.
import { useEffect, useState } from 'react';
import type { InspectionDto } from '../api';

export interface MaskBbox { r0: number; c0: number; rows: number; cols: number }

/** The mask's bounding box == the po render's exact footprint (the sizing law
 * renders the BBOX at 256/cell -- art_sizing.cjs, mirrored in artShared's
 * deriveSizeClient). null when no cell is masked. */
export function maskBbox(mask: boolean[][] | null | undefined): MaskBbox | null {
  if (!mask) return null;
  let r0 = 99, c0 = 99, r1 = -1, c1 = -1;
  for (let r = 0; r < mask.length; r++) {
    for (let c = 0; c < mask[r].length; c++) {
      if (!mask[r][c]) continue;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
    }
  }
  if (r1 < 0) return null;
  return { r0, c0, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
}

/** Per-cell violation values from a po.cell_fit row, keyed "r,c" in
 * BBOX-NORMALIZED coordinates -- the same normalization
 * tool_fit_check.shape_to_cellset applies, so the keys index this backdrop's
 * grid directly, with no re-origin needed.
 *
 * THE COUPLING, STATED PLAINLY: inspect_kits.py's kit_po_cell_fit publishes
 * the per-cell numbers only inside its prose note ("... Per-cell v: (0,0)=0.12,
 * (1,0)=0.45. Advisory: ..."), not as metrics. Reading the note is the cheap
 * side of a real trade: promoting them to metrics means a kit_version bump,
 * which marks every existing inspection row stale and forces a re-run of the
 * whole registry to get a tint back. So: parse, but parse DEFENSIVELY (any
 * "(r,c)=<number>" anywhere in any note) and degrade to "no per-cell tint" --
 * never to a wrong tint -- if the wording changes. inspect_kits_test.py pins
 * the note format against this exact regex, so a reword fails a gate instead
 * of silently emptying the overlay. */
export function parseCellV(notes: string[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const note of notes || []) {
    const re = /\((\d+),\s*(\d+)\)\s*=\s*([0-9]*\.?[0-9]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(note)) !== null) out[m[1] + ',' + m[2]] = Number(m[3]);
  }
  return out;
}

export interface CellFit {
  score: number | null;        // po.cell_fit fit_score (100 = no violation)
  worst: number | null;        // worst_cell_violation metric
  cellV: Record<string, number>;
  worstKey: string | null;     // "r,c" of the worst cell, or null
  stale: boolean;              // row predates the current kit version
}

/** The po.cell_fit row for one render -> the overlay's model, or null when the
 * kit has not run (the backdrop then draws the footprint alone -- the REQ's
 * required half; the fit numbers are the nice-to-have riding the same view). */
export function cellFitFrom(rows: InspectionDto[] | null | undefined): CellFit | null {
  const row = (rows || []).find((r) => r.kit_id === 'po.cell_fit');
  if (!row) return null;
  const m = (row.metrics || {}) as Record<string, number>;
  const cellV = parseCellV(row.notes);
  let worstKey: string | null = null;
  for (const k of Object.keys(cellV)) if (worstKey === null || cellV[k] > cellV[worstKey]) worstKey = k;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return { score: num(m.fit_score), worst: num(m.worst_cell_violation), cellV, worstKey, stale: !!row.stale };
}

// The S7 threshold the kit itself checks (worst_cell_ok: v <= 0.5). A cell at
// or past it is tinted at full alarm; the ramp below is linear up to it, so
// the eye's "that one is hot" agrees with the kit's own verdict boundary.
const V_ALARM = 0.5;
const TINT_OK: [number, number, number] = [246, 233, 192];   // pale gold  = owned, quiet
const TINT_HOT: [number, number, number] = [241, 174, 166];  // pale blood = owned, violating

/** Owned-cell tint on the violation ramp. No fit row -> flat pale gold. */
function ownedTint(v: number | undefined): string {
  if (v == null) return 'rgb(' + TINT_OK.join(',') + ')';
  const t = Math.max(0, Math.min(1, v / V_ALARM));
  const ch = TINT_OK.map((a, i) => Math.round(a + (TINT_HOT[i] - a) * t));
  return 'rgb(' + ch.join(',') + ')';
}

/** Wraps a po render in its cell footprint. `children` is the <img>: it keeps
 * its own testid/src so every existing e2e contract (lightbox-img, the card
 * thumb's img) survives the wrap untouched.
 *
 * SIZING. The wrapper carries aspect-ratio cols/rows and the img fills it, so
 * the tint grid and the pixels stay locked together at any zoom without
 * measuring anything. `widthPx` is the natural (or zoomed) render width; the
 * caller's `style` supplies the fit-mode max-width/max-height cap. The img
 * keeps object-fit:contain, so a render whose aspect disagrees with the mask
 * letterboxes instead of stretching -- though ArtAdmin skips the backdrop
 * outright in that case (see aspectMatches) rather than draw a lying grid. */
export function CellStage({ bb, mask, fit, widthPx, probeUrl, style, className, testId, children }: {
  bb: MaskBbox;
  mask: boolean[][];
  fit: CellFit | null;
  widthPx: number;
  probeUrl: string;                   // same render the child <img> shows
  style?: React.CSSProperties;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const keyWhite = useNeedsWhiteKey(probeUrl);
  const grid: React.CSSProperties = {
    gridTemplateColumns: 'repeat(' + bb.cols + ', 1fr)',
    gridTemplateRows: 'repeat(' + bb.rows + ', 1fr)',
  };
  const tints = [];
  const lines = [];
  for (let r = 0; r < bb.rows; r++) {
    for (let c = 0; c < bb.cols; c++) {
      const key = r + ',' + c;
      const owned = !!(mask[bb.r0 + r] && mask[bb.r0 + r][bb.c0 + c]);
      const v = owned && fit ? fit.cellV[key] : undefined;
      const isWorst = owned && fit != null && fit.worstKey === key && (v || 0) > 0;
      tints.push(
        <div key={key} data-testid={testId ? testId + '-cell-' + r + '-' + c : undefined}
          data-owned={owned ? '1' : '0'} data-v={v != null ? v.toFixed(2) : undefined}
          className={'aa-cb-cell' + (owned ? ' is-owned' : ' is-unowned')}
          style={owned ? { background: ownedTint(v) } : undefined} />,
      );
      lines.push(<div key={key} className={'aa-cb-line' + (isWorst ? ' is-worst' : '')} />);
    }
  }
  return (
    <div data-testid={testId} data-key={keyWhite ? 'white' : 'alpha'}
      className={'aa-cb' + (keyWhite ? ' is-keyed' : '') + (className ? ' ' + className : '')}
      style={{ width: widthPx + 'px', aspectRatio: bb.cols + ' / ' + bb.rows, ...style }}>
      <div className="aa-cb-layer" style={grid} aria-hidden="true">{tints}</div>
      <div className="aa-cb-render">{children}</div>
      <div className="aa-cb-layer aa-cb-lines" style={grid} aria-hidden="true">{lines}</div>
      {fit && fit.score != null && (
        <span data-testid={testId ? testId + '-fit' : undefined}
          className={'aa-cb-score tnum' + ((fit.worst || 0) > V_ALARM ? ' is-hot' : '')}
          title={'po.cell_fit -- advisory only, never gates adoption (art_pipeline.md S7)'
            + (fit.stale ? '; STALE row (kit moved on since this ran)' : '')}>
          fit {fit.score.toFixed(0)}{fit.stale ? ' (stale)' : ''}
        </span>
      )}
    </div>
  );
}

/** Is this render already transparent, or does it need the white keyed away?
 *
 * Cheap and exact: draw the loaded image down to 2x2 and read the corners'
 * alpha. Any transparent corner -> the render carries its own alpha and must
 * NOT be multiplied (see the header). Same-origin renders, so the canvas
 * never taints. Returns null until the probe resolves; callers treat null as
 * "multiply" because the un-keyed white of a fresh generation is the worse
 * thing to flash on screen. */
export function useNeedsWhiteKey(url: string): boolean {
  const [alpha, setAlpha] = useState(false);
  useEffect(() => {
    let dead = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (dead) return;
      try {
        const cv = document.createElement('canvas');
        cv.width = 2; cv.height = 2;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        if (!cx) return;
        cx.drawImage(img, 0, 0, 2, 2);
        const d = cx.getImageData(0, 0, 2, 2).data;
        let clear = false;
        for (let i = 3; i < d.length; i += 4) if (d[i] < 250) clear = true;
        setAlpha(clear);
      } catch {
        // tainted or unreadable -> keep the safe default (multiply)
        setAlpha(false);
      }
    };
    img.src = url;
    return () => { dead = true; };
  }, [url]);
  return !alpha;
}

/** Does this render's pixel aspect match the mask's bbox? A shape edited after
 * a render was made leaves the two disagreeing (Workspace already warns:
 * existing renders keep their OLD size). A backdrop drawn anyway would be a
 * misaligned grid presented as ground truth -- worse than none -- so the
 * callers drop the overlay instead. `null` natural size = not measured yet;
 * assume it matches, since the derived width is what we draw at until the
 * img reports otherwise. */
export function aspectMatches(bb: MaskBbox, nat: { w: number; h: number } | null): boolean {
  if (!nat || !nat.w || !nat.h) return true;
  return Math.abs(nat.w / nat.h - bb.cols / bb.rows) < 0.02;
}
