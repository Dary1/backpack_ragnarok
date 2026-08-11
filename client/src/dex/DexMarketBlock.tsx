// client/src/dex/DexMarketBlock.tsx -- REQ-0374: the Dex detail's 市場の刻銘 /
// "Market Engravings" block, WIRED.
//
// REQ-0075 shipped this block as a PERMANENT empty state -- a literal "—"
// anchor and a hardcoded 0 count -- with a comment in ItemDetailCard.tsx
// admitting no dex-facing feed existed (REQ-0052/0064 wired the market's own
// panes only). The market has owned the anchor all along: trade.cjs engraves a
// rolling settled-price history per itemId, and the SELL pane renders its head
// as market.sell.anchor. What was missing was a per-ITEM read of it. That read
// is GET /api/market/dex/:itemId, and this component is its one consumer.
//
// Extracted OUT of ItemDetailCard rather than fetched inside it: the lore card
// is a pure projection of an already-loaded DexEntry, and giving it a network
// dependency would make every lore section wait on the market. Here the fetch,
// its failure mode and its markup sit together.
//
// DEGRADATION IS THE OLD BEHAVIOUR, ON PURPOSE. A failed or unresolved fetch
// renders exactly REQ-0075's empty state (dashed frame, "—", emptyNote). The
// block that used to always claim "no settlements" now only claims it when it
// is TRUE or when the market could not be reached -- it never invents a
// number, which was REQ-0075's own rule and stays this component's rule.
//
// REMOUNT-TO-REFETCH: usePolledResource loads once per mount by design (its
// `load` has a stable identity), so DexDetail/ItemDetailCard pass key={id} --
// selecting another entry remounts this block and re-reads for the new id.
import { useCallback } from 'react';
import { fetchMarketDexInfo } from '../api';
import type { ApiMarketDexInfo } from '../api';
import { t } from '../i18n';
import { usePolledResource } from '../lib/usePolledResource';
import type { Locale } from '../store';

interface DexMarketBlockProps {
  /** The content id being viewed (po or si) -- the market keys its listings
   * and its price history by exactly this id. */
  itemId: string;
  /** REQ-0075's honest 1-based dex number, or null (SIs carry none). Drives
   * the market deep link: a No. query is the market's OWN exact-match path
   * (services/market/views.cjs's matchesQuery), so a po lands on precisely
   * itself. */
  dexNo: number | null;
  /** The entry's EN base name -- the deep-link fallback for an entry with no
   * dex No. (matchesQuery's EN/JA substring path). Always present; the base
   * fields on an entry are always English (see api.ts's ApiI18nMap doc). */
  name: string;
  locale: Locale;
}

/** The market-browse query that lands on THIS item. Mirrors the market's own
 * search grammar rather than inventing a parallel one: a bare number is an
 * exact Dex-No. match server- AND client-side (views.cjs matchesQuery /
 * BuyPane's matchesQuery, kept in lockstep by their own comments); an entry
 * with no No. falls back to its EN name substring. Exported for the e2e. */
export function marketQueryFor(dexNo: number | null, name: string): string {
  return dexNo != null ? String(dexNo) : name;
}

export function DexMarketBlock({ itemId, dexNo, name, locale }: DexMarketBlockProps) {
  // onError:'null-data' -- a market read that fails is "no data", not a Dex
  // page error (the same posture DexRoot takes for its /api/me role probe and
  // warehouse/SellModal takes for its own anchor fetch). No trackLoading: the
  // block has an honest resting state to show while the read is in flight, so
  // a spinner would only flash.
  const { data } = usePolledResource<ApiMarketDexInfo>(
    useCallback(() => fetchMarketDexInfo(itemId).then((r) => r.dex), [itemId]),
    { onError: 'null-data' }
  );
  const anchor = data ? data.anchor : null;
  const count = data ? data.activeCount : 0;

  return (
    <div className="dex-market" data-testid="dex-market-block">
      <div className="dex-market-head">
        <span className="ttl dj dex-market-title">{t(locale, 'dex.market.title')}</span>
        <span className="den dex-market-den">{t(locale, 'dex.market.den')}</span>
        <span className="dex-colhead-grow" />
        <span className="chip dex-market-count" data-testid="dex-market-count">
          <span className="rune dex-market-count-rune">ᚠ</span> {t(locale, 'dex.market.listingCount', { count })}
        </span>
      </div>
      <div
        className={`dex-market-anchorbox${anchor ? ' is-anchored' : ' is-empty'}`}
        data-testid={anchor ? 'dex-market-anchored' : 'dex-market-empty'}
      >
        <div className="dex-market-anchor-row">
          <span className="dex-market-anchor-label t-micro">{t(locale, 'dex.market.anchorLabel')}</span>
          <span className="dex-market-anchor-val tnum" data-testid="dex-market-anchor-val">
            <span className="rune dex-market-anchor-rune">ᚠ</span>{anchor ? anchor.qty : '—'}
          </span>
        </div>
        {anchor ? null : <div className="dex-market-empty-note t-micro">{t(locale, 'dex.market.emptyNote')}</div>}
      </div>
      <div className="dex-market-cap">{t(locale, 'dex.market.caption')}</div>
      <div className="den dex-market-cap-en">{t(locale, 'dex.market.captionEn')}</div>
      <div className="dex-market-link">
        <button
          type="button"
          className="btn btn-ghost dex-market-link-btn"
          data-testid="dex-market-link-btn"
          onClick={() => {
            // REQ-0374: was a bare '#/market', which dropped the item the
            // player was looking at on the floor. '#/market?buy=<q>' is the
            // BUY-side twin of REQ-0198's '#/market?sell=<uid>' deep link
            // (store/core.ts's MARKET_BUY_HASH_RE) -- the market opens on the
            // buy pane with its search prefilled, so the hearth shows this
            // item and nothing else.
            window.location.hash = `#/market?buy=${encodeURIComponent(marketQueryFor(dexNo, name))}`;
          }}
        >
          <span className="rune" aria-hidden="true">ᚠ</span> {t(locale, 'dex.market.viewInMarket')}
        </button>
      </div>
    </div>
  );
}
