// Warehouse tab (golden f) -- REQ-0036 P1-C, REWRITTEN by REQ-0041 for
// the two-phase claim + embedded InventoryBoard design.
//
// REQ-0041 changes from the original REQ-0036 P1-C version:
//  - This tab now EMBEDS the REAL InventoryBoard component (same Pixi
//    Application/BoardRenderer instance the Backpacks page uses -- see
//    board/inventorySlot.ts's module comment for the full "reuse via
//    portal, not a second Pixi app" decision writeup) + its Tabs, so the
//    inventory shown here is fully operable with EXACTLY the same
//    behavior as the Backpacks page (by construction, not by
//    reimplementation -- it IS the same component instance).
//  - The claim flow is now two-phase (bug #3's fix, see server/
//    schedule.cjs's claimWarehouseItem doc): POST claim marks the row
//    'claiming' and returns {itemUid, itemId} WITHOUT placing anything
//    server-side. THIS component now performs the engine first-fit
//    placement itself (open page first, then other pages in order),
//    pulses the placed cell(s) (~2s, BoardRenderer.pulseCellsSuccess),
//    pulse-highlights the destination tab if it lands on a page other
//    than the currently-open one, and finally calls notifyStateChanged()
//    -- the SAME auto-save choke point every other board mutation in
//    this app already goes through -- so the server's existing profile-
//    PUT finalization path (server/api.cjs) picks up the placement and
//    deletes the warehouse row on its own, with NO manual/explicit save
//    call from here (that would bypass the app's one-writer auto-save
//    discipline, defeating the whole point of the two-phase design).
//  - If NO page anywhere has room, this shows a toast error and leaves
//    the row 'claiming' -- per the REQ's own accepted design ("no item
//    loss on crash" via the lazy server-side timeout revert), no
//    explicit "abandon claim" endpoint was added (see the REQ-0041
//    outcome doc for this documented decision): the row simply reverts
//    to claimable server-side after WAREHOUSE_CLAIM_TIMEOUT_MS if this
//    client never manages to place it, without any extra round-trip.
//
// REQ-0072 (MJOLNIR re-skin; mock: web/redesign/warehouse.html):
// presentation-only rewrite of the render tree -- the claim machinery
// above (two-phase claim, engine first-fit, pulse/tab-pulse, auto-save
// finalization, poll cadence, claim-all walk order) is UNCHANGED, and
// so is every E2E-load-bearing selector (schedule-warehouse-row /
// schedule-claim-btn-<uid> / schedule-warehouse-toast /
// schedule-claim-all-btn / schedule-warehouse-capacity-* /
// .schedule-slot-error / schedule-warehouse-board-slot). New chrome:
// ornate capacity topstrip (gold bar + staged warning kept), a
// DECAYING SOON section for rows within 48h of expiry, the stone-shelf
// card grid (rarity-framed .wcard anatomy with per-row Joermungandr TTL
// ring + provenance chip + NEW badge), kind-based filter chips, and the
// footer lore. Rows are ordered soonest-to-expire within BOTH sections
// (the REQ-0046 sort, unchanged in spirit -- the danger split is that
// same ordering made spatial). What the mock shows with no backing
// data (weapon/frost/ember filters, seller names, boss provenance,
// non-decaying currency) is inferred or omitted per
// docs/REQ-0072-redesign-warehouse.md.
//
// REQ-0086 (promoted to an independent top-level route): this file is a
// direct extraction of the former client/src/schedule/WarehouseTab.tsx
// (embedded as the #/schedule page's WAREHOUSE tab) into its own
// `#/warehouse` route + Nav.tsx rail entry. Extraction only -- every
// mechanism described above (two-phase claim, embedded InventoryBoard
// portal, capacity/danger/shelf/filter/TTL-ring presentation, every
// E2E-load-bearing selector) is UNCHANGED. What changed structurally:
// this component now owns its own permanent pagehead/key-art/rune-
// divider (previously SchedulePage swapped that chrome's identity
// between Rooms and Warehouse depending on which tab was active -- see
// SchedulePage.tsx, which keeps only the Rooms/Expedition identity now)
// and fetches its own one-shot rooms/dungeons copy for the provenance
// chip (previously passed down as props from SchedulePage, which no
// longer renders this component at all).
//
// This supersedes REQ-0036's original golden-f placement decision
// ("Warehouse -> inventory transfer any time (Warehouse tab inside
// Schedule screen)") per a direct 2026-07-07 user instruction (recorded
// as REQ-0086 on the docs FS, since docs/REQ lives there, not in this
// repo -- see PROJECT.md). The mock (web/redesign/*.html) always showed
// 倉庫 as its own rail entry across every page's nav, including its own
// dedicated warehouse.html document; REQ-0069 found this and explicitly
// deferred adding it ("the warehouse lives as a Schedule tab today").
// REQ-0086 lands that deferred entry.
//
// REQ-0091 (claim button press feedback + double-press guard, direct
// user instruction via https://backpack-dev.qtie.jp/app/#/warehouse):
// additive only, no change to the two-phase claim machinery itself.
// Pressing a row's claim button now flashes that row's OWN frame (CSS
// schedule-claim-flash, index.css) + plays a short synthesized chime
// (warehouse/claimSfx.ts) immediately; the moment the claim POST's
// response is known (success or error), the flash hands off to a
// one-shot fade-out (schedule-claim-fadeout) and is removed from the DOM
// once that finishes. A ref-based guard (claimLockRef) closes the same-
// row double-press race the existing disabled={isClaiming} attribute
// alone cannot (state updates are batched/async; the ref mutates
// immediately). New hooks only -- no selector in the contract above was
// renamed or removed.
// REQ-0145b (cd): split. Data + the claim/claim-all machinery moved
// VERBATIM to useWarehouseData.ts; the TTL ring to TtlRing.tsx. This
// file keeps the presentation: filter chips, countdown ticker, capacity
// strip, danger/shelf grids, the embedded-board portal slot.
import { useEffect, useRef, useState } from 'react';
import { setInventorySlot } from '../board/inventorySlot';
import { iconDataUrl } from '../dex/dexIcons';
import { rarThemeClass } from '../render/uiBits';
import { contentEntryFor, localizedItemName } from '../lib/itemContent';
import { itemKindOf } from '../../../shared/player_actions.mjs'; // REQ-0310
import { formatWarehouseCountdown } from '../lib/time';
import { localizedName } from '../lib/contentName'; // REQ-0239: relocated
import { t } from '../i18n';
import { setRoute, type Locale } from '../store';
import { SellModal } from './SellModal'; // REQ-0366
import { TtlRing } from './TtlRing';
import { useWarehouseData, type WarehouseRow } from './useWarehouseData';
import { WAREHOUSE_CAP } from '../../../shared/constants.json';

interface WarehousePageProps {
  locale: Locale;
}

// REQ-0072: rows closer than this to expiry move into the mock's
// DECAYING SOON section (its example rows read 期限 2日 / 期限 1日) and
// wear the red TTL treatment. Supersedes the old 24h "warm label"
// threshold -- same idea, made a section instead of a tint.
const DECAY_SOON_MS = 2 * 86400000;
// REQ-0072: the mock's NEW badge / 新着 count. No "seen" tracking exists
// anywhere in the data model, so "new" is honestly derived from the
// row's own harvestedAt: delivered within the last 24h (one Muninn
// night, matching the mock's 「今夜搬入」 framing).
const FRESH_MS = 86400000;

/* REQ-0075: rarThemeClass (app ramp -> theme .rar-* frame) moved to
   client/src/render/uiBits.ts so the Dex port reuses the SAME mapping
   instead of a second copy -- imported above. */

type WarehouseFilter = 'all' | 'spoils' | 'currency';

/** REQ-0374: the way OUT of a "there is no room" message. Both surfaces that
 * report the problem -- the per-claim no-space toast and the full-warehouse
 * capacity banner -- name it and, before this REQ, stopped there; the player
 * was told the shelf is jammed and left to work out that the fix lives on
 * another route. Navigation goes through the store's setRoute (the app's ONE
 * navigation path). REQ-0373's per-page auto-arrange button is the affordance
 * this lands NEXT TO once it exists; until then the inventory itself is the
 * honest destination -- nothing here depends on that REQ having landed. */
function OrganizeLink({ locale, testId }: { locale: Locale; testId: string }) {
  return (
    <button
      type="button"
      className="btn btn-ghost schedule-warehouse-organize-btn"
      data-testid={testId}
      onClick={() => setRoute('backpacks')}
    >
      {t(locale, 'schedule.warehouse.organizeCta')}
    </button>
  );
}

export function WarehousePage({ locale }: WarehousePageProps) {
  const {
    items,
    loadError,
    content,
    rooms,
    dungeons,
    toast,
    toastAction,
    claimingUid,
    claimingAll,
    claimFx,
    claimErrors,
    sellingUid,
    handleClaim,
    handleClaimAll,
    handleSell,
  } = useWarehouseData(locale);
  const [now, setNow] = useState(() => Date.now());
  // REQ-0072: kind-based display filter (mock filter chips). The mock's
  // weapon/frost/ember chips have no backing taxonomy (see the notes
  // doc); `kind:'tm'` vs everything else is the one REAL category split
  // a row carries, so the honest chip set is all / spoils / currency.
  // Display-only: claim-all still walks the FULL list.
  const [filter, setFilter] = useState<WarehouseFilter>('all');
  // REQ-0366: the row whose direct-sell modal is open (null = closed).
  const [sellRow, setSellRow] = useState<WarehouseRow | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);

  // REQ-0041: claim this DOM node as the inventory column's portal
  // target for as long as this tab is mounted (see board/inventorySlot.ts
  // for the full mechanism) -- releases it (back to null, i.e. "render
  // in the normal Backpacks-page spot") on unmount, matching this app's
  // existing "never leave a stale registration behind" discipline (same
  // shape as drag.ts's registerBoard cleanup, store.ts's subscribe
  // cleanup, etc).
  useEffect(() => {
    setInventorySlot(slotRef.current);
    return () => setInventorySlot(null);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // REQ-0072: resolves the mock's provenance chip (「出所: …」) from the
  // ONLY origin data a row actually carries: sourceListingId (market
  // settlement -- gold-etched chip, mock REQ-0065 P1-5 treatment) or
  // sourceRoomId -> the player's own room -> its dungeon's display name.
  // Dev grants (both sources null) and unresolvable rooms yield null --
  // the chip is omitted rather than invented.
  const provenanceFor = (row: WarehouseRow): { market: boolean; name?: string } | null => {
    if (row.sourceListingId) return { market: true };
    if (row.sourceRoomId) {
      const room = rooms?.find((r) => r.id === row.sourceRoomId);
      const entry = room ? dungeons?.dungeons.find((d) => d.id === room.dungeonId) : undefined;
      if (entry) return { market: false, name: localizedName(locale, entry) };
    }
    return null;
  };

  // Render soonest-to-expire first (REQ-0046, unchanged). `items` itself
  // stays unchanged for length/cap math below.
  const sortedItems = items ? [...items].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt)) : null;

  // Staged capacity warning (REQ-0046, unchanged thresholds). server/
  // schedule.cjs's addToWarehouse SILENTLY DROPS new rewards once at
  // WAREHOUSE_CAP, so 'full' is a real data-loss state, not just a
  // styling threshold.
  const capRatio = (items?.length ?? 0) / WAREHOUSE_CAP;
  const capState: 'calm' | 'warning' | 'full' = capRatio >= 1 ? 'full' : capRatio >= 0.7 ? 'warning' : 'calm';

  // REQ-0072 derived presentation: danger split + shelf tallies. All
  // counts are computed from the UNFILTERED list (the filter chips only
  // narrow what is shown, never what is counted or claim-all-walked).
  const dangerCount = items ? items.filter((i) => Date.parse(i.expiresAt) - now < DECAY_SOON_MS).length : 0;
  const kindCount = items ? new Set(items.map((i) => i.itemId)).size : 0;
  const pieceCount = items ? items.reduce((sum, i) => sum + (i.qty ?? 1), 0) : 0;
  const freshCount = items ? items.filter((i) => now - Date.parse(i.harvestedAt) < FRESH_MS).length : 0;

  const matchesFilter = (row: WarehouseRow): boolean => {
    if (filter === 'all') return true;
    const isCurrency = row.kind === 'tm';
    return filter === 'currency' ? isCurrency : !isCurrency;
  };
  const visibleItems = sortedItems ? sortedItems.filter(matchesFilter) : null;
  const dangerRows = visibleItems ? visibleItems.filter((i) => Date.parse(i.expiresAt) - now < DECAY_SOON_MS) : [];
  const shelfRows = visibleItems ? visibleItems.filter((i) => Date.parse(i.expiresAt) - now >= DECAY_SOON_MS) : [];

  const capWord = t(locale, 'schedule.warehouse.capWord');

  const filterChip = (key: WarehouseFilter, label: string) => (
    <button
      type="button"
      className={`chip schedule-warehouse-filter-chip${filter === key ? ' is-on' : ''}`}
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      data-testid={`schedule-warehouse-filter-${key}`}
      key={key}
    >
      {label}
    </button>
  );

  // One warehouse card (mock .wcard): rarity frame + corner gem, 64px
  // thumb (with stack count), name/sub/provenance column, and the TTL
  // ring + claim button side rail. Shared verbatim by the DECAYING SOON
  // grid and the stone shelf -- only the container differs.
  const renderRow = (item: WarehouseRow) => {
    const expiresMs = Date.parse(item.expiresAt) - now;
    const lifetimeMs = Date.parse(item.expiresAt) - Date.parse(item.harvestedAt);
    const ttlPct = lifetimeMs > 0 ? (expiresMs / lifetimeMs) * 100 : 0;
    const expired = expiresMs <= 0;
    const danger = expiresMs < DECAY_SOON_MS; // includes expired
    const fresh = now - Date.parse(item.harvestedAt) < FRESH_MS;
    const rowKind = item.kind === 'tm' ? 'tm' : itemKindOf(content, item.itemId);
    const entry = contentEntryFor(content, rowKind, item.itemId);
    const icon = entry ? iconDataUrl(entry.icon) : null;
    const qty = item.qty ?? 1;
    const src = provenanceFor(item);
    const isClaiming = claimingUid === item.itemUid;
    const isSelling = sellingUid === item.itemUid; // REQ-0328
    // REQ-0091: press-feedback class on the row's OWN frame -- 'flash'
    // while the claim POST is in flight, 'fadeout' once the response is
    // back (see handleClaim/beginClaimFadeOut); absent otherwise.
    const fx = claimFx[item.itemUid];
    const fxClass = fx === 'flash' ? ' schedule-claim-flash' : fx === 'fadeout' ? ' schedule-claim-fadeout' : '';
    return (
      <article
        className={`schedule-warehouse-row rar ${rarThemeClass(entry?.rarity)}${danger ? ' is-danger' : ''}${rowKind === 'tm' ? ' schedule-warehouse-row-stack' : ''}${fxClass}`}
        key={item.itemUid}
        data-testid="schedule-warehouse-row"
        data-item-uid={item.itemUid}
        title={t(locale, 'schedule.warehouse.harvested', { time: new Date(item.harvestedAt).toLocaleString(locale) })}
      >
        {fresh ? (
          <span className="schedule-warehouse-badge-new den" data-testid="schedule-warehouse-badge-new">
            {t(locale, 'schedule.warehouse.badgeNew')}
          </span>
        ) : null}
        <span className="gem" aria-hidden="true" />
        <span className="schedule-warehouse-icon-frame">
          {icon ? <img src={icon} alt="" /> : null}
          {qty > 1 ? <span className="schedule-warehouse-qcnt tnum">&times;{qty}</span> : null}
        </span>
        <div className="schedule-warehouse-row-main">
          <div className="schedule-warehouse-item-name dj">{localizedItemName(locale, content, item.itemId)}</div>
          <div className="schedule-warehouse-row-sub">
            {entry ? <span className={`rar-word rarity r-${entry.rarity}`}>{entry.rarity}</span> : null}
            {rowKind === 'tm' ? <span className="kw-gold">{t(locale, 'schedule.warehouse.currencyWord')}</span> : null}
            <span className="tnum">&times;{qty}</span>
            <span className={`schedule-warehouse-item-expiry${danger ? ' schedule-warehouse-item-expiry-soon' : ''}`}>
              {expired
                ? t(locale, 'schedule.warehouse.expired')
                : t(locale, 'schedule.warehouse.expiresIn', { time: formatWarehouseCountdown(expiresMs, locale) })}
            </span>
          </div>
          {src ? (
            <div className="schedule-warehouse-row-src">
              <span
                className={`chip schedule-warehouse-src${src.market ? ' schedule-warehouse-src-market' : ''}`}
                data-testid="schedule-warehouse-src"
              >
                {src.market ? t(locale, 'schedule.warehouse.srcMarket') : t(locale, 'schedule.warehouse.srcDungeon', { name: src.name ?? '' })}
              </span>
              {src.market ? <div className="schedule-warehouse-src-note t-micro">{t(locale, 'schedule.warehouse.srcMarketNote')}</div> : null}
            </div>
          ) : null}
          {claimErrors[item.itemUid] ? (
            <div className="schedule-slot-error">
              {claimErrors[item.itemUid]}
              {/* REQ-0374: the per-ROW copy of the no-space message gets the
                  same way out as the toast -- the toast auto-clears after 4s
                  and this line does not, so the row is where a player who
                  looked away still finds it. Keyed off the message being the
                  no-space one rather than a second piece of state: the row's
                  error is a rendered STRING by construction (see
                  useWarehouseData's setClaimErrors call sites), and the
                  comparison is against the very t() call that produced it. */}
              {claimErrors[item.itemUid] === t(locale, 'schedule.warehouse.claimNoSpace') ? (
                <OrganizeLink locale={locale} testId={`schedule-warehouse-row-organize-${item.itemUid}`} />
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="schedule-warehouse-row-side">
          <TtlRing
            pct={ttlPct}
            danger={danger}
            label={t(locale, 'schedule.warehouse.ringTitle', { pct: Math.max(0, Math.round(ttlPct)) })}
          />
          <button
            type="button"
            className={`btn schedule-claim-btn${isClaiming ? ' placing' : ''}`}
            disabled={isClaiming}
            onClick={() => void handleClaim(item.itemUid)}
            data-testid={`schedule-claim-btn-${item.itemUid}`}
          >
            {isClaiming ? t(locale, 'schedule.warehouse.claiming') : t(locale, 'schedule.warehouse.claimButton')}
          </button>
          {/* REQ-0328: sell a drop DIRECTLY from the warehouse to the
              market (no claim-to-canvas first). Hidden for currency (tm)
              rows, which have no direct-sell path server-side.
              REQ-0366: opens the SellModal (market price-carve UI) --
              the POST fires from the modal's confirm, not from here. */}
          {item.kind !== 'tm' ? (
            <button
              type="button"
              className="btn schedule-sell-btn"
              disabled={isSelling}
              onClick={() => setSellRow(item)}
              data-testid={`schedule-sell-btn-${item.itemUid}`}
            >
              {isSelling ? t(locale, 'schedule.warehouse.selling') : t(locale, 'schedule.warehouse.sellButton')}
            </button>
          ) : null}
        </div>
      </article>
    );
  };

  const pageSub = t(locale, 'schedule.warehouse.pageSub');
  const pageTitle = t(locale, 'schedule.warehouse.pageTitle');
  const pageLede = t(locale, 'schedule.warehouse.pageLede');

  return (
    <div className="schedule-page">
      {/* REQ-0086: full-viewport key art -- same served /redesign/assets
          convention as the Expedition page (REQ-0071/0072). This page
          always wears the warehouse identity now (no more swapping with
          a sibling Rooms tab -- see SchedulePage.tsx, which keeps its
          own permanent Expedition identity after this split). */}
      <div className="warehouse-bgart" aria-hidden="true" />

      <section className="schedule-pagehead">
        <div className="schedule-pagehead-main">
          {pageSub ? <div className="schedule-pagehead-kicker den">{pageSub}</div> : null}
          <h1 className="schedule-pagehead-title dj dj-wide">{pageTitle}</h1>
          <div className="schedule-pagehead-lede">{pageLede}</div>
        </div>
      </section>
      <div className="rune-divider schedule-pagehead-divider" aria-hidden="true">
        ᚷ
      </div>

      <div className="schedule-warehouse-tab">
      {/* mock .topstrip: capacity meter / near-expiry chip / filters /
          bulk claim. Same staged capacity semantics as before (REQ-0046)
          -- calm/warning/full classes and the warning-text testid are
          load-bearing names, kept verbatim. */}
      <section className="panel ornate schedule-warehouse-topstrip" data-testid="schedule-warehouse-topstrip">
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />
        <div className="schedule-warehouse-capblock">
          <div className="schedule-warehouse-caphead">
            <span className="schedule-warehouse-cap tnum" data-testid="schedule-warehouse-cap">
              {items?.length ?? 0}
              <span className="schedule-warehouse-cap-of">/{WAREHOUSE_CAP}</span>
            </span>
            {capWord ? <span className="dj schedule-warehouse-cap-word">{capWord}</span> : null}
            <span className="den schedule-warehouse-cap-den">{t(locale, 'schedule.warehouse.capDen')}</span>
          </div>
          <div
            className={`bar schedule-warehouse-capacity-bar schedule-warehouse-capacity-${capState}`}
            data-testid="schedule-warehouse-capacity-bar"
          >
            <div className="fill gold schedule-warehouse-capacity-fill" style={{ width: `${Math.min(100, capRatio * 100)}%` }} />
          </div>
        </div>
        {dangerCount > 0 ? (
          <span className="chip warn schedule-warehouse-warnchip" data-testid="schedule-warehouse-warnchip">
            ⚠ {t(locale, 'schedule.warehouse.expiryWarnChip', { count: dangerCount })}
          </span>
        ) : null}
        <div className="schedule-warehouse-filters" role="group">
          {filterChip('all', t(locale, 'schedule.warehouse.filterAll'))}
          {filterChip('spoils', t(locale, 'schedule.warehouse.filterSpoils'))}
          {filterChip('currency', t(locale, 'schedule.warehouse.filterCurrency'))}
        </div>
        <span className="schedule-warehouse-grow" />
        <button
          type="button"
          className="btn btn-forge schedule-claim-all-btn"
          onClick={() => void handleClaimAll()}
          disabled={claimingAll || !items || items.length === 0}
          data-testid="schedule-claim-all-btn"
        >
          <span className="rune" aria-hidden="true">
            ᚷ
          </span>{' '}
          {claimingAll ? t(locale, 'schedule.warehouse.claimingAll') : t(locale, 'schedule.warehouse.claimAllButton')}
        </button>
        {capState !== 'calm' ? (
          <div
            className={`schedule-warehouse-capacity-warning-text ${capState}`}
            data-testid="schedule-warehouse-capacity-warning"
          >
            {capState === 'full' ? t(locale, 'schedule.warehouse.capFull') : t(locale, 'schedule.warehouse.capWarning')}
            {/* REQ-0374: the FULL banner is the harshest message this page
                shows ("rewards are being lost"); it now carries the fix. The
                milder 'warning' state deliberately does not -- there is still
                room, so nothing is being asked of the player yet. */}
            {capState === 'full' ? <OrganizeLink locale={locale} testId="schedule-warehouse-cap-organize" /> : null}
          </div>
        ) : null}
        <div className="schedule-warehouse-strip-note t-micro">{t(locale, 'schedule.warehouse.stripNote')}</div>
      </section>

      {loadError ? <div className="schedule-error">{t(locale, 'schedule.warehouse.loadFailed')}{loadError}</div> : null}
      {toast ? (
        <div className="schedule-toast" data-testid="schedule-warehouse-toast">
          {toast}
          {/* REQ-0374: only a toast that carries an action renders one (today:
              the no-space claim failure). See useWarehouseData's toastAction. */}
          {toastAction === 'organize' ? <OrganizeLink locale={locale} testId="schedule-warehouse-toast-organize" /> : null}
        </div>
      ) : null}

      {sortedItems === null ? (
        <div className="schedule-loading">{t(locale, 'schedule.loading')}</div>
      ) : sortedItems.length === 0 ? (
        <div className="schedule-empty">{t(locale, 'schedule.warehouse.empty')}</div>
      ) : (
        <>
          {/* mock DECAYING SOON strip: rows within 48h of expiry, pulled
              out ABOVE the shelf. Same soonest-first ordering. */}
          {dangerRows.length > 0 ? (
            <>
              <div
                className="schedule-warehouse-colhead schedule-warehouse-colhead-danger"
                data-testid="schedule-warehouse-danger-head"
              >
                <span className="schedule-warehouse-colhead-rn">⚠</span>
                <h3 className="dj">{t(locale, 'schedule.warehouse.dangerTitle')}</h3>
                <span className="den schedule-warehouse-colhead-den">{t(locale, 'schedule.warehouse.dangerDen')}</span>
                <span className="t-micro">{t(locale, 'schedule.warehouse.dangerNote')}</span>
              </div>
              <div className="schedule-warehouse-danger-grid" data-testid="schedule-warehouse-danger-grid">
                {dangerRows.map(renderRow)}
              </div>
            </>
          ) : null}

          {/* mock stone shelf (.shelf .mat-stone): the stored-spoils grid
              with the kinds/pieces/new tally in its colhead. */}
          <section className="panel ornate schedule-warehouse-shelf" data-testid="schedule-warehouse-shelf">
            <i className="k tl" />
            <i className="k tr" />
            <i className="k br" />
            <i className="k bl" />
            <div className="schedule-warehouse-colhead">
              <span className="schedule-warehouse-colhead-rn rune">ᚷ</span>
              <h3 className="dj">{t(locale, 'schedule.warehouse.shelfTitle')}</h3>
              <span className="den schedule-warehouse-colhead-den">{t(locale, 'schedule.warehouse.shelfDen')}</span>
              <span className="schedule-warehouse-colhead-grow" />
              <span className="t-micro tnum" data-testid="schedule-warehouse-shelf-count">
                {t(locale, 'schedule.warehouse.shelfCount', { kinds: kindCount, pieces: pieceCount })}
                {freshCount > 0 ? ` ・ ${t(locale, 'schedule.warehouse.shelfFresh', { fresh: freshCount })}` : ''}
              </span>
            </div>
            {shelfRows.length > 0 ? (
              <div className="schedule-warehouse-list">{shelfRows.map(renderRow)}</div>
            ) : (
              <div className="schedule-empty">
                {t(locale, dangerRows.length > 0 || filter !== 'all' ? 'schedule.warehouse.shelfFiltered' : 'schedule.warehouse.empty')}
              </div>
            )}
          </section>
        </>
      )}

      {/* REQ-0041: the Warehouse tab's embedded inventory board -- this
          div is the PORTAL TARGET App.tsx's InventoryColumn (Tabs +
          InventoryBoard) renders into while this tab is mounted (see
          board/inventorySlot.ts's module comment for the full
          reuse-via-portal decision). Fully operable with EXACTLY the
          same behavior as the Backpacks page's own inventory panel, by
          construction (it IS the same component instance/Pixi
          Application, not a reimplementation). */}
      <div className="schedule-warehouse-board-slot" ref={slotRef} data-testid="schedule-warehouse-board-slot" />

      {/* mock .wfoot -- lore line + the first-fit explainer (which states
          REAL behavior: handleClaim's placement + no-space posture). */}
      <footer className="schedule-warehouse-foot">
        <div className="rune-divider" aria-hidden="true">
          ᛞ
        </div>
        <div className="schedule-warehouse-foot-lore">{t(locale, 'schedule.warehouse.footLore')}</div>
        <div className="t-micro">{t(locale, 'schedule.warehouse.footNote')}</div>
      </footer>
      </div>

      {/* REQ-0366: the direct-sell price modal -- the market's own
          price-carve UI replacing REQ-0328's raw browser prompt(), the
          product's last raw browser dialog. Modal behavior (Esc /
          overlay-click / focus trap / initial focus) follows the
          REQ-0369 conventions via lib/useModalConventions. */}
      {sellRow ? (
        <SellModal
          row={sellRow}
          content={content}
          locale={locale}
          busy={sellingUid === sellRow.itemUid}
          onConfirm={(qty) => {
            void handleSell(sellRow.itemUid, qty).then((ok) => {
              if (ok) setSellRow(null);
            });
          }}
          onClose={() => {
            if (sellingUid !== sellRow.itemUid) setSellRow(null);
          }}
        />
      ) : null}
    </div>
  );
}
