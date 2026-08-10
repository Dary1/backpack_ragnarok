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
import type { ApiMarketListing, GameData } from '../api';
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

/** 図鑑の直近刻銘 -- the dex anchor line (empty-states to anchorNone per
 * the REQ-0064 spec rather than blocking the pane). */
export function CarveAnchor({ locale, anchor }: { locale: Locale; anchor: number | null }) {
  return (
    <span className="t-micro" data-testid="market-carve-anchor">
      {anchor != null ? t(locale, 'market.sell.anchor', { n: anchor }) : t(locale, 'market.sell.anchorNone')}
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
