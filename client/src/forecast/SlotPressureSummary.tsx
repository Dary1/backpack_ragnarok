// client/src/forecast/SlotPressureSummary.tsx -- REQ-0057, the formation
// picker's half of the overlay: "per-slot summary = which squad slot eats
// the most".
//
// Rendered inside CreateRoomForm, which already owns the three inputs this
// needs (dungeon type, level, formation) -- so as the player flips through
// formations, the four slot bars re-rank live and the question the REQ set
// out to answer ("where does the tanky squad go?") is answerable BEFORE the
// room exists.
//
// WHAT IT ASSUMES, AND WHY. This runs at CREATE time, when no squad is
// assigned to any slot yet, so the fold runs over an EMPTY field: the bars
// compare the FORMATION GEOMETRY itself -- which box the dungeon's rays
// rake hardest -- not any particular backpack layout. That is the honest
// comparison at this moment, and it is also the stable one (it does not
// shuffle under you as you edit a canvas on another page). The canvas
// overlay is where occupancy-aware, per-cell pressure lives.
//
// Same disclaimer discipline as the canvas panel: "expected pressure", a
// distribution, never "safe"/"unsafe".
import { boxCells, forecastPressure, parseBox } from '../../../shared/forecast.mjs';
import { t } from '../i18n';
import type { Locale } from '../store';
import { useForecastPayload } from './forecastState';
import { heatColor } from './pressure';

const SLOTS = ['unit1', 'unit2', 'unit3', 'unit4'];

interface SlotPressureSummaryProps {
  locale: Locale;
  dungeonType: string;
  level: number;
  formationId: string;
}

export function SlotPressureSummary({ locale, dungeonType, level, formationId }: SlotPressureSummaryProps) {
  const { payload, loading } = useForecastPayload(dungeonType || 'default', level || 1);

  if (loading) {
    return <div className="slot-pressure" data-testid="slot-pressure-loading">{t(locale, 'forecast.loading')}</div>;
  }
  if (!payload) return null;

  const formation = payload.formations.find((f) => f.id === formationId);
  if (!formation) return null;

  const rows = SLOTS.map((slot, i) => {
    const boxStr = formation.canvases[slot];
    if (!boxStr) return null;
    const box = parseBox(boxStr);
    const res = forecastPressure({
      bounds: payload.bounds,
      jitterHalfWidth: payload.jitterHalfWidth,
      profiles: payload.profiles,
      cells: boxCells(box),
    });
    return { slot, index: i, box: boxStr, mean: res.mean, max: res.max };
  }).filter((r): r is { slot: string; index: number; box: string; mean: number; max: number } => r !== null);

  if (rows.length === 0) return null;

  const worst = Math.max(...rows.map((r) => r.mean));
  const best = Math.min(...rows.map((r) => r.mean));

  return (
    <div className="slot-pressure" data-testid="slot-pressure">
      <div className="slot-pressure-head">
        <span className="slot-pressure-title">{t(locale, 'forecast.slotSummaryTitle')}</span>
        <span className="slot-pressure-unit">{t(locale, 'forecast.unit')}</span>
      </div>
      <ul className="slot-pressure-list">
        {rows.map((r) => {
          // Normalised ACROSS THE FOUR SLOTS (not from zero) -- the question
          // here is strictly comparative ("which slot eats the most?"), and
          // the flat all-field term sim's 5-bounce terminator lays under
          // every box would otherwise wash the ranking out. Both raw numbers
          // are printed, so nothing is hidden.
          const tNorm = worst > best ? (r.mean - best) / (worst - best) : 0;
          const isWorst = r.mean === worst;
          return (
            <li
              key={r.slot}
              className={`slot-pressure-row${isWorst ? ' is-worst' : ''}`}
              data-testid={`slot-pressure-${r.slot}`}
              data-mean={r.mean.toFixed(2)}
            >
              <span className="slot-pressure-name">{t(locale, 'forecast.slotN', { n: r.index + 1 })}</span>
              <span className="slot-pressure-box">{r.box}</span>
              <span className="slot-pressure-bar">
                <span
                  className="slot-pressure-fill"
                  style={{ width: `${(12 + 88 * tNorm).toFixed(1)}%`, background: heatColor(tNorm) }}
                />
              </span>
              <span className="slot-pressure-mean">{r.mean.toFixed(1)}</span>
            </li>
          );
        })}
      </ul>
      <p className="forecast-disclaimer" data-testid="slot-pressure-disclaimer">
        {t(locale, 'forecast.disclaimer')}
      </p>
    </div>
  );
}
