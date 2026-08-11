// client/src/market/priceCarve.tsx -- REQ-0366: SellPane's "Carve the
// price" primitives (the integer price stepper with its free-typing
// input, the codex anchor line, and the projected-receipt estimate),
// extracted from SellPane.tsx so the warehouse direct-sell modal
// (warehouse/SellModal.tsx) reuses the market's ONE finished price UI
// instead of the raw browser prompt() REQ-0328 shipped with.
//
// Extraction contract (REQ-0366 spec 1): SellPane's rendered DOM --
// classes, structure, testids (market-price-down / market-price-input /
// market-price-up / market-cap-note / market-carve-anchor /
// market-est-*) -- is byte-identical to the pre-split markup; its e2e
// selectors must not move. The same testids therefore also appear
// inside the warehouse modal; the two never mount on the same route, so
// selectors stay unambiguous per page (warehouse e2e scopes through its
// own modal testid anyway).
import { useState } from 'react';
import type { ApiMarketListing, ApiMarketPriceHistoryEntry, GameData } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { PriceTag, burnOf, MARKET_PRICE_MIN, MARKET_PRICE_MAX } from './marketShared';

/** Carve state: the CLAMPED integer price (always 1..999 -- what gets
 * POSTed) plus its free-typing text mirror (may transiently be '' while
 * the user retypes; onBlur re-clamps it back into the price). Both move
 * ONLY through the three handlers, so every consumer inherits the same
 * clamp law. */
export interface PriceCarve {
  price: number;
  priceText: string;
  applyPrice: (v: number) => void;
  onPriceInput: (raw: string) => void;
  onPriceBlur: () => void;
}

/** The price state machine SellPane owned inline before REQ-0366 --
 * applyPrice/onChange/onBlur semantics are verbatim. */
export function usePriceCarve(initial: number = MARKET_PRICE_MIN): PriceCarve {
  const [price, setPrice] = useState<number>(initial);
  const [priceText, setPriceText] = useState<string>(String(initial));
  function applyPrice(v: number) {
    const clamped = Math.max(MARKET_PRICE_MIN, Math.min(MARKET_PRICE_MAX, Math.round(v) || MARKET_PRICE_MIN));
    setPrice(clamped);
    setPriceText(String(clamped));
  }
  function onPriceInput(raw: string) {
    const d = raw.replace(/[^\d]/g, '');
    if (d === '') {
      setPriceText('');
      return;
    }
    const n = parseInt(d, 10);
    setPriceText(d);
    setPrice(Math.max(MARKET_PRICE_MIN, Math.min(MARKET_PRICE_MAX, n)));
  }
  function onPriceBlur() {
    applyPrice(parseInt(priceText, 10) || MARKET_PRICE_MIN);
  }
  return { price, priceText, applyPrice, onPriceInput, onPriceBlur };
}

/** The item's most recent settled price for `itemId`, read off any known
 * listing's priceHistory (newest first, per the DTO) -- null when never
 * settled. SellPane's anchor memo and its selectItem/preselect price
 * seeding all derive from this one walk now. */
export function anchorFor(itemId: string | null, listings: ApiMarketListing[]): number | null {
  if (!itemId) return null;
  for (const l of listings) {
    if (l.itemId === itemId && l.priceHistory && l.priceHistory.length > 0) return l.priceHistory[0].qty;
  }
  return null;
}

/** REQ-0377 item 8: the anchor's SERIES, not just its head. Same walk as
 * anchorFor (first listing that knows this itemId wins), but returns the
 * whole rolling history filtered to ONE tm -- prices denominated in different
 * TMs are different numbers about different things, and a line drawn through
 * both would be a lie (shared/dto.ts states the same rule for the anchor).
 * Oldest-first, because that is left-to-right on a chart; the DTO stores
 * newest-first. */
export function historyFor(itemId: string | null, listings: ApiMarketListing[], tm: string): ApiMarketPriceHistoryEntry[] {
  if (!itemId) return [];
  for (const l of listings) {
    if (l.itemId === itemId && l.priceHistory && l.priceHistory.length > 0) {
      return l.priceHistory.filter((e) => e.tm === tm).slice().reverse();
    }
  }
  return [];
}

/** REQ-0377 item 8: a bare-SVG sparkline of the settled-price series.
 *
 * Inline SVG and no charting dependency on purpose -- this is ~90px wide and
 * has at most DEX_PRICE_HISTORY_MAX points; a library would cost more than
 * the feature. Renders NOTHING below two points: one point is not a trend,
 * and a flat stub beside the anchor number would imply a stability the data
 * does not show.
 *
 * Never colour alone (REQ-0143): the direction is carried by the line's shape
 * and restated in the aria-label, so the readout survives both a screen
 * reader and a colourblind eye. */
export function AnchorSparkline({ locale, entries }: { locale: Locale; entries: ApiMarketPriceHistoryEntry[] }) {
  if (entries.length < 2) return null;
  const W = 88;
  const H = 18;
  const PADY = 2;
  const qtys = entries.map((e) => e.qty);
  const lo = Math.min(...qtys);
  const hi = Math.max(...qtys);
  // A flat series would divide by zero; draw it down the middle instead.
  const span = hi - lo;
  const x = (i: number) => (entries.length === 1 ? W / 2 : (i / (entries.length - 1)) * W);
  const y = (q: number) => (span === 0 ? H / 2 : PADY + (1 - (q - lo) / span) * (H - PADY * 2));
  const pts = entries.map((e, i) => `${x(i).toFixed(1)},${y(e.qty).toFixed(1)}`).join(' ');
  const first = qtys[0];
  const last = qtys[qtys.length - 1];
  const dir = last > first ? 'up' : last < first ? 'down' : 'flat';
  return (
    <svg
      className={`market-anchor-spark is-${dir}`}
      data-testid="market-anchor-sparkline"
      data-points={entries.length}
      data-dir={dir}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t(locale, 'market.sell.sparkAria', { n: String(entries.length), lo: String(lo), hi: String(hi) })}
    >
      <polyline points={pts} fill="none" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      {/* the newest point, marked -- it is the one the anchor number quotes */}
      <circle cx={x(entries.length - 1)} cy={y(last)} r="1.9" />
    </svg>
  );
}

/** 図鑑の直近刻銘 -- the dex anchor line (empty-states to anchorNone per
 * the REQ-0064 spec rather than blocking the pane). REQ-0377 item 8 adds the
 * optional series beside it; passing no `entries` renders exactly the
 * pre-REQ line, which is what keeps every existing caller honest. */
export function CarveAnchor({ locale, anchor, entries }: { locale: Locale; anchor: number | null; entries?: ApiMarketPriceHistoryEntry[] }) {
  return (
    <span className="t-micro market-carve-anchor" data-testid="market-carve-anchor">
      {anchor != null ? t(locale, 'market.sell.anchor', { n: anchor }) : t(locale, 'market.sell.anchorNone')}
      {entries && entries.length > 1 ? <AnchorSparkline locale={locale} entries={entries} /> : null}
    </span>
  );
}

interface CarveBitsProps {
  gameData: GameData | null;
  locale: Locale;
  /** The TM the price is carved in (display only -- the POST's tm is the
   * caller's own contract). */
  priceTm: string;
  /** REQ-0195a: with >1 live TM the PriceTag carries the TM's short label. */
  multiTm: boolean;
}

/** The ± stepper + numeric input + ceiling word, and the cap note once
 * the ceiling is reached. DOM verbatim from SellPane. */
export function CarveStepper({ gameData, locale, priceTm, multiTm, carve }: CarveBitsProps & { carve: PriceCarve }) {
  const { price, priceText, applyPrice, onPriceInput, onPriceBlur } = carve;
  const capped = price >= MARKET_PRICE_MAX;
  return (
    <>
      <div className="stepper market-stepper">
        <button type="button" className="sbtn" data-testid="market-price-down" aria-label={t(locale, 'market.sell.priceDown')} onClick={() => applyPrice(price - 1)}>−</button>
        <span className="sval">
          <PriceTag gameData={gameData} tm={priceTm} multi={multiTm} />
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            data-testid="market-price-input"
            aria-label={t(locale, 'market.sell.priceAria')}
            value={priceText}
            onChange={(e) => onPriceInput(e.target.value)}
            onBlur={onPriceBlur}
          />
        </span>
        <button type="button" className="sbtn" data-testid="market-price-up" aria-label={t(locale, 'market.sell.priceUp')} onClick={() => applyPrice(price + 1)}>+</button>
        <span className="t-micro">{t(locale, 'market.sell.ceiling')}</span>
      </div>
      {capped ? <div className="t-micro capnote" data-testid="market-cap-note">{t(locale, 'market.sell.capReached')}</div> : null}
    </>
  );
}

/** The projected receipt (pay -> burn -> receive) line. burnOf is the
 * client mirror of the server law (see marketShared) -- display only,
 * always reconciled against the server's own listing fields. DOM
 * verbatim from SellPane. */
export function CarveEst({ gameData, locale, priceTm, multiTm, price }: CarveBitsProps & { price: number }) {
  const burn = burnOf(price);
  return (
    <div className="est market-est">
      <span className="lbl">{t(locale, 'market.sell.estLabel')}</span>
      <span data-testid="market-est-line">
        {t(locale, 'market.sell.estPay')} <b className="tnum" data-testid="market-est-pay">{price}</b> → <span className="kw-ember">{t(locale, 'market.sell.estBurn')} <b className="tnum" data-testid="market-est-burn">{burn}</b></span> ・ {t(locale, 'market.sell.estGet')} <b className="kw-gold tnum" data-testid="market-est-get">{price - burn}</b>{multiTm ? <>{' '}<PriceTag gameData={gameData} tm={priceTm} multi /></> : null}
      </span>
    </div>
  );
}
