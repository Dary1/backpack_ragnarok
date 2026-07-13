// client/src/artadmin/ShapeEditors.tsx -- REQ-0156. The per-kind shape
// editors (po 5x5 click-mask, monster w*h + preview grid), MJOLNIR-styled.
// Used by BOTH the create panel (idPrefix '' -- keeps the REQ-0151 e2e
// testid contract po-cell-<r>-<c>/monster-w/...) and the edit form
// (idPrefix 'edit-' so testids never collide across panes).

export function PoMaskEditor({ mask, onToggle, idPrefix = '' }: {
  mask: boolean[][]; onToggle: (r: number, c: number) => void; idPrefix?: string;
}) {
  return (
    <div data-testid={idPrefix + 'po-mask'} className="aa-po-grid">
      {mask.map((row, r) => row.map((on, c) => (
        <button key={r + '_' + c} type="button" data-testid={idPrefix + 'po-cell-' + r + '-' + c}
          className={'aa-po-cell' + (on ? ' is-on' : '')}
          aria-pressed={on}
          onClick={() => onToggle(r, c)} />
      )))}
    </div>
  );
}

export function MonsterShapeEditor({ w, h, onW, onH, idPrefix = '' }: {
  w: number; h: number; onW: (v: number) => void; onH: (v: number) => void; idPrefix?: string;
}) {
  const clamp = (v: number) => Math.max(1, Math.min(12, v || 1));
  const cells = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push(<div key={r + '_' + c} className="aa-mon-cell" />);
  return (
    <div className="aa-mon-editor">
      <label className="t-micro">w
        <input data-testid={idPrefix + 'monster-w'} className="aa-input aa-input--num" type="number" min={1} max={12}
          value={w} onChange={(e) => onW(clamp(Number(e.target.value)))} />
      </label>
      <label className="t-micro">h
        <input data-testid={idPrefix + 'monster-h'} className="aa-input aa-input--num" type="number" min={1} max={12}
          value={h} onChange={(e) => onH(clamp(Number(e.target.value)))} />
      </label>
      <div data-testid={idPrefix + 'monster-preview'} className="aa-mon-grid"
        style={{ gridTemplateColumns: 'repeat(' + w + ', 10px)' }}>{cells}</div>
    </div>
  );
}
