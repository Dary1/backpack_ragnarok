// client/src/TroopDisbandToast.tsx -- REQ-0327: the DEVICE consumer of the
// notification feed, surfacing a small fixed-position toast for the two
// ALARM kinds (a troop disbanding, a room's wipe-streak halt) and then
// acking them so each shows once. Dependency-free and styled like
// InviteBanner (no toast library exists in this app).
//
// REQ-0368: the POLL that used to live here moved to
// notify/NotificationCenter.tsx. This component's own behaviour is
// deliberately unchanged -- same two kinds, same copy, same show-once
// discipline -- but it now reads the shared feed instead of running the
// app's only notification loop, because REQ-0368 added three more surfaces
// over the same data and the request cadence had to stay exactly what it
// was (the polling-budget gate). The ack likewise goes through the centre,
// so dismissing a toast also clears that entry from the bell.
import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import type { Locale } from './store';
import { useNotificationCenter } from './notify/notifyContext';
import type { ApiNotification } from '../../shared/dto';

export function TroopDisbandToast({ locale }: { locale: Locale }) {
  const { notifications, ack } = useNotificationCenter();
  const [current, setCurrent] = useState<ApiNotification | null>(null);
  // Ids this device has already surfaced+acked, so a poll that races the
  // ack (still returning the entry) never re-pops the toast.
  const handledRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    // REQ-0357: room_halted (solo wipe-streak halt) surfaces through the same
    // toast; a troop's breaker rides troop_disbanded with reason 'wipe_streak'.
    const next = notifications.find((n) => (n.kind === 'troop_disbanded' || n.kind === 'room_halted') && !handledRef.current.has(n.id));
    if (next && (current === null || current.id !== next.id)) setCurrent(next);
  }, [notifications, current]);

  if (current === null) return null;

  const dismiss = () => {
    handledRef.current.add(current.id);
    ack([current.id]);
    setCurrent(null);
  };

  const wipeStreak = current.payload?.reason === 'wipe_streak';
  const text =
    current.kind === 'room_halted'
      ? t(locale, 'notify.roomHalted')
      : wipeStreak
        ? t(locale, 'notify.troopDisbandedWipeStreak')
        : current.attackLv !== null
          ? t(locale, 'notify.troopDisbanded', { level: String(current.attackLv) })
          : t(locale, 'notify.troopDisbandedNoLevel');

  return (
    <div className="notify-toast" role="status">
      <span className="notify-toast-text">{text}</span>
      <button
        type="button"
        className="notify-toast-close"
        onClick={dismiss}
        aria-label={t(locale, 'notify.dismiss')}
      >
        ×
      </button>
    </div>
  );
}
