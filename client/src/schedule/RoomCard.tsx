// One room's card -- REQ-0036 P1-C. Status label, current dungeon level,
// next-run countdown (computed client-side from cooldownUntil, ticked
// every second via plain setInterval/Date.now() -- no library needed for
// this), cancel button, and an expand toggle that reveals the SlotsPanel
// + Monitor for this room.
import { useEffect, useState } from 'react';
import { cancelRoom as apiCancelRoom, type ApiRoom } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { Monitor } from './Monitor';
import { SlotsPanel } from './SlotsPanel';

interface RoomCardProps {
  room: ApiRoom;
  locale: Locale;
  expanded: boolean;
  onToggleExpand: () => void;
  onChanged: () => void | Promise<void>;
}

type RoomUiStatus = 'idle' | 'cooldown' | 'running' | 'cancelPending' | 'canceled';

/** Derives the room's own friendly UI status (per the task brief's exact
 * mapping): 'running' = status:'active'; 'cancelPending' =
 * cancelRequested:true (checked before cooldown/idle, since a
 * cancel-after-current-run flag is meaningful even while technically
 * 'open'); 'cooldown' = status:'open' with cooldownUntil in the future;
 * 'idle' = status:'open', slots incomplete or cooldown already elapsed;
 * 'canceled' = status:'canceled'. */
function deriveStatus(room: ApiRoom): RoomUiStatus {
  if (room.status === 'canceled') return 'canceled';
  // Checked BEFORE the plain 'active' -> 'running' mapping: a room that
  // is currently running but flagged cancelRequested (golden g,
  // cancelPolicy.immediate:false) should read as "cancel pending" to the
  // player, not plainly "running" -- the cancellation is already
  // committed, only deferred until the in-flight run settles.
  if (room.cancelRequested) return 'cancelPending';
  if (room.status === 'active') return 'running';
  if (room.cooldownUntil && Date.parse(room.cooldownUntil) > Date.now()) return 'cooldown';
  return 'idle';
}

const STATUS_KEY: Record<RoomUiStatus, 'schedule.statusIdle' | 'schedule.statusCooldown' | 'schedule.statusRunning' | 'schedule.statusCancelPending' | 'schedule.statusCanceled'> = {
  idle: 'schedule.statusIdle',
  cooldown: 'schedule.statusCooldown',
  running: 'schedule.statusRunning',
  cancelPending: 'schedule.statusCancelPending',
  canceled: 'schedule.statusCanceled',
};

/** Formats a millisecond duration as "Xm Ys" / "Ys" -- small, dependency-
 * free, matches this codebase's existing "no library for simple
 * countdown formatting" posture (see store.ts's welcome-banner timer for
 * the same spirit, though that one doesn't render a countdown string). */
export function formatCountdown(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function RoomCard({ room, locale, expanded, onToggleExpand, onChanged }: RoomCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [cancelPending, setCancelPending] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = deriveStatus(room);
  const cooldownRemainingMs = room.cooldownUntil ? Date.parse(room.cooldownUntil) - now : 0;

  const handleCancel = async () => {
    if (!window.confirm(t(locale, 'schedule.cancelConfirm'))) return;
    setCancelPending(true);
    try {
      await apiCancelRoom(room.id);
      await onChanged();
    } finally {
      setCancelPending(false);
    }
  };

  return (
    <div className={`schedule-room-card schedule-room-status-${status}`} data-testid="schedule-room-card" data-room-id={room.id} data-room-status={status}>
      <div className="schedule-room-card-header">
        <div className="schedule-room-card-title">
          <span className="schedule-room-id">{t(locale, 'schedule.roomId')} {room.id.slice(0, 12)}</span>
          <span className={`schedule-status-badge schedule-status-badge-${status}`} data-testid="schedule-room-status-badge">
            {t(locale, STATUS_KEY[status])}
          </span>
        </div>
        <div className="schedule-room-card-actions">
          <button type="button" className="schedule-expand-btn" onClick={onToggleExpand} data-testid="schedule-room-expand-toggle">
            {expanded ? t(locale, 'schedule.collapse') : t(locale, 'schedule.expand')}
          </button>
          {status !== 'canceled' ? (
            <button type="button" className="schedule-cancel-btn" onClick={handleCancel} disabled={cancelPending} data-testid="schedule-room-cancel-btn">
              {t(locale, 'schedule.cancelButton')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="schedule-room-card-body">
        <span className="schedule-room-level">{t(locale, 'schedule.levelLine', { level: room.level })}</span>
        {status === 'cooldown' ? (
          <span className="schedule-room-countdown" data-testid="schedule-room-countdown">
            {t(locale, 'schedule.nextRunIn', { time: formatCountdown(cooldownRemainingMs) })}
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div className="schedule-room-expanded">
          <SlotsPanel room={room} locale={locale} onChanged={onChanged} />
          <Monitor room={room} locale={locale} />
        </div>
      ) : null}
    </div>
  );
}
