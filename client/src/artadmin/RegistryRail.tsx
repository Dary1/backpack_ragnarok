// client/src/artadmin/RegistryRail.tsx -- REQ-0156. The left registry
// browser: search (system_name + main_object substring), kind filter chips
// with counts, adoption filter, collapsible batch-prefix groups for the
// backfilled `prefix:name` entries, and rows with a lazy thumbnail
// (adopted -> public /api/art/<name>; else the latest ok candidate; else a
// placeholder). Keeps the REQ-0151 e2e testids: art-list (container) and
// art-select-<system_name> (row buttons).
import { useState } from 'react';
import type { ArtworkDto } from '../api';
import { artAdoptedUrl, artRenderUrl } from '../api';
import { KINDS, batchPrefix } from './artShared';
import type { Kind } from './artShared';

type AdoptionFilter = 'all' | 'adopted' | 'unadopted';

function thumbUrl(a: ArtworkDto): string | null {
  if (a.adopted_render_id != null) {
    // ?v= busts the browser cache when the adopted seed switches
    return artAdoptedUrl(a.system_name) + '?v=' + (a.adopted_seed != null ? a.adopted_seed : 'a');
  }
  if (a.latest_ok_seed != null) return artRenderUrl(a.system_name, a.latest_ok_seed);
  return null;
}

function Row({ a, selected, onSelect }: { a: ArtworkDto; selected: boolean; onSelect: (name: string) => void }) {
  const url = thumbUrl(a);
  const prefix = batchPrefix(a.system_name);
  const label = prefix ? a.system_name.slice(prefix.length + 1) : a.system_name;
  return (
    <button type="button" data-testid={'art-select-' + a.system_name}
      className={'aa-row' + (selected ? ' is-selected' : '')}
      onClick={() => onSelect(a.system_name)}>
      <span className="aa-thumb">
        {url ? <img src={url} alt="" loading="lazy" /> : <span className="aa-thumb-ph">?</span>}
      </span>
      <span className="aa-row-main">
        <span className="aa-row-name" title={a.system_name}>{label}</span>
        <span className="aa-row-sub t-micro tnum">
          <span className={'aa-kind aa-kind--' + a.kind}>{a.kind}</span>
          {' '}{a.gen_width}x{a.gen_height}{' '}&middot;{' '}{a.render_count != null ? a.render_count : 0}r
          {a.failed_count ? <span className="aa-failcount"> ({a.failed_count} failed)</span> : null}
        </span>
      </span>
      {a.adopted_render_id != null
        ? <span className="aa-adopt-badge tnum" title={'adopted seed ' + a.adopted_seed}>s{a.adopted_seed != null ? a.adopted_seed : '?'}</span>
        : null}
    </button>
  );
}

export function RegistryRail({ artworks, selected, onSelect, onNew }: {
  artworks: ArtworkDto[]; selected: string | null;
  onSelect: (name: string) => void; onNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [adoption, setAdoption] = useState<AdoptionFilter>('all');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const q = query.trim().toLowerCase();
  const searched = artworks.filter((a) =>
    (!q || a.system_name.toLowerCase().includes(q) || (a.main_object || '').toLowerCase().includes(q))
    && (adoption === 'all' || (adoption === 'adopted') === (a.adopted_render_id != null)));
  const counts: Record<string, number> = {};
  for (const a of searched) counts[a.kind] = (counts[a.kind] || 0) + 1;
  const visible = searched.filter((a) => kindFilter === 'all' || a.kind === kindFilter);

  const plain: ArtworkDto[] = [];
  const groups = new Map<string, ArtworkDto[]>();
  for (const a of visible) {
    const p = batchPrefix(a.system_name);
    if (!p) { plain.push(a); continue; }
    const arr = groups.get(p) || [];
    arr.push(a);
    groups.set(p, arr);
  }

  return (
    <aside className="aa-rail panel">
      <div className="aa-rail-head">
        <span className="den t-label gold-text">Registry</span>
        <button type="button" data-testid="art-new" className="btn aa-btn-sm" onClick={onNew}>+ New artwork</button>
      </div>
      <input data-testid="art-search" className="aa-input aa-search" type="search"
        placeholder="search name / main object" value={query}
        onChange={(e) => setQuery(e.target.value)} />
      <div className="aa-filters">
        <button type="button" data-testid="art-filter-kind-all"
          className={'chip aa-chipbtn' + (kindFilter === 'all' ? ' is-on' : '')}
          onClick={() => setKindFilter('all')}>all {searched.length}</button>
        {KINDS.map((k) => (
          <button key={k} type="button" data-testid={'art-filter-kind-' + k}
            className={'chip aa-chipbtn' + (kindFilter === k ? ' is-on' : '')}
            onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}>{k} {counts[k] || 0}</button>
        ))}
      </div>
      <div className="aa-filters">
        {(['all', 'adopted', 'unadopted'] as AdoptionFilter[]).map((f) => (
          <button key={f} type="button" data-testid={'art-filter-adoption-' + f}
            className={'chip aa-chipbtn' + (adoption === f ? ' is-on' : '')}
            onClick={() => setAdoption(f)}>{f}</button>
        ))}
      </div>
      <div data-testid="art-list" className="aa-list">
        {plain.map((a) => <Row key={a.system_name} a={a} selected={selected === a.system_name} onSelect={onSelect} />)}
        {[...groups.entries()].map(([prefix, rows]) => {
          // groups auto-open while a search narrows the list
          const open = q !== '' || !!openGroups[prefix];
          return (
            <div key={prefix} className="aa-group">
              <button type="button" data-testid={'art-group-' + prefix} className="aa-group-head t-micro"
                onClick={() => setOpenGroups((s) => ({ ...s, [prefix]: !open }))}>
                <span className="aa-group-arrow">{open ? '▾' : '▸'}</span> {prefix} ({rows.length})
              </button>
              {open && rows.map((a) => <Row key={a.system_name} a={a} selected={selected === a.system_name} onSelect={onSelect} />)}
            </div>
          );
        })}
        {visible.length === 0 && <div className="aa-empty t-micro">no artworks match</div>}
      </div>
    </aside>
  );
}
