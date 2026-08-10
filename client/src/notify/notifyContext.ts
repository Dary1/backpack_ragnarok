// client/src/notify/notifyContext.ts -- REQ-0368: the notification-feed
// CONTEXT and its reader hook, split out of NotificationCenter.tsx so that
// file exports a component and nothing else (the react-refresh rule oxlint
// enforces; the same reason i18n key groups live in their own modules).
import { createContext, useContext } from 'react';
import type { ApiNotification } from '../../../shared/dto';

/** REQ-0327's cadence, unchanged -- see REQ-0368's polling-budget gate. */
export const NOTIFY_POLL_MS = 15000;

export interface NotificationCenterValue {
  /** The caller's UNSEEN entries, ascending by id, minus anything this
   * device has already retired locally. */
  notifications: ApiNotification[];
  /** True once the first poll has landed. The login digest waits on this
   * so it can tell "no news" from "not asked yet". */
  loaded: boolean;
  /** Optimistically retire entries locally, then ack them server-side. */
  ack: (ids: number[]) => void;
}

const EMPTY: NotificationCenterValue = { notifications: [], loaded: false, ack: () => {} };

export const NotificationCtx = createContext<NotificationCenterValue>(EMPTY);

/** Read the feed. Safe outside the provider (returns the empty value), so a
 * component can mount in a test harness without the whole app shell. */
export function useNotificationCenter(): NotificationCenterValue {
  return useContext(NotificationCtx);
}
