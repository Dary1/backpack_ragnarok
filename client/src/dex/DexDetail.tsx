// Detail pane for the Dex (図鑑) — REQ-0108, persistent right/top pane of
// the master/detail split (REQ-0120), unified REQ-0194.
//
// REQ-0194 (dex detail pane overhaul): the former TWO stacked ornate
// panels ([Schema panel] + [info panel], each with its own rarity frame
// and corner brackets, the first never naming the item it diagrams) are
// merged into ONE rarity-framed plate:
//
//   [ masthead  — No. chip + localized name + EN caption + rarity word
//                 + kind/slot chip + id + type chips              ]
//   [ section   — 図解 / SCHEMA   (.dex-detail-col-diagram)        ]
//   [ divider ᛁ                                                    ]
//   [ section   — 銘と効果 / LORE & EFFECTS (.dex-detail-col-info)  ]
//
// The identity row (name/rarity/id chips) used to live INSIDE
// ItemDetailCard (i.e. inside the second panel, below the diagram of the
// very item it names); it is hoisted here so both sections visibly hang
// off one identity. The E2E-load-bearing section classes
// (.dex-detail-col-diagram / .dex-detail-col-info / .dex-detail-phead)
// are kept — they are now sections of the single panel instead of
// standalone panels. See docs/REQ/*/REQ-0194-dex-detail-overhaul.md.
import type { ApiContentPayload, ApiItemEntry, ApiSIEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t } from '../i18n';
import { rarThemeClass } from '../render/uiBits';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { DexDiagram } from './DexDiagram';
import { iconDims, resolveIconUrl } from './dexIcons';
import { ItemDetailCard, localizedName } from './ItemDetailCard';
import { RegistryBadge } from './RegistryBadge'; // REQ-0155 LINK-FIRST

interface DexDetailProps {
  selected: DexEntry;
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

/** REQ-0194: shared section head for the schema/lore sections (exported
 * for REQ-0208's Unit/Monster detail panes -- same anatomy, one head). The den
 * caption (EN smallcaps) is HIDDEN when it is just the title uppercased —
 * the EN locale used to render a redundant "Schema / SCHEMA"; the JA
 * locale keeps its 図解 / SCHEMA pairing. */
export function SectionHead({ rune, title, den }: { rune: string; title: string; den: string }) {
  const showDen = den.trim().toUpperCase() !== title.trim().toUpperCase();
  return (
    <div className="dex-detail-phead">
      <span className="dex-detail-phead-rn rune" aria-hidden="true">
        {rune}
      </span>
      <span className="dj dex-detail-phead-title">{title}</span>
      {showDen ? <span className="den dex-detail-phead-den">{den}</span> : null}
    </div>
  );
}

export function DexDetail({ selected, locale, tagTree, registry, dexNo }: DexDetailProps) {
  const entry = selected.entry;
  const displayName = localizedName(entry, locale);
  const noStr = dexNo != null ? `${t(locale, 'dex.noPrefix')}${String(dexNo).padStart(3, '0')}` : null;
  // SIs carry no dex number; their closest real category is their slot
  // (same source categoryOf() in Dex.tsx already uses for the catalog
  // cards) — shown on the kind chip, not invented taxonomy.
  const slot = selected.kind === 'si' ? (entry as ApiSIEntry).slot || null : null;
  const tags = selected.kind === 'po' ? (entry as ApiItemEntry).tags || [] : [];

  return (
    <div className="dex-detail-drawer-panes">
      <article className={`dex-detail-panel panel ornate rar ${rarThemeClass(entry.rarity)}`}>
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />

        {/* REQ-0194 masthead — the ONE identity both sections hang off. */}
        <header className="dex-detail-masthead">
          <div className="dex-detail-namehead">
            {noStr ? <span className="dex-detail-masthead-no den tnum">{noStr}</span> : null}
            <h3 className="dex-detail-name dj">{displayName}</h3>
            <span className="dex-detail-enname den">{entry.name.toUpperCase()}</span>
          </div>
          <div className="dex-detail-chiprow">
            <span className={`rar-word rarity r-${entry.rarity}`}>{entry.rarity.toUpperCase()}</span>
            <span className="chip dex-detail-kindchip">
              {selected.kind === 'po' ? 'PO' : slot ? `SI ・ ${slot}` : 'SI'}
            </span>
            <span className="dex-detail-field-id">
              <span className="dex-detail-label">id</span> {selected.id}
            </span>
            {tags.map((tag) => (
              <span className="chip dex-detail-tagchip" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </header>

        <section className="dex-detail-col-diagram">
          <SectionHead rune="ᛟ" title={t(locale, 'dex.schemaTitle')} den={t(locale, 'dex.schemaDen')} />
          <DexDiagram
            entry={entry}
            shape={shapeOf(entry)}
            iconUrl={resolveIconUrl(entry.id, entry.icon).url}
            iconDims={iconDims(entry.icon)}
            iconStretch={stretchOf(entry)}
            iconAlign={alignOf(entry)}
            locale={locale}
          />
        </section>

        <div className="rune-divider dex-detail-section-divider" aria-hidden="true">
          ᛁ
        </div>

        <section className="dex-detail-col-info">
          <SectionHead rune="ᛗ" title={t(locale, 'dex.loreTitle')} den={t(locale, 'dex.loreDen')} />
          <ItemDetailCard dexEntry={selected} locale={locale} tagTree={tagTree} registry={registry} dexNo={dexNo} />
          <RegistryBadge systemName={selected.id} />
        </section>
      </article>
    </div>
  );
}
