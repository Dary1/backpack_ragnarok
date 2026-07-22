// client/src/artadmin/ArtAdminPage.tsx -- REQ-0151 artwork registry admin,
// OVERHAULED by REQ-0156 into a three-pane MJOLNIR console (registry
// browser | selected-artwork workspace | generation + queue strip).
// Registry semantics are UNCHANGED (REQ-0151 data model / sizing law /
// adoption rules / export; REQ-0152 kit verdicts stay advisory): this page
// is an art-generation console + adoption ledger whose core act is HUMAN
// visual comparison (lightbox/compare), never automated judgement.
// Auth reuses admin.cjs (item_admin) via the api.ts helpers' X-Auth-Token
// header. Admin surface stays EN-only (locale accepted, unused).
//
// This root owns ALL server state + polling (artwork list 10 s, selected
// detail 2 s, queue 2 s) and the safety rails (adopt/delete confirm
// dialogs, toasts + the persistent aria-live art-msg line the e2e asserts
// on); the panes are dumb components under client/src/artadmin/.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from '../store';
import { useGameStore, clearArtAdminFocusName } from '../store';
import {
  listArtworks, getArtwork, patchArtwork, previewArtwork, generateArtwork,
  adoptRenderApi, deleteRenderApi, repackRenderApi, cutoutRenderApi, reinspectRender, getArtQueue, cancelRenderApi,
  setArtQueueHold, executeArtQueueBatch,
  artRenderUrl,
} from '../api';
import type { ArtworkDto, RenderDto, InspectionDto, KitDto, ArtQueueDto, RenderRef } from '../api';
import { refOf, refKey, sameRef, refLabel } from '../api';
import { draftFromArtwork } from './artShared';
import type { ArtDraft, Kind } from './artShared';
import { RegistryRail } from './RegistryRail';
import { CreatePanel } from './CreatePanel';
import { Workspace } from './Workspace';
import { QueuePanel } from './QueuePanel';
import { Lightbox } from './Lightbox';
import { cellFitFrom } from './CellBackdrop';
import type { CellFit } from './CellBackdrop';

interface Toast { id: number; text: string; kind: 'ok' | 'err' }
// REQ-0223b: every one of these carried a bare seed, because until REQ-0223a a seed
// WAS a render's identity. Twins share a seed, so each widens to a RenderRef --
// otherwise "adopt seed 42" is ambiguous the moment an A/B exists, and the confirm
// dialog would show one twin's image while adopting the other.
interface ConfirmState { type: 'adopt' | 'delete'; rref: RenderRef }
interface LightboxState { rref: RenderRef; compareWith: RenderRef | null }

function ConfirmDialog({ title, confirmLabel, onOk, onCancel, children }: {
  title: string; confirmLabel: string; onOk: () => void; onCancel: () => void; children?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="aa-scrim" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div data-testid="confirm-dialog" className="panel panel-pad aa-confirm" role="dialog" aria-modal="true">
        <div className="den t-h3 gold-text">{title}</div>
        <div className="aa-confirm-body">{children}</div>
        <div className="aa-confirm-actions">
          <button type="button" data-testid="confirm-ok" className="btn" onClick={onOk}>{confirmLabel}</button>
          <button type="button" data-testid="confirm-cancel" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function ArtAdminPage({ locale }: { locale: Locale }) {
  void locale;
  // REQ-0173 (contentadmin-entity-rendering B): the module store's one-shot
  // artadmin deep-link focus name (set by initRouting when the hash is
  // #/artadmin/<system_name>). Consumed + cleared once the artwork list has
  // loaded. Kept MINIMAL + additive per the REQ: we consume WITHOUT rewriting
  // the hash (contentadmin rewrites; here the simpler consume-only path avoids
  // any risk to the existing 3 artadmin e2e tests -- documented deviation).
  const store = useGameStore();
  // registry + selection
  const [artworks, setArtworks] = useState<ArtworkDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailArt, setDetailArt] = useState<ArtworkDto | null>(null);
  const [renders, setRenders] = useState<RenderDto[]>([]);
  const [inspections, setInspections] = useState<Record<string, InspectionDto[]>>({});
  const [kits, setKits] = useState<KitDto[]>([]);
  const [adoptedId, setAdoptedId] = useState<number | null>(null);
  const [expandedKits, setExpandedKits] = useState<Record<string, boolean>>({});
  // edit draft (explicit Save; baseline for the dirty indicator)
  const [draft, setDraft] = useState<ArtDraft | null>(null);
  const [baseline, setBaseline] = useState<ArtDraft | null>(null);
  const draftFor = useRef<string | null>(null);
  const [finalPreview, setFinalPreview] = useState('');
  // queue
  const [queue, setQueue] = useState<ArtQueueDto | null>(null);
  const [queueFetchedAt, setQueueFetchedAt] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  // overlays + feedback
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  // REQ-0191: ONE cell-backdrop switch for the whole console -- the gallery
  // and the lightbox must never disagree about what is on screen. Default ON;
  // it is inert off po.
  const [cells, setCells] = useState(true);
  const [comparePicks, setComparePicks] = useState<RenderRef[]>([]);
  const [msg, setMsg] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(1);

  const report = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setMsg(text);
    const id = toastId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const refreshList = useCallback(async () => {
    try { const r = await listArtworks(); setArtworks(r.artworks); }
    catch (e) { setMsg('list: ' + (e as Error).message); }
  }, []);

  const loadDetail = useCallback(async (name: string) => {
    try {
      const r = await getArtwork(name);
      setDetailArt(r.artwork);
      setRenders(r.renders);
      setAdoptedId(r.artwork.adopted_render_id);
      setInspections(r.inspections || {});
      setKits(r.kits || []);
      if (draftFor.current !== name) {
        draftFor.current = name;
        const d = draftFromArtwork(r.artwork);
        setDraft(d); setBaseline(d); setFinalPreview('');
      }
    } catch (e) { setMsg('detail: ' + (e as Error).message); }
  }, []);

  const pollQueue = useCallback(async () => {
    try {
      const r = await getArtQueue();
      setQueue({ running: r.running, pending: r.pending, heldPending: r.heldPending, held: r.held, inspectDepth: r.inspectDepth });
      setQueueFetchedAt(Date.now());
    } catch (_e) { /* transient poll errors stay silent; the next tick retries */ }
  }, []);

  useEffect(() => { void refreshList(); const t = setInterval(() => { void refreshList(); }, 10000); return () => clearInterval(t); }, [refreshList]);
  useEffect(() => { void pollQueue(); const t = setInterval(() => { void pollQueue(); }, 2000); return () => clearInterval(t); }, [pollQueue]);
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!selected) return;
    void loadDetail(selected);
    const t = setInterval(() => { void loadDetail(selected); }, 2000);
    return () => clearInterval(t);
  }, [selected, loadDetail]);

  // REQ-0173 (contentadmin-entity-rendering B): honor + consume a pending
  // artadmin deep-link focus name once the artwork list has loaded (unknown
  // name -> normal page + a reported error). Mirrors ContentAdminPage's
  // consume-once-then-clear convention.
  useEffect(() => {
    const focus = store.artAdminFocusName;
    if (!focus) return;
    if (artworks.some((a) => a.system_name === focus)) {
      selectArtwork(focus);
      clearArtAdminFocusName();
    } else if (artworks.length > 0) {
      setMsg('deep link: no artwork named "' + focus + '"');
      clearArtAdminFocusName();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.artAdminFocusName, artworks]);

  async function doPreview() {
    if (!selected || !draft) return;
    try {
      const r = await previewArtwork(selected, {
        main_object: draft.main_object, prompt_template: draft.prompt_template,
        style_override: draft.style_override || null,
      });
      setFinalPreview(r.final_prompt);
    } catch (e) { setMsg('preview: ' + (e as Error).message); }
  }

  // debounced (~700 ms) auto final-prompt preview: follows the prompt-field
  // draft (the manual art-preview button stays for the e2e contract).
  const mainObject = draft ? draft.main_object : null;
  const promptTemplate = draft ? draft.prompt_template : null;
  const styleOverride = draft ? draft.style_override : null;
  useEffect(() => {
    if (!selected || mainObject == null) return;
    const t = setTimeout(() => { void doPreview(); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mainObject, promptTemplate, styleOverride]);

  function selectArtwork(name: string) {
    setCreateOpen(false); setSelected(name);
    setComparePicks([]); setLightbox(null); setConfirm(null);
  }

  const dirty = !!(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline));
  const shapeDirty = !!(draft && baseline && detailArt && (
    (detailArt.kind === 'po' && JSON.stringify(draft.mask) !== JSON.stringify(baseline.mask))
    || ((detailArt.kind === 'monster' || detailArt.kind === 'gimic') && (draft.mw !== baseline.mw || draft.mh !== baseline.mh))
    || (detailArt.kind === 'custom' && (draft.cw !== baseline.cw || draft.ch !== baseline.ch))
    || (detailArt.kind === 'vfx' && draft.role !== baseline.role)));

  async function doSave() {
    if (!selected || !draft || !baseline || !detailArt) return;
    const body: Record<string, unknown> = {};
    if (draft.main_object !== baseline.main_object) body.main_object = draft.main_object;
    if (draft.prompt_template !== baseline.prompt_template) body.prompt_template = draft.prompt_template;
    if (draft.style_override !== baseline.style_override) body.style_override = draft.style_override || null;
    if (detailArt.kind === 'bpskin' && draft.edge_padding !== baseline.edge_padding) body.edge_padding = draft.edge_padding;
    // REQ-0186: po lock controls. Saved like any other field -- explicit Save,
    // never a silent PATCH.
    if (detailArt.kind === 'po' && draft.shape_lock !== baseline.shape_lock) body.shape_lock = draft.shape_lock;
    if (detailArt.kind === 'po' && draft.shape_dilation_px !== baseline.shape_dilation_px) body.shape_dilation_px = draft.shape_dilation_px;
    if (shapeDirty) body.shape = detailArt.kind === 'po' ? { mask: draft.mask } : detailArt.kind === 'custom' ? { width: draft.cw, height: draft.ch } : detailArt.kind === 'vfx' ? { role: draft.role } : { w: draft.mw, h: draft.mh };
    try {
      const r = await patchArtwork(selected, body);
      setDetailArt(r.artwork);
      const d = draftFromArtwork(r.artwork);
      setDraft(d); setBaseline(d);
      report('saved ' + selected);
      await refreshList();
    } catch (e) { report('save failed: ' + (e as Error).message, 'err'); }
  }

  async function doGenerate(mode: 'next' | 'n' | 'seed', n: number, seed: number, lockOverride?: string) {
    if (!selected) return;
    try {
      const body: Record<string, unknown> = mode === 'next' ? { count: 1 } : mode === 'n' ? { count: n } : { seed };
      // REQ-0186: '' = no override -> the server falls back to the artwork's own setting.
      if (lockOverride) body.shape_lock = lockOverride;
      const r = await generateArtwork(selected, body);
      report('queued ' + r.renders.length + ' seed(s) for ' + selected);
      await loadDetail(selected);
      await pollQueue();
    } catch (e) { report('generate: ' + (e as Error).message, 'err'); }
  }

  async function doAdopt(ref: RenderRef) {
    const seed = ref.seed;
    if (!selected) return;
    try {
      const r = await adoptRenderApi(selected, seed, ref.variant);
      report('adopted ' + refLabel(ref) + (r.export_error ? (' (export warning: ' + r.export_error + ')') : ' + exported'),
        r.export_error ? 'err' : 'ok');
      await loadDetail(selected); await refreshList();
    } catch (e) { report('adopt: ' + (e as Error).message, 'err'); }
  }

  async function doDelete(ref: RenderRef) {
    const seed = ref.seed;
    if (!selected) return;
    try {
      await deleteRenderApi(selected, seed, ref.variant);
      report('deleted ' + refLabel(ref));
      setComparePicks((p) => p.filter((x) => !sameRef(x, ref)));
      setLightbox((lb) => (lb && (sameRef(lb.rref, ref) || sameRef(lb.compareWith, ref)) ? null : lb));
      await loadDetail(selected); await refreshList();
    } catch (e) { report('delete: ' + (e as Error).message, 'err'); }
  }

  // Retry a failed render: delete the failed row, regenerate at that exact
  // seed (client-side composition of the two existing endpoints, per spec).
  async function doRetry(ref: RenderRef) {
    const seed = ref.seed;
    if (!selected) return;
    try {
      await deleteRenderApi(selected, seed, ref.variant);
      // The slot is now free, so this re-lands on the SAME (seed, variant) without a
      // twin: retry means "make this render again", not "make me another one".
      await generateArtwork(selected, ref.variant ? { seed, twin: true } : { seed });
      report('retrying ' + refLabel(ref));
      await loadDetail(selected); await pollQueue();
    } catch (e) { report('retry: ' + (e as Error).message, 'err'); }
  }

  // REQ-0192: repack -- queue a best-placement derived render at seed+100000.
  async function doRepack(ref: RenderRef) {
    const seed = ref.seed;
    if (!selected) return;
    try {
      const r = await repackRenderApi(selected, seed, ref.variant);
      report('repack queued: ' + refLabel(ref) + ' -> seed ' + r.render.seed);
      await loadDetail(selected);
    } catch (e) { report('repack: ' + (e as Error).message, 'err'); }
  }

  // REQ-0193: cutout -- queue a background-removed derived render at
  // seed+100000. Available for every kind, unlike repack.
  async function doCutout(ref: RenderRef) {
    const seed = ref.seed;
    if (!selected) return;
    try {
      const r = await cutoutRenderApi(selected, seed, ref.variant);
      report('cutout queued: ' + refLabel(ref) + ' -> seed ' + r.render.seed);
      await loadDetail(selected);
    } catch (e) { report('cutout: ' + (e as Error).message, 'err'); }
  }

  async function doCancel(artwork: string, seed: number) {
    try {
      const r = await cancelRenderApi(artwork, seed);
      setQueue(r.queue); setQueueFetchedAt(Date.now());
      report('canceled ' + artwork + ' seed ' + seed + ' (' + r.canceled + ')');
      if (artwork === selected) await loadDetail(artwork);
    } catch (e) { report('cancel: ' + (e as Error).message, 'err'); }
  }

  // REQ-0197: deferred-batch controls -- hold gates newly queued generation
  // jobs; Execute batch releases everything held, grouped so same-prompt
  // jobs run back to back (no per-item text-encoder swap).
  async function doHold(next: boolean) {
    try {
      const r = await setArtQueueHold(next);
      setQueue(r); setQueueFetchedAt(Date.now());
      report(next ? 'queue hold ON: jobs wait for Execute batch' : 'queue hold OFF: queue resumed');
    } catch (e) { report('hold: ' + (e as Error).message, 'err'); }
  }

  async function doExecuteBatch() {
    try {
      const r = await executeArtQueueBatch();
      setQueue(r); setQueueFetchedAt(Date.now());
      report('executing batch: ' + r.released + ' job(s) released');
    } catch (e) { report('execute: ' + (e as Error).message, 'err'); }
  }

  async function doReinspect(ref: RenderRef, kitId?: string) {
    const seed = ref.seed;
    if (!selected) return;
    try {
      const r = await reinspectRender(selected, seed, kitId, ref.variant);
      report('queued ' + r.queued.length + ' kit(s) for ' + refLabel(ref));
      await loadDetail(selected);
    } catch (e) { report('inspect: ' + (e as Error).message, 'err'); }
  }

  function togglePick(ref: RenderRef) {
    setComparePicks((p) => p.some((x) => sameRef(x, ref)) ? p.filter((x) => !sameRef(x, ref)) : (p.length >= 2 ? [p[1], ref] : [...p, ref]));
  }

  const okRefs = renders.filter((r) => r.status === 'ok').map(refOf);
  const adoptedRender = adoptedId != null ? renders.find((r) => r.id === adoptedId) : undefined;
  const adoptedRef = adoptedRender ? refOf(adoptedRender) : null;
  // REQ-0223b: pin the variant -- a bare seed match would put a TWIN's image in the
  // confirm dialog while the action adopted/deleted the other one.
  const confirmRender = confirm ? renders.find((r) => sameRef(refOf(r), confirm.rref)) : undefined;

  // REQ-0191: the cell backdrop's two inputs, both already on the wire.
  // The mask is read from the SAVED artwork, never from `draft` -- a dirty
  // editor click must not repaint the footprint under renders that were made
  // against the saved one (the same reason art-shape-warn exists).
  const savedShape = (detailArt && detailArt.kind === 'po' ? detailArt.shape : null) as { mask?: boolean[][] } | null;
  const savedMask = savedShape && savedShape.mask ? savedShape.mask : null;
  const fitByRef: Record<string, CellFit | null> = {};
  for (const r of renders) fitByRef[refKey(refOf(r))] = cellFitFrom(inspections[String(r.id)]);

  return (
    <div data-testid="artadmin" className="aa-root">
      <header className="aa-head">
        <span className="den t-h2 gold-text">Artwork Registry</span>
        <a data-testid="art-contentadmin-link" className="aa-crosslink t-micro" href="#/contentadmin">Content Admin &rarr;</a>
        <div data-testid="art-msg" aria-live="polite" className="aa-msg t-micro">{msg}</div>
      </header>
      <div className="aa-cols">
        <RegistryRail artworks={artworks} selected={selected}
          onSelect={selectArtwork}
          onNew={() => { setCreateOpen(true); }} />
        <section className="aa-center">
          {createOpen ? (
            <CreatePanel existing={artworks} report={report}
              onClose={() => setCreateOpen(false)}
              onCreated={(a) => {
                setCreateOpen(false);
                void refreshList().then(() => selectArtwork(a.system_name));
              }} />
          ) : detailArt && selected && draft ? (
            <Workspace art={detailArt} renders={renders} kits={kits} inspections={inspections}
              adoptedId={adoptedId} draft={draft}
              onDraft={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
              dirty={dirty} shapeDirty={shapeDirty}
              finalPreview={finalPreview} onPreviewNow={() => { void doPreview(); }}
              onSave={() => { void doSave(); }}
              onAskAdopt={(rref) => setConfirm({ type: 'adopt', rref })}
              onAskDelete={(rref) => setConfirm({ type: 'delete', rref })}
              onRetry={(seed) => { void doRetry(seed); }}
              onRepack={(seed) => { void doRepack(seed); }}
              onCutout={(seed) => { void doCutout(seed); }}
              onOpenLightbox={(rref, compareWith) => setLightbox({ rref, compareWith })}
              onRerunKit={(seed, kitId) => { void doReinspect(seed, kitId); }}
              expandedKits={expandedKits}
              onToggleKit={(key) => setExpandedKits((e) => ({ ...e, [key]: !e[key] }))}
              comparePicks={comparePicks} onTogglePick={togglePick}
              cells={cells} onToggleCells={() => setCells((v) => !v)} savedMask={savedMask} />
          ) : (
            <div className="panel panel-pad aa-placeholder">
              <div className="den t-h3">No artwork selected</div>
              <div className="t-micro">Pick one in the registry on the left, or create a new one.</div>
            </div>
          )}
        </section>
        <QueuePanel selected={selected} selectedKind={detailArt ? detailArt.kind : null}
          queue={queue} fetchedAt={queueFetchedAt} nowTick={nowTick}
          onGenerate={(mode, n, seed, lockOverride) => { void doGenerate(mode, n, seed, lockOverride); }}
          onCancel={(artwork, seed) => { void doCancel(artwork, seed); }}
          onHold={(h) => { void doHold(h); }}
          onExecute={() => { void doExecuteBatch(); }} />
      </div>

      {lightbox && selected && detailArt && (
        <Lightbox name={selected} kind={detailArt.kind as Kind}
          mask={cells ? savedMask : null} fitByRef={fitByRef}
          refs={okRefs} initialRef={lightbox.rref} compareWith={lightbox.compareWith}
          adoptedRef={adoptedRef} keysDisabled={confirm != null}
          onAdopt={(rref) => setConfirm({ type: 'adopt', rref })}
          onClose={() => setLightbox(null)} />
      )}

      {confirm && selected && (
        confirm.type === 'adopt' ? (
          <ConfirmDialog title={'Adopt ' + refLabel(confirm.rref) + '?'} confirmLabel="Adopt + export"
            onOk={() => { const s = confirm.rref; setConfirm(null); void doAdopt(s); }}
            onCancel={() => setConfirm(null)}>
            <img className="aa-confirm-img" src={artRenderUrl(selected, confirm.rref.seed, confirm.rref.variant)} alt={refLabel(confirm.rref)} />
            <div className="t-micro">This becomes the ONE live render of <b>{selected}</b> and is exported to
              content/ (the git-integrate path). Switchable any time; history stays.</div>
          </ConfirmDialog>
        ) : (
          <ConfirmDialog title={'Delete ' + refLabel(confirm.rref) + '?'} confirmLabel="Delete"
            onOk={() => { const s = confirm.rref; setConfirm(null); void doDelete(s); }}
            onCancel={() => setConfirm(null)}>
            {confirmRender && confirmRender.status === 'ok' && (
              <img className="aa-confirm-img" src={artRenderUrl(selected, confirm.rref.seed, confirm.rref.variant)} alt={refLabel(confirm.rref)} />
            )}
            <div className="t-micro">Candidates live ONLY in the registry DB (no backup) -- a deleted render
              is gone; its recipe (seed + params) can regenerate a parameter-identical image.</div>
          </ConfirmDialog>
        )
      )}

      <div className="aa-toasts" aria-hidden="true">
        {toasts.map((t) => (
          <div key={t.id} className={'aa-toast' + (t.kind === 'err' ? ' is-err' : '')}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
