// Maximum-detail item card — REQ-0035. Expanded inline below a Dex grid
// card's summary row. Shows every field the task spec lists: icon (shown
// already in the summary row, not repeated here), name JA+EN, id, rarity,
// tags with full ancestry, shape mini-grid, ports (tile mini-grid overlay
// + tag chip), sockets (type/tags/anchor), effects (rendered text AND
// collapsible raw AST), flavor JA+EN, part/assembly info, stretch flag,
// provenance (batch-level, see module comment in api.ts's ApiRegistry).
import type { ApiItemEntry, ApiRegistry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { ShapeGrid } from './ShapeGrid';
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
  const si = !isPO(dexEntry) ? (entry as ApiSIEntry) : null;
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
          <span className="dex-detail-label">{locale === 'ja' ? 'レアリティ' : 'rarity'}</span>{' '}
          <span className={`rarity r-${entry.rarity}`}>{entry.rarity}</span>
        </div>
      </div>

      {po ? (
        <div className="dex-detail-section">
          <h4>{locale === 'ja' ? 'タグ（階層）' : 'Tags (hierarchy)'}</h4>
          <ul className="dex-tag-list">
            {(po.tags || []).map((t, i) => (
              <li key={t}>
                {i === 0 ? <span className="dex-tag-root-label">{locale === 'ja' ? '型' : 'type'}</span> : null}
                {ancestryPath(tagTree, t).join(' -> ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {po ? (
        <div className="dex-detail-section">
          <h4>{locale === 'ja' ? '形状' : 'Shape'}</h4>
          <ShapeGrid shape={po.shape as Cell[]} />
        </div>
      ) : null}

      {(po?.ports || si?.ports) && (po?.ports || si?.ports)!.length > 0 ? (
        <div className="dex-detail-section">
          <h4>{locale === 'ja' ? 'ポート' : 'Ports'}</h4>
          {(po?.ports || si?.ports)!.map((port, i) => (
            <div className="dex-port-row" key={i}>
              <ShapeGrid shape={(po?.shape as Cell[]) ?? []} portTiles={port.tiles as Cell[]} cellPx={14} />
              <span className="dex-tag-chip">{port.tag}</span>
            </div>
          ))}
        </div>
      ) : null}

      {po?.sockets && po.sockets.length > 0 ? (
        <div className="dex-detail-section">
          <h4>{locale === 'ja' ? 'ソケット' : 'Sockets'}</h4>
          <ul className="dex-socket-list">
            {po.sockets.map((s, i) => (
              <li key={i}>
                <span className="dex-tag-chip">{s.t}</span>{' '}
                {(s.tags || []).map((t) => (
                  <span className="dex-tag-chip dex-tag-chip-dim" key={t}>
                    {t}
                  </span>
                ))}{' '}
                <span className="dex-socket-anchor">
                  ax={s.ax ?? '—'} ay={s.ay ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="dex-detail-section">
        <h4>{locale === 'ja' ? '効果' : 'Effects'}</h4>
        <div className="dex-eff-text">
          <div>
            <span className="dex-detail-label">EN</span> {entry.eff_en || (locale === 'ja' ? '（なし）' : '(none)')}
          </div>
          <div>
            <span className="dex-detail-label">JA</span> {entry.eff_ja || '（なし）'}
          </div>
        </div>
        {entry.effects && entry.effects.length > 0 ? (
          <details className="dex-raw-ast">
            <summary>{locale === 'ja' ? '生のAST（JSON）' : 'Raw AST (JSON)'}</summary>
            <pre>{JSON.stringify(entry.effects, null, 2)}</pre>
          </details>
        ) : null}
      </div>

      <div className="dex-detail-section">
        <h4>{locale === 'ja' ? 'フレーバーテキスト' : 'Flavor text'}</h4>
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
          <h4>{locale === 'ja' ? 'パーツ／組み立て' : 'Part / assembly'}</h4>
          <div>
            {locale === 'ja' ? '組み立て先' : 'assembles into'}: <strong>{po.part.assembles}</strong>{' '}
            ({locale === 'ja' ? '役割' : 'role'}: {po.part.role})
          </div>
        </div>
      ) : null}

      {po?.stretch ? (
        <div className="dex-detail-section">
          <h4>stretch</h4>
          <div>{locale === 'ja' ? 'このアイテムはstretchフラグを持ちます。' : 'This item carries the stretch flag.'}</div>
        </div>
      ) : null}

      <div className="dex-detail-section">
        <h4>{locale === 'ja' ? '来歴（provenance）' : 'Provenance'}</h4>
        {provenance ? (
          <div className="dex-provenance">
            <div>batch: {provenance.id}</div>
            {provenance.date ? <div>date: {provenance.date}</div> : null}
            {provenance.drafted_by ? <div>drafted_by: {provenance.drafted_by}</div> : null}
            {provenance.icons_by ? <div>icons_by: {provenance.icons_by}</div> : null}
            {provenance.status ? <div>status: {provenance.status}</div> : null}
          </div>
        ) : (
          <div className="dex-provenance-unresolved">
            {locale === 'ja'
              ? 'このアイテムに対応する来歴情報は見つかりませんでした（registry.jsonにアイテム単位の対応表がまだありません）。'
              : 'No per-item provenance mapping available yet (content/registry.json has no item-id list per batch today).'}
          </div>
        )}
      </div>
    </div>
  );
}
