// Two-pane detail view — REQ-0038. LEFT (large) = diagram + detail
// fields; RIGHT = the item list (moved here from Dex.tsx's old inline-
// expansion layout). Selecting an item in the right-side list updates
// the left diagram + detail fields, per the task spec verbatim: "Detail
// screen splits into two big panes: LEFT (large) = the diagram; RIGHT =
// the item list... Selecting an item in the right-side list updates the
// left diagram + detail fields."
//
// This is a SEPARATE mode from the catalog grid (Dex.tsx renders THIS
// component instead of the catalog once an item is selected -- see
// Dex.tsx's `selectedId` state) -- not an inline expansion under a card
// anymore (REQ-0035's old behavior).
import type { ApiContentPayload, ApiItemEntry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t } from '../i18n';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { DexDiagram } from './DexDiagram';
import { iconDataUrl } from './dexIcons';
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

// Small helper (used only by the right-pane list rows) -- reuses
// ShapeGrid at a small cellPx, same shape-mounted-icon rendering as the
// catalog grid and the edit-mode list, per the task spec's "reuse this
// shape-mounted rendering, smaller" instruction for list rows.
function ShapeMountedThumb({ shape, iconUrl, iconAlt }: { shape: Cell[]; iconUrl: string | null; iconAlt: string }) {
  return <ShapeGrid shape={shape} cellPx={16} iconUrl={iconUrl} iconAlt={iconAlt} />;
}

export function DexDetail({ entries, selectedId, onSelect, onBack, locale, tagTree, registry }: DexDetailProps) {
  const selected = entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;

  return (
    <div className="dex-detail-two-pane">
      <div className="dex-detail-pane-left">
        <button type="button" className="dex-detail-back-btn" onClick={onBack}>
          {t(locale, 'dex.backToList')}
        </button>
        {selected ? (
          <>
            <DexDiagram
              entry={selected.entry}
              shape={shapeOf(selected.entry)}
              iconUrl={iconDataUrl(selected.entry.icon)}
              locale={locale}
            />
            <ItemDetailCard dexEntry={selected} locale={locale} tagTree={tagTree} registry={registry} />
          </>
        ) : (
          <div className="dex-empty">{t(locale, 'dex.noMatch')}</div>
        )}
      </div>
      <div className="dex-detail-pane-right">
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
                    <ShapeMountedThumb shape={shapeOf(e.entry)} iconUrl={icon} iconAlt={e.entry.icon} />
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
    </div>
  );
}
