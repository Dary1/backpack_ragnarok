// Item Encyclopedia (図鑑) display view — REQ-0035. Read-only reference/
// wiki view: search + filters over a combined PO+SI item grid, each item
// expandable into a maximum-detail card. Admin edit mode (a SEPARATE
// view/layout per the spec, not overlaid here) lives in ./DexAdmin.tsx,
// reached via its own toggle rendered by DexRoot (see dex/DexRoot.tsx).
//
// Data source: GET /api/content directly (api.ts's fetchContent()), NOT
// the engine-normalized GameData the boards use -- the raw payload still
// carries fields the boards' normalization drops (e.g. `part`, the raw
// `effects` AST) that this reference view needs to show. This is a
// read-only view with its own independent fetch; it does not touch
// store.ts's engine/GameState at all.
import { useEffect, useMemo, useState } from 'react';
import { fetchContent, type ApiContentPayload, type ApiItemEntry, type ApiSIEntry } from '../api';
import type { Locale } from '../store';
import { iconDataUrl } from './dexIcons';
import { ancestryPath } from './vocabTree';
import { ItemDetailCard } from './ItemDetailCard';

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

interface DexProps {
  locale: Locale;
}

const RESERVED_TABS: Array<{ ja: string; en: string }> = [
  { ja: 'ソケットアイテム', en: 'Socket Items' },
  { ja: 'BP', en: 'BPs' },
  { ja: '検索プリセット', en: 'Search Presets' },
];

export function Dex({ locale }: DexProps) {
  const [payload, setPayload] = useState<ApiContentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchContent()
      .then((p) => {
        if (!cancelled) setPayload(p);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => (payload ? combineEntries(payload) : []), [payload]);

  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.entry.rarity);
    return Array.from(set).sort();
  }, [entries]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'po') {
        for (const t of (e.entry as ApiItemEntry).tags || []) set.add(t);
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

  if (error) {
    return (
      <div className="dex-view dex-error">
        {locale === 'ja' ? '図鑑の読み込みに失敗しました: ' : 'Failed to load the dex: '}
        {error}
      </div>
    );
  }
  if (!payload) {
    return <div className="dex-view dex-loading">{locale === 'ja' ? '読み込み中…' : 'Loading…'}</div>;
  }

  return (
    <div className="dex-view">
      <div className="dex-tab-row">
        <button type="button" className="dex-tab dex-tab-active">
          {locale === 'ja' ? 'アイテム' : 'Items'}
        </button>
        {RESERVED_TABS.map((t) => (
          <button key={t.en} type="button" className="dex-tab" disabled title={locale === 'ja' ? '今後対応予定' : 'reserved for later'}>
            {locale === 'ja' ? t.ja : t.en}
          </button>
        ))}
      </div>

      <div className="dex-controls">
        <input
          type="text"
          className="dex-search"
          placeholder={locale === 'ja' ? '名前またはIDで検索…' : 'Search by name or id…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="dex-filter" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)}>
          <option value="">{locale === 'ja' ? 'レアリティ: すべて' : 'Rarity: all'}</option>
          {rarities.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select className="dex-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">{locale === 'ja' ? 'タグ: すべて' : 'Tag: all'}</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
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
          const expanded = expandedId === e.id;
          return (
            <div key={e.id} className={`dex-card${expanded ? ' dex-card-expanded' : ''}`}>
              <button
                type="button"
                className="dex-card-summary"
                onClick={() => setExpandedId(expanded ? null : e.id)}
                aria-expanded={expanded}
              >
                {icon ? <img className="dex-icon" src={icon} alt={e.entry.icon} /> : <div className="dex-icon dex-icon-missing" />}
                <div className="dex-card-summary-text">
                  <div className="dex-card-name">{locale === 'ja' ? nameJaOf(e.entry) || nameOf(e.entry) : nameOf(e.entry)}</div>
                  <div className="dex-card-meta">
                    <span className={`rarity r-${e.entry.rarity}`}>{e.entry.rarity}</span>
                    <span className="dex-card-id">{e.id}</span>
                    <span className="dex-card-kind">{e.kind === 'po' ? 'PO' : 'SI'}</span>
                  </div>
                </div>
              </button>
              {expanded ? (
                <ItemDetailCard
                  dexEntry={e}
                  locale={locale}
                  tagTree={payload.trees.po}
                  registry={null}
                />
              ) : null}
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <div className="dex-empty">{locale === 'ja' ? '該当するアイテムがありません。' : 'No items match.'}</div>
        ) : null}
      </div>
    </div>
  );
}

export { ancestryPath };
