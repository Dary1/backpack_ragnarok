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
// REQ-0373: mass dismantle grew a SAFETY rail. The multi-selection summary
// showed a bare count, so one confirm could melt a Rare inside a 30-item
// drag-select and the player would never know it had been in there --
// dismantle is irreversible, and the count told them nothing about WHAT.
// Two additions, both display-only on the client's own state (no new
// endpoint, no server change): a per-rarity chip breakdown of the live
// selection, and a two-click ARM on the confirm button whenever the
// selection holds anything at Rare or better. The single-item flow is
// untouched -- it already names the exact piece being destroyed, which is
// the whole thing the multi flow was missing.
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
import { useModalConventions } from '../lib/useModalConventions'; // REQ-0369
import { useListMultiSelect } from './useListMultiSelect';

interface DismantlableItem {
  itemUid: string;
  itemId: string;
  kind: 'po' | 'si';
}

/** REQ-0373: the closed rarity vocabulary, weakest first
 * (content/vocab.json's `rarities`). Order matters twice: the chips render
 * in it, and everything from RARITY_ARM_FLOOR up is what arms the confirm.
 * A def with an unknown/absent rarity is counted as Common -- the same
 * fallback the row's own `rar-${def?.rarity || 'common'}` class already
 * uses, so the chips can never disagree with the tint beside them. */
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Relic'] as const;
type Rarity = (typeof RARITIES)[number];
const RARITY_ARM_FLOOR = RARITIES.indexOf('Rare');
const RARITY_LABEL: Record<Rarity, TranslationKey> = {
  Common: 'workshop.dismantle.rarity.Common',
  Uncommon: 'workshop.dismantle.rarity.Uncommon',
  Rare: 'workshop.dismantle.rarity.Rare',
  Relic: 'workshop.dismantle.rarity.Relic',
};
function rarityOf(def: ItemDef | SIDef | null): Rarity {
  const r = def && typeof def.rarity === 'string' ? def.rarity : '';
  return (RARITIES as readonly string[]).includes(r) ? (r as Rarity) : 'Common';
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

  // REQ-0373: the confirm button's two-click arm. Reset by every change to
  // the selection (below) so an arm can never outlive the selection it was
  // granted for -- arming on "1 Common + 1 Rare" and then Ctrl-clicking 20
  // more rows must ask again.
  const [armed, setArmed] = useState(false);
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

  // REQ-0369: Esc (this panel's own pre-0369 listener, aligned), overlay
  // click, focus trap and initial focus via the shared conventions hook --
  // the same conventions as every player-facing modal since REQ-0366/0369.
  const { dialogRef, onScrimClick } = useModalConventions(onClose);

  // REQ-0090: the live, confirmable selection -- a locked (deployed-while-
  // this-modal-was-open) row can end up inside multi.selected if it fell
  // within a Ctrl+Click index range, since the selection model itself has
  // no notion of "locked"; filtered back out here at every read site
  // (rendering AND confirm) rather than teaching the generic hook about
  // this panel's own concept of a lock.
  const selectedItems = dismantlable.filter((it) => multi.selected.has(keyOf(it)) && !deployedKeys.has(keyOf(it)));
  const selectedCount = selectedItems.length;
  // REQ-0373: per-rarity tally of the LIVE selection (the same
  // deployed-filtered list the confirm will act on, so the chips can never
  // over-report), plus whether it holds anything at Rare or better.
  const defOf = (it: DismantlableItem): ItemDef | SIDef | null =>
    (it.kind === 'po' ? gameData?.ITEMS[it.itemId] : gameData?.SI_DEFS[it.itemId]) || null;
  const rarityCounts = new Map<Rarity, number>();
  for (const it of selectedItems) {
    const r = rarityOf(defOf(it));
    rarityCounts.set(r, (rarityCounts.get(r) ?? 0) + 1);
  }
  const precious = RARITIES.some((r, i) => i >= RARITY_ARM_FLOOR && (rarityCounts.get(r) ?? 0) > 0);
  const needsArm = selectedCount > 1 && precious;
  // The selection key changes whenever the SET changes, which is what
  // disarms the button (see `armed` above). Sorted so a re-selection in a
  // different order is the same selection.
  const selectionKey = selectedItems.map((it) => keyOf(it)).sort().join('|');
  useEffect(() => {
    setArmed(false);
  }, [selectionKey]);
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
    setArmed(false); // REQ-0373: never leave a spent arm behind
    if (succeededCount > 0) {
      await loadGame(); // authoritative post-removal canvas -- defuses the auto-save race (see module comment)
    }
    setBusy(false);
  }

  const anyEligible = dismantlable.some((it) => !deployedKeys.has(keyOf(it)));

  return (
    <div
      className="scrim workshop-dismantle-scrim"
      onClick={onScrimClick}
    >
      <div className="modal panel ornate workshop-dismantle-modal" data-testid="workshop-dismantle-modal" role="dialog" aria-modal="true" ref={dialogRef} tabIndex={-1}>
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
                  {/* REQ-0373: WHAT is in the selection, not just how many.
                      Only rarities actually present get a chip -- a row of
                      four chips, three of them zero, is noise that hides the
                      one number that matters. */}
                  <div className="workshop-dismantle-rarity-chips" data-testid="workshop-dismantle-rarity-chips">
                    {RARITIES.filter((r) => (rarityCounts.get(r) ?? 0) > 0).map((r) => (
                      <span key={r} className={`chip rar-word r-${r} workshop-dismantle-rarity-chip`} data-rarity={r} data-count={rarityCounts.get(r)}>
                        {t(locale, RARITY_LABEL[r])} <b className="tnum">{rarityCounts.get(r)}</b>
                      </span>
                    ))}
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
                  {/* REQ-0373: the two-click arm. First click on a
                      Rare-or-better multi-selection only ARMS -- the label
                      changes to name what is at stake and the second click
                      performs the dismantle. `data-armed` is the machine-
                      readable state (the e2e gate reads it); `needsArm` is
                      false for a single item and for Common/Uncommon-only
                      selections, which confirm in one click exactly as
                      before. */}
                  <button
                    type="button"
                    className={`btn btn-forge${needsArm && armed ? ' is-armed' : ''}`}
                    data-testid="workshop-dismantle-confirm-btn"
                    data-needs-arm={needsArm ? 'true' : 'false'}
                    data-armed={needsArm && armed ? 'true' : 'false'}
                    disabled={busy}
                    onClick={() => {
                      if (needsArm && !armed) {
                        setArmed(true);
                        return;
                      }
                      void confirmDismantle();
                    }}
                  >
                    <span className="rune">{'ᚠ'}</span>{' '}
                    {busy
                      ? t(locale, 'workshop.dismantle.dismantling')
                      : needsArm && !armed
                        ? t(locale, 'workshop.dismantle.armBtn')
                        : needsArm && armed
                          ? t(locale, 'workshop.dismantle.armedBtn')
                          : t(locale, 'workshop.dismantle.confirmBtn')}
                  </button>
                  {needsArm ? (
                    <div className="t-micro workshop-dismantle-armnote" data-testid="workshop-dismantle-arm-note">
                      {armed ? t(locale, 'workshop.dismantle.armedNote') : t(locale, 'workshop.dismantle.armNote')}
                    </div>
                  ) : null}
                </div>
              ) : null}

            </div>
          </div>
        )}

        {/* REQ-0159: the outcome banners live OUTSIDE the
            `dismantlable.length === 0` ternary above, NOT inside its
            non-empty branch.

            They used to sit inside it, which meant a successful dismantle
            could unmount its OWN confirmation: confirmDismantle() sets
            `result`, then awaits loadGame(), which drops the just-destroyed
            item from state -- and if it was the caller's LAST dismantlable
            item, `dismantlable` became empty, the panel flipped to the
            empty-state branch, and the toast that had just been set was never
            rendered at all. Dismantling your last item therefore gave you NO
            feedback whatsoever (and the same held for `errKey`: an error on
            the last item was silently swallowed too). The bug dated from
            REQ-0063 and was only ever intermittent in e2e because the dev
            fixture usually happened to have other inventory items left over,
            which kept the list non-empty and the toast alive.

            Hoisting them here makes the outcome independent of what the
            dismantle did to the list -- which is the whole point of a
            confirmation. */}
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
  );
}
