// Item Encyclopedia (図鑑) display view — REQ-0035, rebuilt REQ-0038 for
// Dex v2. Read-only reference/wiki view: search + filters over a combined
// PO+SI item grid. Two REQ-0038 changes from the original REQ-0035
// layout:
//   1. Catalog cards render each item ON its cell shape (a mini shape
//      grid with the icon mounted on the anchor cell -- ShapeGrid.tsx,
//      reused, DOM-based per dexIcons.ts's module comment), not as a
//      bare <img> icon.
//   2. Selecting a card no longer expands it inline -- it switches the
//      WHOLE view into the two-pane detail layout (DexDetail.tsx: large
//      diagram left, item list right), a distinct mode from the catalog
//      grid, per the task spec's "Detail screen splits into two big
//      panes" (not an inline-expansion overlay on the catalog anymore).
//
// REQ-0075 (MJOLNIR re-skin; mock: web/redesign/dex.html):
// presentation-only rewrite of the render tree. Dex v2 BEHAVIOR is
// UNCHANGED -- the combined PO+SI grid, the search/rarity/tag filtering,
// selecting-a-card-switches-to-the-detail-view flow, the TM catalog
// strip, and (critically) every E2E-load-bearing selector (.dex-count /
// .dex-card / .dex-card-shape .shape-grid / .shape-grid-cell-shape /
// .shape-grid-icon-overlay / .dex-card-summary / .dex-grid / .dex-search
// / .dex-tab-active / .dex-empty) are kept verbatim. New chrome: the
// mock's page header (知の炉 / EMBERS OF KNOWLEDGE), an ornate progress
// strip (収集 collected count + gold bar + honest filter chips), the
// 形の目録/CATALOG colhead, and the .dcard card anatomy (No. chip drawn
// from the item's honest 1-based dex position, rarity WORD + corner gem
// via the theme .rar-* frame, the shape-mounted thumbnail kept inside a
// night-iron well). The mock's market-engraving marker (ᚠ) is NOT drawn
// on catalog cards: no Dex-facing price/listing feed exists yet (that is
// REQ-0052 / REQ-0064's market API, still queued -- see
// docs/REQ-0075-redesign-dex.md), so marking specific cards as
// "engraved" would be invented data.
//
// Admin edit mode (a SEPARATE view/layout per the spec, not overlaid
// here) lives in ./DexAdmin.tsx; both are reached through ./DexRoot.tsx,
// which owns the /api/content + /api/me fetches and the view/edit toggle.
//
// Data source: the `payload` prop is the raw GET /api/content response
// (api.ts's ApiContentPayload), NOT the engine-normalized GameData the
// boards use -- the raw payload still carries fields the boards'
// normalization drops (e.g. `part`, the raw `effects` AST) that this
// reference view needs to show. This is a read-only view; it does not
// touch store.ts's engine/GameState at all.
import { useEffect, useMemo, useState } from 'react';
import type { ApiContentPayload, ApiItemEntry, ApiSIEntry, ApiTmEntry } from '../api';
import type { Cell } from '../engine/engine.d.ts';
import { t, type TranslationKey } from '../i18n';
import { rarThemeClass } from '../render/uiBits';
import type { Locale } from '../store';
import { clearDexFocusId } from '../store';
import { DexDetail } from './DexDetail';
import { useDexCard } from './DexCardWindow'; // REQ-0052
import { dexNoOf } from './dexNo';
import { iconDataUrl, iconDims } from './dexIcons';
import { ShapeGrid } from './ShapeGrid';

export interface DexEntry {
  id: string;
  kind: 'po' | 'si';
  entry: ApiItemEntry | ApiSIEntry;
}

function combineEntries(payload: ApiContentPayload): DexEntry[] {
  const pos: DexEntry[] = Object.values(payload.items).map((entry) => ({ id: entry.id, kind: 'po', entry }));
  const sis: DexEntry[] = Object.values(payload.sis).map((entry) => ({ id: entry.id, kind: 'si', entry }));
  return [...pos, ...sis];
}

// REQ-0042: TMs (Transmutators) are a display-only catalog addition, kept
// DELIBERATELY separate from DexEntry/combineEntries above rather than
// widened into a 3rd 'tm' kind -- DexDetail.tsx/ItemDetailCard.tsx both
// narrow DexEntry to ApiItemEntry|ApiSIEntry via an isPO()-style type
// guard (shape/sockets/part fields POs have that SIs+TMs don't), and TMs
// have no shape at all (always 1x1, inventory-only, no canvas role per
// the engine design -- see mock-src/engine.js's TM model), so folding
// them into the same selectable-detail-view path would require widening
// that guard logic for comparatively little benefit given the REQ spec
// only asks for TMs to appear in the catalog display (display-only is
// fine, no edit-role gating needed). TMs render as their own small,
// non-selectable catalog strip below the main PO/SI grid instead.
function tmEntries(payload: ApiContentPayload): ApiTmEntry[] {
  return Object.values(payload.tms || {});
}

function nameOf(e: ApiItemEntry | ApiSIEntry): string {
  return e.name || '';
}
function nameJaOf(e: ApiItemEntry | ApiSIEntry): string {
  return e.name_ja || '';
}
function shapeOf(e: ApiItemEntry | ApiSIEntry): Cell[] {
  return ('shape' in e && Array.isArray(e.shape) ? e.shape : []) as Cell[];
}
// REQ-0038 R2: mirrors ItemDef.stretch for the shared itemCard.ts fit math
// (see ShapeGrid.tsx) -- only POs carry this field; SIs have no shape at
// all so it's moot for them.
function stretchOf(e: ApiItemEntry | ApiSIEntry): boolean | undefined {
  return 'stretch' in e ? e.stretch : undefined;
}

// REQ-0075: the mock's card sub-line reads "武具/剣 ・ LONGSWORD" -- a
// localized category fragment + the EN name in caps. The category is the
// item's FIRST tag (its root type in vocab.json's po_tags tree; SIs have
// no tags, so their `slot` -- the closest real category a socket item
// carries -- is used instead). No invented taxonomy: whatever the entry
// actually declares.
function categoryOf(e: DexEntry): string {
  if (e.kind === 'po') {
    const tags = (e.entry as ApiItemEntry).tags || [];
    return tags[0] || '';
  }
  return (e.entry as ApiSIEntry).slot || '';
}

interface DexProps {
  locale: Locale;
  payload: ApiContentPayload;
  /** REQ-0052: pending Dex deep-link target from a '#/dex/<id>' hash
   * (e.g. a DexCardWindow footer link) -- see DexRoot.tsx's doc. When
   * present and it matches a real entry, this component jumps its own
   * selectedId state straight to it (bypassing the catalog grid) on
   * mount/change, then clears it via clearDexFocusId() so it does not
   * keep re-forcing a jump on later, unrelated re-renders (e.g. the
   * user then clicking "Back to list" and browsing normally). */
  dexFocusId?: string | null;
}

const RESERVED_TABS: TranslationKey[] = ['dex.tabSocketItems', 'dex.tabBps', 'dex.tabSearchPresets'];

export function Dex({ locale, payload, dexFocusId }: DexProps) {
  const [query, setQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState<string>('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { openCard } = useDexCard(); // REQ-0052

  const entries = useMemo(() => combineEntries(payload), [payload]);

  // REQ-0052: honor a pending Dex deep-link (see DexProps.dexFocusId's
  // doc) -- jump straight to that entry's detail view once, then clear
  // the store field so it is a true one-shot (matches the store's own
  // welcomeBanner/dexFocusId "consume once" convention elsewhere).
  // Guarded on the id actually existing in this payload's entries (a
  // stale/garbage deep-link degrades to the plain catalog grid, same
  // "unknown id -> safe fallback, never a crash" posture as
  // routeFromHash's own unknown-route fallback).
  useEffect(() => {
    if (!dexFocusId) return;
    if (entries.some((en) => en.id === dexFocusId)) {
      setSelectedId(dexFocusId);
    }
    clearDexFocusId();
  }, [dexFocusId, entries]);
  const tms = useMemo(() => tmEntries(payload), [payload]); // REQ-0042

  // REQ-0075: honest 1-based dex numbering for the mock's No. chips,
  // derived from each PO's position in content.items (the same v1 dex
  // numbering shared/dto.ts's ApiMarketListing.dexNo documents). Built
  // once per payload; POs get a real No., SIs/TMs are not part of the
  // dex numbering (dexNoOf returns null -> no chip).
  const dexNos = useMemo(() => dexNoOf(payload), [payload]);

  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.entry.rarity);
    return Array.from(set).sort();
  }, [entries]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.kind === 'po') {
        for (const tag of (e.entry as ApiItemEntry).tags || []) set.add(tag);
      }
    }
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (rarityFilter && e.entry.rarity !== rarityFilter) return false;
      if (tagFilter) {
        if (e.kind !== 'po') return false;
        if (!(e.entry as ApiItemEntry).tags?.includes(tagFilter)) return false;
      }
      if (q) {
        const hay = [e.id, nameOf(e.entry), nameJaOf(e.entry)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, query, rarityFilter, tagFilter]);

  // REQ-0075: collection progress readout (mock 収集 N / total + gold
  // bar). This is a read-only wiki over the FULL content catalog -- there
  // is no per-player "discovered" set in the data model (undiscovered
  // cards are a mock-only concept; see docs/REQ-0075-redesign-dex.md), so
  // "collected" honestly means the catalog's own size (every real entry
  // is a page). Total = PO+SI+TM; count = same, i.e. 100% -- the bar is a
  // truthful "the codex is complete" strip, not a fabricated 57%.
  const totalPages = entries.length + tms.length;
  const collectedPages = totalPages; // no discovery gating exists (documented)
  const progressPct = totalPages > 0 ? (collectedPages / totalPages) * 100 : 0;

  // REQ-0038: selecting a card switches the whole view into the two-pane
  // detail layout -- the list shown there is `filtered` (so the current
  // search/filter selection carries over into the detail right-pane
  // list), not the full unfiltered `entries`.
  if (selectedId) {
    return (
      <div className="dex-view">
        <DexDetail
          entries={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onBack={() => setSelectedId(null)}
          locale={locale}
          tagTree={payload.trees.po}
          registry={payload.registry}
          dexNos={dexNos}
        />
      </div>
    );
  }

  return (
    <div className="dex-view">
      {/* REQ-0075: page header (mock .pagehead) -- kicker / hall title /
          lede, then a rune divider. Mirrors the sibling ports' pagehead
          strip (SchedulePage/CanvasChrome). */}
      <section className="dex-pagehead">
        <div className="dex-pagehead-main">
          <div className="dex-pagehead-kicker den">{t(locale, 'dex.pageKicker')}</div>
          <h1 className="dex-pagehead-title dj dj-wide">{t(locale, 'dex.pageTitle')}</h1>
          <div className="dex-pagehead-lede">{t(locale, 'dex.pageLede')}</div>
        </div>
      </section>
      <div className="rune-divider dex-pagehead-divider" aria-hidden="true">
        ᚲ
      </div>

      {/* REQ-0075: progress strip (mock .dexstrip) -- collection readout +
          gold bar on the left, filter/tab chips on the right. */}
      <section className="panel ornate dex-strip">
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />
        <div className="dex-strip-prog">
          <div className="dex-strip-nums">
            <span className="dex-strip-big tnum" data-testid="dex-collected-count">
              {collectedPages}
            </span>
            <span className="dex-strip-of tnum">/ {totalPages}</span>
            <span className="dj dex-strip-word">{t(locale, 'dex.collectedWord')}</span>
            <span className="den dex-strip-den">{t(locale, 'dex.collectedDen')}</span>
          </div>
          <div className="bar dex-strip-bar">
            <div className="fill gold" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <div className="dex-strip-note t-micro">{t(locale, 'dex.stripNote')}</div>
      </section>

      {/* Tab row kept (its text is E2E-load-bearing: dex-admin.spec asserts
          the active "Items"/"アイテム" tab flips with the locale). Now
          styled as theme chips to match the mock's chip row. */}
      <div className="dex-tab-row" role="tablist">
        <button type="button" className="chip is-on dex-tab dex-tab-active" role="tab" aria-selected="true">
          {t(locale, 'dex.tabItems')}
        </button>
        {RESERVED_TABS.map((key) => (
          <button
            key={key}
            type="button"
            className="chip dex-tab is-locked"
            role="tab"
            aria-selected="false"
            disabled
            title={t(locale, 'dex.reservedTitle')}
          >
            {t(locale, key)}
          </button>
        ))}
      </div>

      {/* Catalog section head (mock .colhead). */}
      <div className="dex-colhead">
        <span className="dex-colhead-rn rune">ᚲ</span>
        <h2 className="dj dex-colhead-title">{t(locale, 'dex.catalogTitle')}</h2>
        <span className="den dex-colhead-den">{t(locale, 'dex.catalogDen')}</span>
        <span className="dex-colhead-grow" />
        <span className="t-micro">{t(locale, 'dex.catalogNote')}</span>
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
        <select className="dex-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">{t(locale, 'dex.tagAll')}</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <span className="dex-count">
          {filtered.length} / {entries.length}
        </span>
      </div>

      <div className="dex-grid dgrid">
        {filtered.map((e) => {
          const icon = iconDataUrl(e.entry.icon);
          const no = dexNos[e.id];
          const cat = categoryOf(e);
          const displayName = locale === 'ja' ? nameJaOf(e.entry) || nameOf(e.entry) : nameOf(e.entry);
          return (
            <div key={e.id} className={`dex-card dcard rar ${rarThemeClass(e.entry.rarity)}`}>
              <button
                type="button"
                className="dex-card-summary dcard-btn"
                onClick={() => setSelectedId(e.id)}
              >
                <span className="gem" aria-hidden="true" />
                {no != null ? (
                  <span className="dex-card-no no t-micro tnum">No.{String(no).padStart(3, '0')}</span>
                ) : (
                  <span className="dex-card-no dex-card-no-kind t-micro">{e.kind === 'po' ? 'PO' : 'SI'}</span>
                )}
                <span className="dex-card-shape dthumb">
                  <ShapeGrid
                    shape={shapeOf(e.entry)}
                    cellPx={20}
                    iconUrl={icon}
                    iconAlt={e.entry.icon}
                    iconDims={iconDims(e.entry.icon)}
                    iconStretch={stretchOf(e.entry)}
                  />
                </span>
                <div className="dex-card-summary-text">
                  <div className="dex-card-name dname">{displayName}</div>
                  <div className="dex-card-sub dsub">
                    {cat ? <span className="dex-card-cat">{cat}</span> : null}
                    <span className="dex-card-enname">{nameOf(e.entry).toUpperCase()}</span>
                  </div>
                  <div className="dex-card-meta dfoot">
                    <span className={`rar-word rarity r-${e.entry.rarity}`}>{e.entry.rarity.toUpperCase()}</span>
                    <span className="dex-card-id">{e.id}</span>
                    <span className="dex-card-kind">{e.kind === 'po' ? 'PO' : 'SI'}</span>
                  </div>
                </div>
              </button>
              {/* REQ-0052: Dex card subwindow preview trigger -- opens
                  the SAME entry's card via the shared API+window
                  (DexCardWindow.tsx) WITHOUT navigating away from the
                  catalog grid, distinct from the button above (which
                  still does the pre-existing onSelect -> full detail-
                  view switch, UNCHANGED). stopPropagation so a click
                  here never also fires the summary button underneath. */}
              <button
                type="button"
                className="dex-card-preview-btn"
                data-testid="dex-card-preview-btn"
                aria-label={t(locale, 'dexcard.previewAria')}
                title={t(locale, 'dexcard.previewAria')}
                onClick={(ev) => {
                  ev.stopPropagation();
                  openCard(e.kind === 'po' ? 'item' : 'si', e.id);
                }}
              >
                <span aria-hidden="true">i</span>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 ? <div className="dex-empty">{t(locale, 'dex.noMatch')}</div> : null}
      </div>

      {/* REQ-0042: TM (Transmutator) catalog strip -- display-only, see
          tmEntries()'s module comment for why this is deliberately NOT
          folded into the main selectable PO/SI dex-grid above. */}
      {tms.length > 0 ? (
        <div className="dex-tm-section">
          <div className="dex-colhead dex-tm-colhead">
            <span className="dex-colhead-rn rune">ᚠ</span>
            <h2 className="dj dex-colhead-title dex-tm-section-title">{t(locale, 'dex.tmSectionTitle')}</h2>
          </div>
          <div className="dex-tm-grid dgrid">
            {tms.map((tmEntry) => {
              const icon = iconDataUrl(tmEntry.icon);
              return (
                <div key={tmEntry.id} className={`dex-tm-card dcard rar ${rarThemeClass(tmEntry.rarity)}`}>
                  <span className="gem" aria-hidden="true" />
                  <span className="dex-card-shape dthumb">
                    <ShapeGrid
                      shape={[[0, 0]]}
                      cellPx={20}
                      iconUrl={icon}
                      iconAlt={tmEntry.icon}
                      iconDims={iconDims(tmEntry.icon)}
                    />
                  </span>
                  <div className="dex-card-summary-text">
                    <div className="dex-card-name dname">
                      {locale === 'ja' ? tmEntry.name_ja || tmEntry.name : tmEntry.name}
                    </div>
                    <div className="dex-card-sub dsub">
                      <span className="dex-card-cat">{tmEntry.short || 'TM'}</span>
                      <span className="dex-card-enname">{tmEntry.name.toUpperCase()}</span>
                    </div>
                    <div className="dex-card-meta dfoot">
                      <span className={`rar-word rarity r-${tmEntry.rarity}`}>{tmEntry.rarity.toUpperCase()}</span>
                      <span className="dex-card-id">{tmEntry.id}</span>
                      <span className="dex-card-kind">TM</span>
                      {tmEntry.stackable ? <span className="dex-tm-stackable">{t(locale, 'dex.tmStackable')}</span> : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
