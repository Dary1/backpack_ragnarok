// Detail FIELDS card — REQ-0035, restructured REQ-0038 for the two-pane
// detail layout (DexDetail.tsx), locale-only display REQ-0038 R3 (Dex
// feedback round 3). Shows every non-diagram field the task spec lists:
// name, id, rarity, tags with full ancestry, effects (rendered text AND
// collapsible raw AST), flavor text, part/assembly info, stretch flag,
// provenance (batch-level, see module comment in api.ts's ApiRegistry).
// Shape/Ports/Sockets moved OUT of this component in REQ-0038 -- they
// are now the two-pane detail view's diagram column (see DexDiagram.tsx),
// not a section here.
//
// REQ-0038 R3 (Dex feedback round 3, fix 1): name/flavor/effects text now
// show ONLY the currently active locale -- the paired "EN … / JA …" rows
// this component used to render unconditionally are gone. This mirrors
// the edit-mode locale switcher's behavior (DexAdmin.tsx: "Never both
// languages' inputs at once") for the READ-ONLY view: the global JA/EN
// toggle (store.ts's `locale`) now governs which single language's
// content-text is shown here, exactly like the catalog card's name
// already did (Dex.tsx's dex-card-name). ID/rarity/tags stay locale-
// NEUTRAL (raw identifiers/closed-vocab strings, not translated content)
// and are unaffected by this change, per the task spec. The raw AST
// <details> block is also locale-neutral (opaque JSON) and unaffected.
//
// REQ-0075 (MJOLNIR re-skin; mock: web/redesign/dex.html §銘と効果 +
// §市場の刻銘): presentation-only rewrite of the field layout to the
// mock's info panel (name + EN caption header, rarity/tag chip row, rune
// dividers between effect/lore/provenance blocks). The locale-only text
// resolution below is UNCHANGED. Two additions:
//   (a) the mock's No.NNN chip in the provenance micro-line, from the
//       honest dex numbering passed in as `dexNo` (dexNo.ts); and
//   (b) the mock's 市場の刻銘 (market engravings) block. That block is
//       rendered as an EMPTY-STATE shell: no Dex-facing price/listing
//       feed is exposed today (the market wire shapes exist in
//       shared/dto.ts as ApiMarketPriceHistoryEntry etc., but ONLY on
//       the /api/market listing endpoints -- REQ-0064; a per-item Dex
//       card feed is REQ-0052, still queued). Per REQ-0075's own fallback
//       clause ("fed by whatever the card DTO already offers; empty-state
//       otherwise"), and since /api/content offers NOTHING market-related,
//       the block shows the mock's anchor/listing labels with honest "—"
//       placeholders, NOT invented numbers, and links to the market page.
//       See docs/REQ-0075-redesign-dex.md.
//
// Locale text resolution prefers the formal i18n map (entry.i18n?.ja)
// over the legacy top-level name_ja/flavor_ja mirror fields, falling
// back to name_ja/flavor_ja if i18n.ja is absent (matches DexAdmin.tsx's
// own `ja?.name ?? entry.name_ja` precedence) -- then falls back to the
// EN text if JA copy doesn't exist at all for that field (an item with
// no JA translation yet should not show blank/dash in JA mode; showing
// the EN text is more useful than nothing, same rule the catalog card's
// nameOf ternary already applied: `nameJaOf(e.entry) || nameOf(e.entry)`).
import type { ApiItemEntry, ApiRegistry, ApiSIEntry } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import type { DexEntry } from './Dex';
import { ancestryPath, type TagTree } from './vocabTree';

interface ItemDetailCardProps {
  dexEntry: DexEntry;
  locale: Locale;
  tagTree: TagTree;
  registry: ApiRegistry | null;
  /** REQ-0075: honest 1-based dex number for this entry (dexNo.ts), or
   * null for SIs (not in the dex numbering). Shown in the provenance
   * micro-line's No.NNN, mirroring the mock. */
  dexNo: number | null;
}

function isPO(e: DexEntry): e is DexEntry & { entry: ApiItemEntry } {
  return e.kind === 'po';
}

/** Resolves the locale-active display name: JA mode prefers
 * i18n.ja.name, falling back to the legacy name_ja mirror, falling back
 * to the EN name if no JA copy exists at all. EN mode is always just the
 * base `name` field (the base fields on an entry are always English,
 * per api.ts's ApiI18nMap doc comment). */
function localizedName(entry: ApiItemEntry | ApiSIEntry, locale: Locale): string {
  if (locale === 'ja') {
    return entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name;
  }
  return entry.name;
}

/** Same locale-resolution precedence as localizedName, for flavor text.
 * Returns null (not a placeholder string) when neither locale has any
 * flavor text at all, so the caller can render the existing "—" empty
 * marker exactly once. */
function localizedFlavor(entry: ApiItemEntry | ApiSIEntry, locale: Locale): string | null {
  if (locale === 'ja') {
    return entry.i18n?.ja?.flavor ?? entry.flavor_ja ?? entry.flavor ?? null;
  }
  return entry.flavor ?? null;
}

/** Effects rendered text has no i18n.ja map entry (eff_en/eff_ja are
 * server-rendered strings, not part of the ApiI18nMap content-i18n
 * shape) -- so this just picks whichever of eff_en/eff_ja matches the
 * active locale, falling back to the other language if the active one is
 * empty (an item whose effect text hasn't been translated yet should
 * still show SOMETHING rather than the "(none)" placeholder, matching
 * the same non-blank-over-blank precedent as localizedName/Flavor). */
function localizedEff(entry: ApiItemEntry | ApiSIEntry, locale: Locale): string {
  if (locale === 'ja') {
    return entry.eff_ja || entry.eff_en || '';
  }
  return entry.eff_en || entry.eff_ja || '';
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

export function ItemDetailCard({ dexEntry, locale, tagTree, registry, dexNo }: ItemDetailCardProps) {
  const { entry } = dexEntry;
  const po = isPO(dexEntry) ? (entry as ApiItemEntry) : null;
  const provenance = resolveProvenance(registry, dexEntry.id);
  const displayName = localizedName(entry, locale);
  const displayFlavor = localizedFlavor(entry, locale);
  const displayEff = localizedEff(entry, locale);
  const noStr = dexNo != null ? `${t(locale, 'dex.noPrefix')}${String(dexNo).padStart(3, '0')}` : null;

  return (
    <div className="dex-detail">
      {/* mock header: name + EN caption */}
      <div className="dex-detail-namehead">
        <span className="dex-detail-name dj">{displayName}</span>
        <span className="dex-detail-enname den">{entry.name.toUpperCase()}</span>
      </div>

      {/* mock chip row: rarity word + type/tag chips */}
      <div className="dex-detail-chiprow">
        <span className={`rar-word rarity r-${entry.rarity}`}>{entry.rarity.toUpperCase()}</span>
        <span className="dex-detail-field-id">
          <span className="dex-detail-label">id</span> {dexEntry.id}
        </span>
        {po
          ? (po.tags || []).map((tag) => (
              <span className="chip dex-detail-tagchip" key={tag}>
                {tag}
              </span>
            ))
          : null}
      </div>

      {po ? (
        <div className="dex-detail-section">
          <h4>{t(locale, 'dex.detail.tags')}</h4>
          <ul className="dex-tag-list">
            {(po.tags || []).map((tag, i) => (
              <li key={tag}>
                {i === 0 ? <span className="dex-tag-root-label">{t(locale, 'dex.detail.type')}</span> : null}
                {ancestryPath(tagTree, tag).join(' -> ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rune-divider" aria-hidden="true">ᛁ</div>

      <div className="dex-detail-section">
        <h4>{t(locale, 'dex.detail.effects')}</h4>
        <div className="dex-eff-text">
          <div>{displayEff || t(locale, 'dex.detail.effectsNone')}</div>
        </div>
        {entry.effects && entry.effects.length > 0 ? (
          <details className="dex-raw-ast">
            <summary>{t(locale, 'dex.detail.rawAst')}</summary>
            <pre>{JSON.stringify(entry.effects, null, 2)}</pre>
          </details>
        ) : null}
      </div>

      <div className="dex-detail-section">
        <h4>{t(locale, 'dex.detail.flavor')}</h4>
        <div className="dex-flavor flavor">
          <div>{displayFlavor || '—'}</div>
        </div>
      </div>

      {po?.part ? (
        <div className="dex-detail-section">
          <h4>{t(locale, 'dex.detail.part')}</h4>
          <div>
            {t(locale, 'dex.detail.assemblesInto')}: <strong>{po.part.assembles}</strong>{' '}
            ({t(locale, 'dex.detail.role')}: {po.part.role})
          </div>
        </div>
      ) : null}

      {po?.stretch ? (
        <div className="dex-detail-section">
          <h4>stretch</h4>
          <div>{t(locale, 'dex.detail.stretchNote')}</div>
        </div>
      ) : null}

      <div className="rune-divider" aria-hidden="true">ᛞ</div>

      <div className="dex-detail-section">
        <h4>{t(locale, 'dex.detail.provenance')}</h4>
        {provenance ? (
          <div className="dex-provenance">
            <div>batch: {provenance.id}</div>
            {provenance.date ? <div>date: {provenance.date}</div> : null}
            {provenance.drafted_by ? <div>drafted_by: {provenance.drafted_by}</div> : null}
            {provenance.icons_by ? <div>icons_by: {provenance.icons_by}</div> : null}
            {provenance.status ? <div>status: {provenance.status}</div> : null}
          </div>
        ) : (
          <div className="dex-provenance-unresolved">{t(locale, 'dex.detail.provenanceUnresolved')}</div>
        )}
        {noStr ? <div className="dex-detail-no t-micro tnum">{noStr}</div> : null}
      </div>

      {/* ============ 市場の刻銘 / THE MARKET ENGRAVINGS (mock) ============
          REQ-0075 EMPTY-STATE: no Dex-facing price/listing feed exists yet
          (REQ-0052/REQ-0064). Render the mock's block shell with honest
          "—" placeholders + a zero listing count, never invented numbers.
          The anchor-price / listing-count LABELS from the mock are kept so
          the block reads as a real (currently empty) section, and a link
          to the market page is provided. See docs/REQ-0075-redesign-dex.md. */}
      <div className="rune-divider" aria-hidden="true">ᚠ</div>
      <div className="dex-market" data-testid="dex-market-block">
        <div className="dex-market-head">
          <span className="ttl dj dex-market-title">{t(locale, 'dex.market.title')}</span>
          <span className="den dex-market-den">{t(locale, 'dex.market.den')}</span>
          <span className="dex-colhead-grow" />
          <span className="chip dex-market-count" data-testid="dex-market-count">
            <span className="rune dex-market-count-rune">ᚠ</span> {t(locale, 'dex.market.listingCount', { count: 0 })}
          </span>
        </div>
        <div className="dex-market-empty" data-testid="dex-market-empty">
          <div className="dex-market-anchor-row">
            <span className="dex-market-anchor-label t-micro">{t(locale, 'dex.market.anchorLabel')}</span>
            <span className="dex-market-anchor-val tnum">
              <span className="rune dex-market-anchor-rune">ᚠ</span>—
            </span>
          </div>
          <div className="dex-market-empty-note t-micro">{t(locale, 'dex.market.emptyNote')}</div>
        </div>
        <div className="dex-market-cap">{t(locale, 'dex.market.caption')}</div>
        <div className="den dex-market-cap-en">{t(locale, 'dex.market.captionEn')}</div>
        <div className="dex-market-link">
          <button
            type="button"
            className="btn btn-ghost dex-market-link-btn"
            onClick={() => {
              window.location.hash = '#/market';
            }}
          >
            <span className="rune" aria-hidden="true">ᚠ</span> {t(locale, 'dex.market.viewInMarket')}
          </button>
        </div>
      </div>
    </div>
  );
}
