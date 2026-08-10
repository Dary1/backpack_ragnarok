// client/src/market/BuyModal.tsx -- REQ-0064: the 購入の誓い / "Seal the
// trade" modal (mock: web/redesign/market.html #buyModal, bodies
// mA..mE). Renders the payment/burn-8%/seller-receives breakdown table +
// post-pay balance projection, then confirm -> ATOMIC settle. Handles
// EVERY 409 in the mock's own voice via a dedicated body per the mock's
// designed panels: race (already_settled/not_active/item_gone),
// warehouse_full, insufficient_balance, suspended -- anything else falls
// to a generic line. On success it invokes onSettled() which the parent
// uses to run the CRITICAL post-buy canvas refresh (see MarketPage).
import { useState } from 'react';
import { buyMarketListing, type ApiMarketListing, type GameData } from '../api';
import { t } from '../i18n';
import { useModalConventions } from '../lib/useModalConventions'; // REQ-0369
import type { Locale } from '../store';
import { buyReasonOf } from './marketErrors';
import { RollBar, MarketThumb, PriceTag, dexNoLabel, listingKindLine } from './marketShared';

/** The distinct modal bodies, mirroring the mock's mA..mE. 'form' is the
 * initial oath (mA); 'done' is 取引成立 (mB); the rest are the 409
 * outcome panels. */
type BuyPhase = 'form' | 'done' | 'race' | 'full' | 'poor' | 'suspended' | 'generic';

interface BuyModalProps {
  listing: ApiMarketListing;
  gameData: GameData | null;
  locale: Locale;
  /** REQ-0195a: live TM registry ids -- the pay/burn/receives rows show
   * the price TM's short label once more than one TM is live. */
  tms: string[];
  /** The buyer's current spendable market-TM balance (for the post-pay
   * projection + the pre-emptive can't-afford body). */
  balance: number;
  /** Runs AFTER a confirmed settle, BEFORE the modal's close is offered:
   * the parent re-GETs the fresh (debited) canvas into the store so a
   * pending auto-save can't resurrect the pre-trade balance, and refetches
   * listings. Awaited so the "see vault / close" actions only appear once
   * state is reconciled. */
  onSettled: () => Promise<void>;
  onClose: () => void;
}

export function BuyModal({ listing, gameData, locale, tms, balance, onSettled, onClose }: BuyModalProps) {
  const multiTm = tms.length > 1;
  const [phase, setPhase] = useState<BuyPhase>('form');
  const [busy, setBusy] = useState(false);
  const [genericMsg, setGenericMsg] = useState<string>('');
  // REQ-0369: unified modal conventions (Esc / overlay-click / focus trap /
  // initial focus) -- the same hook warehouse/SellModal (REQ-0366) adopted.
  const { dialogRef, onScrimClick } = useModalConventions(onClose);

  const qty = listing.price.qty;
  const burn = listing.burn;
  const receives = listing.sellerReceives;
  const kind = listingKindLine(listing, gameData);
  const shortfall = Math.max(0, qty - balance);

  async function confirm() {
    setBusy(true);
    try {
      await buyMarketListing(listing.id);
      // CRITICAL race guard runs in the parent (fresh canvas GET ->
      // store) BEFORE we let the player dismiss; only then reveal 'done'.
      await onSettled();
      setPhase('done');
    } catch (e) {
      const reason = buyReasonOf(e);
      if (reason === 'already_settled' || reason === 'not_active' || reason === 'item_gone' || reason === 'expired') {
        setPhase('race');
      } else if (reason === 'warehouse_full') {
        setPhase('full');
      } else if (reason === 'insufficient_balance') {
        setPhase('poor');
      } else if (reason === 'suspended') {
        setPhase('suspended');
      } else {
        setGenericMsg(t(locale, 'market.err.generic'));
        setPhase('generic');
      }
      // Even on a 409 the server may have advanced listing state (e.g.
      // already_settled): the parent refetches so the browse grid
      // reflects reality. Fire-and-forget; the modal body is already set.
      void onSettled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim market-scrim" data-testid="market-buy-modal" onClick={onScrimClick}>
      <div className="modal panel ornate market-modal" role="dialog" aria-modal="true" ref={dialogRef} tabIndex={-1}>
        <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />

        {phase === 'form' ? (
          <div data-testid="market-buy-body-form">
            <div className="row market-modal-head">
              <h3 className="ph3 dj">{t(locale, 'market.buy.oathTitle')}</h3>
              <span className="en">{t(locale, 'market.buy.oathTitleEn')}</span>
            </div>
            <div className="row market-modal-item">
              <MarketThumb gameData={gameData} itemId={listing.itemId} cellPx={30} kind={listing.kind} />
              <div>
                <div className="dj market-modal-name">{locale === 'ja' ? listing.itemNameJa || listing.itemName : listing.itemName}</div>
                <div className="t-micro market-modal-sub">
                  {kind.kind}{kind.dims ? ` ・ ${kind.dims}` : ''}{kind.tags ? ` ・ ${kind.tags}` : ''}
                  {listing.rarity ? <span className={`rar-word r-${listing.rarity}`}> {listing.rarity.toUpperCase()}</span> : null}
                </div>
                <div className="market-modal-dex"><span className="chip dexno">{t(locale, 'market.dexChip', { no: dexNoLabel(listing.dexNo) })}</span></div>
                <RollBar kind={listing.kind} rollPct={listing.rollPct} locale={locale} />
              </div>
            </div>
            <table className="bd market-bd">
              <tbody>
                <tr>
                  <td>{t(locale, 'market.buy.pay')}</td><td className="t-micro">{t(locale, 'market.buy.payFrom')}</td>
                  <td className="v"><PriceTag gameData={gameData} tm={listing.price.tm} multi={multiTm} /> {qty}</td>
                </tr>
                <tr className="burnrw">
                  <td>{t(locale, 'market.buy.burn')}</td><td className="t-micro">{t(locale, 'market.buy.burnShare')}</td>
                  <td className="v">−<PriceTag gameData={gameData} tm={listing.price.tm} multi={multiTm} /> {burn}</td>
                </tr>
                <tr className="getrw">
                  <td>{t(locale, 'market.buy.sellerGets')}</td><td className="t-micro">{t(locale, 'market.buy.sellerGetsTo', { who: listing.sellerName })}</td>
                  <td className="v"><PriceTag gameData={gameData} tm={listing.price.tm} multi={multiTm} /> {receives}</td>
                </tr>
              </tbody>
            </table>
            <div className="mnote dj">{t(locale, 'market.buy.valveLore')}</div>
            <div className="row market-modal-actions">
              <button type="button" className="btn btn-forge" data-testid="market-buy-confirm" disabled={busy || shortfall > 0} onClick={() => void confirm()}>
                {busy ? t(locale, 'market.buy.sealing') : t(locale, 'market.buy.confirm')}
              </button>
              <button type="button" className="btn btn-ghost" data-testid="market-buy-cancel" onClick={onClose}>{t(locale, 'market.buy.cancel')}</button>
              <span className="t-micro market-modal-after">
                {shortfall > 0
                  ? t(locale, 'market.buy.shortInline', { n: shortfall })
                  : t(locale, 'market.buy.afterBalance', { n: balance - qty })}
              </span>
            </div>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="center" data-testid="market-buy-body-done">
            <div className="rune-divider market-done-div">ᚷ</div>
            <div className="dj market-done-title">{t(locale, 'market.buy.doneTitle')}</div>
            <p className="mdone dj">{t(locale, 'market.buy.doneBody', { burn, receives, who: listing.sellerName })}</p>
            <div className="row market-done-actions">
              <button type="button" className="btn" onClick={onClose} data-testid="market-buy-done-close">{t(locale, 'market.buy.close')}</button>
            </div>
          </div>
        ) : null}

        {phase === 'race' ? (
          <div className="center" data-testid="market-buy-body-race">
            <div className="rune-divider market-done-div">ᚱ</div>
            <div className="dj market-done-title">{t(locale, 'market.buy.raceTitle')}</div>
            <p className="mdone dj">{t(locale, 'market.buy.raceBody')}</p>
            <button type="button" className="btn" onClick={onClose} data-testid="market-buy-fail-close">{t(locale, 'market.buy.backToHearth')}</button>
          </div>
        ) : null}

        {phase === 'full' ? (
          <div className="center" data-testid="market-buy-body-full">
            <div className="rune-divider market-done-div">ᚷ</div>
            <div className="dj market-done-title">{t(locale, 'market.buy.fullTitle')}</div>
            <p className="mdone dj">{t(locale, 'market.buy.fullBody')}</p>
            <div className="t-micro market-done-note">{t(locale, 'market.buy.fullNote')}</div>
            <button type="button" className="btn btn-ghost" onClick={onClose} data-testid="market-buy-fail-close">{t(locale, 'market.buy.backToHearth')}</button>
          </div>
        ) : null}

        {phase === 'poor' ? (
          <div className="center" data-testid="market-buy-body-poor">
            <div className="rune-divider market-done-div">ᚠ</div>
            <div className="dj market-done-title">{t(locale, 'market.buy.poorTitle')}</div>
            <p className="mdone dj">{t(locale, 'market.buy.poorBody', { n: shortfall })}</p>
            <div className="t-micro market-done-note">{t(locale, 'market.buy.poorNote')}</div>
            <button type="button" className="btn" onClick={onClose} data-testid="market-buy-fail-close">{t(locale, 'market.buy.stepBack')}</button>
          </div>
        ) : null}

        {phase === 'suspended' ? (
          <div className="center" data-testid="market-buy-body-suspended">
            <div className="rune-divider market-done-div">ᚱ</div>
            <div className="dj market-done-title">{t(locale, 'market.buy.suspendedTitle')}</div>
            <p className="mdone dj">{t(locale, 'market.buy.suspendedBody')}</p>
            <button type="button" className="btn" onClick={onClose} data-testid="market-buy-fail-close">{t(locale, 'market.buy.backToHearth')}</button>
          </div>
        ) : null}

        {phase === 'generic' ? (
          <div className="center" data-testid="market-buy-body-generic">
            <div className="rune-divider market-done-div">ᛞ</div>
            <p className="mdone dj">{genericMsg}</p>
            <button type="button" className="btn" onClick={onClose} data-testid="market-buy-fail-close">{t(locale, 'market.buy.backToHearth')}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
