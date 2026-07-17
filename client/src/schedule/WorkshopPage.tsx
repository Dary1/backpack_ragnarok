// Workshop route (#/workshop) -- REQ-0042 behavior, REQ-0076 MJOLNIR
// re-skin, REWRITTEN by REQ-0215. Common BP gacha: costs
// GACHA_COMMON_BP_COST (10, single source shared/constants.json since
// REQ-0145b (cb)) LRDST (a stackable TM currency, see mock-src/engine.js's
// TM model). Follows the SAME "fetch on mount, loading/error states, t()"
// shape SchedulePage.tsx/DexRoot.tsx/Settings.tsx established.
//
// REQ-0215: THIS PAGE NO LONGER PLACES ANYTHING. The roll used to be a
// two-phase claim clone -- server mints a pending roll, this client deducts
// the LRDST via spendTM, first-fit-places the BP, pulses, auto-saves, and
// THAT PUT finalizes the roll. The user's spec sends the rolled Unit to the
// WAREHOUSE instead, so all of that is gone: the roll POST is one atomic
// server-side transaction (debit + warehouse delivery), and this page's job
// ends at showing the result modal. The player claims the Unit through the
// ordinary Warehouse UI, exactly like a dungeon reward or a market-bought
// Unit -- which is also why the local refund path is gone (a roll that
// cannot be delivered now 409s BEFORE anything is charged, so there is
// nothing to refund).
//
// The two obligations this page DOES own are the canvas-race ones the
// market's settle already documents (services/market.cjs's rule-5
// divergence writeup): flushAutoSave() BEFORE the roll so the server reads
// our real balance, and loadGame() AFTER it so our in-memory canvas learns
// about the server's debit. Skipping the reload would let a later auto-save
// resurrect the pre-roll canvas and hand the LRDST back.
//
// REQ-0076: markup re-skinned to web/redesign/workshop.html (Forge of
// Fates) -- casting panel + odds panel + result MODAL wearing the
// mjolnir.css panel/ornate/btn-forge/rune-divider primitives. The gacha
// MECHANIC and the two-phase finalize are UNCHANGED; only chrome moved.
// Currency naming follows REQ-0053 (Weathervane / rune) where the mock
// shows it -- the visible label drops the raw "LRDST" string in favor of
// the rune + the currency-item wording (same call the market port made,
// REQ-0064); the wire/engine id stays 'lrdst' everywhere.
//
// REQ-0145b (cb): the helpers this file used to define locally
// (pulseTab / firstFitPlaceBp, plus GRID_MIN/GRID_MAX/TAB_PULSE_MS and
// the gacha-cost display mirror) moved to src/lib/ and
// shared/constants.json -- verbatim moves, zero behavior change.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, rollWorkshopGacha, type ApiRolledBp } from '../api';
import type { ApiConnShape } from '../../../shared/dto';
import { unitArtUrl } from '../board/unitIcon';
import { dirsLabel, shapeLabel } from '../lib/connShapeLabel'; // REQ-0208: lifted from this file
import { BpDiagram } from '../dex/BpDiagram';
import { DismantlePanel } from './DismantlePanel';
import { t } from '../i18n';
import { flushAutoSave, loadGame, useGameStore, type Locale } from '../store';
import { GACHA_COMMON_BP_COST } from '../../../shared/constants.json';

interface WorkshopPageProps {
  locale: Locale;
}

// REQ-0170: the casting odds are no longer a mock's fixed figures (the old
// 40/35/25 rows were display-only, and were describing a 4-6 cell roll the server
// stopped doing long ago). rollPolyomino() picks its cell count UNIFORMLY from the
// pack's [min,max] range -- so the odds are knowable, exactly, from the pack def,
// and are computed from it here. A fabricated stat is replaced by the real one.
function castingOdds(pack: { cells?: [number, number]; hp_per_cell?: number } | undefined) {
  const [lo, hi] = pack?.cells ?? [6, 8];
  const hpPer = pack?.hp_per_cell ?? 15;
  const n = Math.max(1, hi - lo + 1);
  const rows: Array<{ cells: number; pct: number; hp: number }> = [];
  for (let c = lo; c <= hi; c++) rows.push({ cells: c, pct: Math.round((100 / n) * 10) / 10, hp: c * hpPer });
  return rows;
}

// REQ-0062: the bonus-slot odds, computed from the pack def exactly like castingOdds
// -- every table row's chance is its weight over the slot's total, so the odds view
// advertises the SAME numbers the server rolls with (no opaque loot box).
function bonusOdds(pack: { bonus?: Array<{ pool: 'po' | 'si' | 'tm'; table: Array<{ id: string; weight: number; qty?: number }> }> } | undefined) {
  const slots = pack?.bonus ?? [];
  return slots.map((slot, i) => {
    const total = slot.table.reduce((s, r) => s + Math.max(0, r.weight || 0), 0) || 1;
    return {
      idx: i,
      pool: slot.pool,
      rows: slot.table.map((r) => ({ id: r.id, qty: r.qty ?? 1, pct: Math.round((100 * Math.max(0, r.weight || 0) / total) * 10) / 10 })),
    };
  });
}

// REQ-0062: a pack's display name in the player's locale (ja i18n name when reading
// Japanese), falling back to the pack's English name then the id.
function packName(pack: { name?: string; i18n?: { ja?: { name?: string } } } | undefined, fallback: string, locale: Locale): string {
  if (!pack) return fallback;
  if (locale === 'ja' && pack.i18n?.ja?.name) return pack.i18n.ja.name;
  return pack.name ?? fallback;
}

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

/** Maps a unit offset [row,col] (shape-local, origin [0,0]) to the
 * mock's coord label convention (column letter + 1-based row number,
 * e.g. [1,1] -> "B2") -- the SAME A/B/1/2/3 axis labels the mock's
 * result figure draws and the SAME scheme ShapeGrid's showCoords uses.
 * Purely a readout of the real rolled unit.off; invents nothing. */
function unitCoordLabel(off: [number, number]): string {
  const col = String.fromCharCode(65 + Math.max(0, off[1])); // 0->A, 1->B, ...
  const row = Math.max(0, off[0]) + 1; // 0-based row -> 1-based label
  return col + row;
}

// REQ-0208: dirsLabel/shapeLabel (and their COMPASS_LABELS table) moved to
// lib/connShapeLabel.ts VERBATIM -- the Dex unit catalog now labels
// connections too, so the formatter lives in one shared module instead of
// growing a drift-prone copy.

/** The unit's display name in the player's locale -- i18n.ja.name when reading
 * Japanese, the def's `name` otherwise. Same localized() convention the item panel
 * already uses. */
function unitName(def: ApiRolledBp['unitDef'] | undefined, locale: Locale): string {
  if (!def) return '—';
  if (locale === 'ja' && def.i18n?.ja?.name) return def.i18n.ja.name;
  return def.name;
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
  // REQ-0063: opens the real Dismantle modal (replaces the old REQ-0076
  // "opening soon" shell for this one tile only -- Transmute stays a shell).
  const [dismantleOpen, setDismantleOpen] = useState(false);
  // REQ-0062: the themed pack the player has chosen to open. Defaults to the Common
  // pack (the unchanged REQ-0042 default); every served catalog pack is selectable and
  // the chosen pack drives cost, pool, odds, bonuses and the roll.
  const [selectedPackId, setSelectedPackId] = useState<string>('common_bp');

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const balance = readTotalLrdstBalance(snapshot.state);
  // REQ-0170: cost/pool/odds all come from the PACK the server rolls against, with
  // the shared constant as the fallback for a client that booted before content
  // arrived. A display constant that can drift from the roll is exactly the bug
  // the old odds panel had.
  const packs = snapshot.gameData?.PACKS ?? {};
  const packIds = Object.keys(packs);
  const effectivePackId = packs[selectedPackId] ? selectedPackId : (packIds[0] ?? 'common_bp');
  const pack = packs[effectivePackId];
  const units = snapshot.gameData?.UNITS ?? {};
  // REQ-0062: PO/SI defs (for naming bonus items in the odds view; the result modal
  // uses the server's own def echo instead).
  const itemDefs = (snapshot.gameData?.ITEMS ?? {}) as Record<string, { name?: string; i18n?: { ja?: { name?: string } } }>;
  const siDefsMap = (snapshot.gameData?.SI_DEFS ?? {}) as Record<string, { name?: string; i18n?: { ja?: { name?: string } } }>;
  const connShapes = (snapshot.gameData?.CONN_SHAPES ?? {}) as Record<string, ApiConnShape>;
  const cost = pack?.cost ?? GACHA_COMMON_BP_COST;
  const odds = castingOdds(pack);
  const bonusRows = bonusOdds(pack); // REQ-0062: transparent bonus-table odds
  const bonusPoolLabel = (poolKind: 'po' | 'si' | 'tm'): string =>
    poolKind === 'po' ? t(locale, 'workshop.bonusPoolPo') : poolKind === 'si' ? t(locale, 'workshop.bonusPoolSi') : t(locale, 'workshop.bonusPoolTm');
  const bonusItemName = (poolKind: 'po' | 'si' | 'tm', id: string): string => {
    const def = poolKind === 'po' ? itemDefs[id] : poolKind === 'si' ? siDefsMap[id] : undefined;
    if (def) return (locale === 'ja' && def.i18n?.ja?.name) ? def.i18n.ja.name : (def.name ?? id);
    return id;
  };
  const canAfford = balance >= cost;
  const rolledShapeKey = rollResult?.unitDef?.connection_shape;
  const rolledShape = rolledShapeKey ? connShapes[rolledShapeKey] : undefined;

  const handleRoll = useCallback(async () => {
    setRolling(true);
    setError(null);
    setRollResult(null);
    try {
      // The server reads our LRDST balance off the LAST-SAVED canvas and debits
      // it there. Flush first, or it validates and charges against a stale
      // balance (design rule 5 makes the saved canvas the only one it can see).
      await flushAutoSave();

      // ONE atomic server-side transaction (REQ-0215): validates balance +
      // warehouse capacity, rolls the Unit, debits the cost, and delivers the
      // Unit (plus any pack bonuses) to our WAREHOUSE as claimable rows. Nothing
      // is charged if anything refuses -- there is no half-settled roll and no
      // pending state to abandon.
      const res = await rollWorkshopGacha(effectivePackId);

      // The server just wrote our canvas (the debit). Re-read it before the next
      // auto-save can fire, or an in-flight PUT of our pre-roll copy resurrects
      // the spent LRDST -- the exact stale-canvas race REQ-0041 documented and
      // the market's buyListing still carries. Unlike a market settle we ARE the
      // initiating client, so this window is ours to close, and we close it.
      await loadGame();

      // REQ-0045 (h): reveal what was rolled. This is now a RECEIPT of what was
      // delivered to the warehouse, not something this page has to place.
      setRollResult(res.rolled);
      setToast(t(locale, 'workshop.rolledToWarehouse'));
    } catch (e) {
      if (e instanceof ApiError && e.reason === 'warehouse_full') {
        setError(t(locale, 'workshop.warehouseFull'));
      } else if (e instanceof ApiError && e.status === 409) {
        setError(t(locale, 'workshop.insufficientFunds'));
      } else {
        setError(t(locale, 'workshop.rollFailed') + (e instanceof Error ? e.message : String(e)));
      }
    } finally {
      setRolling(false);
    }
  }, [snapshot.engine, snapshot.state, snapshot.activeInvPage, locale, effectivePackId]);

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

      {/* ===== REQ-0062: themed pack selector -- choose which pack to open ===== */}
      {packIds.length > 0 ? (
        <section className="workshop-pack-select" data-testid="workshop-pack-select">
          <div className="workshop-colhead">
            <span className="workshop-colhead-rune rune">{'\u16DC'}</span>
            <h3 className="workshop-colhead-title dj">{t(locale, 'workshop.packSelectHeading')}</h3>
            <span className="workshop-colhead-den den">{t(locale, 'workshop.packSelectDen')}</span>
            <span className="workshop-colhead-grow" />
            <span className="workshop-colhead-note t-micro">{t(locale, 'workshop.packSelectNote')}</span>
          </div>
          <div className="workshop-pack-options">
            {packIds.map((pid) => {
              const p = packs[pid];
              const active = pid === effectivePackId;
              return (
                <button
                  key={pid}
                  type="button"
                  className={'btn workshop-pack-option' + (active ? ' is-active' : '')}
                  aria-pressed={active}
                  data-testid={'workshop-pack-option-' + pid}
                  data-active={active ? '1' : '0'}
                  onClick={() => { setSelectedPackId(pid); setRollResult(null); setError(null); }}
                >
                  <span className="workshop-pack-option-name dj">{packName(p, pid, locale)}</span>
                  <span className="workshop-pack-option-cost t-micro"><span className="rune">{'\u16A0'}</span> {t(locale, 'workshop.cost', { cost: p?.cost ?? cost })}</span>
                  {(p?.bonus?.length ?? 0) > 0 ? <span className="workshop-pack-option-syn chip">{t(locale, 'workshop.synergyChip')}</span> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

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
            <div className="workshop-cast-title dj" data-testid="workshop-cast-title">{packName(pack, t(locale, 'workshop.commonBpGacha'), locale)}</div>
            <div className="workshop-cast-sub t-micro">{t(locale, 'workshop.castSub')}</div>
            <div className="workshop-cast-cost">
              <span className="workshop-cast-cost-rune rune">{'ᚠ'}</span>
              <span className="workshop-cast-cost-val" data-testid="workshop-gacha-cost">
                {t(locale, 'workshop.cost', { cost })}
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
            {odds.map((o) => (
              <div className="workshop-orow" key={o.cells}>
                <span className="workshop-orow-lab">
                  <b>{t(locale, 'workshop.oddsCells', { n: o.cells })}</b>
                  <span className="t-micro">{t(locale, 'workshop.oddsHp', { hp: o.hp })}</span>
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
            <li>{t(locale, 'workshop.ruleUnit')}</li>
            <li>{t(locale, 'workshop.ruleTwoPhase')}</li>
          </ul>
          {/* REQ-0062: transparent bonus-slot odds -- every table with its weights. */}
          <div className="rune-divider">{'\u16DC'}</div>
          <div className="workshop-odds-head">
            <span className="workshop-odds-title dj">{t(locale, 'workshop.bonusHeading')}</span>
            <span className="workshop-odds-den den">{t(locale, 'workshop.bonusHeadingDen')}</span>
            <span className="workshop-odds-grow" />
            <span className="t-micro">{t(locale, 'workshop.bonusNote')}</span>
          </div>
          {bonusRows.length === 0 ? (
            <div className="workshop-bonus-none t-micro" data-testid="workshop-bonus-none">{t(locale, 'workshop.bonusNone')}</div>
          ) : (
            <div className="workshop-bonus-slots" data-testid="workshop-bonus-odds">
              {bonusRows.map((slot) => (
                <div className="workshop-bonus-slot" key={slot.idx} data-pool={slot.pool}>
                  <div className="workshop-bonus-slot-head t-micro">{t(locale, 'workshop.bonusSlotLabel', { n: slot.idx + 1, pool: bonusPoolLabel(slot.pool) })}</div>
                  {slot.rows.map((r) => (
                    <div className="workshop-orow" key={r.id} data-testid="workshop-bonus-row" data-bonus-id={r.id}>
                      <span className="workshop-orow-lab">
                        <b>{bonusItemName(slot.pool, r.id)}</b>
                        {r.qty > 1 ? <span className="t-micro">{' \u00d7' + r.qty}</span> : null}
                      </span>
                      <span className="bar workshop-orow-bar">
                        <span className="fill gold" style={{ display: 'block', height: '100%', width: r.pct + '%' }} />
                      </span>
                      <span className="workshop-orow-pct tnum">{r.pct}%</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===== roster panel (REQ-0170): WHO this pack can cast. Read straight off
           the pack's pool + the unit defs -- the same table the server rolls
           against, so it can never advertise a unit that cannot drop. ===== */}
      {pack && pack.pool?.length ? (
        <section className="workshop-forge-grid workshop-pool-grid">
          <div className="panel ornate workshop-pool" data-testid="workshop-pool">
            <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
            <div className="workshop-odds-head">
              <span className="workshop-odds-title dj">{t(locale, 'workshop.poolHeading')}</span>
              <span className="workshop-odds-den den">{t(locale, 'workshop.poolHeadingDen')}</span>
              <span className="workshop-odds-grow" />
              <span className="t-micro">{t(locale, 'workshop.poolNote')}</span>
            </div>
            <div className="workshop-pool-rows">
              {pack.pool.map((row) => {
                const def = units[row.unit];
                if (!def) return null; // a pool entry with no live def cannot drop -- do not advertise it
                const shp = connShapes[def.connection_shape];
                const nm = locale === 'ja' && def.i18n?.ja?.name ? def.i18n.ja.name : def.name;
                return (
                  <div className="workshop-pool-cell" key={row.unit} data-testid="workshop-pool-unit" data-unit={row.unit}>
                    <img className="workshop-pool-art" src={unitArtUrl(def.icon)} alt="" width={44} height={44} loading="lazy" />
                    <span className="workshop-pool-name">{nm}</span>
                    <span className="workshop-pool-shape t-micro">{shapeLabel(def.connection_shape, shp, locale)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

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
          </div>
          <div className="workshop-subp-copy dj">{t(locale, 'workshop.dismantleCopy')}</div>
          <div className="workshop-subp-note t-micro">{t(locale, 'workshop.dismantleSub')}</div>
          <button
            type="button"
            className="btn btn-forge workshop-subp-btn"
            data-testid="workshop-dismantle-open-btn"
            onClick={() => setDismantleOpen(true)}
          >
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
                  unitOff={rollResult.unit.off}
                  /* REQ-0170: the arrows are the Unit's connection shape, resolved from
                     the served vocab table. An offset shape draws none -- see dirsLabel. */
                  dirs={rolledShape && rolledShape.kind === 'ray' ? (rolledShape.dirs ?? []) : []}
                  hpMax={rollResult.hpMax}
                  cellCount={rollResult.cellCount}
                  locale={locale}
                />
              </div>
              {/* stats -- all read straight off the rolled Unit + BP; invents nothing */}
              <div className="workshop-result-stats">
                {rollResult.unitDef ? (
                  <div className="workshop-result-stat workshop-result-unit" data-testid="workshop-result-unit" data-unit={rollResult.unitDef.id}>
                    <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statUnitName')}</span>
                    <img className="workshop-result-unit-art" src={unitArtUrl(rollResult.unitDef.icon)} alt="" width={56} height={56} />
                    <b className="workshop-result-unit-name dj">{unitName(rollResult.unitDef, locale)}</b>
                  </div>
                ) : null}
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statRarity')}</span>
                  <span className="rar-word" style={{ color: 'var(--r-common)' }}>
                    {(rollResult.unitDef?.rarity ?? 'Common').toUpperCase()}
                  </span>
                </div>
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statShape')}</span>
                  <b data-testid="workshop-result-shape">{shapeLabel(rolledShapeKey, rolledShape, locale)}</b>
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
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statUnit')}</span>
                  <b className="tnum">{unitCoordLabel(rollResult.unit.off)}</b>
                  <span className="rune" style={{ color: 'var(--gold-hi)' }}>{'ᛖ'}</span>
                </div>
                <div className="workshop-result-stat">
                  <span className="workshop-result-stat-lbl">{t(locale, 'workshop.statDirs')}</span>
                  <b>{dirsLabel(rolledShape)}</b>
                </div>
                <div className="rune-divider workshop-result-flavor-divider">{'ᛖ'}</div>
                <div className="workshop-result-flavor dj">{t(locale, 'workshop.rollResultFlavor')}</div>
              </div>
              {(rollResult.bonuses?.length ?? 0) > 0 ? (
                <div className="workshop-result-bonuses" data-testid="workshop-result-bonuses">
                  <div className="workshop-result-bonuses-head den">{t(locale, 'workshop.resultBonusHeading')}</div>
                  <div className="workshop-result-bonuses-list">
                    {(rollResult.bonuses ?? []).map((b) => (
                      <div className="workshop-result-bonus" key={b.uid} data-testid="workshop-result-bonus" data-bonus-id={b.id} data-pool={b.pool}>
                        <b className="workshop-result-bonus-name">{b.def && locale === 'ja' && b.def.i18n?.ja?.name ? b.def.i18n.ja.name : (b.def?.name ?? b.id)}</b>
                        {b.qty > 1 ? <span className="t-micro tnum">{' \u00d7' + b.qty}</span> : null}
                        <span className="t-micro workshop-result-bonus-pool">{b.pool === 'po' ? t(locale, 'workshop.bonusPoolPo') : b.pool === 'si' ? t(locale, 'workshop.bonusPoolSi') : t(locale, 'workshop.bonusPoolTm')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="workshop-result-act">
              <button
                type="button"
                className="btn btn-forge workshop-result-again"
                disabled={!canAfford || rolling}
                onClick={() => void handleRoll()}
              >
                <span className="rune">{'ᚠ'}</span> {t(locale, 'workshop.rollAgain', { cost })}
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

      {dismantleOpen ? <DismantlePanel locale={locale} onClose={() => setDismantleOpen(false)} /> : null}
    </div>
  );
}
