// client/src/sortie/SquadMicrogrid.tsx -- REQ-0239 (design 01 sec 6.1): the
// squad's 8x8 canvas as a CSS grid of dots. Each BP's cells (origin+shape)
// filled with the BP's own color; POs drawn as brighter pips. Pure DOM/CSS --
// explicitly NOT a Pixi board and NOT the full inventory grid (user verdict:
// full grids too big). Exported STANDALONE so the squad status board
// (SquadBoardTile) reuses the exact same microgrid (design 02 sec 5).
import { bpCells, type SquadCanvas } from './squadCanvas';

const GRID = 8;

interface SquadMicrogridProps {
  canvas: SquadCanvas | null;
  /** px size of the whole square grid (default 40 per design 01 sec 6.1). */
  size?: number;
  className?: string;
}

export function SquadMicrogrid({ canvas, size = 40, className }: SquadMicrogridProps) {
  const cells: (null | { color: string; po: boolean })[] = new Array(GRID * GRID).fill(null);
  const at = (r: number, c: number) => r * GRID + c;
  for (const bp of canvas?.bps ?? []) {
    const color = bp.color || 'var(--bone-3)';
    for (const [r, c] of bpCells(bp)) {
      if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue;
      cells[at(r, c)] = { color, po: false };
    }
  }
  for (const po of canvas?.pos ?? []) {
    if (po.loc !== 'grid' || !po.cell) continue;
    const [r, c] = po.cell;
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue;
    const under = cells[at(r, c)];
    cells[at(r, c)] = { color: under?.color || 'var(--gold-hi)', po: true };
  }
  return (
    <div
      className={`sortie-microgrid${className ? ' ' + className : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {cells.map((cell, i) => (
        <span
          key={i}
          className={`sortie-microgrid-dot${cell ? ' is-filled' : ''}${cell?.po ? ' is-po' : ''}`}
          style={cell ? { backgroundColor: cell.color } : undefined}
        />
      ))}
    </div>
  );
}
