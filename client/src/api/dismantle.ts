// client/src/api/dismantle.ts -- REQ-0145b (ca): Dismantle System
// endpoints (extracted VERBATIM from the old flat api.ts).
import { scheduleJSON } from './http';
import type { ApiDismantleLedgerResponse, ApiDismantleResponse } from '../../../shared/dto';

// ---- REQ-0063: Dismantle System client API ----
// Talks to server/routes/dismantle.cjs. postDismantle removes the given
// inventory PO/SI server-side (RULE-5 sanctioned direct-canvas removal)
// and returns the real yield + updated ledger numbers -- callers MUST
// follow a successful call with the store's loadGame() to pull the
// authoritative post-removal canvas (see DismantlePanel.tsx's module
// comment for why: same auto-save race MarketPage.tsx's buy flow guards
// against).
export function postDismantle(itemUid: string, kind: 'po' | 'si'): Promise<ApiDismantleResponse> {
  return scheduleJSON('/api/dismantle', { method: 'POST', body: JSON.stringify({ itemUid, kind }) });
}

/** The caller's own full 分解値 ledger (every id ever dismantled, with
 * its cumulative count + current suppression). Backs DismantlePanel's
 * per-item preview numbers. */
export function fetchDismantleLedger(): Promise<ApiDismantleLedgerResponse> {
  return scheduleJSON('/api/dismantle/ledger');
}
