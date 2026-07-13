// client/src/forecast/ForecastPanel.tsx -- REQ-0057: the overlay's controls.
//
// Sits under the canvas stage (REQ-0070 MJOLNIR chrome): one toggle, and --
// only once the overlay is on -- the four inputs REQ-0057 forecasts against
// (dungeon type, level, formation, squad slot), a legend that prints the
// TRUE dmg/s at both ends of the tint ramp, and the honesty line.
//
// The disclaimer is not decoration. REQ-0057 is explicit: "Not a promise:
// forecast shows the DISTRIBUTION (jitter, packs vary); label it 'expected
// pressure', never 'safe/unsafe' absolutes." So the panel says exactly that,
// in the player's own language, right where the number is read.
import { t } from '../i18n';
import { useGameStore } from '../store';
import { setForecastSettings, toggleForecast, useForecast } from './forecastState';
import { computePressure } from './pressure';

const SLOTS = ['unit1', 'unit2', 'unit3', 'unit4'];

export function ForecastPanel() {
  const snapshot = useGameStore();
  const fc = useForecast();
  const locale = snapshot.locale;

  if (snapshot.status !== 'ready') return null;

  const view = fc.enabled && fc.status === 'ready' && fc.payload && snapshot.state && snapshot.engine
    ? computePressure({
      payload: fc.payload,
      formationId: fc.formationId,
      slot: fc.slot,
      engine: snapshot.engine,
      state: snapshot.state,
    })
    : null;

  return (
    <div className="forecast-panel" data-testid="forecast-panel">
      <div className="forecast-bar">
        <button
          type="button"
          className={`forecast-toggle${fc.enabled ? ' is-on' : ''}`}
          data-testid="forecast-toggle"
          aria-pressed={fc.enabled}
          onClick={() => toggleForecast()}
        >
          {t(locale, 'forecast.toggle')}
        </button>

        {fc.enabled && fc.status === 'loading' ? (
          <span className="forecast-status" data-testid="forecast-loading">{t(locale, 'forecast.loading')}</span>
        ) : null}
        {fc.enabled && fc.status === 'error' ? (
          <span className="forecast-status forecast-status-error" data-testid="forecast-error">
            {t(locale, 'forecast.error', { msg: fc.error ?? '' })}
          </span>
        ) : null}

        {fc.enabled && fc.payload ? (
          <>
            <label className="forecast-field">
              <span className="forecast-field-label">{t(locale, 'schedule.dungeonTypeLabel')}</span>
              <select
                className="forecast-select"
                data-testid="forecast-type-select"
                value={fc.dungeonType}
                onChange={(e) => setForecastSettings({ dungeonType: e.target.value })}
              >
                <option value="default">{t(locale, 'forecast.typeDefault')}</option>
                <option value="test_fixed">{t(locale, 'forecast.typeFixed')}</option>
              </select>
            </label>

            <label className="forecast-field">
              <span className="forecast-field-label">{t(locale, 'schedule.levelLabel')}</span>
              <input
                className="forecast-input"
                data-testid="forecast-level-input"
                type="number"
                min={1}
                max={99}
                value={fc.level}
                onChange={(e) => setForecastSettings({ level: Number(e.target.value) || 1 })}
              />
            </label>

            <label className="forecast-field">
              <span className="forecast-field-label">{t(locale, 'schedule.formationLabel')}</span>
              <select
                className="forecast-select"
                data-testid="forecast-formation-select"
                value={fc.formationId}
                onChange={(e) => setForecastSettings({ formationId: e.target.value })}
              >
                {fc.payload.formations.map((f) => (
                  <option key={f.id} value={f.id}>
                    {(locale === 'ja' ? f.i18n?.ja?.name : f.i18n?.en?.name) ?? f.id}
                  </option>
                ))}
              </select>
            </label>

            <label className="forecast-field">
              <span className="forecast-field-label">{t(locale, 'forecast.slotLabel')}</span>
              <select
                className="forecast-select"
                data-testid="forecast-slot-select"
                value={fc.slot}
                onChange={(e) => setForecastSettings({ slot: e.target.value })}
              >
                {SLOTS.map((s, i) => (
                  <option key={s} value={s}>{t(locale, 'forecast.slotN', { n: i + 1 })}</option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      {view ? (
        <div className="forecast-legend" data-testid="forecast-legend">
          <span className="forecast-legend-label">{t(locale, 'forecast.legend')}</span>
          <span className="forecast-legend-min" data-testid="forecast-legend-min">{view.min.toFixed(1)}</span>
          <span className="forecast-legend-ramp" aria-hidden="true" />
          <span className="forecast-legend-max" data-testid="forecast-legend-max">{view.max.toFixed(1)}</span>
          <span className="forecast-legend-unit">{t(locale, 'forecast.unit')}</span>
          <span className="forecast-disclaimer" data-testid="forecast-disclaimer">
            {t(locale, 'forecast.disclaimer')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
