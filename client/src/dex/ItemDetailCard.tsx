// Detail FIELDS card — REQ-0035, restructured REQ-0038 for the two-pane
// detail layout (DexDetail.tsx). Shows every non-diagram field the task
// spec lists: name JA+EN, id, rarity, tags with full ancestry, effects
// (rendered text AND collapsible raw AST), flavor JA+EN, part/assembly
// info, stretch flag, provenance (batch-level, see module comment in
// api.ts's ApiRegistry). Shape/Ports/Sockets moved OUT of this component
// in REQ-0038 -- they are now the two-pane detail view's LEFT-pane
// diagram (see DexDiagram.tsx), not a section here, per the task spec's
// "detail screen splits into two big panes: LEFT = diagram, RIGHT = item
// list" + "detail fields... go under/beside the diagram in the left
// pane". This component IS the "fields" half of that left pane.
import type { ApiItemEntry, ApiRegistry } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { ancestryPath, type TagTree } from './vocabTree';

interface ItemDetailCardProps {
  dexEntry: DexEntry;
  locale: Locale;
  tagTree: TagTree;
  registry: ApiRegistry | null;
}

function isPO(e: DexEntry): e is DexEntry & { entry: ApiItemEntry } {
  return e.kind === 'po';
}

/** Resolves batch-level provenance for `id` -- this repo's registry.json
 * schema has no per-item id list (see docs/REQ/REQ-0035-item-
 * encyclopedia.md), so today this always returns null (no resolvable
 * per-item mapping) unless/until the registry schema grows one. Written
 * as a real lookup (not a stub that always returns null) so it starts
 * working the moment such a mapping is added, with no Dex code change. */
function resolveProvenance(registry: ApiRegistry | null, _id: string) {
  if (!registry || !Array.isArray(registry.batches)) return null;
  for (const b of registry.batches) {
    if (Array.isArray((b as unknown as { item_ids?: string[] }).item_ids)) {
      const ids = (b as unknown as { item_ids?: string[] }).item_ids || [];
      if (ids.includes(_id)) return b;
    }
  }
  return null;
}

export function ItemDetailCard({ dexEntry, locale, tagTree, registry }: ItemDetailCardProps) {
  const { entry } = dexEntry;
  const po = isPO(dexEntry) ? (entry as ApiItemEntry) : null;
  const provenance = resolveProvenance(registry, dexEntry.id);

  return (
    <div className="dex-detail">
      <div className="dex-detail-row">
        <div className="dex-detail-field">
          <span className="dex-detail-label">EN</span> {entry.name}
        </div>
        <div className="dex-detail-field">
          <span className="dex-detail-label">JA</span> {entry.name_ja || '—'}
        </div>
        <div className="dex-detail-field">
          <span className="dex-detail-label">id</span> {dexEntry.id}
        </div>
        <div className="dex-detail-field">
          <span className="dex-detail-label">{t(locale, 'dex.detail.rarity')}</span>{' '}
          <span className={`rarity r-${entry.rarity}`}>{entry.rarity}</span>
        </div>
      </div>

      {po ? (
        <div className="dex-detail-section">
          <h4>{t(locale, 'dex.detail.tags')}</h4>
          <ul className="dex-tag-list">
            {(po.tags || []).map((tag, i) => (
              <li key={tag}>
                {i === 0 ? <span className="dex-tag-root-label">{t(locale, 'dex.detail.type')}</span> : null}
                {ancestryPath(tagTree, tag).join(' -> ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="dex-detail-section">
        <h4>{t(locale, 'dex.detail.effects')}</h4>
        <div className="dex-eff-text">
          <div>
            <span className="dex-detail-label">EN</span> {entry.eff_en || t(locale, 'dex.detail.effectsNone')}
          </div>
          <div>
            <span className="dex-detail-label">JA</span> {entry.eff_ja || t(locale, 'dex.detail.effectsNone')}
          </div>
        </div>
        {entry.effects && entry.effects.length > 0 ? (
          <details className="dex-raw-ast">
            <summary>{t(locale, 'dex.detail.rawAst')}</summary>
            <pre>{JSON.stringify(entry.effects, null, 2)}</pre>
          </details>
        ) : null}
      </div>

      <div className="dex-detail-section">
        <h4>{t(locale, 'dex.detail.flavor')}</h4>
        <div className="dex-flavor">
          <div>
            <span className="dex-detail-label">EN</span> {entry.flavor || '—'}
          </div>
          <div>
            <span className="dex-detail-label">JA</span> {entry.flavor_ja || '—'}
          </div>
        </div>
      </div>

      {po?.part ? (
        <div className="dex-detail-section">
          <h4>{t(locale, 'dex.detail.part')}</h4>
          <div>
            {t(locale, 'dex.detail.assemblesInto')}: <strong>{po.part.assembles}</strong>{' '}
            ({t(locale, 'dex.detail.role')}: {po.part.role})
          </div>
        </div>
      ) : null}

      {po?.stretch ? (
        <div className="dex-detail-section">
          <h4>stretch</h4>
          <div>{t(locale, 'dex.detail.stretchNote')}</div>
        </div>
      ) : null}

      <div className="dex-detail-section">
        <h4>{t(locale, 'dex.detail.provenance')}</h4>
        {provenance ? (
          <div className="dex-provenance">
            <div>batch: {provenance.id}</div>
            {provenance.date ? <div>date: {provenance.date}</div> : null}
            {provenance.drafted_by ? <div>drafted_by: {provenance.drafted_by}</div> : null}
            {provenance.icons_by ? <div>icons_by: {provenance.icons_by}</div> : null}
            {provenance.status ? <div>status: {provenance.status}</div> : null}
          </div>
        ) : (
          <div className="dex-provenance-unresolved">{t(locale, 'dex.detail.provenanceUnresolved')}</div>
        )}
      </div>
    </div>
  );
}
