// client/src/forecast/ForecastOverlay.tsx -- REQ-0057 Ray Forecast Overlay:
// the heat tint + per-cell tooltip drawn ON the canvas board.
//
// Implemented as a DOM layer, NOT a new Pixi layer, for the same reason
// CanvasChrome's BoardCoords is: the board's PAD=38 / CELL=80 geometry is
// already mirrored in index.css, the layer is purely presentational, and
// staying out of BoardRenderer means the overlay cannot possibly perturb
// drag/drop, ghosting, link beams or the render loop. Zero risk to the
// editor; a `display:none` away from not existing.
//
// POINTER DISCIPLINE. The whole layer is pointer-events:none, so every
// board gesture (drag a PO, double-click-rotate, long-press) passes straight
// through it untouched even while the overlay is on -- you can keep BUILDING
// while you read the weather, which is the entire premise of REQ-0057 ("so
// 'where should the tanky BP go' is visible WHILE building"). The per-cell
// tooltip therefore cannot use :hover; it is driven by a window-level
// pointermove hit-test against this layer's own bounding rect. A tooltip you
// can't touch is a small price for a board you can still use.
//
// HONESTY. The tint is normalised over the board's own [min, max] (see
// pressure.ts's heatColor for why), and the legend beneath the board always
// prints the true dmg/s at both ends. The panel is labelled "expected
// pressure" and never "safe"/"unsafe" -- REQ-0057: "Not a promise: forecast
// shows the DISTRIBUTION (jitter, packs vary)".
import { useEffect, useRef, useState } from 'react';
import { cellKey } from '../../../shared/forecast.mjs';
import { canvasToField } from '../../../shared/forecast.mjs';
import { t } from '../i18n';
import { useGameStore } from '../store';
import { useForecast } from './forecastState';
import { computePressure, heatColor, heatT, type ForecastCell } from './pressure';

// Mirrors board/geom.ts (and index.css's .board-coords rules, which already
// hard-code the same two numbers for exactly this reason).
const PAD = 38;
const CELL = 80;
const GRID = 8;

interface Hover {
  row0: number;
  col0: number;
  cell: ForecastCell;
}

function localizedName(locale: string, i18n: { en?: { name?: string }; ja?: { name?: string } } | undefined, fallback: string): string {
  if (!i18n) return fallback;
  if (locale === 'ja' && i18n.ja?.name) return i18n.ja.name;
  return i18n.en?.name ?? fallback;
}

export function ForecastOverlay() {
  const snapshot = useGameStore();
  const fc = useForecast();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const active = fc.enabled && fc.status === 'ready' && !!fc.payload &&
    snapshot.status === 'ready' && !!snapshot.state && !!snapshot.engine;

  const view = active && fc.payload && snapshot.state && snapshot.engine
    ? computePressure({
      payload: fc.payload,
      formationId: fc.formationId,
      slot: fc.slot,
      engine: snapshot.engine,
      state: snapshot.state,
    })
    : null;

  // Per-cell tooltip via a window hit-test (see the pointer-discipline note
  // above -- the layer itself must stay pointer-events:none so the board
  // underneath stays fully usable).
  useEffect(() => {
    if (!view) { setHover(null); return; }
    const onMove = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // The layer spans the whole canvas (PAD included), so back the padding
      // out in the layer's OWN scale -- the canvas may be CSS-scaled.
      const sx = rect.width / (PAD * 2 + CELL * GRID);
      const sy = rect.height / (PAD * 2 + CELL * GRID);
      const x = (e.clientX - rect.left) / sx - PAD;
      const y = (e.clientY - rect.top) / sy - PAD;
      const col0 = Math.floor(x / CELL);
      const row0 = Math.floor(y / CELL);
      if (row0 < 0 || row0 >= GRID || col0 < 0 || col0 >= GRID) { setHover(null); return; }
      const f = canvasToField(view.box, row0, col0);
      const cell = view.result.perCell.get(cellKey(f[0], f[1]));
      if (!cell) { setHover(null); return; }
      setHover((prev) => (prev && prev.row0 === row0 && prev.col0 === col0 ? prev : { row0, col0, cell }));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [view]);

  if (!view) return null;

  const locale = snapshot.locale;
  const { min, max } = view;

  return (
    <div
      className="forecast-overlay"
      ref={rootRef}
      data-testid="forecast-overlay"
      // REQ-0057 perf budget ([TUNABLE 50ms] per recompute): the fold's OWN
      // wall-clock, stamped by pressure.ts, exposed so the e2e budget test
      // measures the real shipped fold on the real payload rather than a
      // re-implementation of it. Cheap (one attribute), and it makes a
      // regression in the hot loop visible instead of merely slow.
      data-fold-ms={view.ms.toFixed(2)}
      aria-hidden="true"
    >
      {view.cells.map(([fr, fc2], i) => {
        const row0 = Math.floor(i / GRID);
        const col0 = i % GRID;
        const cell = view.result.perCell.get(cellKey(fr, fc2));
        if (!cell) return null;
        const tNorm = heatT(cell.damage, min, max);
        const isHover = !!hover && hover.row0 === row0 && hover.col0 === col0;
        return (
          <div
            key={`${row0},${col0}`}
            className={`forecast-cell${isHover ? ' forecast-cell-hover' : ''}`}
            data-testid={`forecast-cell-${row0}-${col0}`}
            data-pressure={cell.damage.toFixed(2)}
            style={{
              left: PAD + col0 * CELL,
              top: PAD + row0 * CELL,
              background: heatColor(tNorm),
            }}
          />
        );
      })}

      {hover ? (
        <div
          className="forecast-tip"
          data-testid="forecast-tip"
          style={{
            left: PAD + hover.col0 * CELL + CELL / 2,
            top: PAD + hover.row0 * CELL,
          }}
        >
          <div className="forecast-tip-head">
            <span className="forecast-tip-cell">
              {String.fromCharCode(65 + hover.col0)}{hover.row0 + 1}
            </span>
            <span className="forecast-tip-dps" data-testid="forecast-tip-dps">
              {t(locale, 'forecast.dps', { n: hover.cell.damage.toFixed(1) })}
            </span>
          </div>
          {hover.cell.statusRate > 0 ? (
            <div className="forecast-tip-status">
              {t(locale, 'forecast.statusRate', { n: hover.cell.statusRate.toFixed(2) })}
            </div>
          ) : null}
          <ul className="forecast-tip-list">
            {hover.cell.contributors.map((c) => (
              <li key={c.key} className={c.statusOnly ? 'forecast-tip-item is-status' : 'forecast-tip-item'}>
                <span className="forecast-tip-src">
                  {localizedName(locale, c.enemyI18n, c.enemyId)}
                </span>
                <span className="forecast-tip-skill">
                  {localizedName(locale, c.i18n, c.skillId)}
                </span>
                <span className="forecast-tip-amt">{c.amount.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
