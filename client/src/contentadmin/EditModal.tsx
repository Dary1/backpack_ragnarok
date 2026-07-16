// client/src/contentadmin/EditModal.tsx -- REQ-0173
// (contentadmin-entity-rendering C), upgraded to the full PO/SI EDITOR by
// REQ-0182a (po-si-editor-port). The edit-as-new modal is the registry path's
// answer to Dex Edit: DexAdmin's friendlier FORM UX, but on top of registry
// semantics (a new human_edit variant with lineage, machine-checked +
// adoptable) instead of Dex Edit's direct live PUT. REQ-0182b retires Dex Edit
// once this has merged; until then DexAdmin.tsx remains the parity reference.
//
// REQ-0182a brings the surface to AT LEAST DexAdmin parity:
//   1. LAYOUT -- a full-size editor (not a 720px dialog): the form scrolls on
//      the left, a live EntityPreview rail sits beside it on the right, so the
//      operator sees the shape/icon/art context WHILE editing. That context is
//      what DexAdmin's list thumbnails provided and this modal had none of.
//      The rail renders the SERIALIZED data -- i.e. exactly what Submit would
//      send -- on BOTH tabs, so it doubles as a "what am I about to create?"
//      check. While the JSON tab holds unparseable text the rail holds the
//      last valid render rather than flickering to an error.
//   2. LOCALE -- an EN/JA switcher for name/flavor (never both at once),
//      replacing the side-by-side fields. DECISION (the REQ asked for one):
//      the switcher WINS and the side-by-side is gone. The user called
//      DexAdmin's editor the friendlier surface and this is its pattern; on
//      top of that the preview rail now takes horizontal room the old
//      2-column name(EN)|name(JA) grid needed, so side-by-side would have to
//      cramp precisely the fields most often typed into. Cost: a testid can
//      only be present in its own locale (see the testid note below).
//   3. TAGS -- the additional-tags control is a real multi-select over
//      trees.po with ANCESTRY labels ("Weapon > WeaponPart", via dex's
//      ancestryPath), replacing free-text comma parsing. Beyond DexAdmin,
//      which the REQ permits ("at least" parity). Any tag NOT in the tree
//      (legacy content) is preserved as a selected option -- never silently
//      dropped by a control that cannot represent it.
//   4. EFFECTS -- the row grammar is now COMPLETE. The old form had no input
//      for `every_secs` secs[lo,hi] or `amp_status` mult, so those params were
//      only round-tripped, never editable: the exact fields DexAdmin exposes
//      and the reason an operator still had to fall back to Dex Edit.
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
//
// TESTIDS -- every REQ-0173 edit-* testid is kept, on the same control, with
// two documented consequences of the changes above:
//   - edit-form-name/flavor-<no> and edit-form-ja-name/ja-flavor-<no> are now
//     mutually exclusive: each mounts only while its locale is selected. Drive
//     the switcher (edit-form-locale-en/ja-<no>) to reach the other pair.
//   - edit-form-tags-<no> is the same "additional tags" control but is now a
//     <select multiple>: selectOption(), no longer fill().
// New: edit-form-locale-en-<no>, edit-form-locale-ja-<no>,
// edit-form-eff-secslo-<no>-<i>, edit-form-eff-secshi-<no>-<i>,
// edit-form-eff-mult-<no>-<i>, and the rail's entity-preview-edit-<no>
// (EntityPreview's own idBase-derived testid).
import { useEffect, useMemo, useRef, useState } from 'react';
import { cachedFetchContent } from '../lib/contentCache';
import type { ApiContentPayload } from '../api';
import { effectToRow, rowToEffect, defaultEffectRow, type EffectRow } from '../dex/adminForm';
import { ancestryPath } from '../dex/vocabTree';
import { EntityPreview } from './EntityPreview';
import { prettyJson, jaField } from './contentShared';

type Data = Record<string, unknown>;

/** Verbs whose AST carries a `status` -- adminForm.rowToEffect's exact list
 * (kept in lockstep with it; server/admin.cjs validates for real). */
const STATUS_VERBS = ['apply_status', 'add_on_hit_status', 'amp_status'];

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

type EditLocale = 'en' | 'ja';

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

/** "Weapon > WeaponPart" for a tag, via the dex ancestry walker. A tag absent
 * from the tree labels as itself (ancestryPath's own unknown-tag posture). */
function tagLabel(tree: Record<string, string | null>, tag: string): string {
  const path = ancestryPath(tree, tag);
  return path.length > 1 ? path.join(' > ') : tag;
}

export function EditModal({ no, kind, original, artUrl, onClose, onSubmit }: {
  no: number;
  kind: string;
  original: Data;
  /** REQ-0182a: the def's adopted registry-render URL, threaded to the live
   * preview rail so the editor shows the SAME art the variant cards do
   * (ContentAdminPage resolves it once via defAdoptedArtUrl). Absent -> the
   * rail falls back to the SVG sprite, EntityPreview's own posture. */
  artUrl?: string | null;
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
  // REQ-0182a: which locale's name/flavor inputs are mounted -- never both.
  // Always opens on EN (DexAdmin's posture: independent of the chrome locale,
  // reset per editor, and this admin surface is EN-only anyway).
  const [editLocale, setEditLocale] = useState<EditLocale>('en');

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

  // REQ-0182a: a <select multiple> reports its selection in DOM (option) order,
  // so writing that back verbatim REORDERS tags the operator never touched --
  // adding one tag would rewrite the variant's whole tags array and show up as
  // a spurious change in the diff. Keep the order the variant already had for
  // every tag still selected, and append only the genuinely new ones.
  function patchExtraTags(picked: string[]) {
    const prev = form.tags.slice(1);
    const pickedSet = new Set(picked);
    const kept = prev.filter((t) => pickedSet.has(t));
    const added = picked.filter((t) => !prev.includes(t));
    patchForm({ tags: [form.tags[0] || '', ...kept, ...added] });
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

  // REQ-0182a: the preview rail renders the SERIALIZED truth (jsonText), so it
  // is live on the Form tab and equally live on the JSON tab -- always "what
  // Submit would send". Non-objects (a bare `123` typed into the JSON tab) are
  // not renderable entities, so they count as no-parse here; submit-time
  // behaviour is deliberately untouched (editError alone still gates it).
  const parsedForPreview = useMemo<Data | null>(() => {
    try {
      const p: unknown = JSON.parse(jsonText);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Data;
    } catch { /* mid-typing -> hold the last valid render */ }
    return null;
  }, [jsonText]);
  const lastGoodRef = useRef<Data>(original);
  useEffect(() => { if (parsedForPreview) lastGoodRef.current = parsedForPreview; }, [parsedForPreview]);
  const previewData = parsedForPreview ?? lastGoodRef.current;

  const rarities = payload ? payload.vocab.rarities : [];
  const triggers = payload ? payload.vocab.triggers : [];
  const verbs = payload ? payload.vocab.verbs : [];
  const statuses = payload ? payload.vocab.statuses : [];
  const poTree = useMemo(() => (payload ? payload.trees.po : {}), [payload]);
  const rootTags = useMemo(
    () => Object.keys(poTree).filter((t) => poTree[t] === null),
    [poTree]
  );
  // Additional-tag options: every tag in the tree, ancestry-labelled, PLUS any
  // tag this variant already carries that the tree does not know about -- so a
  // legacy tag survives a form round-trip instead of being dropped by a
  // control that could not offer it back.
  const extraTagOptions = useMemo(() => {
    const known = Object.keys(poTree);
    const unknown = form.tags.slice(1).filter((t) => !(t in poTree));
    return [...known, ...unknown].map((t) => ({ tag: t, label: tagLabel(poTree, t), known: t in poTree }));
  }, [poTree, form.tags]);

  const noteText = !kindFormKind
    ? 'The structured Form is available for po_def / si_def only. Edit ' + kind + ' as JSON.'
    : !objectsOk
      ? 'This variant has a non-object effects array -- edit as JSON to avoid data loss.'
      : payloadErr
        ? 'Vocabulary could not be loaded -- edit as JSON.'
        : 'loading vocabulary...';

  const localeSwitch = (
    <div className="ca-ed-locale" role="group" aria-label="name / flavor locale">
      <button type="button" data-testid={'edit-form-locale-en-' + no} aria-pressed={editLocale === 'en'}
        className={'ca-ed-loc-btn' + (editLocale === 'en' ? ' is-on' : '')}
        onClick={() => setEditLocale('en')}>EN</button>
      <button type="button" data-testid={'edit-form-locale-ja-' + no} aria-pressed={editLocale === 'ja'}
        className={'ca-ed-loc-btn' + (editLocale === 'ja' ? ' is-on' : '')}
        onClick={() => setEditLocale('ja')}>JA</button>
    </div>
  );

  const formPane = (
    <div className="ca-edit-form">
      {localeSwitch}
      <div className="ca-ef-grid">
        {editLocale === 'en' ? (
          <label className="aa-field"><span className="t-micro">name (EN)</span>
            <input data-testid={'edit-form-name-' + no} className="aa-input" value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })} /></label>
        ) : (
          <label className="aa-field"><span className="t-micro">name (JA)</span>
            <input data-testid={'edit-form-ja-name-' + no} className="aa-input" value={form.jaName}
              onChange={(e) => patchForm({ jaName: e.target.value })} /></label>
        )}
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

      {editLocale === 'en' ? (
        <label className="aa-field aa-field--wide"><span className="t-micro">flavor (EN)</span>
          <textarea data-testid={'edit-form-flavor-' + no} className="aa-input aa-textarea ca-ed-flavor" rows={2} value={form.flavor}
            onChange={(e) => patchForm({ flavor: e.target.value })} /></label>
      ) : (
        <label className="aa-field aa-field--wide"><span className="t-micro">flavor (JA)</span>
          <textarea data-testid={'edit-form-ja-flavor-' + no} className="aa-input aa-textarea ca-ed-flavor" rows={2} value={form.jaFlavor}
            onChange={(e) => patchForm({ jaFlavor: e.target.value })} /></label>
      )}

      {kind === 'po_def' ? (
        <div className="ca-ef-tags">
          <label className="aa-field"><span className="t-micro">type (first tag)</span>
            <select data-testid={'edit-form-tag-root-' + no} className="aa-input" value={form.tags[0] || ''}
              onChange={(e) => patchForm({ tags: [e.target.value, ...form.tags.slice(1)] })}>
              <option value="">--</option>
              {/* a first tag the tree does not list as a root (legacy content) still
                  has to be selectable, or picking any other field would silently
                  rewrite it -- same defensive posture as the rarity select above. */}
              {form.tags[0] && !rootTags.includes(form.tags[0])
                ? <option value={form.tags[0]}>{tagLabel(poTree, form.tags[0])}</option> : null}
              {rootTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></label>
          <label className="aa-field aa-field--wide"><span className="t-micro">additional tags (ctrl/cmd-click to multi-select)</span>
            <select multiple data-testid={'edit-form-tags-' + no} className="aa-input ca-ef-tagmulti"
              value={form.tags.slice(1)}
              onChange={(e) => patchExtraTags(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {extraTagOptions.map((o) => (
                <option key={o.tag} value={o.tag}>{o.label}{o.known ? '' : ' (not in vocab)'}</option>
              ))}
            </select></label>
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
            {/* REQ-0182a: every_secs carries trigger.s [lo,hi]. Without these the
                form could round-trip the range but never edit it -- DexAdmin has
                them, so their absence was a reason to keep using Dex Edit. */}
            {row.triggerT === 'every_secs' ? (
              <>
                <input data-testid={'edit-form-eff-secslo-' + no + '-' + i} className="aa-input ca-input-xs ca-ef-num"
                  type="number" step="0.1" placeholder="secs lo" value={row.secsLo}
                  onChange={(e) => patchEffect(i, { secsLo: e.target.value })} />
                <input data-testid={'edit-form-eff-secshi-' + no + '-' + i} className="aa-input ca-input-xs ca-ef-num"
                  type="number" step="0.1" placeholder="secs hi" value={row.secsHi}
                  onChange={(e) => patchEffect(i, { secsHi: e.target.value })} />
              </>
            ) : null}
            <select data-testid={'edit-form-eff-verb-' + no + '-' + i} className="aa-input ca-input-xs" value={row.verbT}
              onChange={(e) => patchEffect(i, { verbT: e.target.value })}>
              {row.verbT && !verbs.includes(row.verbT) ? <option value={row.verbT}>{row.verbT}</option> : null}
              {verbs.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <input data-testid={'edit-form-eff-nlo-' + no + '-' + i} className="aa-input ca-input-xs ca-ef-num" type="number"
              placeholder="n lo" value={row.nLo} onChange={(e) => patchEffect(i, { nLo: e.target.value })} />
            <input data-testid={'edit-form-eff-nhi-' + no + '-' + i} className="aa-input ca-input-xs ca-ef-num" type="number"
              placeholder="n hi" value={row.nHi} onChange={(e) => patchEffect(i, { nHi: e.target.value })} />
            {STATUS_VERBS.includes(row.verbT) ? (
              <select data-testid={'edit-form-eff-status-' + no + '-' + i} className="aa-input ca-input-xs" value={row.status}
                onChange={(e) => patchEffect(i, { status: e.target.value })}>
                <option value="">--</option>
                {statuses.map((sname) => <option key={sname} value={sname}>{sname}</option>)}
              </select>
            ) : null}
            {/* REQ-0182a: amp_status carries verb.mult -- same story as secs. */}
            {row.verbT === 'amp_status' ? (
              <input data-testid={'edit-form-eff-mult-' + no + '-' + i} className="aa-input ca-input-xs ca-ef-num" type="number"
                step="0.1" placeholder="mult" value={row.mult} onChange={(e) => patchEffect(i, { mult: e.target.value })} />
            ) : null}
            <button type="button" data-testid={'edit-form-eff-del-' + no + '-' + i} className="btn btn-ghost aa-btn-xs"
              onClick={() => delEffect(i)}>del</button>
          </div>
        ))}
        {form.effects.length === 0 ? <div className="t-micro ca-ep-muted">no effects</div> : null}
      </div>
    </div>
  );

  const jsonPane = (
    <>
      <textarea data-testid={'edit-json-' + no} className="aa-input aa-textarea" value={jsonText}
        spellCheck={false} onChange={(e) => setJsonText(e.target.value)} />
      <div data-testid={'edit-valid-' + no} className={'ca-edit-valid ' + (editError ? 'is-err' : 'is-ok')}>
        {editError ? 'invalid JSON: ' + editError : 'valid JSON'}
      </div>
    </>
  );

  return (
    <div className="aa-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel panel-pad ca-editor ca-editor--wide" role="dialog" aria-modal="true">
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

        {/* REQ-0182a: form/JSON on the left, the live entity beside it on the
            right -- the editing context DexAdmin's thumbnails gave and this
            modal lacked. The rail is fed by the serialized truth, so it tracks
            BOTH panes without either knowing about it. */}
        <div className="ca-ed-body">
          <div className="ca-ed-main">
            {tab === 'form' && formSupported ? formPane : jsonPane}
          </div>
          <aside className="ca-ed-rail">
            <span className="t-micro ca-ep-muted">live preview -- what Submit will create</span>
            <EntityPreview kind={kind} data={previewData} idBase={'edit-' + no} artUrl={artUrl} />
          </aside>
        </div>

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
