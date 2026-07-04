// Detail view layout — REQ-0038, restructured Dex feedback round 3 (fix
// 2). WIDE-screen layout is now three columns, per the task spec verbatim:
// "the ALL-ITEMS LIST on the FAR LEFT; the DETAIL PANEL sits to its
// right and is itself split into left/right blocks: 図解(diagram) LEFT |
// その他情報(all other info) RIGHT" -- i.e. [list | diagram | info] left
// to right. This replaces REQ-0038's original two-pane [diagram+fields |
// list] arrangement (list used to be on the right).
//
// NARROW/vertical (縦長) screens keep the layout REQ-0038 already had
// (list first, then diagram, then fields, stacked) via a responsive
// breakpoint -- see index.css's `.dex-detail-columns` media query
// (DEX_DETAIL_WIDE_BREAKPOINT_PX below documents the chosen width). The
// DOM order below is [list, diagram, info] so the CSS only needs to
// reorder columns on the WIDE side (three even flex columns) rather than
// on both sides -- the narrow/stacked fallback is then simply "let them
// wrap in source order" (list -> diagram -> info), matching what the
// pre-R3 narrow viewport already showed (list visible above/alongside
// the diagram+fields block, not hidden).
import type { ApiContentPayload, ApiItemEntry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t } from '../i18n';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { DexDiagram } from './DexDiagram';
import { iconDataUrl, iconDims } from './dexIcons';
import { ItemDetailCard } from './ItemDetailCard';
import { ShapeGrid } from './ShapeGrid';

interface DexDetailProps {
  entries: DexEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  locale: Locale;
  tagTree: ApiContentPayload['trees']['po'];
  registry: ApiContentPayload['registry'];
}

function shapeOf(entry: ApiItemEntry | ApiSIEntry): Cell[] {
  return ('shape' in entry && Array.isArray(entry.shape) ? entry.shape : []) as Cell[];
}

// REQ-0038 R2: mirrors ItemDef.stretch for the shared itemCard.ts fit math
// (see ShapeGrid.tsx) -- only POs carry this field.
function stretchOf(entry: ApiItemEntry | ApiSIEntry): boolean | undefined {
  return 'stretch' in entry ? entry.stretch : undefined;
}

// Small helper (used only by the item-list column's rows) -- reuses
// ShapeGrid at a small cellPx, same shape-mounted-icon rendering (fixed
// REQ-0038 R2 to span the full footprint via the shared itemCard.ts
// module) as the catalog grid and the edit-mode list, per the task spec's
// "reuse this shape-mounted rendering, smaller" instruction for list rows.
function ShapeMountedThumb({
  shape,
  iconUrl,
  iconAlt,
  iconId,
  stretch,
}: {
  shape: Cell[];
  iconUrl: string | null;
  iconAlt: string;
  iconId: string;
  stretch?: boolean;
}) {
  return (
    <ShapeGrid
      shape={shape}
      cellPx={16}
      iconUrl={iconUrl}
      iconAlt={iconAlt}
      iconDims={iconDims(iconId)}
      iconStretch={stretch}
    />
  );
}

export function DexDetail({ entries, selectedId, onSelect, onBack, locale, tagTree, registry }: DexDetailProps) {
  const selected = entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;

  return (
    <div className="dex-detail-columns">
      <div className="dex-detail-col-list">
        <ul className="dex-detail-item-list">
          {entries.map((e) => {
            const icon = iconDataUrl(e.entry.icon);
            const active = e.id === selected?.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={`dex-detail-item-list-row${active ? ' dex-detail-item-list-row-active' : ''}`}
                  onClick={() => onSelect(e.id)}
                >
                  <span className="dex-detail-item-list-shape">
                    <ShapeMountedThumb
                      shape={shapeOf(e.entry)}
                      iconUrl={icon}
                      iconAlt={e.entry.icon}
                      iconId={e.entry.icon}
                      stretch={stretchOf(e.entry)}
                    />
                  </span>
                  <span className="dex-detail-item-list-text">
                    <span className="dex-card-name">{locale === 'ja' ? e.entry.name_ja || e.entry.name : e.entry.name}</span>
                    <span className="dex-card-meta">
                      <span className={`rarity r-${e.entry.rarity}`}>{e.entry.rarity}</span>
                      <span className="dex-card-id">{e.id}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected ? (
        <>
          <div className="dex-detail-col-diagram">
            <button type="button" className="dex-detail-back-btn" onClick={onBack}>
              {t(locale, 'dex.backToList')}
            </button>
            <DexDiagram
              entry={selected.entry}
              shape={shapeOf(selected.entry)}
              iconUrl={iconDataUrl(selected.entry.icon)}
              iconDims={iconDims(selected.entry.icon)}
              iconStretch={stretchOf(selected.entry)}
              locale={locale}
            />
          </div>
          <div className="dex-detail-col-info">
            <ItemDetailCard dexEntry={selected} locale={locale} tagTree={tagTree} registry={registry} />
          </div>
        </>
      ) : (
        <div className="dex-detail-col-info">
          <button type="button" className="dex-detail-back-btn" onClick={onBack}>
            {t(locale, 'dex.backToList')}
          </button>
          <div className="dex-empty">{t(locale, 'dex.noMatch')}</div>
        </div>
      )}
    </div>
  );
}
