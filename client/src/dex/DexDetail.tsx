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
//
// REQ-0075 (MJOLNIR re-skin; mock: web/redesign/dex.html §詳解): the
// three columns are now ornate panels matching the mock's two-pane
// detail (the LIST is a slim index rail; DIAGRAM is the 図解/SCHEMA panel
// with a phead; INFO is the 銘と効果 panel). DOM order + every
// E2E-load-bearing selector are UNCHANGED (the wide-vs-stacked column
// order test reads bounding boxes, and the responsive breakpoint is kept
// at 1100px). `dexNos` is threaded through so the list rows and the info
// panel can show the mock's No.NNN chip from the honest dex numbering
// (see dexNo.ts).
import type { ApiContentPayload, ApiItemEntry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t } from '../i18n';
import { rarThemeClass } from '../render/uiBits';
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
  /** REQ-0075: honest 1-based dex numbers (dexNo.ts) for the No.NNN chips
   * shown in the list rows + the detail header. POs only; SIs absent. */
  dexNos: Record<string, number>;
}

function shapeOf(entry: ApiItemEntry | ApiSIEntry): Cell[] {
  const shape = ('shape' in entry && Array.isArray(entry.shape) ? entry.shape : []) as Cell[];
  // REQ-0096: SI/TM entries carry no `shape` (they don't occupy board
  // cells -- SI uses `slot`, TM is a stackable currency) but DO still
  // carry an icon. Without a fallback anchor cell here, ShapeGrid/
  // DexDiagram see an empty cell set and bail to their "--" empty-state
  // placeholder, so the icon never mounts (the catalog/detail/admin dex
  // views all showed a bare "--" for every SI card). Fall back to a
  // synthetic 1x1 anchor cell -- same precedent DexCardWindow.tsx already
  // uses (`card.shape ... : [[0, 0]]`).
  return shape.length > 0 ? shape : ([[0, 0]] as Cell[]);
}

// REQ-0038 R2: mirrors ItemDef.stretch for the shared itemCard.ts fit math
// (see ShapeGrid.tsx) -- only POs carry this field.
function stretchOf(entry: ApiItemEntry | ApiSIEntry): boolean | undefined {
  return 'stretch' in entry ? entry.stretch : undefined;
}
// REQ-0102: mirrors ItemDef.align (only POs carry it) for the shared fit math.
function alignOf(entry: ApiItemEntry | ApiSIEntry) {
  return 'align' in entry ? entry.align : undefined;
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
  align,
}: {
  shape: Cell[];
  iconUrl: string | null;
  iconAlt: string;
  iconId: string;
  stretch?: boolean;
  align?: { v?: 'top' | 'middle' | 'bottom'; h?: 'left' | 'center' | 'right' };
}) {
  return (
    <ShapeGrid
      shape={shape}
      cellPx={16}
      iconUrl={iconUrl}
      iconAlt={iconAlt}
      iconDims={iconDims(iconId)}
      iconStretch={stretch}
      iconAlign={align}
    />
  );
}

export function DexDetail({ entries, selectedId, onSelect, onBack, locale, tagTree, registry, dexNos }: DexDetailProps) {
  const selected = entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;
  const selectedNo = selected ? dexNos[selected.id] : undefined;
  const selectedName = selected
    ? locale === 'ja'
      ? selected.entry.name_ja || selected.entry.name
      : selected.entry.name
    : '';

  return (
    <>
      {/* REQ-0075: detail section head (mock 詳解 / SCHEMA & LORE colhead),
          carrying the current No.NNN ・ name on the right. */}
      <div className="dex-colhead dex-detail-colhead">
        <span className="dex-colhead-rn rune">ᛁ</span>
        <h2 className="dj dex-colhead-title">{t(locale, 'dex.detailTitle')}</h2>
        <span className="den dex-colhead-den">{t(locale, 'dex.detailDen')}</span>
        <span className="dex-colhead-grow" />
        {selected ? (
          <span className="t-micro tnum dex-detail-colhead-cur">
            {selectedNo != null ? `${t(locale, 'dex.noPrefix')}${String(selectedNo).padStart(3, '0')} ・ ` : ''}
            {selectedName}
          </span>
        ) : null}
      </div>

      <div className="dex-detail-columns">
        <div className="dex-detail-col-list panel ornate">
          <i className="k tl" />
          <i className="k tr" />
          <i className="k br" />
          <i className="k bl" />
          <ul className="dex-detail-item-list">
            {entries.map((e) => {
              const icon = iconDataUrl(e.entry.icon);
              const active = e.id === selected?.id;
              const no = dexNos[e.id];
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
                        align={alignOf(e.entry)}
                      />
                    </span>
                    <span className="dex-detail-item-list-text">
                      <span className="dex-card-name dname">{locale === 'ja' ? e.entry.name_ja || e.entry.name : e.entry.name}</span>
                      <span className="dex-card-meta">
                        {no != null ? <span className="dex-card-no t-micro tnum">{t(locale, 'dex.noPrefix')}{String(no).padStart(3, '0')}</span> : null}
                        <span className={`rar-word rarity r-${e.entry.rarity}`}>{e.entry.rarity.toUpperCase()}</span>
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
            <div className={`dex-detail-col-diagram panel ornate rar ${rarThemeClass(selected.entry.rarity)}`}>
              <i className="k tl" />
              <i className="k tr" />
              <i className="k br" />
              <i className="k bl" />
              <div className="dex-detail-phead">
                <button type="button" className="dex-detail-back-btn btn btn-ghost" onClick={onBack}>
                  {t(locale, 'dex.backToList')}
                </button>
                <span className="dj dex-detail-phead-title">{t(locale, 'dex.schemaTitle')}</span>
                <span className="den dex-detail-phead-den">{t(locale, 'dex.schemaDen')}</span>
              </div>
              <DexDiagram
                entry={selected.entry}
                shape={shapeOf(selected.entry)}
                iconUrl={iconDataUrl(selected.entry.icon)}
                iconDims={iconDims(selected.entry.icon)}
                iconStretch={stretchOf(selected.entry)}
                iconAlign={alignOf(selected.entry)}
                locale={locale}
              />
            </div>
            <div className={`dex-detail-col-info panel ornate rar ${rarThemeClass(selected.entry.rarity)}`}>
              <i className="k tl" />
              <i className="k tr" />
              <i className="k br" />
              <i className="k bl" />
              <ItemDetailCard dexEntry={selected} locale={locale} tagTree={tagTree} registry={registry} dexNo={selectedNo ?? null} />
            </div>
          </>
        ) : (
          <div className="dex-detail-col-info panel ornate">
            <i className="k tl" />
            <i className="k tr" />
            <i className="k br" />
            <i className="k bl" />
            <button type="button" className="dex-detail-back-btn btn btn-ghost" onClick={onBack}>
              {t(locale, 'dex.backToList')}
            </button>
            <div className="dex-empty">{t(locale, 'dex.noMatch')}</div>
          </div>
        )}
      </div>
    </>
  );
}
