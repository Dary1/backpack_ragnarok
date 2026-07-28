// client/src/TroopDisbandToast.tsx -- REQ-0327: the DEVICE consumer of the
// notification feed. Polls GET /api/notifications on the app's existing
// poll model (usePolledResource, the same hook the warehouse/market pages
// use) and surfaces a small fixed-position "your troop disbanded" toast for
// the newest unseen troop_disbanded entry, then acks it so it shows once.
// Dependency-free and styled like InviteBanner (no toast library exists in
// this app). ONE notification kind; a real SSE/WS push is explicitly out of
// scope (plain poll only for v1 -- the contract is the feed + since cursor).
import { useEffect, useRef, useState } from 'react';
import { fetchNotifications, ackNotifications } from './api/notifications';
import { usePolledResource } from './lib/usePolledResource';
import { t } from './i18n';
import type { Locale } from './store';
import type { ApiNotification, ApiNotificationsResponse } from '../../shared/dto';

const POLL_MS = 15000;

export function TroopDisbandToast({ locale }: { locale: Locale }) {
  const { data } = usePolledResource<ApiNotificationsResponse>(
    () => fetchNotifications(),
    { intervalMs: POLL_MS, onError: 'ignore' }
  );
  const [current, setCurrent] = useState<ApiNotification | null>(null);
  // Ids this device has already surfaced+acked, so a poll that races the
  // ack (still returning the entry) never re-pops the toast.
  const handledRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const list = data?.notifications ?? [];
    const next = list.find((n) => n.kind === 'troop_disbanded' && !handledRef.current.has(n.id));
    if (next && (current === null || current.id !== next.id)) setCurrent(next);
  }, [data, current]);

  if (current === null) return null;

  const dismiss = () => {
    handledRef.current.add(current.id);
    void ackNotifications([current.id]).catch(() => {
      /* best-effort: a failed ack simply means the next poll may re-surface it */
    });
    setCurrent(null);
  };

  const text =
    current.attackLv !== null
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
