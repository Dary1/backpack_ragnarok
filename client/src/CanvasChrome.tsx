// Canvas-page chrome bits — REQ-0070 (MJOLNIR canvas re-skin; mock:
// web/redesign/canvas.html). Small presentational components composed by
// App.tsx around the ALWAYS-MOUNTED PixiJS boards. None of these touch
// the boards, the drag layer, or any engine mutation path — they are
// strictly additive DOM chrome fed by the same store snapshot App.tsx
// already subscribes to (or by props passed straight from it).
//
//  - BoardCoords: the mock gridbox's coordinate rails (A.. column
//    letters / 1.. row numbers), absolutely positioned over the canvas
//    board's own PAD margin (the Pixi canvas already reserves PAD=38px
//    around the CELL=80px grid — board/geom.ts; those two constants are
//    mirrored by index.css's .board-coords rules, which carry the
//    actual 38/80px offsets). The whole layer is pointer-events:none
//    (CSS) so board drags/dblclicks pass through untouched. Rendered
//    for the CANVAS board only, exactly like the mock (the mock's
//    inventory panel is a list, not a coordinate board).
//  - CanvasStatsChip: the mock stagehead's「背嚢 3 ・ 物品 9 ・ 連結 3」
//    chip, computed from REAL state (BPs / grid POs / established
//    connections via engine.allConnections — the same query the board's
//    ◆ port marks derive from) instead of the mock's static copy, per
//    the REQ-0070 rule "UI is truth; implement by inference from
//    existing engine data when cheap and honest".
//  - SaveSeal: the mock boardfoot's「保存済み」dot+label, bound to the
//    SAME store.autoSaveStatus the header indicator shows. Deliberately
//    does NOT reuse the header's .auto-save-status class (the E2E suite
//    locates that class and expects exactly one match); the machine-
//    readable state rides on data-save-state instead. The mock's
//    「・3秒前」relative timestamp is omitted: the store keeps no
//    last-saved-at instant, and inventing one is the kind of fiction
//    REQ-0070 forbids.
//  - EmbarkDock: the mock's fixed bottom-right「遠征へ発つ」forge CTA —
//    an honest navigation to the real expedition page (#/schedule). The
//    mock's readiness-hint copy (独立性検査 合格 / dungeon name + ETA)
//    has no backing data client-side and is omitted.
import { t } from './i18n';
import { buildPower } from './lib/buildPower';
import type { Locale } from './store';
import { setRoute, undo, useGameStore } from './store';

/** Column letters/row numbers around the canvas grid (mock: .coord). */
export function BoardCoords() {
  const snapshot = useGameStore();
  if (snapshot.status !== 'ready' || !snapshot.gameData) return null;
  const { ROWS, COLS } = snapshot.gameData.LAYOUT;
  return (
    <div className="board-coords" aria-hidden="true">
      <div className="board-coords-cols">
        {Array.from({ length: COLS }, (_, i) => (
          <span key={i}>{String.fromCharCode(65 + i)}</span>
        ))}
      </div>
      <div className="board-coords-rows">
        {Array.from({ length: ROWS }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
    </div>
  );
}

/** Live board-content counts for the canvas stagehead (mock chip). */
export function CanvasStatsChip() {
  const snapshot = useGameStore();
  const { state, engine, gameData, locale } = snapshot;
  if (snapshot.status !== 'ready' || !state || !engine) return null;
  const bpCount = state.bps.length;
  const itemCount = state.pos.filter((p) => p.loc === 'grid').length;
  let linkCount = 0;
  try {
    linkCount = engine.allConnections(state).length;
  } catch {
    linkCount = 0; // defensive: a stats chip must never take the page down
  }
  // REQ-0371: total HP + the REFERENCE power aggregate, computed from the
  // SAME store snapshot the counts read (engine state + gameData defs).
  // Display-only, no engine call -- the recorded formula lives in
  // lib/buildPower.ts; the tooltip carries the forecastTip-style honesty
  // label (reference, not prediction).
  const { hp, power } = buildPower(state, gameData?.ITEMS, gameData?.SI_DEFS);
  return (
    <span className="chip stagehead-chip">
      {t(locale, 'canvas.statBp')} {bpCount} ・ {t(locale, 'canvas.statItems')} {itemCount} ・{' '}
      <span className="kw-link">
        {t(locale, 'canvas.statLinks')} {linkCount}
      </span>
      {' ・ '}
      <span data-testid="canvas-stat-hp">
        {t(locale, 'canvas.statHp')} {hp}
      </span>
      {' ・ '}
      <span data-testid="canvas-stat-power" title={t(locale, 'canvas.statPowerTip')}>
        {t(locale, 'canvas.statPower')} {power}
      </span>
    </span>
  );
}

interface SaveSealProps {
  locale: Locale;
  status: 'saved' | 'saving' | 'offline';
}

const SAVE_KEY: Record<SaveSealProps['status'], 'canvas.saveState.saved' | 'canvas.saveState.saving' | 'canvas.saveState.offline'> = {
  saved: 'canvas.saveState.saved',
  saving: 'canvas.saveState.saving',
  offline: 'canvas.saveState.offline',
};

/** Boardfoot auto-save seal (mock: .saved). Same store field as the
 * header's .auto-save-status, different class on purpose (see module
 * comment). */
export function SaveSeal({ locale, status }: SaveSealProps) {
  return (
    <span className="boardfoot-saved" data-save-state={status}>
      <span className="boardfoot-saved-dot" aria-hidden="true" />
      {t(locale, SAVE_KEY[status])}
    </span>
  );
}

/** REQ-0367: the boardfoot's single-step undo button, right beside the
 * SaveSeal. Same action as Ctrl+Z (store/undo.ts's undo()); disabled while
 * the one snapshot slot is empty (store field `undoAvailable`). Tooltip is
 * i18n'd via the title/aria-label pair. */
export function UndoButton({ locale }: { locale: Locale }) {
  const snapshot = useGameStore();
  return (
    <button
      type="button"
      className="boardfoot-undo"
      data-testid="canvas-undo-btn"
      disabled={!snapshot.undoAvailable}
      title={t(locale, 'canvas.undo')}
      aria-label={t(locale, 'canvas.undo')}
      onClick={() => undo()}
    >
      {'↩'}
    </button>
  );
}

/** Fixed bottom-right expedition CTA (mock: .dock). Pure navigation. */
export function EmbarkDock({ locale }: { locale: Locale }) {
  return (
    <div className="embark-dock">
      <button type="button" className="btn btn-forge embark-btn" onClick={() => setRoute('schedule')}>
        <span className="rune" aria-hidden="true">
          ᚱ
        </span>{' '}
        {t(locale, 'canvas.embark')}
      </button>
    </div>
  );
}
