// Workshop route (#/workshop) -- REQ-0042 behavior, REQ-0076 MJOLNIR
// re-skin. Common BP gacha: costs GACHA_COMMON_BP_COST_DISPLAY (10)
// LRDST (a stackable TM currency, see mock-src/engine.js's TM model).
// Follows the SAME "fetch on mount, loading/error states, t()" shape
// SchedulePage.tsx/DexRoot.tsx/Settings.tsx already established for a
// route-level component, and reuses WarehouseTab.tsx's EXACT two-phase
// claim/first-fit/pulse pattern for the roll flow (server mints a
// pending roll -> THIS client deducts the cost + first-fit-places the
// rolled BP + pulses + auto-saves -> the resulting profile PUT is what
// finalizes the roll server-side, see server/services/runs.cjs +
// server/services/gacha.cjs's finalize path).
//
// REQ-0076: markup re-skinned to web/redesign/workshop.html (Forge of
// Fates) -- casting panel + odds panel + result MODAL wearing the
// mjolnir.css panel/ornate/btn-forge/rune-divider primitives. The gacha
// MECHANIC and the two-phase finalize are UNCHANGED; only chrome moved.
// Currency naming follows REQ-0053 (Weathervane / rune) where the mock
// shows it -- the visible label drops the raw "LRDST" string in favor of
// the rune + the currency-item wording (same call the market port made,
// REQ-0064); the wire/engine id stays 'lrdst' everywhere.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, rollWorkshopGacha, type ApiRolledBp } from '../api';
import { getInventoryRenderer } from '../board/inventoryRenderer';
import { BpDiagram } from '../dex/BpDiagram';
import { t } from '../i18n';
import { notifyStateChanged, useGameStore, type Locale } from '../store';

interface WorkshopPageProps {
  locale: Locale;
}

const GACHA_COMMON_BP_COST_DISPLAY = 10; // mirrors server/services/gacha.cjs's GACHA_COMMON_BP_COST (display only)
const GRID_MIN = 1;
const GRID_MAX = 8; // matches every inventory page's fixed 8x8 layout, same bound WarehouseTab.tsx's firstFitPlace uses
const TAB_PULSE_MS = 1600; // same constant WarehouseTab.tsx uses for its cross-page tab-pulse notification

// REQ-0076: casting-odds display (mock's rules panel). These weights are
// DISPLAY-ONLY -- the server's roll (server/services/gacha.cjs
// rollCommonBp) is a random-walk polyomino of 4-6 cells and does NOT
// publish per-cell-count probabilities, so no live number backs this.
// The mock's own three rows (40/35/25) are reproduced verbatim as the
// designed presentation of "smaller packs are more common"; documented
// as an inference in the notes doc (UI is truth; no fabricated live
// stat, the mock's fixed figures ARE the spec here). HP column = cells
// x 15, which IS the real formula (hpMax = 15 * cellCount, server-side).
const CASTING_ODDS: ReadonlyArray<{ cells: number; pct: number }> = [
  { cells: 4, pct: 40 },
  { cells: 5, pct: 35 },
  { cells: 6, pct: 25 },
];

const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

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

/** Maps a linker offset [row,col] (shape-local, origin [0,0]) to the
 * mock's coord label convention (column letter + 1-based row number,
 * e.g. [1,1] -> "B2") -- the SAME A/B/1/2/3 axis labels the mock's
 * result figure draws and the SAME scheme ShapeGrid's showCoords uses.
 * Purely a readout of the real rolled linker.off; invents nothing. */
function linkerCoordLabel(off: [number, number]): string {
  const col = String.fromCharCode(65 + Math.max(0, off[1])); // 0->A, 1->B, ...
  const row = Math.max(0, off[0]) + 1; // 0-based row -> 1-based label
  return col + row;
}

/** Turns the rolled linker.dirs (0=N..7=NW, the project compass) into a
 * human-facing string -- reads the real dirs; no fabrication. */
function dirsLabel(dirs: number[]): string {
  if (!dirs.length) return '—';
  return dirs.map((d) => COMPASS_LABELS[d] ?? '?').join(' ・ ');
}

/** Briefly applies the tab-claim-pulse CSS class to the inv-tab button
 * at `pageIndex` -- byte-for-byte copy of WarehouseTab.tsx's own
 * pulseTab() helper (same DOM-query-based approach, not worth sharing
 * via an import for one small helper reused across two route-level
 * components with otherwise independent lifecycles). */
function pulseTab(pageIndex: number): void {
  const el = document.querySelector<HTMLElement>('[data-tab-kind="inv"][data-tab-index="' + pageIndex + '"]');
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
        // the timeout (see the gacha finalize/purge path). The LRDST was
        // already deducted above, though -- to avoid silently losing
        // currency for a roll that can never be placed, refund it locally
        // before surfacing the error (no server round trip needed -- the
        // pending roll was never finalized, so the server-side balance
        // was never touched either).
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
      // balance dropped, see the gacha finalize path).
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
      {/* ===== hero strip (mock .pagehead + divider) ===== */}
      <section className="workshop-pagehead">
        <div className="workshop-pagehead-text">
          <div className="workshop-pagehead-kicker den">{t(locale, 'workshop.pageKicker')}</div>
          <h2 className="workshop-pagehead-title dj dj-wide">{t(locale, 'nav.workshop')}</h2>
          <div className="workshop-pagehead-lede">{t(locale, 'workshop.pageLede')}</div>
        </div>
      </section>
      <div className="rune-divider workshop-headline">{'ᛈ'}</div>

      {error ? <div className="schedule-error" data-testid="workshop-error">{error}</div> : null}
      {toast ? <div className="schedule-toast workshop-toast" data-testid="workshop-toast">{toast}</div> : null}

      {/* ===== casting colhead ===== */}
      <div className="workshop-colhead">
        <span className="workshop-colhead-rune rune">{'ᛈ'}</span>
        <h3 className="workshop-colhead-title dj">{t(locale, 'workshop.castHeading')}</h3>
        <span className="workshop-colhead-den den">{t(locale, 'workshop.castHeadingDen')}</span>
        <span className="workshop-colhead-grow" />
        <span className="workshop-colhead-note t-micro">{t(locale, 'workshop.castHeadingNote')}</span>
      </div>

      {/* ===== casting grid: cast panel | odds panel ===== */}
      <section className="workshop-forge-grid">
        {/* LEFT: cast panel */}
        <div className="panel ornate workshop-cast" data-testid="workshop-gacha-card">
          <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
          <div className="workshop-cast-art">
            <span className="workshop-cast-art-glyph seal">{'鋳'}</span>
          </div>
          <div className="workshop-cast-body">
            <div className="workshop-cast-title dj">{t(locale, 'workshop.commonBpGacha')}</div>
            <div className="workshop-cast-sub t-micro">{t(locale, 'workshop.castSub')}</div>
            <div className="workshop-cast-cost">
              <span className="workshop-cast-cost-rune rune">{'ᚠ'}</span>
              <span className="workshop-cast-cost-val" data-testid="workshop-gacha-cost">
                {t(locale, 'workshop.cost', { cost: GACHA_COMMON_BP_COST_DISPLAY })}
              </span>
              <span className="workshop-cast-cost-grow" />
              <span className="workshop-cast-own">
                {t(locale, 'workshop.ownedLabel')}{' '}
                <b className="tnum" data-testid="workshop-gacha-balance">{balance}</b>
              </span>
            </div>
            <button
              type="button"
              className="btn btn-forge workshop-roll-btn"
              disabled={!canAfford || rolling}
              onClick={() => void handleRoll()}
              data-testid="workshop-roll-btn"
            >
              <span className="rune">{'ᛈ'}</span> {rolling ? t(locale, 'workshop.rolling') : t(locale, 'workshop.rollButton')}
            </button>
            <div className="workshop-cast-foot t-micro">{t(locale, 'workshop.castNoteUnique')}</div>
            <div className="workshop-cast-foot t-micro">{t(locale, 'workshop.castNoteSupply')}</div>
          </div>
        </div>

        {/* RIGHT: odds panel */}
        <div className="panel ornate workshop-odds">
          <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
          <div className="workshop-odds-head">
            <span className="workshop-odds-title dj">{t(locale, 'workshop.oddsHeading')}</span>
            <span className="workshop-odds-den den">{t(locale, 'workshop.oddsHeadingDen')}</span>
            <span className="workshop-odds-grow" />
            <span className="t-micro">{t(locale, 'workshop.oddsHpNote')}</span>
          </div>
          <div className="workshop-odds-rows">
            {CASTING_ODDS.map((o) => (
              <div className="workshop-orow" key={o.cells}>
                <span className="workshop-orow-lab">
                  <b>{t(locale, 'workshop.oddsCells', { n: o.cells })}</b>
                  <span className="t-micro">{t(locale, 'workshop.oddsHp', { hp: o.cells * 15 })}</span>
                </span>
                <span className="bar workshop-orow-bar">
                  <span className="fill gold" style={{ display: 'block', height: '100%', width: o.pct + '%' }} />
                </span>
                <span className="workshop-orow-pct tnum">{o.pct}%</span>
              </div>
            ))}
          </div>
          <div className="rune-divider">{'ᛞ'}</div>
          <ul className="workshop-rules">
            <li>{t(locale, 'workshop.ruleCommon')}</li>
            <li>{t(locale, 'workshop.ruleLinker')}</li>
            <li>{t(locale, 'workshop.ruleTwoPhase')}</li>
          </ul>
        </div>
      </section>

      {/* ===== transmute / dismantle sub-row (mock-only; honest coming-soon shells) ===== */}
      <section className="workshop-sub-grid">
        <div className="panel ornate workshop-subp">
          <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
          <div className="workshop-subp-title">
            <span className="workshop-subp-rune rune">{'ᛈ'}</span>
            {t(locale, 'workshop.transmuteTitle')}
            <span className="workshop-subp-den den">{t(locale, 'workshop.transmuteDen')}</span>
            <span className="workshop-subp-grow" />
            <span className="chip">{t(locale, 'workshop.soonChip')}</span>
          </div>
          <div className="workshop-subp-copy dj">{t(locale, 'workshop.transmuteCopy')}</div>
          <div className="workshop-subp-note t-micro">{t(locale, 'workshop.transmuteSub')}</div>
          <button type="button" className="btn is-disabled workshop-subp-btn" disabled>
            <span className="rune">{'ᛈ'}</span> {t(locale, 'workshop.transmuteCta')}
          </button>
        </div>

        <div className="panel ornate workshop-subp">
          <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
          <div className="workshop-subp-title">
            <span className="workshop-subp-rune rune">{'ᚠ'}</span>
            {t(locale, 'workshop.dismantleTitle')}
            <span className="workshop-subp-den den">{t(locale, 'workshop.dismantleDen')}</span>
            <span className="workshop-subp-grow" />
            <span className="chip">{t(locale, 'workshop.soonChip')}</span>
          </div>
          <div className="workshop-subp-copy dj">{t(locale, 'workshop.dismantleCopy')}</div>
          <div className="workshop-subp-note t-micro">{t(locale, 'workshop.dismantleSub')}</div>
          <button type="button" className="btn is-disabled workshop-subp-btn" disabled>
            <span className="rune">{'ᚠ'}</span> {t(locale, 'workshop.dismantleCta')}
          </button>
        </div>
      </section>

      {/* ===== casting result modal ===== */}
      {rollResult ? (
        <div
          className="scrim workshop-result-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRollResult(null);
          }}
        >
          <div className="modal panel ornate workshop-result" data-testid="workshop-roll-result">
            <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
            <div className="workshop-result-head">
              <span className="workshop-result-head-title dj">{t(locale, 'workshop.rollResultTitle')}</span>
              <span className="workshop-result-head-den den">{t(locale, 'workshop.rollResultDen')}</span>
              <span className="workshop-result-head-grow" />
              <span className="workshop-result-mint t-micro tnum">{t(locale, 'workshop.rollResultMint')} {rollResult.uid}</span>
            </div>
            <div className="workshop-result-body">
              {/* BP diagram -- delegates to BpDiagram/ShapeGrid (render/itemCard
                  composition), functionally intact; chrome-only re-skin. */}
              <div className="workshop-result-fig">
                <BpDiagram
                  shape={rollResult.shape}
                  linkerOff={rollResult.linker.off}
                  dirs={rollResult.linker.dirs}
                  hpMax={rollResult.hpMax}
                  cellCount={rollResult.cellCount}
                  locale={locale}
                />
              </div>
              {/* stats -- all read straight off the rolled BP; invents nothing */}
              <div className="workshop-result-stats">
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statRarity')}</span>
                  <span className="rar-word" style={{ color: 'var(--r-common)' }}>COMMON</span>
                </div>
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statCells')}</span>
                  <b className="tnum">{rollResult.cellCount}</b>
                </div>
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statHp')}</span>
                  <b className="tnum">HP {rollResult.hpMax}</b>
                  <span className="t-micro">{'= ' + rollResult.cellCount + ' × 15'}</span>
                </div>
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statLinker')}</span>
                  <b className="tnum">{linkerCoordLabel(rollResult.linker.off)}</b>
                  <span className="rune" style={{ color: 'var(--gold-hi)' }}>{'ᛖ'}</span>
                </div>
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statDirs')}</span>
                  <b>{dirsLabel(rollResult.linker.dirs)}</b>
                </div>
                <div className="rune-divider workshop-result-flavor-divider">{'ᛖ'}</div>
                <div className="workshop-result-flavor dj">{t(locale, 'workshop.rollResultFlavor')}</div>
              </div>
            </div>
            <div className="workshop-result-act">
              <button
                type="button"
                className="btn btn-forge workshop-result-again"
                disabled={!canAfford || rolling}
                onClick={() => void handleRoll()}
              >
                <span className="rune">{'ᚠ'}</span> {t(locale, 'workshop.rollAgain', { cost: GACHA_COMMON_BP_COST_DISPLAY })}
              </button>
              <button
                type="button"
                className="btn btn-ghost workshop-roll-result-dismiss"
                data-testid="workshop-roll-result-dismiss"
                onClick={() => setRollResult(null)}
              >
                {t(locale, 'workshop.rollResultDismiss')}
              </button>
            </div>
            <div className="workshop-result-note t-micro">{t(locale, 'workshop.rollResultNote')}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
