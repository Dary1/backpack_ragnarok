// client/src/artadmin/CreatePanel.tsx -- REQ-0156. The DEDICATED create
// flow: its state is NEVER fed by selection (the REQ-0151 page reused the
// create form as the selection's edit buffer -- one click from an
// accidental near-duplicate Create; that coupling is the bug this panel
// removes). Live validation: name regex/reserved/duplicate, po mask
// non-empty. Keeps the REQ-0151 e2e field testids (art-kind,
// art-system-name, po-cell-<r>-<c>, art-resolution, art-create, ...).
import { useState } from 'react';
import { createArtwork } from '../api';
import type { ArtworkDto } from '../api';
import { KINDS, deriveSizeClient, defaultTemplate, emptyMask, maskCellCount, validateNewName } from './artShared';
import type { Kind } from './artShared';
import { PoMaskEditor, MonsterShapeEditor } from './ShapeEditors';

export function CreatePanel({ existing, onCreated, onClose, report }: {
  existing: ArtworkDto[];
  onCreated: (a: ArtworkDto) => void;
  onClose: () => void;
  report: (m: string, kind: 'ok' | 'err') => void;
}) {
  const [kind, setKind] = useState<Kind>('po');
  const [systemName, setSystemName] = useState('');
  const [mainObject, setMainObject] = useState('');
  const [promptTemplate, setPromptTemplate] = useState(defaultTemplate('po'));
  const [styleOverride, setStyleOverride] = useState('');
  const [edgePadding, setEdgePadding] = useState(32);
  const [mask, setMask] = useState<boolean[][]>(emptyMask());
  const [mw, setMw] = useState(3);
  const [mh, setMh] = useState(4);
  const [cw, setCw] = useState(1024);
  const [ch, setCh] = useState(1024);
  const [role, setRole] = useState<'ray' | 'hit'>('ray'); // REQ-0280/0264: vfx role
  const [busy, setBusy] = useState(false);

  const size = deriveSizeClient(kind, mask, mw, mh, cw, ch, role);
  const nameError = validateNewName(systemName, existing);
  const shapeError = kind === 'po' && maskCellCount(mask) === 0
    ? 'click at least one cell in the 5x5 mask'
    : kind === 'custom' && (cw < 16 || ch < 16) ? 'width and height must be at least 16' : null;
  const canCreate = !busy && systemName !== '' && !nameError && !shapeError;

  function onKindChange(k: Kind) { setKind(k); setPromptTemplate(defaultTemplate(k)); }

  async function doCreate() {
    if (!canCreate) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        system_name: systemName, kind, main_object: mainObject,
        prompt_template: promptTemplate, style_override: styleOverride || null,
      };
      if (kind === 'po') body.shape = { mask };
      if (kind === 'monster' || kind === 'gimic') body.shape = { w: mw, h: mh }; // REQ-0211
      if (kind === 'bpskin') body.edge_padding = edgePadding;
      if (kind === 'custom') body.shape = { width: cw, height: ch };
      if (kind === 'vfx') body.shape = { role }; // REQ-0280/0264
      const r = await createArtwork(body);
      report('created ' + r.artwork.system_name + ' (' + r.artwork.gen_width + 'x' + r.artwork.gen_height + ')', 'ok');
      onCreated(r.artwork);
    } catch (e) {
      report('create failed: ' + (e as Error).message, 'err');
    } finally { setBusy(false); }
  }

  return (
    <div data-testid="art-create-panel" className="panel panel-pad aa-create">
      <div className="aa-ws-head">
        <span className="den t-h3 gold-text">New artwork</span>
        <button type="button" data-testid="art-create-close" className="btn btn-ghost aa-btn-sm" onClick={onClose}>close</button>
      </div>
      <div className="aa-form">
        <label className="aa-field">
          <span className="t-micro">kind</span>
          <select data-testid="art-kind" className="aa-input" value={kind} onChange={(e) => onKindChange(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="aa-field">
          <span className="t-micro">system_name</span>
          <input data-testid="art-system-name" className="aa-input" value={systemName}
            onChange={(e) => setSystemName(e.target.value)} placeholder="[A-Za-z0-9_]+" />
        </label>
        <div className="aa-field">
          <span className="t-micro">shape</span>
          {kind === 'po' && <PoMaskEditor mask={mask} onToggle={(r, c) => setMask((m) => m.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))))} />}
          {(kind === 'monster' || kind === 'gimic') && <MonsterShapeEditor w={mw} h={mh} onW={setMw} onH={setMh} />}
          {(kind === 'si' || kind === 'skill_icon') && <span className="t-micro">locked 256x256 (no shape)</span>}
          {kind === 'vfx' && (
            <select data-testid="art-vfx-role" className="aa-input" value={role} onChange={(e) => setRole(e.target.value as 'ray' | 'hit')}>
              <option value="ray">ray (256x64 strip, tiled along the path)</option>
              <option value="hit">hit (256x256 burst)</option>
            </select>
          )}
          {(kind === 'unit' || kind === 'bpskin') && <span className="t-micro">no shape (locked size)</span>}
          {kind === 'custom' && (
            <div className="aa-res-inputs">
              <label className="aa-field">
                <span className="t-micro">width</span>
                <input data-testid="art-res-w" className="aa-input aa-input--num" type="number" min={16} max={16384} step={16} value={cw} onChange={(e) => setCw(Number(e.target.value) || 0)} />
              </label>
              <label className="aa-field">
                <span className="t-micro">height</span>
                <input data-testid="art-res-h" className="aa-input aa-input--num" type="number" min={16} max={16384} step={16} value={ch} onChange={(e) => setCh(Number(e.target.value) || 0)} />
              </label>
            </div>
          )}
        </div>
        <div className="aa-field">
          <span className="t-micro">{kind === 'custom' ? 'resolution (snapped from inputs)' : 'resolution (derived, read-only)'}</span>
          <b data-testid="art-resolution" className="tnum">{size.width}x{size.height}</b>
        </div>
        <label className="aa-field">
          <span className="t-micro">main_object</span>
          <input data-testid="art-main-object" className="aa-input" value={mainObject} onChange={(e) => setMainObject(e.target.value)} />
        </label>
        <label className="aa-field">
          <span className="t-micro">style/aux prompt</span>
          <input data-testid="art-style" className="aa-input" value={styleOverride} placeholder="(default per kind)" onChange={(e) => setStyleOverride(e.target.value)} />
        </label>
        <label className="aa-field">
          <span className="t-micro">prompt template</span>
          <textarea data-testid="art-template" className="aa-input aa-textarea" value={promptTemplate} rows={2} onChange={(e) => setPromptTemplate(e.target.value)} />
        </label>
        {kind === 'bpskin' && (
          <label className="aa-field">
            <span className="t-micro">edge_padding (compose band, px)</span>
            <input data-testid="art-edge" className="aa-input aa-input--num" type="number" value={edgePadding} onChange={(e) => setEdgePadding(Number(e.target.value) || 0)} />
          </label>
        )}
        {(nameError || shapeError) && (
          <div data-testid="create-error" className="aa-error">
            {nameError && <div>{nameError}</div>}
            {shapeError && <div>{shapeError}</div>}
          </div>
        )}
        <div>
          <button data-testid="art-create" type="button" className="btn" disabled={!canCreate}
            onClick={() => { void doCreate(); }}>{busy ? 'creating…' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}
