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
 * one of the schedule/warehouse API calls (assignSlot, swapSquad,
 * claimWarehouseItem, createRoom, ...). Matches the THREE known
 * server-side 409 message substrings verbatim quoted in the task brief;
 * anything else (network failure, 400/401/404/500, or a message that
 * doesn't match a known pattern) falls back to the raw error's own
 * message so nothing is ever silently hidden.
 */
export function friendlyScheduleError(locale: Locale, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // REQ-0041: the empty-squad deploy-gate 409 carries a STRUCTURED
  // `reason` field (server/schedule.cjs's assignSlot attaches
  // err.reason='empty_squad', threaded through by server/api.cjs's
  // sendScheduleError) rather than relying purely on a message substring
  // match -- checked first/preferentially when available. Falls through
  // to the existing substring-match convention for every other 409 this
  // route surface can throw (unchanged).
  if (error instanceof ApiError && error.reason === 'empty_squad') {
    return t(locale, 'schedule.error.emptySquad');
  }
  // REQ-0045 (b)+(c) deploy gate v2: the OLD isSquadIndependent-based
  // "not independent" 409 no longer exists at all (that predicate is no
  // longer part of the deploy gate -- see server/schedule.cjs's
  // deployedUidSetsForGate doc) -- assignSlot's ONLY overlap rejection
  // now carries the STRUCTURED reason 'deployed_overlap' (covers BOTH the
  // cross-room case the old 'active schedule' substring match used to
  // catch, and the NEW same-room-duplicate-squad case bug (c) needed),
  // checked preferentially exactly like 'empty_squad' above. The old
  // 'active schedule' substring fallback below is kept only as defense-
  // in-depth (harmless if e.reason is ever missing for some reason) but
  // is no longer the primary detection path.
  if (error instanceof ApiError && error.reason === 'deployed_overlap') {
    return t(locale, 'schedule.error.crossRoomOverlap');
  }
  if (raw.includes('active schedule')) return t(locale, 'schedule.error.crossRoomOverlap');
  if (raw.includes('no space in inventory')) return t(locale, 'schedule.error.noWarehouseSpace');
  if (raw.includes('empty squad') || raw.includes('no Backpack')) return t(locale, 'schedule.error.emptySquad');
  return raw;
}

/** True if `error` is an ApiError with the given HTTP status. Small
 * helper so callers can branch on status (e.g. "only show the 409
 * mapping for a 409, otherwise show a generic failure") without
 * importing ApiError directly everywhere. */
export function isApiErrorStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}
