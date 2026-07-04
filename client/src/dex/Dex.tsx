// Item Encyclopedia (図鑑) display view — REQ-0035, rebuilt REQ-0038 for
// Dex v2. Read-only reference/wiki view: search + filters over a combined
// PO+SI item grid. Two REQ-0038 changes from the original REQ-0035
// layout:
//   1. Catalog cards render each item ON its cell shape (a mini shape
//      grid with the icon mounted on the anchor cell -- ShapeGrid.tsx,
//      reused, DOM-based per dexIcons.ts's module comment), not as a
//      bare <img> icon.
//   2. Selecting a card no longer expands it inline -- it switches the
//      WHOLE view into the two-pane detail layout (DexDetail.tsx: large
//      diagram left, item list right), a distinct mode from the catalog
//      grid, per the task spec's "Detail screen splits into two big
//      panes" (not an inline-expansion overlay on the catalog anymore).
//
// Admin edit mode (a SEPARATE view/layout per the spec, not overlaid
// here) lives in ./DexAdmin.tsx; both are reached through ./DexRoot.tsx,
// which owns the /api/content + /api/me fetches and the view/edit toggle.
//
// Data source: the `payload` prop is the raw GET /api/content response
// (api.ts's ApiContentPayload), NOT the engine-normalized GameData the
// boards use -- the raw payload still carries fields the boards'
// normalization drops (e.g. `part`, the raw `effects` AST) that this
// reference view needs to show. This is a read-only view; it does not
// touch store.ts's engine/GameState at all.
import { useMemo, useState } from 'react';
import type { ApiContentPayload, ApiItemEntry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t, type TranslationKey } from '../i18n';
import type { Locale } from '../store';
import { DexDetail } from './DexDetail';
import { iconDataUrl, iconDims } from './dexIcons';
import { ShapeGrid } from './ShapeGrid';

export interface DexEntry {
  id: string;
  kind: 'po' | 'si';
  entry: ApiItemEntry | ApiSIEntry;
}

function combineEntries(payload: ApiContentPayload): DexEntry[] {
  const pos: DexEntry[] = Object.values(payload.items).map((entry) => ({ id: entry.id, kind: 'po', entry }));
  const sis: DexEntry[] = Object.values(payload.sis).map((entry) => ({ id: entry.id, kind: 'si', entry }));
  return [...pos, ...sis];
}

function nameOf(e: ApiItemEntry | ApiSIEntry): string {
  return e.name || '';
}
function nameJaOf(e: ApiItemEntry | ApiSIEntry): string {
  return e.name_ja || '';
}
function shapeOf(e: ApiItemEntry | ApiSIEntry): Cell[] {
  return ('shape' in e && Array.isArray(e.shape) ? e.shape : []) as Cell[];
}
// REQ-0038 R2: mirrors ItemDef.stretch for the shared itemCard.ts fit math
// (see ShapeGrid.tsx) -- only POs carry this field; SIs have no shape at
// all so it's moot for them.
function stretchOf(e: ApiItemEntry | ApiSIEntry): boolean | undefined {
  return 'stretch' in e ? e.stretch : undefined;
}

interface DexProps {
  locale: Locale;
  payload: ApiContentPayload;
}

const RESERVED_TABS: TranslationKey[] = ['dex.tabSocketItems', 'dex.tabBps', 'dex.tabSearchPresets'];

export function Dex({ locale, payload }: DexProps) {
  const [query, setQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(() => combineEntries(payload), [payload]);

  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.entry.rarity);
    return Array.from(set).sort();
  }, [entries]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'po') {
        for (const tag of (e.entry as ApiItemEntry).tags || []) set.add(tag);
      }
    }
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (rarityFilter && e.entry.rarity !== rarityFilter) return false;
      if (tagFilter) {
        if (e.kind !== 'po') return false;
        if (!(e.entry as ApiItemEntry).tags?.includes(tagFilter)) return false;
      }
      if (q) {
        const hay = [e.id, nameOf(e.entry), nameJaOf(e.entry)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, query, rarityFilter, tagFilter]);

  // REQ-0038: selecting a card switches the whole view into the two-pane
  // detail layout -- the list shown there is `filtered` (so the current
  // search/filter selection carries over into the detail right-pane
  // list), not the full unfiltered `entries`.
  if (selectedId) {
    return (
      <div className="dex-view">
        <DexDetail
          entries={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onBack={() => setSelectedId(null)}
          locale={locale}
          tagTree={payload.trees.po}
          registry={payload.registry}
        />
      </div>
    );
  }

  return (
    <div className="dex-view">
      <div className="dex-tab-row">
        <button type="button" className="dex-tab dex-tab-active">
          {t(locale, 'dex.tabItems')}
        </button>
        {RESERVED_TABS.map((key) => (
          <button key={key} type="button" className="dex-tab" disabled title={t(locale, 'dex.reservedTitle')}>
            {t(locale, key)}
          </button>
        ))}
      </div>

      <div className="dex-controls">
        <input
          type="text"
          className="dex-search"
          placeholder={t(locale, 'dex.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="dex-filter" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)}>
          <option value="">{t(locale, 'dex.rarityAll')}</option>
          {rarities.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select className="dex-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">{t(locale, 'dex.tagAll')}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <span className="dex-count">
          {filtered.length} / {entries.length}
        </span>
      </div>

      <div className="dex-grid">
        {filtered.map((e) => {
          const icon = iconDataUrl(e.entry.icon);
          return (
            <div key={e.id} className="dex-card">
              <button
                type="button"
                className="dex-card-summary"
                onClick={() => setSelectedId(e.id)}
              >
                <span className="dex-card-shape">
                  <ShapeGrid
                    shape={shapeOf(e.entry)}
                    cellPx={20}
                    iconUrl={icon}
                    iconAlt={e.entry.icon}
                    iconDims={iconDims(e.entry.icon)}
                    iconStretch={stretchOf(e.entry)}
                  />
                </span>
                <div className="dex-card-summary-text">
                  <div className="dex-card-name">{locale === 'ja' ? nameJaOf(e.entry) || nameOf(e.entry) : nameOf(e.entry)}</div>
                  <div className="dex-card-meta">
                    <span className={`rarity r-${e.entry.rarity}`}>{e.entry.rarity}</span>
                    <span className="dex-card-id">{e.id}</span>
                    <span className="dex-card-kind">{e.kind === 'po' ? 'PO' : 'SI'}</span>
                  </div>
                </div>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 ? <div className="dex-empty">{t(locale, 'dex.noMatch')}</div> : null}
      </div>
    </div>
  );
}
