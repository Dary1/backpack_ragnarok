// client/src/contentadmin/EditModal.tsx -- REQ-0173
// (contentadmin-entity-rendering C). The edit-as-new modal, upgraded from a
// bare JSON textarea into a Form|JSON tabbed editor that gives the registry
// path everything Dex Edit has -- but on top of registry semantics (a new
// human_edit variant with lineage, machine-checked + adoptable) instead of
// Dex Edit's direct live PUT. This SUPERSEDES Dex Edit for content work.
//
// The Dex form-model helpers are REUSED BY IMPORT from ../dex/adminForm
// (EffectRow/effectToRow/rowToEffect/defaultEffectRow) -- never forked. Vocab
// + tag trees come from the cached /api/content payload (contentCache -- the
// exact Dex path). Form state serializes OVER the ORIGINAL variant data, so
// unconsumed fields (shape/align/part/icon/sockets/ports/...) pass through
// VERBATIM. The JSON tab always shows the serialized result; switching tabs
// keeps them in sync. Non-form kinds (monster/skill/tm/unit) -- and any po/si
// variant whose effects array is not all-objects -- open on JSON with the
// Form tab disabled + a note (never a crash).
import { useEffect, useMemo, useState } from 'react';
import { cachedFetchContent } from '../lib/contentCache';
import type { ApiContentPayload } from '../api';
import { effectToRow, rowToEffect, defaultEffectRow, type EffectRow } from '../dex/adminForm';
import { prettyJson, jaField } from './contentShared';

type Data = Record<string, unknown>;

interface FormState {
  name: string;
  flavor: string;
  jaName: string;
  jaFlavor: string;
  rarity: string;
  tags: string[];
  stretch: boolean;
  effects: EffectRow[];
}

function formFromData(original: Data): FormState {
  const effs = Array.isArray(original.effects) ? (original.effects as Record<string, unknown>[]) : [];
  return {
    name: typeof original.name === 'string' ? original.name : '',
    flavor: typeof original.flavor === 'string' ? original.flavor : '',
    jaName: jaField(original, 'name'),
    jaFlavor: jaField(original, 'flavor'),
    rarity: typeof original.rarity === 'string' ? original.rarity : '',
    tags: Array.isArray(original.tags) ? (original.tags as unknown[]).map(String) : [],
    stretch: !!original.stretch,
    effects: effs.map(effectToRow),
  };
}

function serialize(form: FormState, original: Data, kind: string): Data {
  const prevI18n = (original.i18n as Record<string, unknown>) || {};
  const prevJa = (prevI18n.ja as Record<string, unknown>) || {};
  const data: Data = {
    ...original,
    name: form.name,
    flavor: form.flavor,
    i18n: { ...prevI18n, ja: { ...prevJa, name: form.jaName, flavor: form.jaFlavor } },
    rarity: form.rarity,
    effects: form.effects.map(rowToEffect),
  };
  if (kind === 'po_def') {
    data.tags = form.tags;
    data.stretch = form.stretch;
  }
  return data;
}

/** A po/si variant is form-editable only if its effects array (if any) is
 * all-objects -- adminForm's EffectRow grammar targets object ASTs. */
function effectsAreObjects(original: Data): boolean {
  if (!Array.isArray(original.effects)) return true;
  return (original.effects as unknown[]).every((e) => e !== null && typeof e === 'object' && !Array.isArray(e));
}

export function EditModal({ no, kind, original, onClose, onSubmit }: {
  no: number;
  kind: string;
  original: Data;
  onClose: () => void;
  onSubmit: (data: Data) => void;
}) {
  const [payload, setPayload] = useState<ApiContentPayload | null>(null);
  const [payloadErr, setPayloadErr] = useState(false);
  const [form, setForm] = useState<FormState>(() => formFromData(original));
  const [jsonText, setJsonText] = useState<string>(() => prettyJson(serialize(formFromData(original), original, kind)));
  const kindFormKind = kind === 'po_def' || kind === 'si_def';
  const objectsOk = effectsAreObjects(original);
  const formSupported = kindFormKind && objectsOk && !!payload;
  const [tab, setTab] = useState<'form' | 'json'>('json');

  // fetch vocab/trees once on open (non-fatal -> Form tab stays disabled)
  useEffect(() => {
    let live = true;
    cachedFetchContent()
      .then((p) => { if (live) { setPayload(p); } })
      .catch(() => { if (live) setPayloadErr(true); });
    return () => { live = false; };
  }, []);

  // default to Form once vocab has loaded for a supported kind
  useEffect(() => {
    if (kindFormKind && objectsOk && payload) setTab('form');
  }, [kindFormKind, objectsOk, payload]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // form edits push into the serialized JSON truth (kept in sync live)
  function patchForm(patch: Partial<FormState>) {
    setForm((f) => {
      const nf = { ...f, ...patch };
      setJsonText(prettyJson(serialize(nf, original, kind)));
      return nf;
    });
  }
  function patchEffect(i: number, patch: Partial<EffectRow>) {
    setForm((f) => {
      const effects = f.effects.slice();
      effects[i] = { ...effects[i], ...patch };
      const nf = { ...f, effects };
      setJsonText(prettyJson(serialize(nf, original, kind)));
      return nf;
    });
  }
  function addEffect() {
    if (!payload) return;
    patchForm({ effects: [...form.effects, defaultEffectRow(payload.vocab)] });
  }
  function delEffect(i: number) {
    patchForm({ effects: form.effects.filter((_, j) => j !== i) });
  }

  function switchTab(next: 'form' | 'json') {
    if (next === tab) return;
    if (next === 'json') {
      // re-serialize from the current form so JSON always reflects it
      setJsonText(prettyJson(serialize(form, original, kind)));
      setTab('json');
    } else {
      // parse the JSON back into the form (best-effort; stay on JSON on error)
      try {
        const parsed = JSON.parse(jsonText) as Data;
        setForm(formFromData(parsed));
        setTab('form');
      } catch { /* invalid JSON -> stay on the JSON tab */ }
    }
  }

  let editError: string | null = null;
  try { JSON.parse(jsonText); } catch (e) { editError = (e as Error).message; }

  const rarities = payload ? payload.vocab.rarities : [];
  const triggers = payload ? payload.vocab.triggers : [];
  const verbs = payload ? payload.vocab.verbs : [];
  const statuses = payload ? payload.vocab.statuses : [];
  const rootTags = useMemo(
    () => (payload ? Object.keys(payload.trees.po).filter((t) => payload.trees.po[t] === null) : []),
    [payload]
  );

  const noteText = !kindFormKind
    ? 'The structured Form is available for po_def / si_def only. Edit ' + kind + ' as JSON.'
    : !objectsOk
      ? 'This variant has a non-object effects array -- edit as JSON to avoid data loss.'
      : payloadErr
        ? 'Vocabulary could not be loaded -- edit as JSON.'
        : 'loading vocabulary...';

  return (
    <div className="aa-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel panel-pad ca-editor" role="dialog" aria-modal="true">
        <div className="aa-ws-head">
          <span className="den t-h3 gold-text">Edit variant {no} as a NEW variant</span>
          <button type="button" data-testid="edit-close" className="btn btn-ghost aa-btn-xs" onClick={onClose}>close</button>
        </div>
        <div className="t-micro">Variants are immutable: this creates a new human_edit variant with
          parent lineage v{no}; the original is untouched. Unedited fields (shape, icon, align, part...)
          pass through verbatim.</div>

        <div className="ca-edit-tabs" role="tablist">
          <button type="button" role="tab" data-testid={'edit-tab-form-' + no}
            className={'ca-edit-tab' + (tab === 'form' ? ' is-on' : '')}
            aria-selected={tab === 'form'} disabled={!formSupported}
            onClick={() => switchTab('form')}>Form</button>
          <button type="button" role="tab" data-testid={'edit-tab-json-' + no}
            className={'ca-edit-tab' + (tab === 'json' ? ' is-on' : '')}
            aria-selected={tab === 'json'} onClick={() => switchTab('json')}>JSON</button>
          {!formSupported && <span data-testid={'edit-form-note-' + no} className="t-micro ca-edit-note">{noteText}</span>}
        </div>

        {tab === 'form' && formSupported ? (
          <div className="ca-edit-form">
            <div className="ca-ef-grid">
              <label className="aa-field"><span className="t-micro">name (EN)</span>
                <input data-testid={'edit-form-name-' + no} className="aa-input" value={form.name}
                  onChange={(e) => patchForm({ name: e.target.value })} /></label>
              <label className="aa-field"><span className="t-micro">name (JA)</span>
                <input data-testid={'edit-form-ja-name-' + no} className="aa-input" value={form.jaName}
                  onChange={(e) => patchForm({ jaName: e.target.value })} /></label>
              <label className="aa-field"><span className="t-micro">rarity</span>
                <select data-testid={'edit-form-rarity-' + no} className="aa-input" value={form.rarity}
                  onChange={(e) => patchForm({ rarity: e.target.value })}>
                  {form.rarity && !rarities.includes(form.rarity) ? <option value={form.rarity}>{form.rarity}</option> : null}
                  {rarities.map((r) => <option key={r} value={r}>{r}</option>)}
                </select></label>
              {kind === 'po_def' ? (
                <label className="aa-field ca-ef-check"><span className="t-micro">stretch</span>
                  <input data-testid={'edit-form-stretch-' + no} type="checkbox" checked={form.stretch}
                    onChange={(e) => patchForm({ stretch: e.target.checked })} /></label>
              ) : null}
            </div>
            <label className="aa-field aa-field--wide"><span className="t-micro">flavor (EN)</span>
              <textarea data-testid={'edit-form-flavor-' + no} className="aa-input aa-textarea" rows={2} value={form.flavor}
                onChange={(e) => patchForm({ flavor: e.target.value })} /></label>
            <label className="aa-field aa-field--wide"><span className="t-micro">flavor (JA)</span>
              <textarea data-testid={'edit-form-ja-flavor-' + no} className="aa-input aa-textarea" rows={2} value={form.jaFlavor}
                onChange={(e) => patchForm({ jaFlavor: e.target.value })} /></label>

            {kind === 'po_def' ? (
              <div className="ca-ef-tags">
                <label className="aa-field"><span className="t-micro">type (first tag)</span>
                  <select data-testid={'edit-form-tag-root-' + no} className="aa-input" value={form.tags[0] || ''}
                    onChange={(e) => patchForm({ tags: [e.target.value, ...form.tags.slice(1)] })}>
                    <option value="">--</option>
                    {rootTags.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select></label>
                <label className="aa-field aa-field--wide"><span className="t-micro">additional tags (comma-separated)</span>
                  <input data-testid={'edit-form-tags-' + no} className="aa-input" value={form.tags.slice(1).join(', ')}
                    onChange={(e) => patchForm({ tags: [form.tags[0] || '', ...e.target.value.split(',').map((x) => x.trim()).filter(Boolean)] })} /></label>
              </div>
            ) : null}

            <div className="ca-ef-effects">
              <div className="ca-ef-effhead">
                <span className="t-micro">effects</span>
                <button type="button" data-testid={'edit-form-effect-add-' + no} className="btn btn-ghost aa-btn-xs"
                  onClick={addEffect}>+ add effect</button>
              </div>
              {form.effects.map((row, i) => (
                <div key={i} className="ca-ef-effrow">
                  <select data-testid={'edit-form-eff-trigger-' + no + '-' + i} className="aa-input ca-input-xs" value={row.triggerT}
                    onChange={(e) => patchEffect(i, { triggerT: e.target.value })}>
                    {row.triggerT && !triggers.includes(row.triggerT) ? <option value={row.triggerT}>{row.triggerT}</option> : null}
                    {triggers.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select data-testid={'edit-form-eff-verb-' + no + '-' + i} className="aa-input ca-input-xs" value={row.verbT}
                    onChange={(e) => patchEffect(i, { verbT: e.target.value })}>
                    {row.verbT && !verbs.includes(row.verbT) ? <option value={row.verbT}>{row.verbT}</option> : null}
                    {verbs.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <input data-testid={'edit-form-eff-nlo-' + no + '-' + i} className="aa-input ca-input-xs ca-ef-num" type="number"
                    placeholder="n lo" value={row.nLo} onChange={(e) => patchEffect(i, { nLo: e.target.value })} />
                  <input data-testid={'edit-form-eff-nhi-' + no + '-' + i} className="aa-input ca-input-xs ca-ef-num" type="number"
                    placeholder="n hi" value={row.nHi} onChange={(e) => patchEffect(i, { nHi: e.target.value })} />
                  {['apply_status', 'add_on_hit_status', 'amp_status'].includes(row.verbT) ? (
                    <select data-testid={'edit-form-eff-status-' + no + '-' + i} className="aa-input ca-input-xs" value={row.status}
                      onChange={(e) => patchEffect(i, { status: e.target.value })}>
                      <option value="">--</option>
                      {statuses.map((sname) => <option key={sname} value={sname}>{sname}</option>)}
                    </select>
                  ) : null}
                  <button type="button" data-testid={'edit-form-eff-del-' + no + '-' + i} className="btn btn-ghost aa-btn-xs"
                    onClick={() => delEffect(i)}>del</button>
                </div>
              ))}
              {form.effects.length === 0 ? <div className="t-micro ca-ep-muted">no effects</div> : null}
            </div>
          </div>
        ) : (
          <>
            <textarea data-testid={'edit-json-' + no} className="aa-input aa-textarea" value={jsonText}
              spellCheck={false} onChange={(e) => setJsonText(e.target.value)} />
            <div data-testid={'edit-valid-' + no} className={'ca-edit-valid ' + (editError ? 'is-err' : 'is-ok')}>
              {editError ? 'invalid JSON: ' + editError : 'valid JSON'}
            </div>
          </>
        )}

        <div className="ca-editor-actions">
          {tab === 'json' && (
            <button type="button" data-testid={'edit-format-' + no} className="btn btn-ghost aa-btn-sm"
              disabled={!!editError}
              onClick={() => { try { setJsonText(prettyJson(JSON.parse(jsonText))); } catch { /* gated */ } }}>Format</button>
          )}
          <button type="button" data-testid={'edit-submit-' + no} className="btn aa-btn-sm"
            disabled={!!editError}
            onClick={() => { try { onSubmit(JSON.parse(jsonText) as Data); } catch { /* gated by disabled */ } }}>Create edited variant</button>
        </div>
      </div>
    </div>
  );
}
