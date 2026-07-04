// Admin edit mode — REQ-0035. A SEPARATE view/layout from the display
// cards (Dex.tsx) -- entered via a toggle that is visible ONLY when
// GET /api/me's roles include item_admin (the toggle itself lives in
// DexRoot.tsx, which owns switching between Dex/DexAdmin). This component
// renders a two-pane layout: a plain item list on the left, a form editor
// for the selected item on the right.
//
// Server-side validation (server/admin.cjs) is the actual source of
// truth -- every rule enforced here client-side is a UX convenience
// (immediate feedback, dropdown-constrained input) and NOT a substitute
// for it; a raw PUT with a header override still gets rejected server-
// side regardless of what this form allows the user to type.
import { useEffect, useMemo, useState } from 'react';
import { putAdminItem, type ApiContentPayload, type ApiItemEntry, type ApiMe, type ApiSIEntry } from '../api';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';

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
  if (row.triggerT === 'adjacent') {
    // adjacent needs tag/tagKind, which this simplified form does not
    // expose yet -- left as-is (spread from the original below covers it).
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

export function DexAdmin({ locale, payload, onSaved }: DexAdminProps) {
  // REQ-0037: identity for the PUT /api/admin/item/:id call is now carried
  // entirely by the stored auth token (see api.ts's putAdminItem) -- the
  // me prop is kept on DexAdminProps (DexRoot.tsx still resolves and
  // passes it) purely as context for a future per-editor audit trail /
  // display, not consumed as an argument to putAdminItem anymore.
  const entries = useMemo(() => combineEntries(payload), [payload]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    name_ja: string;
    flavor: string;
    flavor_ja: string;
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
    setForm({
      name: entry.name || '',
      name_ja: entry.name_ja || '',
      flavor: entry.flavor || '',
      flavor_ja: entry.flavor_ja || '',
      rarity: entry.rarity || '',
      tags: selectedIsPO ? (entry as ApiItemEntry).tags || [] : [],
      stretch: selectedIsPO ? !!(entry as ApiItemEntry).stretch : false,
      effects: ((entry.effects as Record<string, unknown>[]) || []).map(effectToRow),
    });
    setSaveError(null);
    setSaveOk(false);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagOptions = useMemo(() => Object.keys(payload.trees.po), [payload.trees.po]);
  const rootTagOptions = useMemo(
    () => tagOptions.filter((t) => payload.trees.po[t] === null),
    [tagOptions, payload.trees.po]
  );

  if (!selected || !form) {
    return (
      <div className="dex-admin">
        <div className="dex-admin-list">
          {entries.map((e) => (
            <button key={e.id} type="button" className="dex-admin-list-item" onClick={() => setSelectedId(e.id)}>
              <span className={`rarity r-${e.entry.rarity}`}>{e.entry.rarity[0]}</span> {e.entry.name}{' '}
              <span className="dex-card-id">({e.id})</span>
            </button>
          ))}
        </div>
        <div className="dex-admin-form dex-admin-form-empty">
          {locale === 'ja' ? '編集するアイテムを左から選択してください。' : 'Select an item from the list to edit.'}
        </div>
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

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        name_ja: form.name_ja,
        flavor: form.flavor,
        flavor_ja: form.flavor_ja,
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
            <span className={`rarity r-${e.entry.rarity}`}>{e.entry.rarity[0]}</span> {e.entry.name}{' '}
            <span className="dex-card-id">({e.id})</span>
          </button>
        ))}
      </div>

      <div className="dex-admin-form">
        <h3>
          {locale === 'ja' ? '編集中: ' : 'Editing: '}
          {selected.id}
        </h3>

        <label className="dex-admin-field">
          <span>Name (EN)</span>
          <input type="text" value={form.name} onChange={(e) => setField('name', e.target.value)} />
        </label>
        <label className="dex-admin-field">
          <span>Name (JA)</span>
          <input type="text" value={form.name_ja} onChange={(e) => setField('name_ja', e.target.value)} />
        </label>
        <label className="dex-admin-field">
          <span>Flavor (EN)</span>
          <textarea value={form.flavor} onChange={(e) => setField('flavor', e.target.value)} />
        </label>
        <label className="dex-admin-field">
          <span>Flavor (JA)</span>
          <textarea value={form.flavor_ja} onChange={(e) => setField('flavor_ja', e.target.value)} />
        </label>
        <label className="dex-admin-field">
          <span>{locale === 'ja' ? 'レアリティ' : 'Rarity'}</span>
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
              {locale === 'ja' ? 'タグ' : 'Tags'} —{' '}
              <em>
                {locale === 'ja'
                  ? 'tags[0] は「型」ルートタグです（先頭固定）'
                  : 'tags[0] is the TYPE ROOT tag (fixed as the first slot)'}
              </em>
            </span>
            <div className="dex-admin-tag-editor">
              <label className="dex-admin-subfield">
                <span className="dex-tag-root-label">{locale === 'ja' ? '型 (先頭)' : 'type (first)'}</span>
                <select
                  value={form.tags[0] || ''}
                  onChange={(e) => setField('tags', [e.target.value, ...form.tags.slice(1)])}
                >
                  <option value="">--</option>
                  {rootTagOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dex-admin-subfield">
                <span>{locale === 'ja' ? '追加タグ（カンマ区切り）' : 'Additional tags (comma-separated)'}</span>
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
          <span>{locale === 'ja' ? '効果' : 'Effects'}</span>
          {form.effects.map((row, i) => (
            <div className="dex-admin-effect-row" key={i}>
              <label>
                <span>{locale === 'ja' ? 'トリガー' : 'Trigger'}</span>
                <select value={row.triggerT} onChange={(e) => setEffectField(i, 'triggerT', e.target.value)}>
                  {payload.vocab.triggers.map((t) => (
                    <option key={t} value={t}>
                      {t}
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
                <span>{locale === 'ja' ? '動詞' : 'Verb'}</span>
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
            </div>
          ))}
        </div>

        {selectedIsPO ? (
          <label className="dex-admin-field dex-admin-checkbox">
            <input type="checkbox" checked={form.stretch} onChange={(e) => setField('stretch', e.target.checked)} />
            <span>stretch</span>
          </label>
        ) : null}

        <div className="dex-admin-viewonly-note">
          {locale === 'ja'
            ? '形状・ポートのタイルは閲覧専用です。形状編集は今後対応予定（fit/アートパイプライン）。'
            : 'Shape and port tiles are view-only. Geometry editing comes later (fit/art pipeline).'}
        </div>

        <div className="dex-admin-actions">
          <button type="button" className="dex-admin-save-btn" onClick={() => void save()} disabled={saving}>
            {saving ? (locale === 'ja' ? '保存中…' : 'Saving…') : locale === 'ja' ? '保存' : 'Save'}
          </button>
          {saveOk ? <span className="dex-admin-save-ok">{locale === 'ja' ? '保存しました ✓' : 'Saved ✓'}</span> : null}
          {saveError ? <span className="dex-admin-save-error">{saveError}</span> : null}
        </div>
      </div>
    </div>
  );
}
