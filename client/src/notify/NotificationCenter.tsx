// client/src/notify/NotificationCenter.tsx -- REQ-0368: THE single client
// consumer of the REQ-0327 notification feed.
//
// WHY A PROVIDER AND NOT FOUR COMPONENTS: this REQ adds four surfaces that
// all read the same feed -- the header bell, the nav-rail badges, the login
// digest, and the pre-existing TroopDisbandToast. The REQ is explicit that
// there must be ONE poller ("reuse/extend the TroopDisbandToast poll -- do
// not add a second loop"), and the polling budget is a stated gate: request
// cadence must be unchanged from today's toast poll. So the poll that used
// to live inside TroopDisbandToast moves here, at the same 15s interval and
// through the same usePolledResource hook, and every surface reads the
// context (notifyContext.ts) instead of fetching for itself.
//
// ACK is also centralised, for a subtler reason: three of the four surfaces
// can retire the same entry (the toast on dismiss, the bell on open, the
// digest on dismiss). Each does an optimistic local retire into `ackedIds`
// and fires POST /api/notifications/ack; the local set is what keeps a poll
// that RACES the ack (the server still returning the entry for a few
// hundred ms) from re-lighting a badge the player just cleared.
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchNotifications, ackNotifications } from '../api/notifications';
import { usePolledResource } from '../lib/usePolledResource';
import { NOTIFY_POLL_MS, NotificationCtx } from './notifyContext';
import type { NotificationCenterValue } from './notifyContext';
import type { ApiNotificationsResponse } from '../../../shared/dto';

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const { data } = usePolledResource<ApiNotificationsResponse>(
    () => fetchNotifications(),
    { intervalMs: NOTIFY_POLL_MS, onError: 'ignore' }
  );
  // Ids retired on this device but possibly still unseen server-side (the
  // ack is in flight, or failed). Never unbounded in practice: the server
  // bounds the feed at MAX_ENTRIES and an acked entry stops coming back.
  const [ackedIds, setAckedIds] = useState<ReadonlySet<number>>(() => new Set());

  const notifications = useMemo(
    () => (data?.notifications ?? []).filter((n) => !ackedIds.has(n.id)),
    [data, ackedIds]
  );

  const ack = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setAckedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    void ackNotifications(ids).catch(() => {
      /* best-effort, exactly as REQ-0327's toast ack was: a failed ack only
         means the entry may resurface on a later poll (the local retire is
         session-scoped), never a lost or duplicated player action. */
    });
  }, []);

  const value = useMemo<NotificationCenterValue>(
    () => ({ notifications, loaded: data != null, ack }),
    [notifications, data, ack]
  );

  return <NotificationCtx.Provider value={value}>{children}</NotificationCtx.Provider>;
}
