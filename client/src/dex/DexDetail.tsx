// Detail drawer for the Dex (図鑑) — REQ-0108. The catalog grid is now the
// single, persistent list (master); selecting a card opens THIS drawer in
// place (Dex.tsx), holding the two panes [diagram | info] for the selected
// entry. The former separate list rail (.dex-detail-col-list /
// .dex-detail-item-list-row) is removed — the grid IS the list, so the two
// can no longer diverge (the REQ-0108 fix). Composition is otherwise
// unchanged from the REQ-0038/0075 detail: DexDiagram (図解/SCHEMA) +
// ItemDetailCard (銘と効果). Every kept selector (.dex-detail-col-diagram /
// .dex-detail-col-info / .dex-detail-phead / .dex-detail-back-btn /
// .dex-diagram*) is unchanged.
import type { ApiContentPayload, ApiItemEntry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t } from '../i18n';
import { rarThemeClass } from '../render/uiBits';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { DexDiagram } from './DexDiagram';
import { iconDataUrl, iconDims } from './dexIcons';
import { ItemDetailCard } from './ItemDetailCard';

interface DexDetailProps {
  selected: DexEntry;
  onBack: () => void;
  locale: Locale;
  tagTree: ApiContentPayload['trees']['po'];
  registry: ApiContentPayload['registry'];
  /** REQ-0075: honest 1-based dex number (dexNo.ts) for the selected entry;
   * null for SIs (not part of the v1 dex numbering). */
  dexNo: number | null;
}

function shapeOf(entry: ApiItemEntry | ApiSIEntry): Cell[] {
  const shape = ('shape' in entry && Array.isArray(entry.shape) ? entry.shape : []) as Cell[];
  // REQ-0096: SI/TM entries carry no `shape`; fall back to a synthetic 1x1
  // anchor cell so ShapeGrid/DexDiagram still mount the icon (see Dex.tsx).
  return shape.length > 0 ? shape : ([[0, 0]] as Cell[]);
}
function stretchOf(entry: ApiItemEntry | ApiSIEntry): boolean | undefined {
  return 'stretch' in entry ? entry.stretch : undefined;
}
// REQ-0102: mirrors ItemDef.align (only POs carry it) for the shared fit math.
function alignOf(entry: ApiItemEntry | ApiSIEntry) {
  return 'align' in entry ? entry.align : undefined;
}

export function DexDetail({ selected, onBack, locale, tagTree, registry, dexNo }: DexDetailProps) {
  return (
    <div className="dex-detail-drawer-panes">
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
        <ItemDetailCard dexEntry={selected} locale={locale} tagTree={tagTree} registry={registry} dexNo={dexNo} />
      </div>
    </div>
  );
}
