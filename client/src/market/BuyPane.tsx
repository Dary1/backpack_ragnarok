// client/src/market/BuyPane.tsx -- REQ-0064 BUY pane (火床の品書き /
// "The hearth's menu"). Filter chips + Dex-No/name search + listing
// cards. Chips are CONTENT-DEFINED: the fixed mock chip labels map to
// real content tag/rarity VALUES, and each chip only renders when at
// least one live listing actually carries that value (so the chip row is
// bound to real content, never a hardcoded list disconnected from what's
// on the hearth). Suspended cards render a lock chip + disabled buy.
import { useMemo } from 'react';
import type { ApiMarketListing, GameData } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { MarketThumb, dexNoLabel, listingKindLine } from './marketShared';

/** The mock's chip vocabulary. `match` values are compared (lowercased)
 * against each listing's tags[]/rarity, EXACTLY as the server's
 * matchesFilter does -- so a chip and its server-side filter agree. The
 * server also accepts these raw values as ?filter=, but the BUY grid
 * filters client-side (all active+suspended listings are already loaded)
 * for instant chip response, matching the mock's client-only chip toggle.
 * 'all' is the always-present reset chip. Only chips whose value appears
 * in >=1 current listing are shown (content-bound). */
interface ChipDef {
  key: string;
  labelKey: Parameters<typeof t>[1];
  /** null = the "all" reset chip; otherwise the tag/rarity value matched. */
  match: string | null;
  /** Optional keyword class for the ember/frost tinted chips (mock). */
  kw?: 'ember' | 'frost';
}

const CHIP_DEFS: ChipDef[] = [
  { key: 'all', labelKey: 'market.chip.all', match: null },
  { key: 'weapon', labelKey: 'market.chip.weapon', match: 'weapon' },
  { key: 'frost', labelKey: 'market.chip.frost', match: 'frost', kw: 'frost' },
  { key: 'ember', labelKey: 'market.chip.ember', match: 'ember', kw: 'ember' },
  { key: 'unit', labelKey: 'market.chip.unit', match: 'unit' },
  { key: 'relic', labelKey: 'market.chip.relic', match: 'relic' },
];

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

function matchesChip(listing: ApiMarketListing, match: string | null): boolean {
  if (!match) return true;
  const m = match.toLowerCase();
  if ((listing.tags || []).some((tg) => tg.toLowerCase() === m)) return true;
  return typeof listing.rarity === 'string' && listing.rarity.toLowerCase() === m;
}

interface BuyPaneProps {
  listings: ApiMarketListing[];
  gameData: GameData | null;
  locale: Locale;
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

export function BuyPane({ listings, gameData, locale, balanceOf, myPlayerId, activeChip, query, onChipChange, onQueryChange, onBuy }: BuyPaneProps) {
  // Content-bound chips: keep only those whose value is present in some
  // live listing (plus 'all'), so the row reflects the real hearth.
  const visibleChips = useMemo(() => {
    return CHIP_DEFS.filter((c) => c.match === null || listings.some((l) => matchesChip(l, c.match)));
  }, [listings]);

  const activeChipDef = CHIP_DEFS.find((c) => c.key === activeChip) || CHIP_DEFS[0];
  const filtered = useMemo(() => {
    return listings.filter((l) => matchesChip(l, activeChipDef.match) && matchesQuery(l, query));
  }, [listings, activeChipDef, query]);

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
          {filtered.map((l) => {
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
                  <MarketThumb gameData={gameData} itemId={l.itemId} cellPx={22} alt={name} />
                  <div className="grow">
                    <div className="row market-card-nmrow">
                      <span className="nm dj">{name}</span>
                      <span className="chip dexno" data-testid="market-dexno">{dexNoLabel(l.dexNo)}</span>
                    </div>
                    <div className="sub">
                      {kind.kind}{kind.dims ? ` ・ ${kind.dims}` : ''}{kind.tags ? ` ・ ${kind.tags}` : ''}
                      {l.rarity ? <span className={`rar-word r-${l.rarity}`}> {l.rarity.toUpperCase()}</span> : null}
                    </div>
                    <span className="sellr">
                      {t(locale, 'market.seller')} <span className={`who${isMine ? ' kw-gold' : ''}`}>{isMine ? t(locale, 'market.you') : l.sellerName}</span>
                      {isSuspended && isMine ? <span className="t-micro"> — {t(locale, 'market.suspendedMineNote')}</span> : null}
                    </span>
                  </div>
                </div>
                <div className="prow">
                  <div className="grow">
                    <div className="price"><span className="rune">ᚠ</span><span className="pnm">{t(locale, 'market.currencyName')}</span><b className="tnum">×{l.price.qty}</b></div>
                    <div className="burn">{t(locale, 'market.burnLine', { pay: l.price.qty, burn: l.burn, get: l.sellerReceives })}</div>
                  </div>
                  {buyable ? (
                    <button type="button" className="btn sm" data-testid={`market-buy-btn-${l.itemUid}`} onClick={() => onBuy(l)}>{t(locale, 'market.buyButton')}</button>
                  ) : (
                    <div className="buycol">
                      <button type="button" className="btn sm" data-testid={`market-buy-btn-${l.itemUid}`} disabled>{t(locale, 'market.buyButton')}</button>
                      {!isSuspended && !isMine && !canAfford ? <span className="t-micro shortnote">{t(locale, 'market.shortChip', { n: l.price.qty - bal })}</span> : null}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
