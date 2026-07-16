// client/src/market/MinePane.tsx -- REQ-0064 MINE pane (自分の出品 /
// "Your listings"). Rows show listing age, projected burn/receive if
// still active, state (active/suspended/settled/withdrawn/expired), and a
// withdraw button where applicable. Data for this pane is a FRESH GET
// (filter=mine) whenever the tab is focused/returned to -- state changes
// server-side asynchronously (suspended<->active as the seller deploys/
// undeploys; a buy landing as settled), so this pane never trusts a
// cached copy. That refetch-on-focus is driven by the parent (MarketPage).
import { useState } from 'react';
import { withdrawMarketListing, type ApiMarketListing, type GameData } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { marketErrorKey } from './marketErrors';
import { RollBar, MarketThumb, PriceTag, dexNoLabel } from './marketShared';

/** Whole-days since an ISO timestamp, 1-based for display ("day 1" the
 * moment it is listed) to match the mock's 出品N日目. */
function dayNumber(createdAt: string, now: number): number {
  const ms = now - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 0) return 1;
  return Math.floor(ms / 86400000) + 1;
}

/** Whole days remaining before the 7-day shelf life expires (floored,
 * min 0) -- the mock's あとN日で炉棚から下がる, rendered CALM (no red/
 * countdown). */
function daysRemaining(expiresAt: string, now: number): number {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

interface MinePaneProps {
  listings: ApiMarketListing[];
  gameData: GameData | null;
  locale: Locale;
  /** REQ-0195a: live TM registry ids -- the row price shows the TM short
   * label once more than one TM is live. */
  tms: string[];
  onWithdrawn: () => Promise<void>;
}

export function MinePane({ listings, gameData, locale, tms, onWithdrawn }: MinePaneProps) {
  const multiTm = tms.length > 1;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errKey, setErrKey] = useState<string | null>(null);
  const now = Date.now();

  async function withdraw(id: string) {
    setBusyId(id);
    setErrKey(null);
    try {
      await withdrawMarketListing(id);
      await onWithdrawn();
    } catch (e) {
      setErrKey(marketErrorKey(e));
    } finally {
      setBusyId(null);
    }
  }

  if (listings.length === 0) {
    return (
      <section className="market-pane" data-testid="market-pane-mine">
        <div className="emptyblock market-empty" data-testid="market-mine-empty">
          <svg className="efig" width="46" height="40" viewBox="0 0 46 40" aria-hidden="true">
            <g fill="none" stroke="var(--gold-lo)" strokeWidth="1.5"><circle cx="23" cy="14" r="10" /><circle cx="14" cy="26" r="10" /><circle cx="32" cy="26" r="10" /></g>
          </svg>
          <div className="eja">{t(locale, 'market.mine.emptyJa')}</div>
          <span className="en">{t(locale, 'market.mine.emptyEn')}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="market-pane" data-testid="market-pane-mine">
      <div className="panel ornate panel-pad market-mine-panel" data-testid="market-mine-panel">
        <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
        <div className="row market-mine-head">
          <h3 className="ph3 dj">{t(locale, 'market.mine.title')}</h3>
          <span className="en">{t(locale, 'market.mine.en')}</span>
        </div>
        {errKey ? <div className="schedule-error market-mine-error" data-testid="market-mine-error">{t(locale, errKey as Parameters<typeof t>[1])}</div> : null}
        <div className="col market-mine-list">
          {listings.map((l) => {
            const name = locale === 'ja' ? l.itemNameJa || l.itemName : l.itemName;
            const isActive = l.state === 'active';
            const isSuspended = l.state === 'suspended' || l.suspended;
            const isSettled = l.state === 'settled';
            const isExpired = l.state === 'expired';
            const isWithdrawn = l.state === 'withdrawn';
            const canWithdraw = isActive || isSuspended; // pulling a suspended card off the shelf is allowed (server: withdraw ok on active incl. suspended)
            return (
              <div
                key={l.id}
                className={`lrow market-lrow rar rar-${l.rarity || 'common'}${isExpired ? ' is-expired' : ''}${isSettled ? ' is-settled' : ''}`}
                data-testid="market-mine-row"
                data-listing-id={l.id}
                data-state={l.state}
              >
                <span className="gem" />
                <MarketThumb gameData={gameData} itemId={l.itemId} cellPx={16} alt={name} kind={l.kind} />
                <div>
                  <div className="nmrow">
                    <span className="nm dj">{name}</span>
                    {isSuspended ? <span className="stchip pause" data-testid="market-state-chip">{t(locale, 'market.mine.pausedChip')}</span> : null}
                    {isSettled ? <span className="stchip setl" data-testid="market-state-chip">{t(locale, 'market.mine.settledChip', { receives: l.sellerReceives, burn: l.burn })}</span> : null}
                    {isExpired ? <span className="stchip exp" data-testid="market-state-chip">{t(locale, 'market.mine.expiredChip')}</span> : null}
                    {isWithdrawn ? <span className="stchip exp" data-testid="market-state-chip">{t(locale, 'market.mine.withdrawnChip')}</span> : null}
                  </div>
                  <div className="sub">
                    {dexNoLabel(l.dexNo)}
                    {isActive ? ` ・ ${t(locale, 'market.mine.dayN', { n: dayNumber(l.createdAt, now) })} ・ ` : ' ・ '}
                    {isActive ? <span className="ttlcalm">{t(locale, 'market.mine.daysLeft', { n: daysRemaining(l.expiresAt, now) })}</span> : null}
                    {isSuspended ? t(locale, 'market.mine.suspendedSub') : null}
                    {isSettled ? t(locale, 'market.mine.settledSub') : null}
                    {isExpired ? t(locale, 'market.mine.expiredSub') : null}
                    {isWithdrawn ? t(locale, 'market.mine.withdrawnSub') : null}
                  </div>
                  <RollBar kind={l.kind} rollPct={l.rollPct} locale={locale} />
                </div>
                <div className="lp">
                  <div className="price"><PriceTag gameData={gameData} tm={l.price.tm} multi={multiTm} /><b className="tnum">×{l.price.qty}</b></div>
                  {isSettled
                    ? <div className="burn"><span className="kw-ember">{t(locale, 'market.mine.burnN', { n: l.burn })}</span> ・ <span className="kw-gold">{t(locale, 'market.mine.getN', { n: l.sellerReceives })}</span></div>
                    : (isActive || isSuspended)
                      ? <div className="burn">{t(locale, 'market.mine.ifSettles', { burn: l.burn, get: l.sellerReceives })}</div>
                      : null}
                </div>
                {canWithdraw ? (
                  <button type="button" className="btn btn-ghost sm" data-testid={`market-withdraw-btn-${l.id}`} disabled={busyId === l.id} onClick={() => void withdraw(l.id)}>
                    {busyId === l.id ? t(locale, 'market.mine.withdrawing') : t(locale, 'market.mine.withdraw')}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="t-micro mt8">{t(locale, 'market.mine.footNote')}</div>
      </div>
    </section>
  );
}
