// REQ-0240 M1 (03 spec ss6.1): banner art (dungeon custom 4:1 crop) + title +
// LIVE/REPLAY chip + return clock + admin overflow menu (seed + raw JSONL copy).
import { useState } from 'react';
import { getItemArtUrl } from '../../board/itemArt';
import { t } from '../../i18n';
import type { Locale } from '../../store';

interface Props {
  locale: Locale;
  dungeonId: string;
  dungeonName: string;
  level: number;
  live: boolean;
  returnAt: string | null; // absolute HH:mm the run frees the room
  seed: string | null;
  isAdmin: boolean;
  onCopyJsonl: () => void;
  copyStatus: 'idle' | 'copied' | 'failed';
}

export function MonitorHeader({ locale, dungeonId, dungeonName, level, live, returnAt, seed, isAdmin, onCopyJsonl, copyStatus }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const art = getItemArtUrl(dungeonId);
  return (
    <div className="mon-header" data-testid="monitor-header">
      <div className="mon-header-banner" style={art ? { backgroundImage: `url(${art})` } : undefined} data-has-art={art ? '1' : '0'}>
        {!art ? <span className="mon-header-banner-fallback" aria-hidden="true">ᛝ</span> : null}
        <div className="mon-header-scrim" />
        <div className="mon-header-row">
          <span className="mon-header-title dj">{dungeonName} · Lv{level}</span>
          {live ? (
            <span className="chip is-live schedule-monitor-live-chip den" data-testid="schedule-monitor-live-chip">
              <span className="dot" aria-hidden="true" />{t(locale, 'schedule.monitor.live')}
            </span>
          ) : (
            <span className="chip den mon-replay-chip" data-testid="monitor-replay-chip">{t(locale, 'schedule.monitor.replayChip')}</span>
          )}
          <span className="mon-header-grow" aria-hidden="true" />
          {returnAt ? <span className="mon-header-return t-micro tnum">{t(locale, 'schedule.monitor.returnAt', { time: returnAt })}</span> : null}
          {isAdmin ? (
            <div className="mon-header-menu-wrap">
              <button type="button" className="mon-header-menu-btn" aria-label={t(locale, 'schedule.monitor.menu.title')} onClick={() => setMenuOpen((v) => !v)} data-testid="monitor-menu-btn">⋯</button>
              {menuOpen ? (
                <div className="mon-header-menu" role="menu">
                  {seed ? <div className="mon-header-menu-seed t-micro tnum">{t(locale, 'schedule.monitor.seed', { seed })}</div> : null}
                  <button type="button" className="mon-header-menu-item schedule-monitor-log-copy-btn" data-testid="schedule-monitor-log-copy-btn" onClick={() => { onCopyJsonl(); }}>
                    {t(locale, 'schedule.monitor.menu.copyJsonl')}
                  </button>
                  {copyStatus === 'copied' ? <span className="mon-header-menu-status" data-testid="schedule-monitor-log-copy-status">{t(locale, 'schedule.monitor.copied')}</span> : null}
                  {copyStatus === 'failed' ? <span className="mon-header-menu-status is-fail">{t(locale, 'schedule.monitor.copyFailed')}</span> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
