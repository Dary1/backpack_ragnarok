// Human-readable, i18n'd mapping for the Dungeon Schedule API's 409
// error messages -- REQ-0036 P1-C. server/schedule.cjs throws these
// EXACT strings (see that file's assignSlot/claimWarehouseItem); this
// module maps them (by substring match, per the task brief) to a
// translated, friendly message, with a fallback that shows the raw
// server error verbatim if it doesn't match any known pattern
// (forward-compat with any future error text -- never silently swallows
// an unrecognized error).
import { t } from '../i18n';
import type { Locale } from '../store';
import { ApiError } from '../api';

/**
 * Resolves a human-readable, translated message for an error thrown by
 * one of the schedule/warehouse API calls (assignSlot, swapUnit,
 * claimWarehouseItem, createRoom, ...). Matches the THREE known
 * server-side 409 message substrings verbatim quoted in the task brief;
 * anything else (network failure, 400/401/404/500, or a message that
 * doesn't match a known pattern) falls back to the raw error's own
 * message so nothing is ever silently hidden.
 */
export function friendlyScheduleError(locale: Locale, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // REQ-0041: the empty-unit deploy-gate 409 carries a STRUCTURED
  // `reason` field (server/schedule.cjs's assignSlot attaches
  // err.reason='empty_unit', threaded through by server/api.cjs's
  // sendScheduleError) rather than relying purely on a message substring
  // match -- checked first/preferentially when available. Falls through
  // to the existing substring-match convention for every other 409 this
  // route surface can throw (unchanged).
  if (error instanceof ApiError && error.reason === 'empty_unit') {
    return t(locale, 'schedule.error.emptyUnit');
  }
  if (raw.includes('not independent')) return t(locale, 'schedule.error.notIndependent');
  if (raw.includes('active schedule')) return t(locale, 'schedule.error.crossRoomOverlap');
  if (raw.includes('no space in inventory')) return t(locale, 'schedule.error.noWarehouseSpace');
  if (raw.includes('empty unit') || raw.includes('no Backpack')) return t(locale, 'schedule.error.emptyUnit');
  return raw;
}

/** True if `error` is an ApiError with the given HTTP status. Small
 * helper so callers can branch on status (e.g. "only show the 409
 * mapping for a 409, otherwise show a generic failure") without
 * importing ApiError directly everywhere. */
export function isApiErrorStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}
