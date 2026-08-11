// client/src/schedule/RunHistory.tsx -- REQ-0372: the room's past-runs fold.
//
// Before this, only the LATEST settled run of a room was viewable (REQ-0099's
// settled replay): "what dropped yesterday?" had no answer, and a player
// tuning a build could not put run N next to run N-1. The replay data always
// existed -- every run is persisted whole -- so this is a READ surface plus
// the retention the server now enforces (server/services/runs.cjs
// RUN_HISTORY_LIMIT), not new run machinery.
//
// Two deliberate honesty constraints, both inherited from the server:
//   * the W/L tally at the fold head counts the LISTED WINDOW ONLY and says so
//     in its own label. Older runs are pruned at settle time, so an "all-time"
//     record does not exist to be shown.
//   * a row's clear time is COMBAT time (ApiRunHistoryRow.durationMs =
//     the run's simDurationSecs), not the [45s,300s]-clamped presentation
//     duration the monitor's transport counts down -- that clamp would flatten
//     exactly the run-N-vs-N-1 comparison this list is for. The two clocks
//     legitimately disagree; this is the one you tune a build against.
//
// Selecting a row does NOT re-implement playback: it lifts the runId to
// SchedulePage, which hands it to <Monitor replayRunId>, which fetches that run
// in the same ApiRunView shape and feeds the existing MonitorRenderer /
// useRunPlayhead path (REQ-0099's transport included).
import { useCallback, useEffect, useState } from 'react';
import {
  fetchRunHistory,
  type ApiContentPayload, type ApiRunHistory, type ApiRunHistoryLoot, type ApiRunHistoryRow,
} from '../api';
import { iconDataUrl } from '../dex/dexIcons';
import { t } from '../i18n';
import { cachedFetchContent } from '../lib/contentCache';
import type { Locale } from '../store';

interface RunHistoryProps {
  roomId: string;
  locale: Locale;
  /** The past run currently loaded in the monitor; null = the room's latest. */
  selectedRunId: string | null;
  onSelect: (runId: string | null) => void;
  /** Bumped by SchedulePage when the watched run settles -- the one moment a
   * new row can appear without a route change. */
  refreshSignal: number;
}

const RESULT_GLYPH: Record<ApiRunHistoryRow['result'], string> = {
  victory: '✦',
  wipe: '✕',
  incomplete: '◌',
};

function resultLabel(locale: Locale, result: ApiRunHistoryRow['result']): string {
  if (result === 'victory') return t(locale, 'schedule.monitor.resultVictory');
  if (result === 'wipe') return t(locale, 'schedule.monitor.resultWipe');
  return t(locale, 'schedule.monitor.resultIncomplete');
}

/** mm:ss -- the same shape the monitor's own transport clock prints. */
function formatClearTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function formatDeparture(locale: Locale, iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Resolve one loot row against the content payload. `kind` picks the table
 * (REQ-0372 DTO); the name/icon/rarity fallbacks mirror Monitor.tsx's own
 * settled-summary rewardVisual()/localizedItemName() pair. */
function lootVisual(
  locale: Locale,
  content: ApiContentPayload | null,
  loot: ApiRunHistoryLoot,
): { name: string; icon: string | null; rarity: string | null } {
  const entry = loot.kind === 'tm'
    ? content?.tms[loot.itemId]
    : content?.items[loot.itemId] ?? content?.sis[loot.itemId];
  if (!entry) return { name: loot.itemId, icon: null, rarity: null };
  const name = locale === 'ja'
    ? entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name
    : entry.name;
  return { name, icon: iconDataUrl(entry.icon), rarity: entry.rarity ?? null };
}

export function RunHistory({ roomId, locale, selectedRunId, onSelect, refreshSignal }: RunHistoryProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<ApiRunHistory | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetchRunHistory(roomId);
      setHistory(res);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [roomId]);

  // Fetch on room change and whenever the watched run settles. Deliberately
  // NOT polled: a room gains a history row only at settle, and SchedulePage
  // already signals exactly that (the same signal the spoils rail rides).
  useEffect(() => { setHistory(null); void load(); }, [load, refreshSignal]);

  // Icons come from the shared content memo, so opening the fold costs no
  // extra request on a session that has already loaded content anywhere.
  useEffect(() => {
    if (!open || content) return;
    let cancelled = false;
    void cachedFetchContent()
      .then((c) => { if (!cancelled) setContent(c); })
      .catch(() => { /* names degrade to content ids -- not worth an error state */ });
    return () => { cancelled = true; };
  }, [open, content]);

  const rows = history?.runs ?? [];
  const tally = history?.tally ?? { victory: 0, wipe: 0, incomplete: 0 };

  // No past runs is not an error -- a freshly created room simply has none --
  // and there is nothing to fold open, so the surface stays out of the way
  // entirely until the first run settles.
  if (!failed && rows.length === 0) return null;

  return (
    <section className="panel ornate schedule-history" data-testid="schedule-history">
      <button
        type="button"
        className="schedule-history-head"
        data-testid="schedule-history-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="schedule-history-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="schedule-history-title den">{t(locale, 'schedule.history.title')}</span>
        {failed ? (
          <span className="schedule-history-failed t-micro" data-testid="schedule-history-failed">{t(locale, 'schedule.history.loadFailed')}</span>
        ) : (
          <span className="schedule-history-tally t-micro tnum" data-testid="schedule-history-tally">
            {t(locale, 'schedule.history.tally', { wins: tally.victory, losses: tally.wipe })}
            {' '}
            <span className="schedule-history-tally-scope">{t(locale, 'schedule.history.tallyScope', { count: rows.length })}</span>
          </span>
        )}
      </button>

      {open ? (
        <div className="schedule-history-body">
          <ul className="schedule-history-list" data-testid="schedule-history-list">
            {rows.map((row) => {
              const isSelected = selectedRunId === row.runId;
              return (
                <li key={row.runId}>
                  <button
                    type="button"
                    className={`schedule-history-row${isSelected ? ' is-selected' : ''}`}
                    data-testid="schedule-history-row"
                    data-run-id={row.runId}
                    aria-pressed={isSelected}
                    // Clicking the selected row again returns the monitor to the
                    // room's live/latest run -- so there is no mode to escape
                    // from, only a toggle (the explicit chip below is the same
                    // action, discoverable).
                    onClick={() => onSelect(isSelected ? null : row.runId)}
                  >
                    <span
                      className={`schedule-history-glyph schedule-monitor-result-${row.result}`}
                      title={resultLabel(locale, row.result)}
                      aria-label={resultLabel(locale, row.result)}
                    >
                      {RESULT_GLYPH[row.result]}
                    </span>
                    <span className="schedule-history-when t-micro">{formatDeparture(locale, row.startedAt)}</span>
                    <span className="schedule-history-time tnum" title={t(locale, 'schedule.history.clearTimeHint')}>
                      {formatClearTime(row.durationMs)}
                    </span>
                    <span className="schedule-history-level t-micro tnum">
                      {row.level != null ? t(locale, 'schedule.history.level', { level: row.level }) : '—'}
                    </span>
                    <span className="schedule-history-loot" data-testid="schedule-history-loot">
                      {row.lootSummary.length === 0 ? (
                        <span className="schedule-history-loot-none t-micro">{t(locale, 'schedule.history.lootNone')}</span>
                      ) : row.lootSummary.map((loot) => {
                        const visual = lootVisual(locale, content, loot);
                        return (
                          <span
                            key={`${loot.kind}/${loot.itemId}`}
                            className={`chip schedule-history-loot-chip${visual.rarity ? ` rarity r-${visual.rarity}` : ''}`}
                            title={visual.name}
                          >
                            {visual.icon ? <img src={visual.icon} alt="" aria-hidden="true" /> : null}
                            <span className="schedule-history-loot-name">{visual.name}</span>
                            {loot.qty > 1 ? <span className="schedule-history-loot-qty tnum">{'×'}{loot.qty}</span> : null}
                          </span>
                        );
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selectedRunId ? (
            <button
              type="button"
              className="btn btn-ghost schedule-history-latest"
              data-testid="schedule-history-latest"
              onClick={() => onSelect(null)}
            >
              {t(locale, 'schedule.history.backToLatest')}
            </button>
          ) : null}
          <div className="schedule-history-note t-micro">
            {t(locale, 'schedule.history.retentionNote', { count: history?.window ?? 0 })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
