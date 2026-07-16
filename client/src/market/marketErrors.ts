// client/src/market/marketErrors.ts -- REQ-0064: maps the market
// service's structured 409/4xx reason vocabulary (threaded through as
// ApiError.reason by server/routes/market.cjs's sendMarketError, same
// convention as schedule/errors.ts) to an i18n key, so every failure is
// rendered in the mock's voice rather than as a raw code. Mirrors
// schedule/errors.ts's "check error.reason FIRST" posture.
import { ApiError } from '../api';
import type { TranslationKey } from '../i18n';

/** Every 409/4xx reason string server/services/market.cjs can throw,
 * mapped to its market.* i18n key. Buy reasons: already_settled /
 * not_active / expired / self_buy / item_gone / suspended /
 * insufficient_balance / warehouse_full. Create-listing reasons:
 * deployed / already_listed (+ a 400 for a bad price/tm/qty, which
 * carries no reason -> the generic fallback). */
const REASON_KEY: Record<string, TranslationKey> = {
  already_settled: 'market.err.alreadySettled',
  not_active: 'market.err.notActive',
  expired: 'market.err.expired',
  self_buy: 'market.err.selfBuy',
  item_gone: 'market.err.itemGone',
  suspended: 'market.err.suspended',
  insufficient_balance: 'market.err.insufficientBalance',
  warehouse_full: 'market.err.warehouseFull',
  deployed: 'market.err.deployed',
  in_use: 'market.err.inUse', // REQ-0198 (C): board-/preset-referenced instance
  already_listed: 'market.err.alreadyListed',
};

/** The i18n key for an error thrown by a market call, preferring the
 * structured reason. Non-ApiError / reasonless errors fall back to a
 * generic "the hearth could not..." key. Returns the KEY (not the
 * translated string) so callers can t() it with their own locale. */
export function marketErrorKey(err: unknown): TranslationKey {
  if (err instanceof ApiError && err.reason && REASON_KEY[err.reason]) {
    return REASON_KEY[err.reason];
  }
  return 'market.err.generic';
}

/** True when the error is the specific 409 whose dedicated modal body
 * the BUY flow shows (race/full/poor/suspended each get their own
 * mock-designed panel); everything else uses the generic message line. */
export function buyReasonOf(err: unknown): string | null {
  return err instanceof ApiError && typeof err.reason === 'string' ? err.reason : null;
}
