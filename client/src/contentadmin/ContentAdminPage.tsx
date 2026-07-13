// client/src/contentadmin/ContentAdminPage.tsx -- REQ-0155 content-data
// registry admin, OVERHAULED by REQ-0157 into a MJOLNIR console sharing the
// REQ-0156 artadmin grammar (def browser | commissioning/adjudication
// workspace). Registry semantics are UNCHANGED (REQ-0155: variant-as-record,
// immutability, machine checks advisory-loud, FAIL adoptable only behind an
// explicit override, export on adoption, Q1 agent-session generation, Dex
// LINK-FIRST): this page is a commissioning + adjudication desk for LLM-
// generated content DATA, never an automated judge.
// Auth reuses admin.cjs (item_admin) via the api.ts helpers' X-Auth-Token
// header. Admin surface stays EN-only (locale accepted, unused).
//
// This root owns ALL server state + polling (def list 10 s, selected detail
// 5 s -- agent sessions may POST variants at any time) and the safety rails
// (adopt confirm with FAIL-override toggle, delete confirm, edit-as-new
// modal with JSON validity + Format, toasts + the persistent aria-live
// cd-msg line the e2e asserts on); the panes are dumb components.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from '../store';
import {
  listContentDefs, getContentDef, patchContentDef, commissionContent,
  ingestVariants, reviewVariant, editVariant, adoptVariantApi, deleteVariantApi,
  recheckVariantApi,
} from '../api';
import type { ContentDefDto, ContentVariantDto, ContentCommission } from '../api';
import { copyText, prettyJson } from './contentShared';
import { DefRail } from './DefRail';
import { CreatePanel } from './CreatePanel';
import { Workspace } from './Workspace';
import type { DefDraft } from './Workspace';

interface Toast { id: number; text: string; kind: 'ok' | 'err' }
interface ConfirmState { type: 'adopt' | 'delete'; no: number }

function ConfirmDialog({ title, okLabel, okDisabled, onOk, onCancel, children }: {
  title: string; okLabel: string; okDisabled?: boolean;
  onOk: () => void; onCancel: () => void; children?: ReactNode;
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
          <button type="button" data-testid="confirm-ok" className="btn" disabled={okDisabled === true} onClick={onOk}>{okLabel}</button>
          <button type="button" data-testid="confirm-cancel" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function ContentAdminPage({ locale }: { locale: Locale }) {
  void locale;
  // registry + selection
  const [defs, setDefs] = useState<ContentDefDto[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [def, setDef] = useState<ContentDefDto | null>(null);
  const [variants, setVariants] = useState<ContentVariantDto[]>([]);
  const [artworkFacet, setArtworkFacet] = useState(false);
  // def edit draft (explicit Save; baseline for the dirty indicator)
  const [draft, setDraft] = useState<DefDraft | null>(null);
  const [baseline, setBaseline] = useState<DefDraft | null>(null);
  const draftFor = useRef<string | null>(null);
  // workflow strip
  const [genN, setGenN] = useState(5);
  const [commission, setCommission] = useState<ContentCommission | null>(null);
  const [ingestText, setIngestText] = useState('');
  const [ingestBusy, setIngestBusy] = useState(false);
  // adjudication UI
  const [expandedChecks, setExpandedChecks] = useState<Record<string, boolean>>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, { verdict: string; rationale: string }>>({});
  const [diffPicks, setDiffPicks] = useState<number[]>([]);
  const [diffPair, setDiffPair] = useState<{ a: number; b: number } | null>(null);
  // overlays + feedback
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [overrideOn, setOverrideOn] = useState(false);
  const [editFor, setEditFor] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
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
    try { const r = await listContentDefs(); setDefs(r.defs); }
    catch (e) { setMsg('list: ' + (e as Error).message); }
  }, []);

  const loadDetail = useCallback(async (name: string) => {
    try {
      const r = await getContentDef(name);
      setDef(r.def);
      setVariants(r.variants);
      setArtworkFacet(!!r.artwork_facet);
      if (draftFor.current !== name) {
        draftFor.current = name;
        const d = { brief: r.def.brief || '', schema_ref: r.def.schema_ref || '' };
        setDraft(d); setBaseline(d);
      }
    } catch (e) { setMsg('detail: ' + (e as Error).message); }
  }, []);

  useEffect(() => { void refreshList(); const t = setInterval(() => { void refreshList(); }, 10000); return () => clearInterval(t); }, [refreshList]);
  useEffect(() => {
    if (!selected) return;
    void loadDetail(selected);
    const t = setInterval(() => { void loadDetail(selected); }, 5000);
    return () => clearInterval(t);
  }, [selected, loadDetail]);

  function selectDef(name: string) {
    setCreateOpen(false); setSelected(name);
    setCommission(null); setIngestText(''); setExpandedChecks({}); setReviewDrafts({});
    setDiffPicks([]); setDiffPair(null); setConfirm(null); setEditFor(null);
  }

  const dirty = !!(draft && baseline && (draft.brief !== baseline.brief || draft.schema_ref !== baseline.schema_ref));
  const adoptedVariant = def && def.adopted_variant_id != null ? variants.find((v) => v.id === def.adopted_variant_id) : undefined;
  const adoptedNo = adoptedVariant ? adoptedVariant.variant_no : null;

  async function doSave() {
    if (!selected || !draft || !baseline) return;
    const body: Record<string, unknown> = {};
    if (draft.brief !== baseline.brief) body.brief = draft.brief;
    if (draft.schema_ref !== baseline.schema_ref) body.schema_ref = draft.schema_ref;
    try {
      const r = await patchContentDef(selected, body);
      setDef(r.def);
      const d = { brief: r.def.brief || '', schema_ref: r.def.schema_ref || '' };
      setDraft(d); setBaseline(d);
      report('saved ' + selected);
      await refreshList();
    } catch (e) { report('save failed: ' + (e as Error).message, 'err'); }
  }

  async function doCommission() {
    if (!selected) return;
    try {
      const r = await commissionContent(selected, genN);
      setCommission(r.commission);
      report('commission for ' + r.commission.count + ' variants ready -- hand to an agent session');
    } catch (e) { report('commission: ' + (e as Error).message, 'err'); }
  }

  async function doCopyCommission() {
    if (!commission) return;
    const ok = await copyText(JSON.stringify(commission, null, 2));
    report(ok ? 'commission payload copied' : 'copy failed -- select the payload text manually', ok ? 'ok' : 'err');
  }

  async function doIngest(parsed: Array<{ data: Record<string, unknown>; provenance?: Record<string, unknown> }>) {
    if (!selected || parsed.length === 0) return;
    setIngestBusy(true);
    try {
      const r = await ingestVariants(selected, parsed as Array<{ data: Record<string, unknown>; provenance: Record<string, unknown> }>);
      report('ingested ' + r.created.length + ' variant(s); machine checks ran');
      setIngestText('');
      await loadDetail(selected); await refreshList();
    } catch (e) { report('ingest: ' + (e as Error).message, 'err'); }
    finally { setIngestBusy(false); }
  }

  async function doReview(no: number) {
    if (!selected) return;
    const d = reviewDrafts[no] || { verdict: 'neutral', rationale: '' };
    try {
      await reviewVariant(selected, no, { verdict: d.verdict, rationale: d.rationale, agent: 'reviewer-agent', model: 'claude-opus-4.8' });
      report('review recorded for variant ' + no);
      await loadDetail(selected);
    } catch (e) { report('review: ' + (e as Error).message, 'err'); }
  }

  async function doAdopt(no: number, override: boolean) {
    if (!selected) return;
    try {
      const r = await adoptVariantApi(selected, no, override);
      report('adopted variant ' + no + (override ? ' (override)' : '')
        + (r.export_error ? (' (export warning: ' + r.export_error + ')') : ' + exported'),
        r.export_error ? 'err' : 'ok');
      await loadDetail(selected); await refreshList();
    } catch (e) { report('adopt: ' + (e as Error).message, 'err'); }
  }

  async function doDelete(no: number) {
    if (!selected) return;
    try {
      await deleteVariantApi(selected, no);
      report('deleted variant ' + no);
      setDiffPicks((p) => p.filter((x) => x !== no));
      setDiffPair((d) => (d && (d.a === no || d.b === no) ? null : d));
      await loadDetail(selected); await refreshList();
    } catch (e) { report('delete: ' + (e as Error).message, 'err'); }
  }

  async function doRecheck(no: number) {
    if (!selected) return;
    try {
      const r = await recheckVariantApi(selected, no);
      const overall = (r.variant.machine_check && r.variant.machine_check.overall) || '?';
      report('rechecked variant ' + no + ': overall ' + overall);
      await loadDetail(selected); await refreshList();
    } catch (e) { report('recheck: ' + (e as Error).message, 'err'); }
  }

  function openEdit(no: number) {
    const v = variants.find((x) => x.variant_no === no);
    if (!v) return;
    setEditFor(no);
    setEditText(prettyJson(v.data));
  }

  async function doEditSubmit() {
    if (!selected || editFor == null) return;
    try {
      const data = JSON.parse(editText) as Record<string, unknown>;
      const r = await editVariant(selected, editFor, data);
      report('edit created new variant ' + r.variant.variant_no + ' (parent ' + editFor + ')');
      setEditFor(null); setEditText('');
      await loadDetail(selected); await refreshList();
    } catch (e) { report('edit: ' + (e as Error).message, 'err'); }
  }

  function togglePick(no: number) {
    setDiffPicks((p) => p.includes(no) ? p.filter((x) => x !== no) : (p.length >= 2 ? [p[1], no] : [...p, no]));
  }

  // edit-modal JSON validity (gates the submit; Format pretty-prints)
  let editError: string | null = null;
  if (editFor != null) {
    try { JSON.parse(editText); } catch (e) { editError = (e as Error).message; }
  }

  const confirmVariant = confirm ? variants.find((v) => v.variant_no === confirm.no) : undefined;
  const confirmOverall = confirmVariant ? ((confirmVariant.machine_check && confirmVariant.machine_check.overall) || 'FAIL') : 'FAIL';
  const needsOverride = confirm != null && confirm.type === 'adopt' && confirmOverall === 'FAIL';

  return (
    <div data-testid="contentadmin" className="ca-root">
      <header className="aa-head">
        <span className="den t-h2 gold-text">Content Data Registry</span>
        <a data-testid="cd-artadmin-link" className="aa-crosslink t-micro" href="#/artadmin">Art Admin &rarr;</a>
        <div data-testid="cd-msg" aria-live="polite" className="aa-msg t-micro">{msg}</div>
      </header>
      <div className="ca-cols">
        <DefRail defs={defs} selected={selected} onSelect={selectDef} onNew={() => setCreateOpen(true)} />
        <section className="ca-center">
          {createOpen ? (
            <CreatePanel existing={defs} report={report}
              onClose={() => setCreateOpen(false)}
              onCreated={(d) => {
                setCreateOpen(false);
                void refreshList().then(() => selectDef(d.system_name));
              }} />
          ) : def && selected && draft ? (
            <Workspace def={def} variants={variants} artworkFacet={artworkFacet} adoptedNo={adoptedNo}
              draft={draft} onDraft={(p) => setDraft((d) => (d ? { ...d, ...p } : d))}
              dirty={dirty} onSave={() => { void doSave(); }}
              genN={genN} onGenN={setGenN}
              commission={commission} onCommission={() => { void doCommission(); }}
              onCopyCommission={() => { void doCopyCommission(); }}
              ingestText={ingestText} onIngestText={setIngestText}
              ingestBusy={ingestBusy} onIngest={(vs) => { void doIngest(vs); }}
              expandedChecks={expandedChecks}
              onToggleCheck={(key) => setExpandedChecks((e) => ({ ...e, [key]: !e[key] }))}
              reviewDrafts={reviewDrafts}
              onReviewDraft={(no, d) => setReviewDrafts((s) => ({ ...s, [no]: d }))}
              onReviewSubmit={(no) => { void doReview(no); }}
              onAskAdopt={(no) => { setOverrideOn(false); setConfirm({ type: 'adopt', no }); }}
              onAskDelete={(no) => setConfirm({ type: 'delete', no })}
              onEditOpen={openEdit}
              onRecheck={(no) => { void doRecheck(no); }}
              diffPicks={diffPicks} onTogglePick={togglePick}
              onDiffAdopted={(no) => { if (adoptedNo != null) setDiffPair({ a: adoptedNo, b: no }); }}
              onOpenPickedDiff={() => { if (diffPicks.length === 2) setDiffPair({ a: diffPicks[0], b: diffPicks[1] }); }}
              diffPair={diffPair} onCloseDiff={() => setDiffPair(null)}
              report={report} />
          ) : (
            <div className="panel panel-pad aa-placeholder">
              <div className="den t-h3">No content def selected</div>
              <div className="t-micro">Pick one in the browser on the left, or create a new one.</div>
            </div>
          )}
        </section>
      </div>

      {confirm && selected && confirmVariant && (
        confirm.type === 'adopt' ? (
          <ConfirmDialog title={'Adopt variant ' + confirm.no + '?'} okLabel="Adopt + export"
            okDisabled={needsOverride && !overrideOn}
            onOk={() => { const no = confirm.no; const ov = needsOverride && overrideOn; setConfirm(null); void doAdopt(no, ov); }}
            onCancel={() => setConfirm(null)}>
            <div className="ca-confirm-checks">
              <span className={'ca-overall ' + (confirmOverall === 'PASS' ? 'is-pass' : 'is-fail')}>{confirmOverall}</span>
              {((confirmVariant.machine_check && confirmVariant.machine_check.checks) || []).map((c) => (
                <span key={c.name} className={'aa-verdict ' + (!c.applicable ? 'ca-verdict--na' : c.ok ? 'aa-verdict--pass' : 'aa-verdict--fail')}>
                  {c.name} {!c.applicable ? 'n/a' : c.ok ? 'ok' : 'x'}
                </span>
              ))}
            </div>
            <div className="t-micro ca-confirm-review">
              {confirmVariant.agent_review
                ? <span>advisory review: <b>{confirmVariant.agent_review.verdict}</b> -- {confirmVariant.agent_review.rationale}</span>
                : <span>no advisory review recorded (never binding either way)</span>}
            </div>
            <div className="t-micro">This becomes THE served data for <b>{selected}</b> and fires the content/
              export. Switchable any time; history stays.</div>
            {needsOverride && (
              <label className="ca-override">
                <input type="checkbox" data-testid="adopt-override" checked={overrideOn}
                  onChange={(e) => setOverrideOn(e.target.checked)} />
                <span>Override FAILED machine checks: this data could not integrate -- the export may
                  break consumers. I adopt it anyway.</span>
              </label>
            )}
          </ConfirmDialog>
        ) : (
          <ConfirmDialog title={'Delete variant ' + confirm.no + '?'} okLabel="Delete"
            onOk={() => { const no = confirm.no; setConfirm(null); void doDelete(no); }}
            onCancel={() => setConfirm(null)}>
            <div className="t-micro">Variants live ONLY in the registry DB (no backup) -- a deleted variant is
              gone; its variant_no is never reused. The provenance recipe carries NO regeneration guarantee.</div>
          </ConfirmDialog>
        )
      )}

      {editFor != null && (
        <div className="aa-scrim" onClick={(e) => { if (e.target === e.currentTarget) setEditFor(null); }}>
          <div className="panel panel-pad ca-editor" role="dialog" aria-modal="true">
            <div className="aa-ws-head">
              <span className="den t-h3 gold-text">Edit variant {editFor} as a NEW variant</span>
              <button type="button" data-testid="edit-close" className="btn btn-ghost aa-btn-xs" onClick={() => setEditFor(null)}>close</button>
            </div>
            <div className="t-micro">Variants are immutable: this creates a new human_edit variant with
              parent lineage v{editFor}; the original is untouched.</div>
            <textarea data-testid={'edit-json-' + editFor} className="aa-input aa-textarea" value={editText}
              spellCheck={false} onChange={(e) => setEditText(e.target.value)} />
            <div data-testid={'edit-valid-' + editFor} className={'ca-edit-valid ' + (editError ? 'is-err' : 'is-ok')}>
              {editError ? 'invalid JSON: ' + editError : 'valid JSON'}
            </div>
            <div className="ca-editor-actions">
              <button type="button" data-testid={'edit-format-' + editFor} className="btn btn-ghost aa-btn-sm"
                disabled={!!editError}
                onClick={() => { try { setEditText(prettyJson(JSON.parse(editText))); } catch { /* gated by disabled */ } }}>Format</button>
              <button type="button" data-testid={'edit-submit-' + editFor} className="btn aa-btn-sm"
                disabled={!!editError}
                onClick={() => { void doEditSubmit(); }}>Create edited variant</button>
            </div>
          </div>
        </div>
      )}

      <div className="aa-toasts" aria-hidden="true">
        {toasts.map((t) => (
          <div key={t.id} className={'aa-toast' + (t.kind === 'err' ? ' is-err' : '')}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
