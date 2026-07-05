// Workshop route (#/workshop) -- REQ-0042. Common BP gacha: costs
// GACHA_COMMON_BP_COST_DISPLAY (10) LRDST (a stackable TM currency, see
// mock-src/engine.js's TM model). Follows the SAME "fetch on mount,
// loading/error states, t()" shape SchedulePage.tsx/DexRoot.tsx/
// Settings.tsx already established for a route-level component, and
// reuses WarehouseTab.tsx's EXACT two-phase claim/first-fit/pulse
// pattern for the roll flow (server mints a pending roll -> THIS client
// deducts the cost + first-fit-places the rolled BP + pulses + auto-
// saves -> the resulting profile PUT is what finalizes the roll
// server-side, see server/schedule.cjs's finalizeGachaForCanvas).
import { useCallback, useEffect, useState } from 'react';
import { ApiError, rollWorkshopGacha, type ApiRolledBp } from '../api';
import { getInventoryRenderer } from '../board/inventoryRenderer';
import { BpDiagram } from '../dex/BpDiagram';
import { t } from '../i18n';
import { notifyStateChanged, useGameStore, type Locale } from '../store';

interface WorkshopPageProps {
  locale: Locale;
}

const GACHA_COMMON_BP_COST_DISPLAY = 10; // mirrors server/schedule.cjs's GACHA_COMMON_BP_COST (display only)
const GRID_MIN = 1;
const GRID_MAX = 8; // matches every inventory page's fixed 8x8 layout, same bound WarehouseTab.tsx's firstFitPlace uses
const TAB_PULSE_MS = 1600; // same constant WarehouseTab.tsx uses for its cross-page tab-pulse notification

/** Sums qty across every same-id 'lrdst' TM stack, across EVERY
 * inventory page (a display-only balance -- the actual spend at roll
 * time is page-scoped, per engine.js's spendTM design; showing a
 * total-across-pages balance here is simply the most useful "can I
 * afford this" number for the player, since the roll deducts from
 * whichever page(s) actually hold LRDST via spendTM's own largest-
 * stack-first page-local drain -- see handleRoll below for exactly
 * which page it targets). */
function readTotalLrdstBalance(state: ReturnType<typeof useGameStore>['state']): number {
  if (!state || !state.inv) return 0;
  let total = 0;
  for (const pg of state.inv.pages) {
    for (const tm of pg.tms || []) {
      if (tm.id === 'lrdst') total += tm.qty;
    }
  }
  return total;
}

/** Briefly applies the tab-claim-pulse CSS class to the inv-tab button
 * at `pageIndex` -- byte-for-byte copy of WarehouseTab.tsx's own
 * pulseTab() helper (same DOM-query-based approach, not worth sharing
 * via an import for one small helper reused across two route-level
 * components with otherwise independent lifecycles). */
function pulseTab(pageIndex: number): void {
  const el = document.querySelector<HTMLElement>(`[data-tab-kind="inv"][data-tab-index="${pageIndex}"]`);
  if (!el) return;
  el.classList.remove('tab-claim-pulse');
  void el.offsetWidth;
  el.classList.add('tab-claim-pulse');
  setTimeout(() => el.classList.remove('tab-claim-pulse'), TAB_PULSE_MS);
}

interface BpPlacementResult {
  page: number;
  origin: [number, number];
}

/** First-fit placement for a freshly-rolled BP -- same push-check-
 * rollback pattern as WarehouseTab.tsx's firstFitPlace 'po' branch, just
 * against engine.invCanPlaceBP/invMoveBP instead of invCanPlacePO/
 * invMovePO (a BP record, unlike a PO, needs shape/linker/hpMax on the
 * placeholder, not just id/loc/cell/rot). Tries `openPage` first, then
 * every other page in ascending order -- matches the same "try the
 * currently open page first" convention WarehouseTab.tsx's claim flow
 * uses. */
function firstFitPlaceBp(
  engine: NonNullable<ReturnType<typeof useGameStore>['engine']>,
  state: NonNullable<ReturnType<typeof useGameStore>['state']>,
  rolled: ApiRolledBp,
  openPage: number,
  pageCount: number
): BpPlacementResult | null {
  const pageOrder = [openPage, ...Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== openPage)];
  for (const pg of pageOrder) {
    const container = state.inv!.pages[pg];
    container.bps.push({
      id: rolled.uid,
      name: 'BP',
      color: '#8a8a8a',
      shape: rolled.shape,
      origin: [1, 1],
      linker: rolled.linker,
      hpMax: rolled.hpMax,
    });
    let found: [number, number] | null = null;
    for (let r = GRID_MIN; r <= GRID_MAX && !found; r++) {
      for (let c = GRID_MIN; c <= GRID_MAX && !found; c++) {
        const chk = engine.invCanPlaceBP(state, pg, rolled.uid, [r, c]);
        if (chk.ok) found = [r, c];
      }
    }
    if (found) {
      engine.invMoveBP(state, pg, rolled.uid, found);
      return { page: pg, origin: found };
    }
    container.bps.pop(); // no room on this page -- roll back, try next
  }
  return null;
}

export function WorkshopPage({ locale }: WorkshopPageProps) {
  const snapshot = useGameStore();
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // REQ-0045 (h): the last successfully rolled BP's full definition, kept
  // around purely for the result diagram below -- independent of the
  // placement/toast logic above (which runs unchanged regardless of
  // whether the player dismisses this panel). Cleared on the NEXT roll
  // attempt (not on dismiss-only) so a failed re-roll doesn't leave a
  // stale diagram from the previous success on screen looking current.
  const [rollResult, setRollResult] = useState<ApiRolledBp | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const balance = readTotalLrdstBalance(snapshot.state);
  const canAfford = balance >= GACHA_COMMON_BP_COST_DISPLAY;

  const handleRoll = useCallback(async () => {
    setRolling(true);
    setError(null);
    setRollResult(null);
    try {
      // Phase 1: server verifies balance + rolls a fresh BP definition,
      // records a pending row, returns it WITHOUT deducting anything.
      const res = await rollWorkshopGacha('common_bp');
      const { cost, rolled } = res;
      // REQ-0045 (h): reveal the rolled BP's full diagram (shape + linker
      // + beam dirs + hpMax + cell count) as soon as the definition is
      // known -- independent of placement succeeding/failing below (the
      // roll itself already happened; the diagram is just showing the
      // player what they got).
      setRollResult(rolled);

      const engine = snapshot.engine;
      const state = snapshot.state;
      if (!engine || !state || !state.inv) {
        throw new Error('inventory not ready');
      }

      // Phase 2 (THIS client): deduct `cost` LRDST via engine.spendTM
      // (page-scoped, largest-stack-first -- see engine.js's TM model
      // comment for why spend is page-scoped) from the CURRENTLY OPEN
      // page first, falling back to any other page that alone holds
      // enough to cover the cost (spendTM itself never partially spends
      // across pages -- see its own doc -- so this loop tries whole
      // pages in order until one page's own balance covers the cost).
      const openPage = snapshot.activeInvPage;
      const pageOrder = [openPage, ...Array.from({ length: engine.PAGE_COUNT }, (_, i) => i).filter((i) => i !== openPage)];
      let spent = false;
      for (const pg of pageOrder) {
        const spendRes = engine.spendTM(state, pg, 'lrdst', cost);
        if (spendRes.ok) {
          spent = true;
          break;
        }
      }
      if (!spent) {
        // Should not happen (server already verified balance >= cost
        // against the last-saved canvas moments ago) unless the balance
        // changed in the interim on THIS client without a save, or the
        // player's LRDST is split across multiple pages with none alone
        // covering the cost -- surface an error rather than silently
        // placing a BP the player never paid for.
        setError(t(locale, 'workshop.spendFailed'));
        return;
      }

      // First-fit place the rolled BP, same open-page-first/pulse/
      // tab-pulse-fallback pattern as WarehouseTab.tsx's claim flow.
      const placed = firstFitPlaceBp(engine, state, rolled, openPage, engine.PAGE_COUNT);
      if (!placed) {
        // No space anywhere -- per the same accepted design as the
        // warehouse claim's own "no space" case, the pending roll is
        // simply left unfinalized server-side; it lazily reverts after
        // the timeout (see finalizeGachaForCanvas/purgeExpiredGachaPending).
        // The LRDST was already deducted above, though -- to avoid
        // silently losing currency for a roll that can never be placed,
        // refund it locally before surfacing the error (no server round
        // trip needed -- the pending roll was never finalized, so the
        // server-side balance was never touched either).
        for (const pg of pageOrder) {
          const refund = engine.tmMove(state, pg, 'lrdst_refund_' + Date.now(), [1, 1], 'lrdst', cost);
          if (refund.ok) break;
        }
        setError(t(locale, 'workshop.noSpace'));
        return;
      }

      const renderer = getInventoryRenderer();
      const cells = engine.bpCells({ shape: rolled.shape, origin: placed.origin } as Parameters<typeof engine.bpCells>[0]);
      if (placed.page === openPage) {
        renderer?.pulseCellsSuccess(cells);
      } else {
        pulseTab(placed.page);
      }

      // Let the existing debounced auto-save run naturally -- this PUT
      // is what finalizes the pending roll server-side (uid present AND
      // balance dropped, see finalizeGachaForCanvas).
      notifyStateChanged();

      setToast(
        placed.page === openPage
          ? t(locale, 'workshop.rolledToast')
          : t(locale, 'workshop.rolledOnOtherPage', { page: placed.page + 1 })
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t(locale, 'workshop.insufficientFunds'));
      } else {
        setError(t(locale, 'workshop.rollFailed') + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      setRolling(false);
    }
  }, [snapshot.engine, snapshot.state, snapshot.activeInvPage, locale]);

  return (
    <div className="workshop-page">
      <h2>{t(locale, 'nav.workshop')}</h2>

      {error ? <div className="schedule-error" data-testid="workshop-error">{error}</div> : null}
      {toast ? <div className="schedule-toast" data-testid="workshop-toast">{toast}</div> : null}

      {rollResult ? (
        <div className="workshop-roll-result" data-testid="workshop-roll-result">
          <div className="workshop-roll-result-header">
            <span className="workshop-roll-result-title">{t(locale, 'workshop.rollResultTitle')}</span>
            <button
              type="button"
              className="workshop-roll-result-dismiss"
              data-testid="workshop-roll-result-dismiss"
              onClick={() => setRollResult(null)}
            >
              {t(locale, 'workshop.rollResultDismiss')}
            </button>
          </div>
          <BpDiagram
            shape={rollResult.shape}
            linkerOff={rollResult.linker.off}
            dirs={rollResult.linker.dirs}
            hpMax={rollResult.hpMax}
            cellCount={rollResult.cellCount}
            locale={locale}
          />
        </div>
      ) : null}

      <div className="workshop-gacha-card" data-testid="workshop-gacha-card">
        <div className="workshop-gacha-title">{t(locale, 'workshop.commonBpGacha')}</div>
        <div className="workshop-gacha-cost" data-testid="workshop-gacha-cost">
          {t(locale, 'workshop.cost', { cost: GACHA_COMMON_BP_COST_DISPLAY })}
        </div>
        <div className="workshop-gacha-balance" data-testid="workshop-gacha-balance">
          {t(locale, 'workshop.balance', { balance })}
        </div>
        <button
          type="button"
          className="workshop-roll-btn"
          disabled={!canAfford || rolling}
          onClick={() => void handleRoll()}
          data-testid="workshop-roll-btn"
        >
          {rolling ? t(locale, 'workshop.rolling') : t(locale, 'workshop.rollButton')}
        </button>
      </div>
    </div>
  );
}
