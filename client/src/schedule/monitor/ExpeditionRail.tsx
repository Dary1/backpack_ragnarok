// REQ-0240 M2 (03 spec ss6.2): the expedition rail -- encounter/boss/gimic
// nodes at their paced positions, filled to the current pct; nodes AHEAD of
// the playhead render masked at 35% (known unknowns), passed nodes full colour.
import { t } from '../../i18n';
import type { Locale } from '../../store';
import type { RailNode } from './railNodes';

interface Props {
  locale: Locale;
  nodes: RailNode[];
  pct: number;
  durationMs: number;
  settled: boolean;
  onScrub?: (frac: number) => void;
}

const GLYPH: Record<RailNode['kind'], string> = { pack: '⚔', boss: '👑', trap: 'ᚦ', chest: 'ᚷ', door: 'ᛞ' };

export function ExpeditionRail({ locale, nodes, pct, durationMs, settled, onScrub }: Props) {
  const clickable = settled && !!onScrub;
  const handle = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (!clickable || !onScrub) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    onScrub(Math.max(0, Math.min(1, frac)));
  };
  return (
    <div className={`mon-rail${clickable ? ' is-scrub' : ''}`} data-testid="monitor-rail" onClick={clickable ? handle : undefined}>
      <div className="mon-rail-track">
        <div className="mon-rail-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        {nodes.map((n, i) => {
          const left = durationMs > 0 ? Math.max(0, Math.min(100, (n.ptMs / durationMs) * 100)) : 0;
          const cls = `mon-rail-node kind-${n.kind}${n.passed ? ' is-passed' : ' is-ahead'}${n.failed ? ' is-failed' : ''}`;
          return (
            <span key={i} className={cls} style={{ left: `${left}%` }} data-testid={`monitor-rail-node-${i}`} title={n.passed ? n.label : t(locale, 'schedule.monitor.railUnknown')} aria-label={n.label}>
              <span className="mon-rail-node-glyph" aria-hidden="true">{GLYPH[n.kind]}</span>
              {n.failed ? <span className="mon-rail-node-x" aria-hidden="true">✕</span> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
