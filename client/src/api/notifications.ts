// client/src/api/notifications.ts -- REQ-0327: the per-player notification
// feed client API. Talks to server/routes/notifications.cjs's
// /api/notifications[?since=<id>] (poll) + /api/notifications/ack. Same
// conventions as every sibling api/*.ts (ApiError on non-2xx, authHeaders()
// via scheduleJSON). ONE mechanism a human device and a bot program consume
// identically -- the web client polls it for the troop-disband toast; a
// bot program (REQ-0330) polls the SAME endpoint with a since cursor.
import { scheduleJSON } from './http';
import type { ApiNotificationsResponse, ApiNotificationAckResponse } from '../../../shared/dto';

/** GET /api/notifications[?since=<id>] -- the caller's UNSEEN entries
 * (optionally only those with id strictly greater than `since`), plus the
 * feed's high-water `cursor`. Auth = X-Auth-Token / Bearer (a bot reads
 * its own feed the same way). */
export function fetchNotifications(since?: number): Promise<ApiNotificationsResponse> {
  const q = since != null ? '?since=' + encodeURIComponent(String(since)) : '';
  return scheduleJSON<ApiNotificationsResponse>('/api/notifications' + q);
}

/** POST /api/notifications/ack {ids} -- mark entries seen (hides them from
 * the unseen feed; bounds the stored list). */
export function ackNotifications(ids: number[]): Promise<ApiNotificationAckResponse> {
  return scheduleJSON<ApiNotificationAckResponse>('/api/notifications/ack', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
