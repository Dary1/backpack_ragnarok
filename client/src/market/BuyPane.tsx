// client/src/market/BuyPane.tsx -- REQ-0064 BUY pane (火床の品書き /
// "The hearth's menu"). Filter chips + Dex-No/name search + listing
// cards. Chips are CONTENT-DEFINED: the fixed mock chip labels map to
// real content tag/rarity VALUES, and each chip only renders when at
// least one live listing actually carries that value (so the chip row is
// bound to real content, never a hardcoded list disconnected from what's
// on the hearth). Suspended cards render a lock chip + disabled buy.
//
// REQ-0375 adds the two things a menu needs once the hearth is BUSY (bot
// fleet + public co-op push listing volume up): an explicit SORT order
// (price asc/desc, newest) and an INCREMENTAL reveal, so a many-hundreds
// payload never mounts many-hundreds of cards at once. Both are purely
// client-side: the wire payload is still the full list (server-side
// pagination is deliberately NOT this REQ -- see the REQ file for the
// listing-count threshold at which it becomes its own).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiMarketListing, GameData } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { RollBar, MarketThumb, PriceTag, dexNoLabel, listingKindLine } from './marketShared';

/** The chip vocabulary. TAG chips carry a `match` value compared
 * (lowercased) against each listing's tags[]/rarity, and KIND chips
 * (REQ-0195a) carry a `kind` matched against the listing's own kind --
 * both EXACTLY mirroring the server's matchesFilter, so a chip and its
 * server-side filter agree. The server also accepts these raw values as
 * ?filter=, but the BUY grid filters client-side (all active+suspended
 * listings are already loaded) for instant chip response, matching the
 * mock's client-only chip toggle. 'all' is the always-present reset chip.
 * Only chips whose value appears in >=1 current listing are shown
 * (content-bound). */
interface ChipDef {
  key: string;
  labelKey: Parameters<typeof t>[1];
  /** A TAG chip's tags[]/rarity value (null on the 'all' reset chip). A
   * KIND chip leaves this undefined and sets `kind` instead. */
  match?: string | null;
  /** REQ-0195a KIND chip: matched against the listing's OWN kind (mirrors
   * the server's matchesFilter kind tokens), not any tag/rarity. */
  kind?: 'po' | 'si' | 'unit' | 'tm';
  /** Optional keyword class for the ember/frost tinted chips (mock). */
  kw?: 'ember' | 'frost';
}

const CHIP_DEFS: ChipDef[] = [
  { key: 'all', labelKey: 'market.chip.all', match: null },
  { key: 'weapon', labelKey: 'market.chip.weapon', match: 'weapon' },
  { key: 'frost', labelKey: 'market.chip.frost', match: 'frost', kw: 'frost' },
  { key: 'ember', labelKey: 'market.chip.ember', match: 'ember', kw: 'ember' },
  { key: 'relic', labelKey: 'market.chip.relic', match: 'relic' },
  // REQ-0195a KIND chips: narrow the hearth to a single listing kind (the
  // market trades po/si/unit/tm now). Content-bound like the tag chips --
  // each shows only when a listing of that kind is live -- and matched by
  // l.kind, exactly as the server's matchesFilter kind tokens do. Labels
  // reuse the SELL tab's kind vocabulary (market.sell.kind*).
  { key: 'po', labelKey: 'market.sell.kindPo', kind: 'po' },
  { key: 'si', labelKey: 'market.sell.kindSi', kind: 'si' },
  { key: 'unit', labelKey: 'market.sell.kindUnit', kind: 'unit' },
  { key: 'tm', labelKey: 'market.sell.kindTm', kind: 'tm' },
];

/** REQ-0375: the buy-pane sort orders. `newest` is the DEFAULT and is a
 * client-side restatement of the order the server already returns
 * (services/market/views.cjs listListings sorts createdAt-descending as
 * its last step) -- we re-sort here anyway so the pane's order is the
 * PANE's own contract and cannot silently change if that server default
 * ever moves. */
export type BuySort = 'newest' | 'priceAsc' | 'priceDesc';

const SORT_DEFS: { key: BuySort; labelKey: Parameters<typeof t>[1] }[] = [
  { key: 'newest', labelKey: 'market.buy.sortNewest' },
  { key: 'priceAsc', labelKey: 'market.buy.sortPriceAsc' },
  { key: 'priceDesc', labelKey: 'market.buy.sortPriceDesc' },
];

/** REQ-0375 spec 3: the sort choice persists PER SESSION in module state
 * -- the pane unmounts on every tab switch (MarketPage renders exactly
 * one pane), so component state alone would forget the choice the moment
 * the player peeks at 出品する. Module scope is the smallest thing that
 * survives that and dies with the tab; nothing is written to storage
 * (the sibling chip/query state is likewise memory-only, lifted into
 * MarketPage). NOT sortie/sortiePrefs.ts (REQ-0371): that precedent is for
 * a DURABLE pref and buys its durability by riding the persisted canvas
 * through the one auto-save PUT writer -- a cost this spec explicitly
 * declines by scoping the choice to the session. */
let sessionSort: BuySort = 'newest';

/** REQ-0375 spec 2: cards are revealed in batches of this size. The
 * payload stays the full list; only the MOUNTED card count is bounded,
 * which is the part that janks (each card mounts a ShapeGrid thumbnail +
 * a roll bar). */
const BUY_PAGE_SIZE = 50;

/** Newest-first, with the listing id as a deterministic final tie-break
 * so two listings carved in the same millisecond never swap order
 * between renders. */
function compareNewest(a: ApiMarketListing, b: ApiMarketListing): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Price order, `dir` = +1 ascending / -1 descending.
 *
 * MULTI-TM CAVEAT (REQ-0195a): prices can be carved in different TMs, and
 * law 1 ("barter in kind -- no abstract coin exists") means no exchange
 * rate exists to make a cross-TM comparison meaningful. So the primary
 * key is the raw carved qty -- the honest reading of "cheapest number
 * first" -- and the TM id is the secondary key, which keeps same-priced
 * listings of one currency contiguous instead of interleaved. A real
 * cross-TM ordering would need a rate the game deliberately does not
 * have; if that is ever wanted it is its own REQ, not a silent fudge
 * here. Today exactly one TM ('lrdst') is live, so the caveat is latent. */
function comparePrice(a: ApiMarketListing, b: ApiMarketListing, dir: 1 | -1): number {
  if (a.price.qty !== b.price.qty) return dir * (a.price.qty - b.price.qty);
  if (a.price.tm !== b.price.tm) return a.price.tm < b.price.tm ? -1 : 1;
  return compareNewest(a, b);
}

function sortComparator(sort: BuySort): (a: ApiMarketListing, b: ApiMarketListing) => number {
  if (sort === 'priceAsc') return (a, b) => comparePrice(a, b, 1);
  if (sort === 'priceDesc') return (a, b) => comparePrice(a, b, -1);
  return compareNewest;
}

/** Client mirror of the server's matchesQuery: a No.-prefixed or bare
 * digit query filters by Dex No.; anything else is an EN/JA name
 * substring. Kept in lockstep with services/market.cjs's matchesQuery so
 * typing "61" deep-links the same way the server's ?q= would. */
function matchesQuery(listing: ApiMarketListing, q: string): boolean {
  const raw = q.trim();
  if (!raw) return true;
  const noMatch = raw.match(/^(?:no\.?\s*)?0*(\d+)$/i);
  if (noMatch) return listing.dexNo != null && listing.dexNo === parseInt(noMatch[1], 10);
  const needle = raw.toLowerCase();
  if (listing.itemName.toLowerCase().includes(needle)) return true;
  if (listing.itemNameJa && listing.itemNameJa.toLowerCase().includes(needle)) return true;
  return false;
}

function matchesChip(listing: ApiMarketListing, chip: ChipDef): boolean {
  if (chip.kind) return (listing.kind || 'po') === chip.kind;
  const m = chip.match;
  if (!m) return true;
  const ml = m.toLowerCase();
  if ((listing.tags || []).some((tg) => tg.toLowerCase() === ml)) return true;
  return typeof listing.rarity === 'string' && listing.rarity.toLowerCase() === ml;
}

interface BuyPaneProps {
  listings: ApiMarketListing[];
  gameData: GameData | null;
  locale: Locale;
  /** REQ-0195a: the live TM registry ids -- the card price shows the TM's
   * short label once MORE THAN ONE is live (a lone rune is ambiguous). */
  tms: string[];
  /** REQ-0195a: spendable balance for a given TM id -- buy affordability
   * is checked per listing against its OWN price.tm. */
  balanceOf: (tm: string) => number;
  myPlayerId: string | null;
  activeChip: string;
  query: string;
  onChipChange: (key: string) => void;
  onQueryChange: (q: string) => void;
  onBuy: (listing: ApiMarketListing) => void;
}

export function BuyPane({ listings, gameData, locale, tms, balanceOf, myPlayerId, activeChip, query, onChipChange, onQueryChange, onBuy }: BuyPaneProps) {
  const multiTm = tms.length > 1;
  // Content-bound chips: keep only those whose value is present in some
  // live listing (plus 'all'), so the row reflects the real hearth.
  const visibleChips = useMemo(() => {
    return CHIP_DEFS.filter((c) => c.match === null || listings.some((l) => matchesChip(l, c)));
  }, [listings]);

  const activeChipDef = CHIP_DEFS.find((c) => c.key === activeChip) || CHIP_DEFS[0];
  const filtered = useMemo(() => {
    return listings.filter((l) => matchesChip(l, activeChipDef) && matchesQuery(l, query));
  }, [listings, activeChipDef, query]);

  // REQ-0375: sort lives here (module-backed, see sessionSort) rather than
  // being lifted into MarketPage like the chip/query pair, because nothing
  // outside this pane reads it.
  const [sort, setSort] = useState<BuySort>(() => sessionSort);
  const onSortChange = useCallback((next: BuySort) => { sessionSort = next; setSort(next); }, []);

  const sorted = useMemo(() => {
    const arr = filtered.slice();
    arr.sort(sortComparator(sort));
    return arr;
  }, [filtered, sort]);

  // REQ-0375: how many cards are MOUNTED. Reset to one batch whenever the
  // player changes what they are looking at (sort/chip/query) -- but NOT
  // when `listings` merely refreshes, which would yank a deep-scrolled
  // browser back to the top on every poll.
  const [shown, setShown] = useState(BUY_PAGE_SIZE);
  useEffect(() => { setShown(BUY_PAGE_SIZE); }, [sort, activeChip, query]);
  const visible = useMemo(() => (shown >= sorted.length ? sorted : sorted.slice(0, shown)), [sorted, shown]);
  const remaining = sorted.length - visible.length;

  return (
    <section className="market-pane" data-testid="market-pane-buy">
      <div className="colhead">
        <span className="rn rune">ᚠ</span>
        <h2 className="dj">{t(locale, 'market.buy.listingsTitle')}</h2>
        <span className="en">{t(locale, 'market.buy.listingsEn')}</span>
        <span className="grow" />
        <span className="t-micro" data-testid="market-buy-count">{t(locale, 'market.buy.countNote', { n: listings.length })}</span>
      </div>

      <div className="panel toolrow market-toolrow">
        <div className="chipflow" data-testid="market-chips">
          {visibleChips.map((c) => (
            <span
              key={c.key}
              className={`chip market-chip${c.key === activeChip ? ' is-on' : ''}`}
              data-testid={`market-chip-${c.key}`}
              role="button"
              tabIndex={0}
              onClick={() => onChipChange(c.key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChipChange(c.key); } }}
            >
              {c.kw ? <span className={`kw-${c.kw}`}>{t(locale, c.labelKey)}</span> : t(locale, c.labelKey)}
            </span>
          ))}
        </div>
        <label className="search market-search">
          <span className="rune">ᚲ</span>
          <input
            type="text"
            data-testid="market-search"
            placeholder={t(locale, 'market.searchPlaceholder')}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </label>
        <label className="market-sort">
          <span className="rune">ᛞ</span>
          <select
            data-testid="market-sort"
            aria-label={t(locale, 'market.buy.sortLabel')}
            value={sort}
            onChange={(e) => onSortChange(e.target.value as BuySort)}
          >
            {SORT_DEFS.map((s) => (
              <option key={s.key} value={s.key}>{t(locale, s.labelKey)}</option>
            ))}
          </select>
        </label>
        <div className="strip-note t-micro">{t(locale, 'market.buy.dexBound')}</div>
      </div>

      {filtered.length === 0 ? (
        <div className="emptyblock market-empty" data-testid="market-buy-empty">
          <svg className="efig" width="46" height="40" viewBox="0 0 46 40" aria-hidden="true">
            <g fill="none" stroke="var(--gold-lo)" strokeWidth="1.5"><circle cx="23" cy="14" r="10" /><circle cx="14" cy="26" r="10" /><circle cx="32" cy="26" r="10" /></g>
          </svg>
          <div className="eja">{t(locale, 'market.buy.emptyJa')}</div>
          <span className="en">{t(locale, 'market.buy.emptyEn')}</span>
        </div>
      ) : (
        <div className="mgrid market-grid" data-testid="market-grid">
          {visible.map((l) => {
            const kind = listingKindLine(l, gameData);
            const isSuspended = l.state === 'suspended' || l.suspended;
            const isMine = myPlayerId != null && l.sellerId === myPlayerId;
            const bal = balanceOf(l.price.tm);
            const canAfford = bal >= l.price.qty;
            const buyable = !isSuspended && !isMine && canAfford;
            const name = locale === 'ja' ? l.itemNameJa || l.itemName : l.itemName;
            return (
              <article
                key={l.id}
                className={`mcard market-card rar rar-${l.rarity || 'common'}${isSuspended ? ' is-locked' : ''}`}
                data-testid="market-listing-row"
                data-listing-id={l.id}
                data-item-uid={l.itemUid}
                data-state={l.state}
              >
                {isSuspended ? <span className="lockchip" data-testid="market-lock-chip">{t(locale, 'market.suspendedChip')}</span> : null}
                <span className="gem" />
                <div className="top">
                  <MarketThumb gameData={gameData} itemId={l.itemId} cellPx={22} alt={name} kind={l.kind} />
                  <div className="grow">
                    <div className="row market-card-nmrow">
                      <span className="nm dj">{name}</span>
                      <span className="chip dexno" data-testid="market-dexno">{dexNoLabel(l.dexNo)}</span>
                    </div>
                    <div className="sub">
                      {kind.kind}{kind.dims ? ` ・ ${kind.dims}` : ''}{kind.tags ? ` ・ ${kind.tags}` : ''}
                      {l.rarity ? <span className={`rar-word r-${l.rarity}`}> {l.rarity.toUpperCase()}</span> : null}
                    </div>
                    <RollBar kind={l.kind} rollPct={l.rollPct} locale={locale} />
                    <span className="sellr">
                      {t(locale, 'market.seller')} <span className={`who${isMine ? ' kw-gold' : ''}`}>{isMine ? t(locale, 'market.you') : l.sellerName}</span>
                      {isSuspended && isMine ? <span className="t-micro"> — {t(locale, 'market.suspendedMineNote')}</span> : null}
                    </span>
                  </div>
                </div>
                <div className="prow">
                  <div className="grow">
                    <div className="price"><PriceTag gameData={gameData} tm={l.price.tm} multi={multiTm} /><span className="pnm">{t(locale, 'market.currencyName')}</span><b className="tnum">×{l.price.qty}</b></div>
                    <div className="burn">{t(locale, 'market.burnLine', { pay: l.price.qty, burn: l.burn, get: l.sellerReceives })}</div>
                  </div>
                  {buyable ? (
                    <button type="button" className="btn sm" data-testid={`market-buy-btn-${l.itemUid ?? l.id}`} onClick={() => onBuy(l)}>{t(locale, 'market.buyButton')}</button>
                  ) : (
                    <div className="buycol">
                      <button type="button" className="btn sm" data-testid={`market-buy-btn-${l.itemUid ?? l.id}`} disabled>{t(locale, 'market.buyButton')}</button>
                      {!isSuspended && !isMine && !canAfford ? <span className="t-micro shortnote">{t(locale, 'market.shortChip', { n: l.price.qty - bal })}</span> : null}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {remaining > 0 ? (
        <div className="market-more" data-testid="market-more">
          <button
            type="button"
            className="btn sm"
            data-testid="market-show-more"
            onClick={() => setShown((n) => n + BUY_PAGE_SIZE)}
          >
            {t(locale, 'market.buy.showMore', { n: Math.min(BUY_PAGE_SIZE, remaining) })}
          </button>
          <span className="t-micro" data-testid="market-shown-of">
            {t(locale, 'market.buy.shownOf', { shown: visible.length, total: sorted.length })}
          </span>
        </div>
      ) : null}
    </section>
  );
}
