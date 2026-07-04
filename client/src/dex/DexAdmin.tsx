// Admin edit mode — REQ-0035, rebuilt REQ-0038 (Dex v2 edit mode). A
// SEPARATE view/layout from the display cards (Dex.tsx) -- entered via a
// toggle that is visible ONLY when GET /api/me's roles include item_admin
// (the toggle itself lives in DexRoot.tsx, which owns switching between
// Dex/DexAdmin). This component renders a two-pane layout: a plain item
// list on the left (now with small shape-mounted thumbnails, REQ-0038),
// a form editor for the selected item on the right.
//
// REQ-0038 changes from the original REQ-0035 form:
//   1. Name/Flavor fields are LOCALE-ONLY: a locale switcher (EN/JA)
//      inside the editor determines which language's inputs are shown --
//      EN mode edits base name/flavor, JA mode edits i18n.ja.name/
//      i18n.ja.flavor (creating the i18n.ja object on first edit if
//      absent). Never both languages' inputs at once.
//   2. Effects list gets ADD (template picker: trigger from vocab
//      triggers, verb from vocab verbs, sensible defaults for the rest)
//      and DELETE (removes one effect from the array) buttons -- not
//      just editing existing rows' values.
//   3. The admin list rows show a small shape-mounted thumbnail (reuses
//      ShapeGrid, smaller cellPx, same rendering the catalog/detail list
//      use).
//
// Server-side validation (server/admin.cjs) is the actual source of
// truth -- every rule enforced here client-side is a UX convenience
// (immediate feedback, dropdown-constrained input) and NOT a substitute
// for it; a raw PUT with a header override still gets rejected server-
// side regardless of what this form allows the user to type.
import { useEffect, useMemo, useState } from 'react';
import { putAdminItem, type ApiContentPayload, type ApiItemEntry, type ApiMe, type ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t } from '../i18n';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { ShapeGrid } from './ShapeGrid';
import { iconDataUrl, iconDims } from './dexIcons';

interface DexAdminProps {
  locale: Locale;
  payload: ApiContentPayload;
  me: ApiMe;
  onSaved: () => void; // re-fetch /api/content after a successful save
}

function combineEntries(payload: ApiContentPayload): DexEntry[] {
  const pos: DexEntry[] = Object.values(payload.items).map((entry) => ({ id: entry.id, kind: 'po', entry }));
  const sis: DexEntry[] = Object.values(payload.sis).map((entry) => ({ id: entry.id, kind: 'si', entry }));
  return [...pos, ...sis];
}

function shapeOf(e: ApiItemEntry | ApiSIEntry): Cell[] {
  return ('shape' in e && Array.isArray(e.shape) ? e.shape : []) as Cell[];
}

// REQ-0038 R2: mirrors ItemDef.stretch for the shared itemCard.ts fit math
// (see ShapeGrid.tsx) -- only POs carry this field.
function stretchOf(e: ApiItemEntry | ApiSIEntry): boolean | undefined {
  return 'stretch' in e ? e.stretch : undefined;
}

// Effect form-row shape -- a superset of every verb's optional fields, so
// one form row component covers every verb without a separate component
// per verb type. Fields irrelevant to the selected verb/trigger are
// simply not sent (validateBody on the server only looks at what a given
// trigger/verb actually needs).
interface EffectRow {
  triggerT: string;
  secsLo: string;
  secsHi: string;
  verbT: string;
  nLo: string;
  nHi: string;
  status: string;
  mult: string;
}

function numToStr(v: unknown): string {
  return v === undefined || v === null || v === '' ? '' : String(v);
}

function effectToRow(eff: Record<string, unknown> | undefined): EffectRow {
  const trigger = (eff?.trigger as Record<string, unknown>) || {};
  const verb = (eff?.verb as Record<string, unknown>) || {};
  const s = (trigger.s as unknown[]) || [];
  const n = (verb.n as unknown[]) || [];
  return {
    triggerT: (trigger.t as string) || '',
    secsLo: numToStr(s[0]),
    secsHi: numToStr(s[1]),
    verbT: (verb.t as string) || '',
    nLo: numToStr(n[0]),
    nHi: numToStr(n[1]),
    status: (verb.status as string) || '',
    mult: numToStr(verb.mult),
  };
}

function rowToEffect(row: EffectRow): Record<string, unknown> {
  const trigger: Record<string, unknown> = { t: row.triggerT };
  if (row.triggerT === 'every_secs') {
    trigger.s = [Number(row.secsLo), Number(row.secsHi)];
  }
  const verb: Record<string, unknown> = { t: row.verbT };
  if (row.nLo !== '' && row.nHi !== '') {
    verb.n = [Number(row.nLo), Number(row.nHi)];
  }
  if (['apply_status', 'add_on_hit_status', 'amp_status'].includes(row.verbT) && row.status) {
    verb.status = row.status;
  }
  if (row.verbT === 'amp_status' && row.mult !== '') {
    verb.mult = Number(row.mult);
  }
  return { trigger, verb };
}

/** REQ-0038: builds a new effect row with sensible defaults for the ADD
 * button's template picker -- trigger defaults to the first vocab
 * trigger, verb to the first vocab verb (both from payload.vocab, the
 * SAME closed-vocabulary lists server/admin.cjs validates against, per
 * the task's "reuse, don't invent a new list" instruction), and a
 * reasonable default numeric range (1-1) so the row is immediately
 * savable without the user having to fill in every field before their
 * first save attempt -- server-side validation still enforces every
 * rule regardless of these defaults. */
function defaultEffectRow(vocab: ApiContentPayload['vocab']): EffectRow {
  return {
    triggerT: vocab.triggers[0] || 'battle_start',
    secsLo: '1',
    secsHi: '1',
    verbT: vocab.verbs[0] || 'strike',
    nLo: '1',
    nHi: '1',
    status: '',
    mult: '',
  };
}

type EditLocale = 'en' | 'ja';

export function DexAdmin({ locale, payload, onSaved }: DexAdminProps) {
  // REQ-0037: identity for the PUT /api/admin/item/:id call is now carried
  // entirely by the stored auth token (see api.ts's putAdminItem) -- the
  // me prop is kept on DexAdminProps (DexRoot.tsx still resolves and
  // passes it) purely as context for a future per-editor audit trail /
  // display, not consumed as an argument to putAdminItem anymore.
  const entries = useMemo(() => combineEntries(payload), [payload]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // REQ-0038: which locale's name/flavor inputs are shown -- independent
  // of the global chrome/content locale (an EN-speaking admin may still
  // want to edit JA copy, and vice versa), always starts at 'en' on a
  // fresh selection.
  const [editLocale, setEditLocale] = useState<EditLocale>('en');
  const [form, setForm] = useState<{
    name: string;
    flavor: string;
    i18nJaName: string;
    i18nJaFlavor: string;
    rarity: string;
    tags: string[];
    stretch: boolean;
    effects: EffectRow[];
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = entries.find((e) => e.id === selectedId) || null;
  const selectedIsPO = selected?.kind === 'po';

  useEffect(() => {
    if (!selected) {
      setForm(null);
      return;
    }
    const entry = selected.entry as ApiItemEntry & ApiSIEntry;
    const ja = entry.i18n?.ja;
    setForm({
      name: entry.name || '',
      flavor: entry.flavor || '',
      i18nJaName: ja?.name ?? entry.name_ja ?? '',
      i18nJaFlavor: ja?.flavor ?? entry.flavor_ja ?? '',
      rarity: entry.rarity || '',
      tags: selectedIsPO ? (entry as ApiItemEntry).tags || [] : [],
      stretch: selectedIsPO ? !!(entry as ApiItemEntry).stretch : false,
      effects: ((entry.effects as Record<string, unknown>[]) || []).map(effectToRow),
    });
    setEditLocale('en');
    setSaveError(null);
    setSaveOk(false);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagOptions = useMemo(() => Object.keys(payload.trees.po), [payload.trees.po]);
  const rootTagOptions = useMemo(
    () => tagOptions.filter((tag) => payload.trees.po[tag] === null),
    [tagOptions, payload.trees.po]
  );

  if (!selected || !form) {
    return (
      <div className="dex-admin">
        <div className="dex-admin-list">
          {entries.map((e) => (
            <button key={e.id} type="button" className="dex-admin-list-item" onClick={() => setSelectedId(e.id)}>
              <span className="dex-admin-list-thumb">
                <ShapeGrid
                shape={shapeOf(e.entry)}
                cellPx={14}
                iconUrl={iconDataUrl(e.entry.icon)}
                iconAlt={e.entry.icon}
                iconDims={iconDims(e.entry.icon)}
                iconStretch={stretchOf(e.entry)}
              />
              </span>
              <span className={`rarity r-${e.entry.rarity}`}>{e.entry.rarity[0]}</span> {e.entry.name}{' '}
              <span className="dex-card-id">({e.id})</span>
            </button>
          ))}
        </div>
        <div className="dex-admin-form dex-admin-form-empty">{t(locale, 'dexAdmin.selectPrompt')}</div>
      </div>
    );
  }

  const setField = <K extends keyof NonNullable<typeof form>>(key: K, value: NonNullable<typeof form>[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  const setEffectField = (idx: number, key: keyof EffectRow, value: string) => {
    setForm((f) => {
      if (!f) return f;
      const effects = f.effects.slice();
      effects[idx] = { ...effects[idx], [key]: value };
      return { ...f, effects };
    });
  };

  // REQ-0038: ADD appends one new effect row with template defaults
  // (defaultEffectRow, above) -- the user then adjusts trigger/verb/
  // params via the existing per-row dropdowns, same as any other row.
  const addEffect = () => {
    setForm((f) => (f ? { ...f, effects: [...f.effects, defaultEffectRow(payload.vocab)] } : f));
  };

  // REQ-0038: DELETE removes exactly one effect from the array -- an
  // empty effects array afterward is an accepted, valid state (server/
  // admin.cjs's validateBody forEachs over whatever length is sent,
  // including zero).
  const deleteEffect = (idx: number) => {
    setForm((f) => (f ? { ...f, effects: f.effects.filter((_, i) => i !== idx) } : f));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        flavor: form.flavor,
        i18n: { ja: { name: form.i18nJaName, flavor: form.i18nJaFlavor } },
        rarity: form.rarity,
        effects: form.effects.map(rowToEffect),
      };
      if (selectedIsPO) {
        body.tags = form.tags;
        body.stretch = form.stretch;
      }
      await putAdminItem(selected.id, body);
      setSaveOk(true);
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dex-admin">
      <div className="dex-admin-list">
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`dex-admin-list-item${e.id === selectedId ? ' dex-admin-list-item-active' : ''}`}
            onClick={() => setSelectedId(e.id)}
          >
            <span className="dex-admin-list-thumb">
              <ShapeGrid
                shape={shapeOf(e.entry)}
                cellPx={14}
                iconUrl={iconDataUrl(e.entry.icon)}
                iconAlt={e.entry.icon}
                iconDims={iconDims(e.entry.icon)}
                iconStretch={stretchOf(e.entry)}
              />
            </span>
            <span className={`rarity r-${e.entry.rarity}`}>{e.entry.rarity[0]}</span> {e.entry.name}{' '}
            <span className="dex-card-id">({e.id})</span>
          </button>
        ))}
      </div>

      <div className="dex-admin-form">
        <h3>
          {t(locale, 'dexAdmin.editing')}
          {selected.id}
        </h3>

        {/* REQ-0038: locale switcher -- determines which language's
            name/flavor inputs are shown below. Never both at once. */}
        <div className="dex-admin-locale-switch" role="group" aria-label={t(locale, 'dexAdmin.localeSwitchLabel')}>
          <button
            type="button"
            className={`dex-admin-locale-btn${editLocale === 'en' ? ' dex-admin-locale-btn-active' : ''}`}
            onClick={() => setEditLocale('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={`dex-admin-locale-btn${editLocale === 'ja' ? ' dex-admin-locale-btn-active' : ''}`}
            onClick={() => setEditLocale('ja')}
          >
            JA
          </button>
        </div>

        {editLocale === 'en' ? (
          <>
            <label className="dex-admin-field">
              <span>{t(locale, 'dexAdmin.nameField')} (EN)</span>
              <input type="text" value={form.name} onChange={(e) => setField('name', e.target.value)} />
            </label>
            <label className="dex-admin-field">
              <span>{t(locale, 'dexAdmin.flavorField')} (EN)</span>
              <textarea value={form.flavor} onChange={(e) => setField('flavor', e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="dex-admin-field">
              <span>{t(locale, 'dexAdmin.nameField')} (JA)</span>
              <input type="text" value={form.i18nJaName} onChange={(e) => setField('i18nJaName', e.target.value)} />
            </label>
            <label className="dex-admin-field">
              <span>{t(locale, 'dexAdmin.flavorField')} (JA)</span>
              <textarea value={form.i18nJaFlavor} onChange={(e) => setField('i18nJaFlavor', e.target.value)} />
            </label>
          </>
        )}

        <label className="dex-admin-field">
          <span>{t(locale, 'dexAdmin.rarity')}</span>
          <select value={form.rarity} onChange={(e) => setField('rarity', e.target.value)}>
            {payload.vocab.rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {selectedIsPO ? (
          <div className="dex-admin-field">
            <span>
              {t(locale, 'dexAdmin.tags')} — <em>{t(locale, 'dexAdmin.tagsNote')}</em>
            </span>
            <div className="dex-admin-tag-editor">
              <label className="dex-admin-subfield">
                <span className="dex-tag-root-label">{t(locale, 'dexAdmin.tagsTypeFirst')}</span>
                <select
                  value={form.tags[0] || ''}
                  onChange={(e) => setField('tags', [e.target.value, ...form.tags.slice(1)])}
                >
                  <option value="">--</option>
                  {rootTagOptions.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dex-admin-subfield">
                <span>{t(locale, 'dexAdmin.tagsAdditional')}</span>
                <input
                  type="text"
                  value={form.tags.slice(1).join(', ')}
                  onChange={(e) =>
                    setField('tags', [
                      form.tags[0] || '',
                      ...e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ])
                  }
                />
              </label>
            </div>
          </div>
        ) : null}

        <div className="dex-admin-field">
          <div className="dex-admin-effect-header">
            <span>{t(locale, 'dexAdmin.effects')}</span>
            <button type="button" className="dex-admin-effect-add-btn" onClick={addEffect}>
              {t(locale, 'dexAdmin.effectAdd')}
            </button>
          </div>
          {form.effects.map((row, i) => (
            <div className="dex-admin-effect-row" key={i}>
              <label>
                <span>{t(locale, 'dexAdmin.trigger')}</span>
                <select value={row.triggerT} onChange={(e) => setEffectField(i, 'triggerT', e.target.value)}>
                  {payload.vocab.triggers.map((trig) => (
                    <option key={trig} value={trig}>
                      {trig}
                    </option>
                  ))}
                </select>
              </label>
              {row.triggerT === 'every_secs' ? (
                <>
                  <label>
                    <span>secs lo</span>
                    <input type="number" step="0.1" value={row.secsLo} onChange={(e) => setEffectField(i, 'secsLo', e.target.value)} />
                  </label>
                  <label>
                    <span>secs hi</span>
                    <input type="number" step="0.1" value={row.secsHi} onChange={(e) => setEffectField(i, 'secsHi', e.target.value)} />
                  </label>
                </>
              ) : null}
              <label>
                <span>{t(locale, 'dexAdmin.verb')}</span>
                <select value={row.verbT} onChange={(e) => setEffectField(i, 'verbT', e.target.value)}>
                  {payload.vocab.verbs.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>n lo</span>
                <input type="number" value={row.nLo} onChange={(e) => setEffectField(i, 'nLo', e.target.value)} />
              </label>
              <label>
                <span>n hi</span>
                <input type="number" value={row.nHi} onChange={(e) => setEffectField(i, 'nHi', e.target.value)} />
              </label>
              {['apply_status', 'add_on_hit_status', 'amp_status'].includes(row.verbT) ? (
                <label>
                  <span>status</span>
                  <select value={row.status} onChange={(e) => setEffectField(i, 'status', e.target.value)}>
                    <option value="">--</option>
                    {payload.vocab.statuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {row.verbT === 'amp_status' ? (
                <label>
                  <span>mult</span>
                  <input type="number" value={row.mult} onChange={(e) => setEffectField(i, 'mult', e.target.value)} />
                </label>
              ) : null}
              <button type="button" className="dex-admin-effect-delete-btn" onClick={() => deleteEffect(i)}>
                {t(locale, 'dexAdmin.effectDelete')}
              </button>
            </div>
          ))}
        </div>

        {selectedIsPO ? (
          <label className="dex-admin-field dex-admin-checkbox">
            <input type="checkbox" checked={form.stretch} onChange={(e) => setField('stretch', e.target.checked)} />
            <span>stretch</span>
          </label>
        ) : null}

        <div className="dex-admin-viewonly-note">{t(locale, 'dexAdmin.viewOnlyNote')}</div>

        <div className="dex-admin-actions">
          <button type="button" className="dex-admin-save-btn" onClick={() => void save()} disabled={saving}>
            {saving ? t(locale, 'dexAdmin.saving') : t(locale, 'dexAdmin.save')}
          </button>
          {saveOk ? <span className="dex-admin-save-ok">{t(locale, 'dexAdmin.saveOk')}</span> : null}
          {saveError ? <span className="dex-admin-save-error">{saveError}</span> : null}
        </div>
      </div>
    </div>
  );
}
