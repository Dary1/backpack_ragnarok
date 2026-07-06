// client/src/market/MarketPage.tsx -- REQ-0064: the Market route
// (#/market), 交易の火床 / "Hearth of Barter". Three panes (買う / 出品する
// / 自分の出品) exactly per the mock (web/redesign/market.html), the
// 購入の誓い buy modal, and the seasonal furnace footer. Follows the same
// route-level component shape as WorkshopPage.tsx (fetch-on-mount,
// loading/error/t()), and reuses the SAME store facilities.
//
// THE CRITICAL RACE GUARD (see refreshAfterServerMutation below): buying/
// settling debits/credits the player's TM balance SERVER-side, directly
// in the DB, while this client holds an in-memory canvas whose debounced
// auto-save (~800ms, store/autosave.ts) would otherwise PUT a STALE,
// pre-trade balance back over the server's correct debit -- silently
// resurrecting spent currency (the REQ-0041 auto-save race class, called
// out verbatim in shared/dto.ts's ApiMarketBuyResponse doc). We defuse it
// EXACTLY the way the rest of the app reconciles server-authoritative
// canvas changes: call the store's loadGame(), which re-GETs the fresh
// (already-debited) canvas and replaces state's OWN fields in place, THEN
// bumps stateVersion via notifyStateChanged() -- so any pending auto-save
// now PUTs the correct post-trade balance, not the stale one. This is the
// same mechanism WorkshopPage relies on (notifyStateChanged after a
// server-side balance change); we use loadGame() rather than a bare
// notifyStateChanged() because for a BUY the authoritative new balance
// lives on the SERVER (server debited), whereas the workshop roll debits
// client-side first -- so we must pull, not just push.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMarketFurnace, fetchMarketListings, type ApiMarketFurnaceResponse, type ApiMarketListing } from '../api';
import { t } from '../i18n';
import { loadGame, useGameStore, type Locale } from '../store';
import type { GameState } from '../engine/engine.d.ts';
import { BuyModal } from './BuyModal';
import { BuyPane } from './BuyPane';
import { MinePane } from './MinePane';
import { SellPane } from './SellPane';

type Pane = 'buy' | 'sell' | 'mine';

/** The market's trade TM id (law 1) -- 'lrdst' today. The wire responses
 * also echo this as `tm`; we default to it for the balance read before
 * the first fetch resolves. */
const MARKET_TM_ID = 'lrdst';

/** Sums the player's spendable market-TM balance across every inventory
 * page's TM stacks -- the SAME cross-page total WorkshopPage.tsx shows
 * for LRDST ("can I afford this"). The actual settle debit happens
 * server-side; this is the client's display + affordability number, kept
 * correct after each buy by the loadGame() refresh below. */
function readMarketBalance(state: GameState | null, tmId: string): number {
  if (!state || !state.inv) return 0;
  let total = 0;
  for (const pg of state.inv.pages) {
    for (const tm of pg.tms || []) {
      if (tm.id === tmId) total += tm.qty;
    }
  }
  return total;
}

interface MarketPageProps {
  locale: Locale;
}

export function MarketPage({ locale }: MarketPageProps) {
  const snapshot = useGameStore();
  const [pane, setPane] = useState<Pane>('buy');
  const [browse, setBrowse] = useState<ApiMarketListing[]>([]);
  const [mine, setMine] = useState<ApiMarketListing[]>([]);
  const [furnace, setFurnace] = useState<ApiMarketFurnaceResponse['furnace'] | null>(null);
  const [furnaceSeason, setFurnaceSeason] = useState<ApiMarketFurnaceResponse['season']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyTarget, setBuyTarget] = useState<ApiMarketListing | null>(null);
  // BUY search/filter state lifted here so it survives pane switches.
  const [activeChip, setActiveChip] = useState('all');
  const [query, setQuery] = useState('');

  const tmId = furnace?.tm || MARKET_TM_ID;
  const balance = readMarketBalance(snapshot.state, tmId);
  const myPlayerId = snapshot.me?.playerId ?? null;

  // Guard so an in-flight fetch that resolves after unmount doesn't setState.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const loadBrowse = useCallback(async () => {
    const res = await fetchMarketListings();
    if (aliveRef.current) setBrowse(res.listings);
  }, []);

  const loadMine = useCallback(async () => {
    const res = await fetchMarketListings({ filter: 'mine' });
    if (aliveRef.current) setMine(res.listings);
  }, []);

  const loadFurnace = useCallback(async () => {
    const res = await fetchMarketFurnace();
    if (aliveRef.current) { setFurnace(res.furnace); setFurnaceSeason(res.season ?? null); }
  }, []);

  // Initial load: browse + mine + furnace together.
  useEffect(() => {
    let done = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadBrowse(), loadMine(), loadFurnace()]);
      } catch (e) {
        if (!done && aliveRef.current) setError(t(locale, 'market.loadError') + (e instanceof Error ? e.message : String(e)));
      } finally {
        if (!done && aliveRef.current) setLoading(false);
      }
    })();
    return () => { done = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MINE pane: refetch FRESH every time it is focused/returned to, since
  // state (suspended<->active, or a buy landing as settled) changes
  // server-side asynchronously to this client (spec requirement).
  useEffect(() => {
    if (pane === 'mine') void loadMine();
  }, [pane, loadMine]);

  /** THE race guard. Called after any server-side balance/settle mutation
   * (a buy, and after any settle-visible refetch). Re-GETs the fresh
   * canvas into the store BEFORE a pending auto-save can PUT stale data,
   * then refreshes both listing views + the furnace (a settle burns, so
   * the seasonal total moved). */
  const refreshAfterServerMutation = useCallback(async () => {
    await loadGame(); // <-- fresh canvas GET -> store field replacement (defuses the auto-save race)
    await Promise.all([loadBrowse(), loadMine(), loadFurnace()]);
  }, [loadBrowse, loadMine, loadFurnace]);

  // Uids of my items that currently have an active/suspended listing (so
  // the SELL pane grays them out -- can't double-list).
  const listedUids = useMemo(() => {
    const s = new Set<string>();
    for (const l of mine) if (l.state === 'active' || l.state === 'suspended' || l.suspended) s.add(l.itemUid);
    return s;
  }, [mine]);

  // Count for the MINE tab badge: active + suspended (the "live" ones),
  // matching the mock's 出品中 semantics.
  const mineActiveCount = useMemo(() => mine.filter((l) => l.state === 'active' || l.state === 'suspended' || l.suspended).length, [mine]);

  // All known listings (browse + mine), deduped by id -- the SELL pane
  // reads this for price-history anchors + already-listed detection.
  const allListings = useMemo(() => {
    const byId = new Map<string, ApiMarketListing>();
    for (const l of browse) byId.set(l.id, l);
    for (const l of mine) byId.set(l.id, l);
    return [...byId.values()];
  }, [browse, mine]);

  return (
    <div className="market-page" data-testid="market-page">
      {/* page header */}
      <section className="pagehead market-pagehead">
        <div>
          <div className="kicker den">{t(locale, 'market.kicker')}</div>
          <h1 className="dj dj-wide market-h1">{t(locale, 'market.title')}</h1>
          <div className="lede">{t(locale, 'market.lede')}</div>
        </div>
      </section>
      <div className="rune-divider headline market-headline">ᚠ</div>

      {/* the three laws */}
      <section className="panel ornate laws market-laws">
        <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
        <div className="law"><span className="law-rn"><span className="rune">ᚠ</span></span><div><div className="law-t">{t(locale, 'market.law1')}</div><div className="en">{t(locale, 'market.law1En')}</div></div></div>
        <div className="law"><span className="law-rn ember"><span className="rune">ᚲ</span></span><div><div className="law-t">{t(locale, 'market.law2')}</div><div className="en">{t(locale, 'market.law2En')}</div></div></div>
        <div className="law"><span className="law-rn"><span className="rune">ᛗ</span></span><div><div className="law-t">{t(locale, 'market.law3')}</div><div className="en">{t(locale, 'market.law3En')}</div></div></div>
      </section>

      {/* tabs */}
      <div className="mtabs market-tabs">
        <span className={`mtab${pane === 'buy' ? ' is-on' : ''}`} data-testid="market-tab-buy" role="button" tabIndex={0} onClick={() => setPane('buy')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPane('buy'); } }}>{t(locale, 'market.tab.buy')}</span>
        <span className={`mtab${pane === 'sell' ? ' is-on' : ''}`} data-testid="market-tab-sell" role="button" tabIndex={0} onClick={() => setPane('sell')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPane('sell'); } }}>{t(locale, 'market.tab.sell')}</span>
        <span className={`mtab${pane === 'mine' ? ' is-on' : ''}`} data-testid="market-tab-mine" role="button" tabIndex={0} onClick={() => setPane('mine')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPane('mine'); } }}>
          {t(locale, 'market.tab.mine')} <span className="ct tnum" data-testid="market-mine-badge">{mineActiveCount}</span>
        </span>
      </div>

      {loading ? (
        <div className="market-loading" data-testid="market-loading">{t(locale, 'market.loading')}</div>
      ) : error ? (
        <div className="schedule-error" data-testid="market-error">{error}</div>
      ) : (
        <>
          {pane === 'buy' ? (
            <BuyPane
              listings={browse}
              gameData={snapshot.gameData}
              locale={locale}
              balance={balance}
              myPlayerId={myPlayerId}
              activeChip={activeChip}
              query={query}
              onChipChange={setActiveChip}
              onQueryChange={setQuery}
              onBuy={setBuyTarget}
            />
          ) : null}
          {pane === 'sell' ? (
            <SellPane
              state={snapshot.state}
              gameData={snapshot.gameData}
              locale={locale}
              allListings={allListings}
              listedUids={listedUids}
              onListed={refreshAfterServerMutation}
            />
          ) : null}
          {pane === 'mine' ? (
            <MinePane
              listings={mine}
              gameData={snapshot.gameData}
              locale={locale}
              onWithdrawn={refreshAfterServerMutation}
            />
          ) : null}
        </>
      )}

      {/* footer lore + seasonal furnace total */}
      <footer className="wfoot market-foot">
        <div className="rune-divider market-foot-div">ᛞ</div>
        <div className="lore">{t(locale, 'market.foot.lore')}</div>
        <div className="t-micro" data-testid="market-furnace">
          {furnace
            ? t(locale, furnaceSeason ? 'market.foot.furnaceSeason' : 'market.foot.furnace', { n: furnace.total.toLocaleString() })
            : t(locale, 'market.foot.furnaceLoading')}
        </div>
      </footer>

      {buyTarget ? (
        <BuyModal
          listing={buyTarget}
          gameData={snapshot.gameData}
          locale={locale}
          balance={balance}
          onSettled={refreshAfterServerMutation}
          onClose={() => setBuyTarget(null)}
        />
      ) : null}
    </div>
  );
}
