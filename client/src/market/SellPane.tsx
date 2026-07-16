// client/src/market/SellPane.tsx -- REQ-0064 SELL pane (手持ちから選ぶ +
// 値を刻む / "From your hoard" + "Carve the price"). Picker over the
// player's OWN inventory POs (state.inv.pages[].pos[]) -- the exact set
// the server's findInventoryPO accepts (inventory POs only; board /
// deployed / in-run items are NOT here) -- plus an integer price stepper
// (min 1, cap 999) with a LIVE client-side receipt estimate and the
// item's most-recent settled-price anchor (図鑑の直近刻銘). See the notes
// doc for the "deployed items shown locked, not hidden" inference: the
// authoritative deployed-uid set lives server-side (rooms/schedule
// state, not loaded on this client), so an item that the server rejects
// as deployed comes back 409 -> we lock that specific card with the
// mock's "配備中 — 出品不可" word rather than silently reimplementing the
// room scan here.
import { useEffect, useMemo, useState } from 'react';
import { createMarketListing, type ApiMarketListing, type GameData } from '../api';
import { t } from '../i18n';
import type { GameState } from '../engine/engine.d.ts';
import type { Locale } from '../store';
import { marketErrorKey } from './marketErrors';
import { MarketThumb, burnOf, dexNoLabel, MARKET_PRICE_MIN, MARKET_PRICE_MAX } from './marketShared';

/** One sellable inventory instance (PO or SI), with display fields
 * precomputed off the right def map so the picker/carve never touch the
 * ItemDef|SIDef union directly. */
interface SellableItem {
  itemUid: string;
  itemId: string;
  name: string;
  nameJa: string;
  rarity: string;
  dims: string;
  tags: string[];
}

/** Collects every inventory-homed PO across all inventory pages -- the
 * server's own "sellable = inventory PO" definition. Board/squad items
 * (state.pos / squads.store) are deliberately excluded: those are the
 * deployed/placed set the server refuses. */
function collectSellable(state: GameState | null, gameData: GameData | null, kind: 'po' | 'si' | 'unit'): SellableItem[] {
  if (!state || !state.inv || !Array.isArray(state.inv.pages)) return [];
  const out: SellableItem[] = [];
  for (const pg of state.inv.pages) {
    if (kind === 'unit') {
      for (const b of pg.bps || []) {
        const bb = b as { id: string; name?: string; unit?: { id: string } };
        const unitId = bb.unit?.id ?? '';
        const d = (gameData?.UNITS?.[unitId] ?? null) as { name?: string; rarity?: string } | null;
        out.push({ itemUid: bb.id, itemId: unitId || bb.id, name: (d?.name ?? bb.name) ?? bb.id, nameJa: '', rarity: d?.rarity ?? '', dims: '', tags: [] });
      }
    } else if (kind === 'si') {
      for (const a of pg.sis || []) {
        const d = gameData?.SI_DEFS?.[a.id] ?? null;
        out.push({ itemUid: a.uid, itemId: a.id, name: d?.name ?? a.id, nameJa: d?.name_ja ?? '', rarity: d?.rarity ?? '', dims: '', tags: [] });
      }
    } else {
      for (const po of pg.pos || []) {
        const d = gameData?.ITEMS[po.id] ?? null;
        const dims = d?.shape?.length ? `${Math.max(...d.shape.map((c) => c[1])) + 1}×${Math.max(...d.shape.map((c) => c[0])) + 1}` : '';
        out.push({ itemUid: po.uid, itemId: po.id, name: d?.name ?? po.id, nameJa: d?.name_ja ?? '', rarity: d?.rarity ?? '', dims, tags: d?.tags ?? [] });
      }
    }
  }
  return out;
}

interface SellPaneProps {
  state: GameState | null;
  gameData: GameData | null;
  locale: Locale;
  /** Every currently-known listing (browse + mine), used two ways: to
   * find an item's recent settled-price anchor (priceHistory), and to
   * gray out items the player has ALREADY listed (still active/suspended)
   * so they can't double-list (server would 409 already_listed). */
  /** REQ-0195a: the live TM registry ids (envelope `tms`); the price is
   * carved in tms[0] today (a selector appears once a 2nd TM goes live). */
  tms: string[];
  allListings: ApiMarketListing[];
  /** Uids the player already has an active/suspended listing for. */
  listedUids: Set<string>;
  onListed: () => Promise<void>;
}

export function SellPane({ state, gameData, locale, tms, allListings, listedUids, onListed }: SellPaneProps) {
  const [sellKind, setSellKind] = useState<'po' | 'si' | 'unit' | 'tm'>('po');
  const sellable = useMemo(() => collectSellable(state, gameData, sellKind === 'tm' ? 'po' : sellKind), [state, gameData, sellKind]);
  const priceTm = tms[0] || 'lrdst'; // REQ-0195a: price TM from the live registry (selector arrives with a 2nd live TM).
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [price, setPrice] = useState<number>(1);
  const [priceText, setPriceText] = useState<string>('1');
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Uids the SERVER rejected as deployed this session -> lock them like
  // the mock's 配備中 cards (shown, not hidden -- the mock shows WHY).
  const [deployedUids, setDeployedUids] = useState<Set<string>>(new Set());
  // REQ-0195b: tm (currency-for-currency) sell tab state.
  const [soldTm, setSoldTm] = useState<string | null>(null);
  const [tmQty, setTmQty] = useState<number>(1);
  const [tmPriceTm, setTmPriceTm] = useState<string | null>(null);
  const tmHoldings = useMemo(() => {
    const m = new Map<string, number>();
    for (const pg of state?.inv?.pages ?? []) for (const tm of pg.tms ?? []) m.set(tm.id, (m.get(tm.id) ?? 0) + (tm.qty || 0));
    return m;
  }, [state]);
  const heldTms = useMemo(() => [...tmHoldings.keys()].filter((id) => tms.includes(id)), [tmHoldings, tms]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  // Default the price-TM to the first live TM that isn't the one being sold.
  useEffect(() => {
    if (!soldTm) return;
    const opts = tms.filter((tt) => tt !== soldTm);
    if (!tmPriceTm || tmPriceTm === soldTm || !opts.includes(tmPriceTm)) setTmPriceTm(opts[0] ?? null);
  }, [soldTm, tms, tmPriceTm]);

  const selected = sellable.find((s) => s.itemUid === selectedUid) || null;

  /** The item's most recent settled price, if the DTO exposes one for
   * this itemId anywhere in the known listings (priceHistory[0], newest
   * first). Empty-state when never settled -- per spec, this one sub-
   * element empty-states rather than blocking the pane. */
  const anchor = useMemo(() => {
    if (!selected) return null;
    for (const l of allListings) {
      if (l.itemId === selected.itemId && l.priceHistory && l.priceHistory.length > 0) {
        return l.priceHistory[0].qty;
      }
    }
    return null;
  }, [selected, allListings]);

  function applyPrice(v: number) {
    const clamped = Math.max(MARKET_PRICE_MIN, Math.min(MARKET_PRICE_MAX, Math.round(v) || MARKET_PRICE_MIN));
    setPrice(clamped);
    setPriceText(String(clamped));
  }

  function selectItem(uid: string) {
    if (deployedUids.has(uid) || listedUids.has(uid)) return;
    setSelectedUid(uid);
    setErrKey(null);
    // Seed the stepper from the anchor when known, else 1 (mock seeds
    // from data-ask; we have no ask until listed, so anchor or floor).
    const it = sellable.find((s) => s.itemUid === uid);
    let seed = MARKET_PRICE_MIN;
    if (it) {
      for (const l of allListings) {
        if (l.itemId === it.itemId && l.priceHistory && l.priceHistory.length > 0) { seed = l.priceHistory[0].qty; break; }
      }
    }
    applyPrice(seed);
  }

  async function list() {
    if (!selected) return;
    setBusy(true);
    setErrKey(null);
    try {
      await createMarketListing({ kind: sellKind === 'tm' ? 'po' : sellKind, itemUid: selected.itemUid, price: { tm: priceTm, qty: price } });
      setToast(t(locale, 'market.sell.listedToast'));
      setSelectedUid(null);
      await onListed(); // refetch mine/browse so the new listing appears + the item grays out here
    } catch (e) {
      const key = marketErrorKey(e);
      if (key === 'market.err.deployed') {
        // Lock this card like the mock's 配備中 item -- the server is the
        // authority on deployment; reflect its answer, don't fake it.
        setDeployedUids((prev) => new Set(prev).add(selected.itemUid));
        setSelectedUid(null);
      }
      setErrKey(key);
    } finally {
      setBusy(false);
    }
  }

  const burn = burnOf(price);
  const capped = price >= MARKET_PRICE_MAX;

  // Eligible = at least one inventory PO not already locked/listed.
  const anyEligible = sellable.some((s) => !deployedUids.has(s.itemUid) && !listedUids.has(s.itemUid));

  const priceTmOptions = tms.filter((tt) => tt !== soldTm);
  async function listTm() {
    if (!soldTm || !tmPriceTm) return;
    setBusy(true);
    setErrKey(null);
    try {
      await createMarketListing({ kind: 'tm', itemId: soldTm, tmQty, price: { tm: tmPriceTm, qty: price } });
      setToast(t(locale, 'market.sell.listedToast'));
      setSoldTm(null);
      await onListed();
    } catch (e) {
      setErrKey(marketErrorKey(e));
    } finally {
      setBusy(false);
    }
  }
  const kindTabs = (
    <div className="mtabs market-sell-kindtabs" data-testid="market-sell-kindtabs">
      <span className={`mtab${sellKind === 'po' ? ' is-on' : ''}`} data-testid="market-sell-kind-po" role="button" tabIndex={0} onClick={() => setSellKind('po')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSellKind('po'); } }}>{t(locale, 'market.sell.kindPo')}</span>
      <span className={`mtab${sellKind === 'si' ? ' is-on' : ''}`} data-testid="market-sell-kind-si" role="button" tabIndex={0} onClick={() => setSellKind('si')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSellKind('si'); } }}>{t(locale, 'market.sell.kindSi')}</span>
      <span className={`mtab${sellKind === 'unit' ? ' is-on' : ''}`} data-testid="market-sell-kind-unit" role="button" tabIndex={0} onClick={() => setSellKind('unit')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSellKind('unit'); } }}>{t(locale, 'market.sell.kindUnit')}</span>
      <span className={`mtab${sellKind === 'tm' ? ' is-on' : ''}`} data-testid="market-sell-kind-tm" role="button" tabIndex={0} onClick={() => setSellKind('tm')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSellKind('tm'); } }}>{t(locale, 'market.sell.kindTm')}</span>
    </div>
  );
  const tmSection = (
    <div className="panel ornate panel-pad market-tm-sell" data-testid="market-pane-sell-tm">
      <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
      <div className="row market-carve-head">
        <h3 className="ph3 dj">{t(locale, 'market.sell.tmTitle')}</h3>
        <span className="en">{t(locale, 'market.sell.tmEn')}</span>
      </div>
      {heldTms.length === 0 ? (
        <div className="t-micro market-carve-hint" data-testid="market-sell-tm-none">{t(locale, 'market.sell.tmNoneHeld')}</div>
      ) : (
        <>
          <div className="col market-hoard-list" data-testid="market-sell-tm-picklist">
            {heldTms.map((id) => (
              <div
                key={id}
                className={`icard market-icard${id === soldTm ? ' is-selected' : ''}`}
                data-testid="market-sell-tm-item"
                data-tm-id={id}
                role="button"
                tabIndex={0}
                onClick={() => setSoldTm(id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSoldTm(id); } }}
              >
                <span className="market-thumb market-thumb-tm" aria-hidden="true"><span className="rune">ᚠ</span></span>
                <div>
                  <div className="nm">{id.toUpperCase()}</div>
                  <div className="sub">{t(locale, 'market.sell.tmBalance', { n: tmHoldings.get(id) ?? 0 })}</div>
                </div>
                {id === soldTm ? <span className="chip is-on selchip">{t(locale, 'market.sell.selected')}</span> : null}
              </div>
            ))}
          </div>
          {!soldTm ? (
            <div className="t-micro market-carve-hint" data-testid="market-sell-tm-pickhint">{t(locale, 'market.sell.tmPickHint')}</div>
          ) : priceTmOptions.length === 0 ? (
            <div className="t-micro market-carve-hint" data-testid="market-sell-tm-noprice">{t(locale, 'market.sell.tmNoPriceTm')}</div>
          ) : (
            <>
              <div className="stepper market-stepper">
                <span className="t-micro">{t(locale, 'market.sell.tmSellQty')}</span>
                <button type="button" className="sbtn" data-testid="market-tmqty-down" aria-label={t(locale, 'market.sell.priceDown')} onClick={() => setTmQty((q) => Math.max(MARKET_PRICE_MIN, q - 1))}>−</button>
                <span className="sval"><b className="tnum" data-testid="market-tmqty-val">{tmQty}</b></span>
                <button type="button" className="sbtn" data-testid="market-tmqty-up" aria-label={t(locale, 'market.sell.priceUp')} onClick={() => setTmQty((q) => Math.min(MARKET_PRICE_MAX, q + 1))}>+</button>
              </div>
              <div className="market-tm-pricein">
                <span className="t-micro">{t(locale, 'market.sell.tmPriceIn')}</span>
                <select data-testid="market-tm-pricetm" aria-label={t(locale, 'market.sell.tmPriceIn')} value={tmPriceTm ?? ''} onChange={(e) => setTmPriceTm(e.target.value)}>
                  {priceTmOptions.map((tt) => <option key={tt} value={tt}>{tt.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="stepper market-stepper">
                <button type="button" className="sbtn" data-testid="market-tmprice-down" aria-label={t(locale, 'market.sell.priceDown')} onClick={() => applyPrice(price - 1)}>−</button>
                <span className="sval"><span className="rune">ᚠ</span><b className="tnum" data-testid="market-tmprice-val">{price}</b></span>
                <button type="button" className="sbtn" data-testid="market-tmprice-up" aria-label={t(locale, 'market.sell.priceUp')} onClick={() => applyPrice(price + 1)}>+</button>
              </div>
              <div className="est market-est">
                <span data-testid="market-tm-est-line">{t(locale, 'market.sell.estPay')} <b className="tnum">{price}</b> → <span className="kw-ember">{t(locale, 'market.sell.estBurn')} <b className="tnum">{burn}</b></span> ・ {t(locale, 'market.sell.estGet')} <b className="kw-gold tnum">{price - burn}</b></span>
              </div>
              <div className="mt16">
                <button type="button" className="btn btn-forge" data-testid="market-tm-list-btn" disabled={busy} onClick={() => void listTm()}>
                  {busy ? t(locale, 'market.sell.listing') : t(locale, 'market.sell.listButton')}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {errKey ? <div className="schedule-error market-sell-error" data-testid="market-sell-error">{t(locale, errKey as Parameters<typeof t>[1])}</div> : null}
      {toast ? <div className="schedule-toast market-sell-toast" data-testid="market-sell-toast">{toast}</div> : null}
    </div>
  );

  if (sellKind !== 'tm' && sellable.length === 0) {
    return (
      <section className="market-pane" data-testid="market-pane-sell">
        {kindTabs}
        <div className="emptyblock market-empty" data-testid="market-sell-empty">
          <svg className="efig" width="46" height="40" viewBox="0 0 46 40" aria-hidden="true">
            <g fill="none" stroke="var(--gold-lo)" strokeWidth="1.5"><circle cx="23" cy="14" r="10" /><circle cx="14" cy="26" r="10" /><circle cx="32" cy="26" r="10" /></g>
          </svg>
          <div className="eja">{t(locale, 'market.sell.emptyJa')}</div>
          <span className="en">{t(locale, 'market.sell.emptyEn')}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="market-pane" data-testid="market-pane-sell">
      {kindTabs}
      {sellKind === 'tm' ? tmSection : (
      <div className="sell-grid market-sell-grid">
        {/* pick from hoard */}
        <div className="panel ornate panel-pad market-hoard">
          <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
          <div className="row market-hoard-head">
            <h3 className="ph3 dj">{t(locale, 'market.sell.hoardTitle')}</h3>
            <span className="en">{t(locale, 'market.sell.hoardEn')}</span>
          </div>
          <div className="t-micro market-hoard-note">{t(locale, 'market.sell.hoardNote')}</div>
          <div className="col market-hoard-list">
            {sellable.map((s) => {
              const name = locale === 'ja' ? (s.nameJa || s.name) : s.name;
              const locked = deployedUids.has(s.itemUid) || listedUids.has(s.itemUid);
              const lockedReason = deployedUids.has(s.itemUid)
                ? t(locale, 'market.sell.deployedLock')
                : listedUids.has(s.itemUid) ? t(locale, 'market.sell.alreadyListedLock') : '';
              const dims = s.dims;
              return (
                <div
                  key={s.itemUid}
                  className={`icard market-icard rar rar-${s.rarity || 'common'}${s.itemUid === selectedUid ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
                  data-testid="market-sell-item"
                  data-item-uid={s.itemUid}
                  data-locked={locked ? 'true' : 'false'}
                  role="button"
                  tabIndex={locked ? -1 : 0}
                  onClick={() => selectItem(s.itemUid)}
                  onKeyDown={(e) => { if (!locked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectItem(s.itemUid); } }}
                >
                  <span className="gem" />
                  <MarketThumb gameData={gameData} itemId={s.itemId} cellPx={16} alt={name} kind={sellKind} />
                  <div>
                    <div className="nm">{name}</div>
                    <div className="sub">{sellKind.toUpperCase()}{dims ? ` ・ ${dims}` : ''}{s.tags.length ? ` ・ ${s.tags.join('/')}` : ''}{s.rarity ? <span className={`rar-word r-${s.rarity}`}> {s.rarity.toUpperCase()}</span> : null}</div>
                  </div>
                  {locked
                    ? <span className="lockword" data-testid="market-sell-lockword">{lockedReason}</span>
                    : <span className="chip is-on selchip">{t(locale, 'market.sell.selected')}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* carve the price */}
        <div className="panel ornate panel-pad market-carve">
          <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
          <div className="row market-carve-head">
            <h3 className="ph3 dj">{t(locale, 'market.sell.carveTitle')}</h3>
            <span className="en">{t(locale, 'market.sell.carveEn')}</span>
          </div>

          {selected ? (
            <>
              <div className="carve-item">
                <span>{t(locale, 'market.sell.pieceLabel')}</span>
                <b className="dj" data-testid="market-carve-name">{locale === 'ja' ? selected.nameJa || selected.name : selected.name}</b>
                <span className="chip dexno">{dexNoLabel(dexNoOf(selected.itemId, allListings))}</span>
                <span className="t-micro" data-testid="market-carve-anchor">
                  {anchor != null ? t(locale, 'market.sell.anchor', { n: anchor }) : t(locale, 'market.sell.anchorNone')}
                </span>
              </div>
              <div className="stepper market-stepper">
                <button type="button" className="sbtn" data-testid="market-price-down" aria-label={t(locale, 'market.sell.priceDown')} onClick={() => applyPrice(price - 1)}>−</button>
                <span className="sval">
                  <span className="rune">ᚠ</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    data-testid="market-price-input"
                    aria-label={t(locale, 'market.sell.priceAria')}
                    value={priceText}
                    onChange={(e) => {
                      const d = e.target.value.replace(/[^\d]/g, '');
                      if (d === '') { setPriceText(''); return; }
                      const n = parseInt(d, 10);
                      setPriceText(d);
                      setPrice(Math.max(MARKET_PRICE_MIN, Math.min(MARKET_PRICE_MAX, n)));
                    }}
                    onBlur={() => applyPrice(parseInt(priceText, 10) || MARKET_PRICE_MIN)}
                  />
                </span>
                <button type="button" className="sbtn" data-testid="market-price-up" aria-label={t(locale, 'market.sell.priceUp')} onClick={() => applyPrice(price + 1)}>+</button>
                <span className="t-micro">{t(locale, 'market.sell.ceiling')}</span>
              </div>
              {capped ? <div className="t-micro capnote" data-testid="market-cap-note">{t(locale, 'market.sell.capReached')}</div> : null}
              <div className="est market-est">
                <span className="lbl">{t(locale, 'market.sell.estLabel')}</span>
                <span data-testid="market-est-line">
                  {t(locale, 'market.sell.estPay')} <b className="tnum" data-testid="market-est-pay">{price}</b> → <span className="kw-ember">{t(locale, 'market.sell.estBurn')} <b className="tnum" data-testid="market-est-burn">{burn}</b></span> ・ {t(locale, 'market.sell.estGet')} <b className="kw-gold tnum" data-testid="market-est-get">{price - burn}</b>
                </span>
              </div>
              <div className="mt16">
                <button type="button" className="btn btn-forge" data-testid="market-list-btn" disabled={busy} onClick={() => void list()}>
                  {busy ? t(locale, 'market.sell.listing') : t(locale, 'market.sell.listButton')}
                </button>
              </div>
              <div className="t-micro sell-law">{t(locale, 'market.sell.law1')}<br />{t(locale, 'market.sell.law2')}</div>
            </>
          ) : (
            <div className="t-micro market-carve-hint" data-testid="market-carve-hint">
              {anyEligible ? t(locale, 'market.sell.pickHint') : t(locale, 'market.sell.noneEligible')}
            </div>
          )}
          {/* Deliberately OUTSIDE the selected-gated block above (fixed
              post-deploy E2E, 2026-07-07): list()'s success path clears
              selectedUid right after setToast (so the picker resets),
              and the 'deployed' catch branch does the same before its
              own errKey would render -- either would otherwise hide
              these the instant they appeared. */}
          {errKey ? <div className="schedule-error market-sell-error" data-testid="market-sell-error">{t(locale, errKey as Parameters<typeof t>[1])}</div> : null}
          {toast ? <div className="schedule-toast market-sell-toast" data-testid="market-sell-toast">{toast}</div> : null}
        </div>
      </div>
      )}
    </section>
  );
}

/** Best-effort Dex No. for an inventory item id: read it off any known
 * listing of the same item (the DTO carries dexNo). Null if none. */
function dexNoOf(itemId: string, listings: ApiMarketListing[]): number | null {
  for (const l of listings) if (l.itemId === itemId && l.dexNo != null) return l.dexNo;
  return null;
}
