// client/src/warehouse/SellModal.tsx -- REQ-0366: the warehouse
// direct-sell price modal. Replaces the raw browser prompt() the
// REQ-0328 Sell action shipped with -- the ONLY raw browser dialog the
// product had -- with the market's own finished price-carve UI
// (market/priceCarve.tsx: ± stepper with integer clamp 1..999, the
// codex anchor line, the projected pay->burn->receive receipt), inside
// a MJOLNIR modal that follows the REQ-0369 conventions via
// lib/useModalConventions (Esc / overlay-click / focus trap / initial
// focus; 0366 is 0369's named first adopter).
//
// Data posture: the modal fetches ONE browse snapshot of the market
// listings on open -- solely for the anchor line (priceHistory) and the
// multi-TM display flag; a fetch failure degrades to anchorNone +
// single-TM display (non-fatal, same posture as the page's own
// content/rooms lookups). The POST itself stays in useWarehouseData's
// handleSell: contract and eligibility rules are UNCHANGED from
// REQ-0328 -- this component only carves the qty.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMarketListings, type ApiContentPayload, type ApiMarketListing } from '../api';
import { t } from '../i18n';
import { localizedItemName } from '../lib/itemContent';
import { useModalConventions } from '../lib/useModalConventions';
import { itemKindOf } from '../../../shared/player_actions.mjs';
import { anchorFor, historyFor, usePriceCarve, CarveAnchor, CarveStepper, CarveEst } from '../market/priceCarve'; // historyFor: REQ-0377 item 8
import { MarketThumb } from '../market/marketShared';
import { useGameStore, type Locale } from '../store';
import { SELL_TM_ID, type WarehouseRow } from './useWarehouseData';

interface SellModalProps {
  /** The warehouse row being listed (never a tm row -- WarehousePage
   * hides the Sell action for those, mirroring the server's
   * unsellable_kind rule). */
  row: WarehouseRow;
  /** The warehouse page's own content payload (name resolution). */
  content: ApiContentPayload | null;
  locale: Locale;
  /** True while THIS row's sell POST is in flight (sellingUid match). */
  busy: boolean;
  /** Fires with the carved price -- the parent runs handleSell and
   * closes the modal only once the row is actually listed. */
  onConfirm: (qty: number) => void;
  onClose: () => void;
}

export function SellModal({ row, content, locale, busy, onConfirm, onClose }: SellModalProps) {
  const snapshot = useGameStore();
  const gameData = snapshot.gameData;
  const { dialogRef, onScrimClick } = useModalConventions(onClose);
  const carve = usePriceCarve();

  // One browse snapshot for the anchor + the REQ-0195a multi-TM flag.
  const [listings, setListings] = useState<ApiMarketListing[]>([]);
  const [tms, setTms] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetchMarketListings()
      .then((res) => {
        if (!alive) return;
        setListings(res.listings);
        setTms(res.tms ?? []);
      })
      .catch(() => {
        /* anchor line empty-states to anchorNone; single-TM display */
      });
    return () => {
      alive = false;
    };
  }, []);

  const anchor = useMemo(() => anchorFor(row.itemId, listings), [row.itemId, listings]);
  // REQ-0377 item 8: the settled-price series behind that anchor number.
  const anchorHistory = useMemo(() => historyFor(row.itemId, listings, SELL_TM_ID), [row.itemId, listings]);

  // Seed the stepper from the anchor ONCE when it becomes known --
  // exactly like SellPane's selectItem seeding -- but only while the
  // stepper still sits at its untouched initial value: the listings
  // fetch races the user's first input and must never stomp a price
  // already being carved. (seededRef guards the rerun the changing
  // `carve` identity causes; applyPrice re-clamps like selectItem's.)
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || anchor == null) return;
    seededRef.current = true;
    if (carve.price === 1 && carve.priceText === '1') carve.applyPrice(anchor);
  }, [anchor, carve]);

  const multiTm = tms.length > 1;
  const kind = row.kind === 'tm' ? 'tm' : itemKindOf(content, row.itemId);

  return (
    <div className="scrim market-scrim" data-testid="warehouse-sell-modal" onClick={onScrimClick}>
      <div className="modal panel ornate market-modal warehouse-sell-modal" role="dialog" aria-modal="true" ref={dialogRef} tabIndex={-1}>
        <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
        <div className="row market-modal-head">
          <h3 className="ph3 dj">{t(locale, 'schedule.warehouse.sellModalTitle')}</h3>
          <span className="en">{t(locale, 'schedule.warehouse.sellModalTitleEn')}</span>
        </div>
        <div className="row market-modal-item">
          <MarketThumb gameData={gameData} itemId={row.itemId} cellPx={30} kind={kind} />
          <div>
            <div className="dj market-modal-name" data-testid="warehouse-sell-name">{localizedItemName(locale, content, row.itemId)}</div>
            <div className="t-micro market-modal-sub">
              <CarveAnchor locale={locale} anchor={anchor} entries={anchorHistory} />
            </div>
          </div>
        </div>
        <CarveStepper gameData={gameData} locale={locale} priceTm={SELL_TM_ID} multiTm={multiTm} carve={carve} />
        <CarveEst gameData={gameData} locale={locale} priceTm={SELL_TM_ID} multiTm={multiTm} price={carve.price} />
        <div className="row market-modal-actions">
          <button type="button" className="btn btn-forge" data-testid="warehouse-sell-confirm" disabled={busy} onClick={() => onConfirm(carve.price)}>
            {busy ? t(locale, 'market.sell.listing') : t(locale, 'market.sell.listButton')}
          </button>
          <button type="button" className="btn btn-ghost" data-testid="warehouse-sell-cancel" disabled={busy} onClick={onClose}>
            {t(locale, 'schedule.warehouse.sellCancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
