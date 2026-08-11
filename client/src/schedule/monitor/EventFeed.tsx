// REQ-0240 M4 (03 spec ss6.3): the filterable, localized event feed --
// newest-on-top, <=500 rows, tone accents, autoscroll pinned to top while
// live (user scroll unpins + shows a jump-to-latest chip), aria-live polite.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { Locale } from '../../store';
import type { FeedRow, FeedCategory } from './feedCopy';

interface Props {
  locale: Locale;
  rows: FeedRow[];
  live: boolean;
  /** REQ-0377 item 6: seek the playhead to a row's event time. Present only
   * on a SETTLED run (Monitor.tsx passes undefined while live) -- when it is
   * undefined the rows render as the plain divs they always were, so a live
   * feed grows no affordance it cannot honour. */
  onSeek?: (ptMs: number) => void;
}

const FILTERS: { key: FeedCategory; label: string }[] = [
  { key: 'all', label: 'schedule.monitor.feed.filterAll' },
  { key: 'damage', label: 'schedule.monitor.feed.filterDamage' },
  { key: 'loot', label: 'schedule.monitor.feed.filterLoot' },
  { key: 'gimic', label: 'schedule.monitor.feed.filterGimic' },
];

function fmtTime(ptMs: number): string {
  const s = Math.max(0, ptMs / 1000);
  const m = Math.floor(s / 60);
  const r = (s % 60);
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}

export function EventFeed({ locale, rows, live, onSeek }: Props) {
  const [filter, setFilter] = useState<FeedCategory>('all');
  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const filtered = filter === 'all' ? rows : rows.filter((r) => r.category === filter);
    // newest-on-top, cap 500
    return filtered.slice(-500).reverse();
  }, [rows, filter]);

  useEffect(() => {
    if (pinned && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [shown, pinned]);

  const onScroll = (): void => {
    const el = scrollRef.current; if (!el) return;
    setPinned(el.scrollTop <= 4);
  };

  return (
    <div className="mon-feed" data-testid="monitor-feed">
      <div className="mon-feed-filters" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip mon-feed-filter${filter === f.key ? ' is-on' : ''}`}
            data-testid={`monitor-feed-filter-${f.key}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {t(locale, f.label as never)}
          </button>
        ))}
      </div>
      <div className="mon-feed-scroll" ref={scrollRef} onScroll={onScroll} aria-live={live ? 'polite' : 'off'}>
        {shown.length === 0 ? (
          <div className="mon-feed-empty" data-testid="monitor-feed-empty">{t(locale, 'schedule.monitor.feedWaiting')}</div>
        ) : (
          shown.map((r) => {
            const body = (
              <>
                <span className="mon-feed-time t-micro tnum">{fmtTime(r.ptMs)}</span>
                <span className="mon-feed-icon" aria-hidden="true">{r.icon}</span>
                <span className="mon-feed-text">{r.text}</span>
              </>
            );
            // A real <button> when it seeks, so keyboard and screen-reader
            // users get the affordance too -- a div with onClick would hand
            // this only to the mouse. Same class list and same testid either
            // way, so every existing selector and tone rule still applies.
            return onSeek ? (
              <button
                key={r.index}
                type="button"
                className={`mon-feed-row mon-feed-row-seek tone-${r.tone}`}
                data-testid="monitor-feed-row"
                data-category={r.category}
                title={t(locale, 'schedule.monitor.replay.seekToEvent')}
                onClick={() => onSeek(r.ptMs)}
              >
                {body}
              </button>
            ) : (
              <div key={r.index} className={`mon-feed-row tone-${r.tone}`} data-testid="monitor-feed-row" data-category={r.category}>
                {body}
              </div>
            );
          })
        )}
      </div>
      {!pinned ? (
        <button type="button" className="chip mon-feed-jump" data-testid="monitor-feed-jump" onClick={() => { setPinned(true); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}>
          {t(locale, 'schedule.monitor.feed.jumpLatest')}
        </button>
      ) : null}
    </div>
  );
}
