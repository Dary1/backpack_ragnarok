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
import { useEffect, useMemo, useState } from 'react';
import { ApiError, fetchDismantleLedger, postDismantle, type ApiDismantleLedgerEntry, type ApiDismantleResponse } from '../api';
import { iconDataUrl, iconDims } from '../dex/dexIcons';
import { ShapeGrid } from '../dex/ShapeGrid';
import { t, type TranslationKey } from '../i18n';
import { loadGame, useGameStore, type Locale } from '../store';
import type { GameState, ItemDef, SIDef } from '../engine/engine.d.ts';

interface DismantlableItem {
  itemUid: string;
  itemId: string;
  kind: 'po' | 'si';
}

/** Every inventory-homed PO + SI across all inventory pages -- the exact
 * set the server's findInventoryItem(kind:'po'|'si') accepts. Board/
 * preset items are deliberately excluded, same as SellPane's own
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
      <ShapeGrid shape={shape} cellPx={40} iconUrl={icon} iconAlt={alt} iconDims={iconDims(def.icon)} iconStretch={(def as ItemDef).stretch} />
    </span>
  );
}

interface DismantlePanelProps {
  locale: Locale;
  onClose: () => void;
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

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errKey, setErrKey] = useState<TranslationKey | null>(null);
  const [result, setResult] = useState<ApiDismantleResponse | null>(null);
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

  const keyOf = (it: DismantlableItem) => `${it.kind}:${it.itemUid}`;
  const selected = dismantlable.find((it) => keyOf(it) === selectedKey) || null;
  const selectedDef: ItemDef | SIDef | null = selected
    ? selected.kind === 'po'
      ? gameData?.ITEMS[selected.itemId] || null
      : gameData?.SI_DEFS[selected.itemId] || null
    : null;
  const selectedLedger: ApiDismantleLedgerEntry = selected
    ? ledger.get(selected.itemId) || { itemId: selected.itemId, dismantleCount: 0, suppression: 0 }
    : { itemId: '', dismantleCount: 0, suppression: 0 };

  function selectItem(it: DismantlableItem) {
    const k = keyOf(it);
    if (deployedKeys.has(k)) return;
    setSelectedKey(k);
    setErrKey(null);
    setResult(null);
  }

  async function confirmDismantle() {
    if (!selected) return;
    setBusy(true);
    setErrKey(null);
    try {
      const res = await postDismantle(selected.itemUid, selected.kind);
      setLedger((prev) => {
        const next = new Map(prev);
        next.set(res.itemId, { itemId: res.itemId, dismantleCount: res.dismantleCount, suppression: res.suppression });
        return next;
      });
      setResult(res);
      setSelectedKey(null);
      await loadGame(); // authoritative post-removal canvas -- defuses the auto-save race (see module comment)
    } catch (e) {
      const deployed = e instanceof ApiError && e.reason === 'deployed';
      if (deployed) {
        setDeployedKeys((prev) => new Set(prev).add(keyOf(selected)));
        setSelectedKey(null);
        setErrKey('workshop.dismantle.errDeployed');
      } else if (e instanceof ApiError && e.status === 404) {
        setErrKey('workshop.dismantle.errNotFound');
      } else {
        setErrKey('workshop.dismantle.errGeneric');
      }
    } finally {
      setBusy(false);
    }
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
              <div className="col workshop-dismantle-hoard-list">
                {dismantlable.map((it) => {
                  const def = it.kind === 'po' ? gameData?.ITEMS[it.itemId] || null : gameData?.SI_DEFS[it.itemId] || null;
                  const name = def ? (locale === 'ja' ? def.name_ja || def.name : def.name) : it.itemId;
                  const k = keyOf(it);
                  const locked = deployedKeys.has(k);
                  return (
                    <div
                      key={k}
                      className={`icard rar rar-${def?.rarity || 'common'}${k === selectedKey ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
                      data-testid="workshop-dismantle-item"
                      data-item-uid={it.itemUid}
                      data-locked={locked ? 'true' : 'false'}
                      role="button"
                      tabIndex={locked ? -1 : 0}
                      onClick={() => selectItem(it)}
                      onKeyDown={(e) => {
                        if (!locked && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          selectItem(it);
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
              {selected && selectedDef ? (
                <>
                  <div className="carve-item">
                    <span>{t(locale, 'workshop.dismantle.pieceLabel')}</span>
                    <b className="dj" data-testid="workshop-dismantle-name">
                      {locale === 'ja' ? selectedDef.name_ja || selectedDef.name : selectedDef.name}
                    </b>
                  </div>
                  <div className="workshop-dismantle-stats t-micro">
                    <div>
                      {t(locale, 'dexcard.dismantleCount')}:{' '}
                      <b className="tnum" data-testid="workshop-dismantle-count">
                        {selectedLedger.dismantleCount}
                      </b>
                    </div>
                    <div>
                      {t(locale, 'dexcard.suppression')}:{' '}
                      <b className="tnum" data-testid="workshop-dismantle-suppression">
                        {Math.round(selectedLedger.suppression * 100)}%
                      </b>
                    </div>
                  </div>
                  <div className="t-micro workshop-dismantle-note">{t(locale, 'workshop.dismantle.yieldNote')}</div>
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
                </>
              ) : (
                <div className="t-micro workshop-dismantle-hint" data-testid="workshop-dismantle-hint">
                  {anyEligible ? t(locale, 'workshop.dismantle.pickHint') : t(locale, 'workshop.dismantle.noneEligible')}
                </div>
              )}
              {errKey ? (
                <div className="schedule-error workshop-dismantle-error" data-testid="workshop-dismantle-error">
                  {t(locale, errKey)}
                </div>
              ) : null}
              {result ? (
                <div className="schedule-toast workshop-dismantle-toast" data-testid="workshop-dismantle-toast">
                  {t(locale, 'workshop.dismantle.resultToast', { qty: result.yield.qty })}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
