// client/src/contentadmin/DefRail.tsx -- REQ-0157. The left def browser:
// search (system_name + brief substring), kind filter chips with counts,
// adoption filter, and rows carrying the REQ-0157 list aggregates: kind
// chip, adopted-variant badge ("v3 *"), variant count, FAIL-check warning
// dot, artwork-facet glyph linking to #/artadmin. Keeps the REQ-0155 e2e
// testids: cd-list (container) and cd-select-<system_name> (row buttons).
import { useState } from 'react';
import type { ContentDefDto } from '../api';
import { KINDS } from './contentShared';
import type { Kind } from './contentShared';

type AdoptionFilter = 'all' | 'adopted' | 'unadopted';

function Row({ d, selected, onSelect }: { d: ContentDefDto; selected: boolean; onSelect: (name: string) => void }) {
  return (
    <div className="ca-rowwrap">
      <button type="button" data-testid={'cd-select-' + d.system_name}
        className={'aa-row' + (selected ? ' is-selected' : '')}
        onClick={() => onSelect(d.system_name)}>
        <span className="aa-row-main">
          <span className="aa-row-name" title={d.system_name}>{d.system_name}</span>
          <span className="aa-row-sub t-micro tnum">
            <span className={'aa-kind ca-kind--' + d.kind}>{d.kind}</span>
            {' '}{d.variant_count != null ? d.variant_count : 0}v
            {d.failed_check_count
              ? <span className="ca-faildot" data-testid={'cd-faildot-' + d.system_name}
                  title={d.failed_check_count + ' variant(s) with FAILED machine checks'} />
              : null}
          </span>
        </span>
        {d.adopted_variant_id != null
          ? <span className="aa-adopt-badge tnum" data-testid={'cd-adopted-badge-' + d.system_name}
              title={'adopted variant ' + (d.adopted_variant_no != null ? d.adopted_variant_no : '?')}>
              v{d.adopted_variant_no != null ? d.adopted_variant_no : '?'} &#9733;</span>
          : null}
      </button>
      {d.has_artwork_facet
        ? <a className="ca-facet-link" data-testid={'cd-facet-' + d.system_name} href="#/artadmin"
            title={d.system_name + ' has an artwork facet -- open Art Admin'}>&#9670;</a>
        : null}
    </div>
  );
}

export function DefRail({ defs, selected, onSelect, onNew }: {
  defs: ContentDefDto[]; selected: string | null;
  onSelect: (name: string) => void; onNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all');
  const [adoption, setAdoption] = useState<AdoptionFilter>('all');

  const q = query.trim().toLowerCase();
  const searched = defs.filter((d) =>
    (!q || d.system_name.toLowerCase().includes(q) || (d.brief || '').toLowerCase().includes(q))
    && (adoption === 'all' || (adoption === 'adopted') === (d.adopted_variant_id != null)));
  const counts: Record<string, number> = {};
  for (const d of searched) counts[d.kind] = (counts[d.kind] || 0) + 1;
  const visible = searched.filter((d) => kindFilter === 'all' || d.kind === kindFilter);

  return (
    <aside className="aa-rail panel">
      <div className="aa-rail-head">
        <span className="den t-label gold-text">Content defs</span>
        <button type="button" data-testid="cd-new" className="btn aa-btn-sm" onClick={onNew}>+ New content</button>
      </div>
      <input data-testid="cd-search" className="aa-input aa-search" type="search"
        placeholder="search name / brief" value={query}
        onChange={(e) => setQuery(e.target.value)} />
      <div className="aa-filters">
        <button type="button" data-testid="cd-filter-kind-all"
          className={'chip aa-chipbtn' + (kindFilter === 'all' ? ' is-on' : '')}
          onClick={() => setKindFilter('all')}>all {searched.length}</button>
        {KINDS.map((k) => (
          <button key={k} type="button" data-testid={'cd-filter-kind-' + k}
            className={'chip aa-chipbtn' + (kindFilter === k ? ' is-on' : '')}
            onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}>{k} {counts[k] || 0}</button>
        ))}
      </div>
      <div className="aa-filters">
        {(['all', 'adopted', 'unadopted'] as AdoptionFilter[]).map((f) => (
          <button key={f} type="button" data-testid={'cd-filter-adoption-' + f}
            className={'chip aa-chipbtn' + (adoption === f ? ' is-on' : '')}
            onClick={() => setAdoption(f)}>{f}</button>
        ))}
      </div>
      <div data-testid="cd-list" className="aa-list">
        {visible.map((d) => <Row key={d.system_name} d={d} selected={selected === d.system_name} onSelect={onSelect} />)}
        {visible.length === 0 && <div className="aa-empty t-micro">no content defs match</div>}
      </div>
    </aside>
  );
}
