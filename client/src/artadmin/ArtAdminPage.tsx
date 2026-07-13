// client/src/artadmin/ArtAdminPage.tsx -- REQ-0151 artwork registry admin.
// One screen: generate artwork through THE flux2 route, manage per-artwork
// seed candidates, adopt exactly one seed as live. Resolution is READ-ONLY
// (derived from kind+shape, mirrors server/services/art_sizing.cjs). Auth
// reuses admin.cjs (item_admin) via the api.ts helpers' X-Auth-Token header.
import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '../store';
import {
  listArtworks, createArtwork, getArtwork, patchArtwork, previewArtwork,
  generateArtwork, adoptRenderApi, deleteRenderApi, artRenderUrl,
} from '../api';
import type { ArtworkDto, RenderDto } from '../api';

type Kind = 'po' | 'si' | 'unit' | 'monster' | 'bpskin';
const KINDS: Kind[] = ['po', 'si', 'unit', 'monster', 'bpskin'];

function snap16(v: number): number { return Math.max(16, Math.round(v / 16) * 16); }
function emptyMask(): boolean[][] { return Array.from({ length: 5 }, () => Array(5).fill(false) as boolean[]); }

function deriveSizeClient(kind: Kind, mask: boolean[][], mw: number, mh: number): { width: number; height: number } {
  if (kind === 'si') return { width: 256, height: 256 };
  if (kind === 'unit') return { width: 512, height: 512 };
  if (kind === 'bpskin') return { width: 1024, height: 1024 };
  if (kind === 'monster') return { width: snap16(mw * 128), height: snap16(mh * 128) };
  let minR = 5, maxR = -1, minC = 5, maxC = -1;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (mask[r][c]) {
    minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  if (maxR < 0) return { width: 0, height: 0 };
  return { width: snap16((maxC - minC + 1) * 256), height: snap16((maxR - minR + 1) * 256) };
}

function defaultTemplate(kind: Kind): string {
  if (kind === 'po' || kind === 'si') return '{main_object}, white background, bold outline';
  if (kind === 'unit') return '{main_object}, portrait, looking at viewer, white background';
  if (kind === 'monster') return '{main_object}, white background';
  return '';
}

function PoMaskEditor({ mask, onToggle }: { mask: boolean[][]; onToggle: (r: number, c: number) => void }) {
  return (
    <div data-testid="po-mask" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 28px)', gap: 2 }}>
      {mask.map((row, r) => row.map((on, c) => (
        <button key={r + '_' + c} type="button" data-testid={'po-cell-' + r + '-' + c}
          onClick={() => onToggle(r, c)}
          style={{ width: 28, height: 28, background: on ? '#C9A959' : '#222', border: '1px solid #555', cursor: 'pointer' }} />
      )))}
    </div>
  );
}

function MonsterShapeEditor({ w, h, onW, onH }: { w: number; h: number; onW: (v: number) => void; onH: (v: number) => void }) {
  const cells = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push(<div key={r + '_' + c} style={{ width: 12, height: 12, background: '#C9A959' }} />);
  return (
    <div>
      <label>w <input data-testid="monster-w" type="number" min={1} max={12} value={w} onChange={(e) => onW(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ width: 48 }} /></label>
      {' '}
      <label>h <input data-testid="monster-h" type="number" min={1} max={12} value={h} onChange={(e) => onH(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ width: 48 }} /></label>
      <div data-testid="monster-preview" style={{ display: 'grid', gridTemplateColumns: 'repeat(' + w + ', 12px)', gap: 1, marginTop: 6 }}>{cells}</div>
    </div>
  );
}

export function ArtAdminPage({ locale }: { locale: Locale }) {
  void locale;
  const [artworks, setArtworks] = useState<ArtworkDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [renders, setRenders] = useState<RenderDto[]>([]);
  const [queueDepth, setQueueDepth] = useState<number>(0);
  const [msg, setMsg] = useState<string>('');
  // create form
  const [kind, setKind] = useState<Kind>('po');
  const [systemName, setSystemName] = useState<string>('');
  const [mainObject, setMainObject] = useState<string>('');
  const [promptTemplate, setPromptTemplate] = useState<string>(defaultTemplate('po'));
  const [styleOverride, setStyleOverride] = useState<string>('');
  const [edgePadding, setEdgePadding] = useState<number>(32);
  const [mask, setMask] = useState<boolean[][]>(emptyMask());
  const [mw, setMw] = useState<number>(3);
  const [mh, setMh] = useState<number>(4);
  const [finalPreview, setFinalPreview] = useState<string>('');
  const [nSeeds, setNSeeds] = useState<number>(3);
  const [explicitSeed, setExplicitSeed] = useState<number>(1);

  const size = deriveSizeClient(kind, mask, mw, mh);

  const refreshList = useCallback(async () => {
    try { const r = await listArtworks(); setArtworks(r.artworks); } catch (e) { setMsg('list: ' + (e as Error).message); }
  }, []);

  const loadDetail = useCallback(async (name: string) => {
    try { const r = await getArtwork(name); setRenders(r.renders); setQueueDepth(r.queueDepth); } catch (e) { setMsg('detail: ' + (e as Error).message); }
  }, []);

  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => {
    if (!selected) return;
    void loadDetail(selected);
    const t = setInterval(() => { void loadDetail(selected); }, 2000);
    return () => clearInterval(t);
  }, [selected, loadDetail]);

  function onKindChange(k: Kind) { setKind(k); setPromptTemplate(defaultTemplate(k)); }

  function shapeForKind(): Record<string, unknown> | undefined {
    if (kind === 'po') return { mask };
    if (kind === 'monster') return { w: mw, h: mh };
    return undefined;
  }

  async function doCreate() {
    setMsg('creating...');
    try {
      const body: Record<string, unknown> = {
        system_name: systemName, kind, main_object: mainObject,
        prompt_template: promptTemplate, style_override: styleOverride || null,
      };
      const sh = shapeForKind(); if (sh) body.shape = sh;
      if (kind === 'bpskin') body.edge_padding = edgePadding;
      const r = await createArtwork(body);
      setMsg('created ' + r.artwork.system_name + ' (' + r.artwork.gen_width + 'x' + r.artwork.gen_height + ')');
      await refreshList();
      setSelected(r.artwork.system_name);
    } catch (e) { setMsg('create failed: ' + (e as Error).message); }
  }

  async function doPreview() {
    if (!selected) return;
    try { const r = await previewArtwork(selected, { main_object: mainObject, prompt_template: promptTemplate, style_override: styleOverride || null }); setFinalPreview(r.final_prompt); }
    catch (e) { setMsg('preview: ' + (e as Error).message); }
  }

  async function doGenerate(kindOf: 'next' | 'n' | 'seed') {
    if (!selected) return;
    setMsg('queuing generation...');
    try {
      const body: Record<string, unknown> = kindOf === 'next' ? { count: 1 } : kindOf === 'n' ? { count: nSeeds } : { seed: explicitSeed };
      const r = await generateArtwork(selected, body);
      setQueueDepth(r.queueDepth); setMsg('queued ' + r.renders.length + ' seed(s)');
      await loadDetail(selected);
    } catch (e) { setMsg('generate: ' + (e as Error).message); }
  }

  async function doAdopt(seed: number) {
    if (!selected) return;
    try { const r = await adoptRenderApi(selected, seed); setMsg('adopted seed ' + seed + (r.export_error ? (' (export warning: ' + r.export_error + ')') : ' + exported')); await loadDetail(selected); }
    catch (e) { setMsg('adopt: ' + (e as Error).message); }
  }

  async function doDelete(seed: number) {
    if (!selected) return;
    try { await deleteRenderApi(selected, seed); setMsg('deleted seed ' + seed); await loadDetail(selected); }
    catch (e) { setMsg('delete: ' + (e as Error).message); }
  }

  const selArt = artworks.find((a) => a.system_name === selected) || null;
  const adoptedId = selArt ? selArt.adopted_render_id : null;

  return (
    <div data-testid="artadmin" style={{ padding: 16, display: 'flex', gap: 24, color: '#eee' }}>
      <div style={{ minWidth: 380 }}>
        <h2>Artwork Registry Admin</h2>
        <div data-testid="art-msg" style={{ minHeight: 20, color: '#C9A959' }}>{msg}</div>
        <fieldset style={{ border: '1px solid #555', padding: 10 }}>
          <legend>Create artwork</legend>
          <div>
            <label>kind{' '}
              <select data-testid="art-kind" value={kind} onChange={(e) => onKindChange(e.target.value as Kind)}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          </div>
          <div><label>system_name <input data-testid="art-system-name" value={systemName} onChange={(e) => setSystemName(e.target.value)} /></label></div>
          <div style={{ margin: '8px 0' }}>
            {kind === 'po' && <PoMaskEditor mask={mask} onToggle={(r, c) => setMask((m) => m.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))))} />}
            {kind === 'monster' && <MonsterShapeEditor w={mw} h={mh} onW={setMw} onH={setMh} />}
            {kind === 'si' && <span>locked 256x256 (no shape)</span>}
            {(kind === 'unit' || kind === 'bpskin') && <span>no shape (locked size)</span>}
          </div>
          <div>resolution (derived, read-only): <b data-testid="art-resolution">{size.width}x{size.height}</b></div>
          <div><label>main_object <input data-testid="art-main-object" value={mainObject} onChange={(e) => setMainObject(e.target.value)} /></label></div>
          <div><label>style/aux prompt <input data-testid="art-style" value={styleOverride} placeholder="(default per kind)" onChange={(e) => setStyleOverride(e.target.value)} /></label></div>
          <div>prompt template<br /><textarea data-testid="art-template" value={promptTemplate} rows={2} cols={44} onChange={(e) => setPromptTemplate(e.target.value)} /></div>
          {kind === 'bpskin' && <div><label>edge_padding <input data-testid="art-edge" type="number" value={edgePadding} onChange={(e) => setEdgePadding(Number(e.target.value) || 0)} /></label></div>}
          <button data-testid="art-create" type="button" onClick={() => { void doCreate(); }}>Create</button>
        </fieldset>
        <h3>Artworks</h3>
        <ul data-testid="art-list" style={{ listStyle: 'none', padding: 0 }}>
          {artworks.map((a) => (
            <li key={a.system_name}>
              <button type="button" data-testid={'art-select-' + a.system_name}
                onClick={() => {
                  setSelected(a.system_name); setKind(a.kind as Kind);
                  setMainObject(a.main_object); setPromptTemplate(a.prompt_template);
                  setStyleOverride(a.style_override || ''); setFinalPreview('');
                  const sh = a.shape as { mask?: boolean[][]; w?: number; h?: number } | null;
                  if (a.kind === 'po' && sh && sh.mask) setMask(sh.mask);
                  if (a.kind === 'monster' && sh) { setMw(sh.w || 1); setMh(sh.h || 1); }
                }}
                style={{ fontWeight: selected === a.system_name ? 'bold' : 'normal' }}>
                {a.system_name} [{a.kind}] {a.gen_width}x{a.gen_height}{a.adopted_render_id ? ' *' : ''}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div style={{ flex: 1 }}>
        {selArt ? (
          <div data-testid="art-editor">
            <h3>{selArt.system_name} [{selArt.kind}] {selArt.gen_width}x{selArt.gen_height}</h3>
            <div style={{ marginBottom: 8 }}>
              <button data-testid="art-preview" type="button" onClick={() => { void doPreview(); }}>Preview final prompt</button>{' '}
              <button data-testid="art-save" type="button" onClick={() => { if (selected) void patchArtwork(selected, { main_object: mainObject, prompt_template: promptTemplate, style_override: styleOverride || null }).then(() => setMsg('saved')).catch((e: Error) => setMsg('save: ' + e.message)); }}>Save edits</button>
            </div>
            <div data-testid="art-final-prompt" style={{ background: '#111', padding: 8, minHeight: 20, fontFamily: 'monospace', fontSize: 12 }}>{finalPreview}</div>
            <div style={{ margin: '10px 0' }}>
              <button data-testid="art-gen-next" type="button" onClick={() => { void doGenerate('next'); }}>Generate next seed</button>{' '}
              <button data-testid="art-gen-n" type="button" onClick={() => { void doGenerate('n'); }}>Generate N</button>
              <input data-testid="art-n" type="number" min={1} max={20} value={nSeeds} onChange={(e) => setNSeeds(Number(e.target.value) || 1)} style={{ width: 48 }} />{' '}
              <button data-testid="art-gen-seed" type="button" onClick={() => { void doGenerate('seed'); }}>Generate at seed</button>
              <input data-testid="art-seed" type="number" value={explicitSeed} onChange={(e) => setExplicitSeed(Number(e.target.value) || 1)} style={{ width: 64 }} />
              <span style={{ marginLeft: 8 }}>queue: <b data-testid="art-queue">{queueDepth}</b></span>
            </div>
            <div data-testid="art-renders" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {renders.map((r) => {
                const isAdopted = adoptedId != null && r.id === adoptedId;
                return (
                  <div key={r.seed} data-testid={'render-' + r.seed} style={{ border: isAdopted ? '2px solid #C9A959' : '1px solid #555', padding: 6, width: 150 }}>
                    <div>seed {r.seed} <span data-testid={'render-status-' + r.seed}>[{r.status}]</span>{isAdopted ? ' ADOPTED' : ''}</div>
                    {r.status === 'ok' && selected ? <img alt={'seed ' + r.seed} src={artRenderUrl(selected, r.seed)} style={{ maxWidth: 138, maxHeight: 138, background: '#000' }} /> : <div style={{ fontSize: 11, color: '#999' }}>{r.status === 'failed' ? (r.error || 'failed') : 'rendering...'}</div>}
                    <div style={{ marginTop: 4 }}>
                      <button data-testid={'adopt-' + r.seed} type="button" disabled={r.status !== 'ok' || isAdopted} onClick={() => { void doAdopt(r.seed); }}>Adopt</button>{' '}
                      <button data-testid={'delete-' + r.seed} type="button" disabled={isAdopted} onClick={() => { void doDelete(r.seed); }}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : <div>Select or create an artwork.</div>}
      </div>
    </div>
  );
}
