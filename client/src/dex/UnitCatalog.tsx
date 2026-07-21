// client/src/dex/UnitCatalog.tsx -- REQ-0208: the Dex "Units" tab.
//
// unit_def (REQ-0170) joins the Dex as a first-class catalog kind. The
// surface reuses the Items tab's anatomy wholesale -- the .dex-controls
// search/rarity row, a .dex-grid of .dcard cards, and the .dex-md
// master/detail split with a persistent, index-0-preselected detail pane
// (REQ-0120's contract) -- so the three tabs read as one page. What it
// deliberately does NOT reuse is ShapeGrid/DexDiagram: a unit's backpack
// shape is rolled at EMISSION (the Workshop gacha, REQ-0170), a unit def
// carries no shape field at all, so any schema drawing here would be
// invented data. The old reserved "BPs" tab died for exactly this reason;
// the detail's schema slot is an explicit rolled-at-emission note instead.
//
// Art: a unit def's `icon` IS its artwork reference (a free reference --
// two units may share one artwork; REQ-0170), so the portrait is
// unitArtUrl(icon): the SAME resolution the Workshop pool list and the
// board renderer already use, not a parallel one. An artwork with no
// adopted render 404s; the <img> hides itself onError and the rune
// placeholder behind it shows through (matches art_urls' "absent id ->
// client fallback tier" posture).
// REQ-0266: "not a parallel one" is now enforced rather than asserted -- the
// portrait resolves through dex/unitArt.ts's resolveUnitArtUrl(), the DOM
// adapter over board/unitIcon.ts's own chain, so a cosmetic skin the board
// paints is the skin the Dex shows. With no skin active the resolved URL is
// byte-identical to what this drew before.
import { useEffect, useMemo, useState } from 'react';
import type { ApiConnShape, ApiUnitEntry } from '../../../shared/dto';
import { resolveUnitArtUrl } from './unitArt'; // REQ-0266
import { t } from '../i18n';
import { dirsLabel, shapeLabel } from '../lib/connShapeLabel';
import { rarThemeClass } from '../render/uiBits';
import type { Locale } from '../store';
import { SectionHead } from './DexDetail';
import { RegistryBadge } from './RegistryBadge';

interface UnitCatalogProps {
  locale: Locale;
  units: Record<string, ApiUnitEntry>;
  connShapes: Record<string, ApiConnShape>;
  /** REQ-0208: one-shot '#/dex/<id>' deep-link target (see Dex.tsx's
   * cross-tab routing of dexFocusId). Consumed, then reported back. */
  focusId?: string | null;
  onFocusConsumed?: () => void;
}

function unitName(u: ApiUnitEntry, locale: Locale): string {
  if (locale === 'ja') return u.i18n?.ja?.name || u.name_ja || u.name;
  return u.name;
}
function unitFlavor(u: ApiUnitEntry, locale: Locale): string {
  if (locale === 'ja') return u.i18n?.ja?.flavor || u.flavor_ja || u.flavor || '';
  return u.flavor || '';
}

/** Portrait well: the rune placeholder always renders underneath; the
 * adopted-render <img> covers it when (and only when) it actually loads.
 * No adopted art is a NORMAL state (files backend, not-yet-generated
 * portraits), never an error/broken-image glyph. */
function UnitPortrait({ unit, large }: { unit: ApiUnitEntry; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  // REQ-0266: active skin (the player's pick, else the def's default) -> the
  // def's own icon -> the rune below. Never a probed skin URL: an unadopted
  // skin is simply absent from art_urls and the chain drops to the icon rung.
  const art = resolveUnitArtUrl(unit.id, unit.icon);
  useEffect(() => {
    setFailed(false); // the detail pane reuses one mounted node across selections
  }, [unit.id, art.url]); // ...and across a skin swap, which moves only the URL
  return (
    <span className={`dex-portrait-well${large ? ' dex-portrait-well-lg' : ''}`}>
      <span className="dex-art-fallback rune" aria-hidden="true">
        ᚢ
      </span>
      {art.url && !failed ? (
        <img
          className="dex-portrait-img"
          data-art-source={art.source}
          src={art.url}
          alt={unit.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

function UnitDetail({
  unit,
  locale,
  connShapes,
}: {
  unit: ApiUnitEntry;
  locale: Locale;
  connShapes: Record<string, ApiConnShape>;
}) {
  const shape = connShapes[unit.connection_shape];
  const flavor = unitFlavor(unit, locale);
  return (
    <div className="dex-detail-drawer-panes">
      <article
        className={`dex-detail-panel panel ornate rar ${rarThemeClass(unit.rarity)}`}
        data-testid="dex-unit-detail"
      >
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />

        <header className="dex-detail-masthead">
          <div className="dex-detail-namehead">
            <h3 className="dex-detail-name dj">{unitName(unit, locale)}</h3>
            <span className="dex-detail-enname den">{unit.name.toUpperCase()}</span>
          </div>
          <div className="dex-detail-chiprow">
            <span className={`rar-word rarity r-${unit.rarity}`}>{unit.rarity.toUpperCase()}</span>
            <span className="chip dex-detail-kindchip">UNIT</span>
            <span className="dex-detail-field-id">
              <span className="dex-detail-label">id</span> {unit.id}
            </span>
          </div>
        </header>

        <section className="dex-detail-col-portrait">
          <SectionHead rune="ᚢ" title={t(locale, 'dex.portraitTitle')} den={t(locale, 'dex.portraitDen')} />
          <UnitPortrait unit={unit} large />
          {/* REQ-0208: the schema slot is an honest sentence, never a drawing --
              the shape does not exist until the Workshop rolls it. */}
          <div className="dex-unit-shape-note t-micro">{t(locale, 'dex.unitNoShapeNote')}</div>
        </section>

        <div className="rune-divider dex-detail-section-divider" aria-hidden="true">
          ᛁ
        </div>

        <section className="dex-detail-col-info">
          <SectionHead rune="ᛗ" title={t(locale, 'dex.connectionTitle')} den={t(locale, 'dex.connectionDen')} />
          <div className="dex-unit-connrow">
            <span className="chip dex-unit-connchip">{shapeLabel(unit.connection_shape, shape, locale)}</span>
            {shape && shape.kind === 'ray' ? (
              <span className="dex-unit-conndirs t-micro">
                {dirsLabel(shape)}
                {shape.pierce ? ' ・ pierce' : ''}
              </span>
            ) : null}
          </div>
          {flavor ? <p className="dex-unit-flavor">{flavor}</p> : null}
          <RegistryBadge systemName={unit.id} />
        </section>
      </article>
    </div>
  );
}

export function UnitCatalog({ locale, units, connShapes, focusId, onFocusConsumed }: UnitCatalogProps) {
  const entries = useMemo(() => Object.values(units), [units]);
  const [query, setQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');
  // REQ-0120 contract kept: index=0 preselected so the detail pane is
  // populated on the very first paint of the tab.
  const [selectedId, setSelectedId] = useState<string | null>(() => entries[0]?.id ?? null);

  useEffect(() => {
    if (!focusId) return;
    if (entries.some((u) => u.id === focusId)) setSelectedId(focusId);
    onFocusConsumed?.();
  }, [focusId, entries, onFocusConsumed]);

  const rarities = useMemo(() => Array.from(new Set(entries.map((u) => u.rarity))).sort(), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((u) => {
      if (rarityFilter && u.rarity !== rarityFilter) return false;
      if (q) {
        const hay = [u.id, u.name, u.name_ja || '', u.i18n?.ja?.name || ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, query, rarityFilter]);

  useEffect(() => {
    setSelectedId((cur) => (cur && filtered.some((u) => u.id === cur) ? cur : filtered[0]?.id ?? null));
  }, [filtered]);

  const selected = useMemo(() => filtered.find((u) => u.id === selectedId) ?? null, [filtered, selectedId]);

  return (
    <div className="dex-md">
      <div className="dex-md-list">
        <div className="dex-colhead">
          <span className="dex-colhead-rn rune">ᚢ</span>
          <h2 className="dj dex-colhead-title">{t(locale, 'dex.unitCatalogTitle')}</h2>
          <span className="den dex-colhead-den">{t(locale, 'dex.unitCatalogDen')}</span>
          <span className="dex-colhead-grow" />
          <span className="t-micro">{t(locale, 'dex.unitCatalogNote')}</span>
        </div>

        <div className="dex-controls">
          <input
            type="text"
            className="dex-search"
            placeholder={t(locale, 'dex.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="dex-filter" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)}>
            <option value="">{t(locale, 'dex.rarityAll')}</option>
            {rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <span className="dex-count">
            {filtered.length} / {entries.length}
          </span>
        </div>

        <div className="dex-grid dgrid">
          {filtered.map((u) => {
            const isSel = u.id === selectedId;
            return (
              <div
                key={u.id}
                className={`dex-card dex-unit-card dcard rar ${rarThemeClass(u.rarity)}${isSel ? ' dex-card-selected' : ''}`}
              >
                <button
                  type="button"
                  className="dex-card-summary dcard-btn"
                  aria-pressed={isSel}
                  onClick={() => setSelectedId(u.id)}
                >
                  <span className="gem" aria-hidden="true" />
                  <span className="dex-card-no dex-card-no-kind t-micro">UNIT</span>
                  <span className="dex-card-shape dthumb">
                    <UnitPortrait unit={u} />
                  </span>
                  <div className="dex-card-summary-text">
                    <div className="dex-card-name dname">{unitName(u, locale)}</div>
                    <div className="dex-card-sub dsub">
                      <span className="dex-card-cat">
                        {shapeLabel(u.connection_shape, connShapes[u.connection_shape], locale)}
                      </span>
                      <span className="dex-card-enname">{u.name.toUpperCase()}</span>
                    </div>
                    <div className="dex-card-meta dfoot">
                      <span className={`rar-word rarity r-${u.rarity}`}>{u.rarity.toUpperCase()}</span>
                      <span className="dex-card-id">{u.id}</span>
                      <span className="dex-card-kind">UNIT</span>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className="dex-empty">{t(locale, 'dex.noMatch')}</div> : null}
        </div>
      </div>

      <div className="dex-md-detail" data-testid="dex-detail-pane">
        {selected ? (
          <UnitDetail unit={selected} locale={locale} connShapes={connShapes} />
        ) : (
          <div className="dex-detail-empty">{t(locale, 'dex.detailEmpty')}</div>
        )}
      </div>
    </div>
  );
}
