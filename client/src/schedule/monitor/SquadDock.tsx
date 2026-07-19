// REQ-0240 M5 (03 spec ss6.4): the per-squad readout dock -- four cards with
// name, HP bar + %, charge pips (hidden cleanly when no charge telemetry), and
// KO/untouched stamps. Data = runRoster reduction (exact HP once run_end airs;
// full bars mid-run per the documented M1 fallback).
import { t } from '../../i18n';
import type { Locale } from '../../store';
import type { SquadReadout } from './runRoster';

const ORD = ['壱', '弐', '参', '肆'];

function hpClass(frac: number): string {
  if (frac >= 0.7) return 'hp-full';
  if (frac >= 0.4) return 'hp-mid';
  return 'hp-low';
}

interface Props { locale: Locale; squads: SquadReadout[]; names: (string | null)[]; }

export function SquadDock({ locale, squads, names }: Props) {
  return (
    <div className="mon-dock" data-testid="monitor-dock">
      {squads.map((sq) => {
        const frac = sq.hpMax > 0 ? Math.max(0, Math.min(1, sq.hp / sq.hpMax)) : 0;
        const name = names[sq.index] ?? `${ORD[sq.index] ?? sq.index + 1}`;
        return (
          <div key={sq.index} className={`mon-dock-card${sq.ko ? ' is-ko' : ''}`} data-testid={`monitor-dock-squad-${sq.index}`}>
            <div className="mon-dock-head">
              <span className="mon-dock-ord den" aria-hidden="true">{ORD[sq.index] ?? ''}</span>
              <span className="mon-dock-name dj">{name}</span>
              <span className="mon-dock-grow" aria-hidden="true" />
              <span className="mon-dock-pct t-micro tnum">{Math.round(frac * 100)}%</span>
            </div>
            <div className="mon-dock-bar bar">
              <div className={`mon-dock-fill ${hpClass(frac)}`} style={{ width: `${frac * 100}%` }} />
            </div>
            <div className="mon-dock-foot">
              {sq.charge != null ? (
                <span className="mon-dock-pips" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => <span key={i} className={`mon-dock-pip${i < (sq.charge ?? 0) ? ' is-on' : ''}`} />)}
                </span>
              ) : <span className="mon-dock-pips-empty" />}
              {sq.ko ? <span className="mon-dock-stamp st-ko">{t(locale, 'schedule.monitor.dock.ko')}</span>
                : sq.untouched ? <span className="mon-dock-stamp st-ok">{t(locale, 'schedule.monitor.dock.untouched')}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
