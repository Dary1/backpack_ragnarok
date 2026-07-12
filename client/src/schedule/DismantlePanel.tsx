// client/src/schedule/DismantlePanel.tsx -- REQ-0063: the Dismantle
// modal, opened from WorkshopPage's dismantle tile (replacing its old
// REQ-0076 "opening soon" shell). Picker over the player's OWN inventory
// POs AND SIs (state.inv.pages[].pos[]/.sis[]) -- the exact set
// server/services/dismantle.cjs's findInventoryItem(kind:'po'|'si')
// accepts (inventory-homed only; board/deployed items are refused
// server-side with a 409 and locked in place here, same "shown locked,
// not hidden" posture client/src/market/SellPane.tsx already established
// for the identical market case) -- plus a confirm action that POSTs
// /api/dismantle and shows the REAL yield + updated 分解値/suppression
// straight from the server's response. The suppression FORMULA itself
// (server/services/dismantle.cjs's suppressionFloor) is deliberately not
// duplicated here -- this panel only ever displays numbers the server
// already computed (the ledger fetch below, or a dismantle response),
// never a client-side guess.
//
// Removal happens SERVER-side (RULE-5 sanctioned direct-canvas-write,
// removal only -- see dismantleItem's own doc), so a successful dismantle
// calls the store's loadGame() afterward to pull the authoritative
// post-removal canvas -- EXACTLY the same race guard client/src/market/
// MarketPage.tsx's own buy flow uses (see that file's "THE CRITICAL RACE
// GUARD" comment): without it, this client's stale in-memory copy of the
// dismantled item would silently resurrect it on the next unrelated
// auto-save PUT.
//
// REQ-0090: the hoard list below is multi-select (hold+drag adds every
// row the pointer passes over, Shift+Click adds one row, Ctrl+Click
// range-selects by index -- see useListMultiSelect.ts for the exact
// semantics and why Ctrl/Shift are swapped from the usual OS convention
// here). Confirming with N items selected dismantles all N via N
// sequential postDismantle calls (not a new batch endpoint -- REQ-0090's
// own documented v1 default: these remain N independent removals, and a
// partial failure surfaces honestly rather than claiming a false
// atomicity guarantee).
import { useEffect, useMemo, useState } from 'react';
import { ApiError, fetchDismantleLedger, postDismantle, type ApiDismantleLedgerEntry } from '../api';
import { iconDataUrl, iconDims } from '../dex/dexIcons';
import { ShapeGrid } from '../dex/ShapeGrid';
import { t, type TranslationKey } from '../i18n';
import { loadGame, useGameStore, type Locale } from '../store';
import type { GameState, ItemDef, SIDef } from '../engine/engine.d.ts';
import { useListMultiSelect } from './useListMultiSelect';

interface DismantlableItem {
  itemUid: string;
  itemId: string;
  kind: 'po' | 'si';
}

/** Every inventory-homed PO + SI across all inventory pages -- the exact
 * set the server's findInventoryItem(kind:'po'|'si') accepts. Board/
 * squad items are deliberately excluded, same as SellPane's own
 * collectSellable -- those are the deployed/placed set the server
 * refuses (409). */
function collectDismantlable(state: GameState | null): DismantlableItem[] {
  if (!state || !state.inv || !Array.isArray(state.inv.pages)) return [];
  const out: DismantlableItem[] = [];
  for (const pg of state.inv.pages) {
    for (const po of pg.pos || []) out.push({ itemUid: po.uid, itemId: po.id, kind: 'po' });
    for (const si of pg.sis || []) out.push({ itemUid: si.uid, itemId: si.id, kind: 'si' });
  }
  return out;
}

/** The one thumbnail this panel uses for either a PO or an SI -- same
 * ShapeGrid-based composition as MarketThumb/DexCardWindow ("same math
 * everywhere"), generalized past MarketThumb's PO-only ITEMS lookup. An
 * SI has no `shape` of its own; DexCardWindow's own precedent for that
 * case (a single [0,0] cell) is reused verbatim rather than inventing a
 * second fallback. */
function DismantleThumb({ def, alt }: { def: ItemDef | SIDef | null; alt: string }) {
  if (!def) return <span className="market-thumb market-thumb-empty" aria-hidden="true" />;
  const icon = iconDataUrl(def.icon);
  const shapeSrc = (def as ItemDef).shape;
  const shape = shapeSrc && shapeSrc.length > 0 ? shapeSrc : ([[0, 0]] as Array<[number, number]>);
  return (
    <span className="market-thumb">
      <ShapeGrid shape={shape} cellPx={40} iconUrl={icon} iconAlt={alt} iconDims={iconDims(def.icon)} iconStretch={(def as ItemDef).stretch} iconAlign={(def as ItemDef).align} />
    </span>
  );
}

interface DismantlePanelProps {
  locale: Locale;
  onClose: () => void;
}

/** REQ-0090: the outcome of one confirm click, which may have dismantled
 * more than one item -- deliberately NOT `ApiDismantleResponse` (that's
 * one server call's own response shape); this is this panel's own local
 * aggregate over however many of the N calls actually succeeded. */
interface DismantleBatchResult {
  count: number;
  qty: number;
}

export function DismantlePanel({ locale, onClose }: DismantlePanelProps) {
  const snapshot = useGameStore();
  const gameData = snapshot.gameData;
  // snapshot.state is a STABLE reference for the app's whole lifetime
  // (the store mutates it in place, see store/core.ts's module comment --
  // "the actual game-state object identity must stay the same"), so
  // stateVersion must be in this dependency array too or this memo would
  // never recompute after the confirmDismantle -> loadGame() refresh
  // (loadGame reassigns state.inv to a NEW object, but `state` itself
  // keeps its old reference) -- the picker would keep showing an already-
  // dismantled item as still available for a second pick in the same
  // modal session.
  // stateVersion is intentionally in this array even though
  // collectDismantlable's body doesn't reference it directly -- same
  // suppression precedent as client/src/board/Board.tsx's own boot-effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dismantlable = useMemo(() => collectDismantlable(snapshot.state), [snapshot.state, snapshot.stateVersion]);

  const keyOf = (it: DismantlableItem) => `${it.kind}:${it.itemUid}`;
  // REQ-0090: multi-select interaction state over `dismantlable`'s own
  // index order -- see useListMultiSelect.ts. Automatically drops any
  // selected key that falls out of `dismantlable` (e.g. after a confirm's
  // loadGame() refresh removes the just-dismantled rows).
  const multi = useListMultiSelect(dismantlable, keyOf);

  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState<TranslationKey | null>(null);
  const [result, setResult] = useState<DismantleBatchResult | null>(null);
  // Server-authoritative deployed set, discovered lazily from 409s --
  // never scanned client-side (same posture as SellPane's deployedUids;
  // the room/schedule state that would make this computable isn't
  // loaded on this client at all).
  const [deployedKeys, setDeployedKeys] = useState<Set<string>>(new Set());
  // itemId -> {dismantleCount, suppression} -- the CALLER's own ledger,
  // fetched once on open and kept fresh locally from each dismantle
  // response (see confirmDismantle below) rather than re-fetched every time.
  const [ledger, setLedger] = useState<Map<string, ApiDismantleLedgerEntry>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetchDismantleLedger()
      .then((res) => {
        if (cancelled) return;
        setLedger(new Map(res.entries.map((e) => [e.itemId, e])));
      })
      .catch(() => {
        /* non-fatal -- the picker/confirm flow works fine without the
           preview numbers; they simply show the zero-baseline below. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ESC closes, same convention as the roll-result modal / dex card stack.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // REQ-0090: the live, confirmable selection -- a locked (deployed-while-
  // this-modal-was-open) row can end up inside multi.selected if it fell
  // within a Ctrl+Click index range, since the selection model itself has
  // no notion of "locked"; filtered back out here at every read site
  // (rendering AND confirm) rather than teaching the generic hook about
  // this panel's own concept of a lock.
  const selectedItems = dismantlable.filter((it) => multi.selected.has(keyOf(it)) && !deployedKeys.has(keyOf(it)));
  const selectedCount = selectedItems.length;
  const singleSelected = selectedCount === 1 ? selectedItems[0] : null;
  const singleSelectedDef: ItemDef | SIDef | null = singleSelected
    ? singleSelected.kind === 'po'
      ? gameData?.ITEMS[singleSelected.itemId] || null
      : gameData?.SI_DEFS[singleSelected.itemId] || null
    : null;
  const singleSelectedLedger: ApiDismantleLedgerEntry = singleSelected
    ? ledger.get(singleSelected.itemId) || { itemId: singleSelected.itemId, dismantleCount: 0, suppression: 0 }
    : { itemId: '', dismantleCount: 0, suppression: 0 };

  function onRowMouseDown(index: number, it: DismantlableItem, e: { shiftKey: boolean; ctrlKey: boolean }) {
    if (deployedKeys.has(keyOf(it))) return;
    setErrKey(null);
    setResult(null);
    multi.handlers.onRowMouseDown(index, e);
  }

  function onRowMouseEnter(index: number, it: DismantlableItem) {
    if (deployedKeys.has(keyOf(it))) return;
    multi.handlers.onRowMouseEnter(index);
  }

  async function confirmDismantle() {
    if (selectedItems.length === 0) return;
    setBusy(true);
    setErrKey(null);
    let succeededCount = 0;
    let succeededQty = 0;
    let anyDeployed = false;
    let anyNotFound = false;
    let anyGeneric = false;
    // N sequential calls, not a batch endpoint (REQ-0090 v1 default) --
    // these are independent removals; a mid-batch 409/404 on one item
    // must not abort the rest.
    for (const it of selectedItems) {
      try {
        const res = await postDismantle(it.itemUid, it.kind);
        succeededCount += 1;
        succeededQty += res.yield.qty;
        setLedger((prev) => {
          const next = new Map(prev);
          next.set(res.itemId, { itemId: res.itemId, dismantleCount: res.dismantleCount, suppression: res.suppression });
          return next;
        });
      } catch (e) {
        if (e instanceof ApiError && e.reason === 'deployed') {
          setDeployedKeys((prev) => new Set(prev).add(keyOf(it)));
          anyDeployed = true;
        } else if (e instanceof ApiError && e.status === 404) {
          anyNotFound = true;
        } else {
          anyGeneric = true;
        }
      }
    }
    if (succeededCount > 0) {
      setResult({ count: succeededCount, qty: succeededQty });
    }
    setErrKey(anyDeployed ? 'workshop.dismantle.errDeployed' : anyNotFound ? 'workshop.dismantle.errNotFound' : anyGeneric ? 'workshop.dismantle.errGeneric' : null);
    multi.clear();
    if (succeededCount > 0) {
      await loadGame(); // authoritative post-removal canvas -- defuses the auto-save race (see module comment)
    }
    setBusy(false);
  }

  const anyEligible = dismantlable.some((it) => !deployedKeys.has(keyOf(it)));

  return (
    <div
      className="scrim workshop-dismantle-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal panel ornate workshop-dismantle-modal" data-testid="workshop-dismantle-modal">
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />
        <div className="workshop-dismantle-head">
          <span className="rune">{'ᚠ'}</span>
          <span className="workshop-dismantle-head-title dj">{t(locale, 'workshop.dismantle.modalTitle')}</span>
          <span className="den">{t(locale, 'workshop.dismantle.modalDen')}</span>
          <span className="workshop-dismantle-head-grow" />
          <button
            type="button"
            className="dexcard-close-btn"
            aria-label={t(locale, 'dexcard.close')}
            onClick={onClose}
            data-testid="workshop-dismantle-close"
          >
            ✕
          </button>
        </div>

        {dismantlable.length === 0 ? (
          <div className="emptyblock market-empty workshop-dismantle-empty" data-testid="workshop-dismantle-empty">
            <div className="eja">{t(locale, 'workshop.dismantle.emptyJa')}</div>
            <span className="en">{t(locale, 'workshop.dismantle.emptyEn')}</span>
          </div>
        ) : (
          <div className="workshop-dismantle-grid">
            <div className="panel ornate panel-pad workshop-dismantle-hoard">
              <div className="t-micro workshop-dismantle-hoard-note">{t(locale, 'workshop.dismantle.hoardNote')}</div>
              <div className="col workshop-dismantle-hoard-list" data-testid="workshop-dismantle-hoard-list">
                {dismantlable.map((it, index) => {
                  const def = it.kind === 'po' ? gameData?.ITEMS[it.itemId] || null : gameData?.SI_DEFS[it.itemId] || null;
                  const name = def ? (locale === 'ja' ? def.name_ja || def.name : def.name) : it.itemId;
                  const k = keyOf(it);
                  const locked = deployedKeys.has(k);
                  const isSel = !locked && multi.isSelected(k);
                  return (
                    <div
                      key={k}
                      className={`icard rar rar-${def?.rarity || 'common'}${isSel ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
                      data-testid="workshop-dismantle-item"
                      data-item-uid={it.itemUid}
                      data-locked={locked ? 'true' : 'false'}
                      role="button"
                      tabIndex={locked ? -1 : 0}
                      onMouseDown={(e) => onRowMouseDown(index, it, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey })}
                      onMouseEnter={() => onRowMouseEnter(index, it)}
                      onKeyDown={(e) => {
                        if (!locked && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onRowMouseDown(index, it, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey });
                        }
                      }}
                    >
                      <span className="gem" />
                      <DismantleThumb def={def} alt={name} />
                      <div>
                        <div className="nm">{name}</div>
                        <div className="sub">
                          {it.kind === 'po' ? 'PO' : 'SI'}
                          {def?.rarity ? <span className={`rar-word r-${def.rarity}`}> {def.rarity.toUpperCase()}</span> : null}
                        </div>
                      </div>
                      {locked ? (
                        <span className="lockword" data-testid="workshop-dismantle-lockword">
                          {t(locale, 'workshop.dismantle.deployedLock')}
                        </span>
                      ) : (
                        <span className="chip is-on selchip">{t(locale, 'market.sell.selected')}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel ornate panel-pad workshop-dismantle-confirm">
              {selectedCount === 0 ? (
                <div className="t-micro workshop-dismantle-hint" data-testid="workshop-dismantle-hint">
                  {anyEligible ? t(locale, 'workshop.dismantle.pickHint') : t(locale, 'workshop.dismantle.noneEligible')}
                </div>
              ) : selectedCount === 1 && singleSelectedDef ? (
                <>
                  <div className="carve-item">
                    <span>{t(locale, 'workshop.dismantle.pieceLabel')}</span>
                    <b className="dj" data-testid="workshop-dismantle-name">
                      {locale === 'ja' ? singleSelectedDef.name_ja || singleSelectedDef.name : singleSelectedDef.name}
                    </b>
                  </div>
                  <div className="workshop-dismantle-stats t-micro">
                    <div>
                      {t(locale, 'dexcard.dismantleCount')}:{' '}
                      <b className="tnum" data-testid="workshop-dismantle-count">
                        {singleSelectedLedger.dismantleCount}
                      </b>
                    </div>
                    <div>
                      {t(locale, 'dexcard.suppression')}:{' '}
                      <b className="tnum" data-testid="workshop-dismantle-suppression">
                        {Math.round(singleSelectedLedger.suppression * 100)}%
                      </b>
                    </div>
                  </div>
                  <div className="t-micro workshop-dismantle-note">{t(locale, 'workshop.dismantle.yieldNote')}</div>
                </>
              ) : (
                <div data-testid="workshop-dismantle-multi-summary">
                  <div className="carve-item">
                    <span>{t(locale, 'workshop.dismantle.multiPieceLabel')}</span>
                    <b className="dj tnum" data-testid="workshop-dismantle-multi-count">
                      {selectedCount}
                    </b>
                  </div>
                  <div className="t-micro workshop-dismantle-note">{t(locale, 'workshop.dismantle.multiYieldNote')}</div>
                </div>
              )}

              {selectedCount > 0 ? (
                <div className="t-micro workshop-dismantle-selrow" data-testid="workshop-dismantle-selected-count">
                  {t(locale, 'workshop.dismantle.selectedCount', { count: selectedCount })}
                  {' · '}
                  <button type="button" className="workshop-dismantle-clear-btn" data-testid="workshop-dismantle-clear-btn" onClick={() => multi.clear()}>
                    {t(locale, 'workshop.dismantle.clearSelection')}
                  </button>
                </div>
              ) : null}

              {selectedCount > 0 ? (
                <div className="mt16">
                  <button
                    type="button"
                    className="btn btn-forge"
                    data-testid="workshop-dismantle-confirm-btn"
                    disabled={busy}
                    onClick={() => void confirmDismantle()}
                  >
                    <span className="rune">{'ᚠ'}</span> {busy ? t(locale, 'workshop.dismantle.dismantling') : t(locale, 'workshop.dismantle.confirmBtn')}
                  </button>
                </div>
              ) : null}

              {errKey ? (
                <div className="schedule-error workshop-dismantle-error" data-testid="workshop-dismantle-error">
                  {t(locale, errKey)}
                </div>
              ) : null}
              {result ? (
                <div className="schedule-toast workshop-dismantle-toast" data-testid="workshop-dismantle-toast">
                  {result.count > 1
                    ? t(locale, 'workshop.dismantle.resultToastMulti', { count: result.count, qty: result.qty })
                    : t(locale, 'workshop.dismantle.resultToast', { qty: result.qty })}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
