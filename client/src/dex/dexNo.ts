// Honest 1-based dex numbering — REQ-0075. The mock's catalog cards and
// detail header show a "No.061" chip. shared/dto.ts's ApiMarketListing
// documents `dexNo` as the item's "1-based position in
// content/live/live_items.json (v1 dex numbering; null = not in the dex,
// e.g. pilot-only items)" -- so the number is NOT invented, it is the
// PO's ordinal in the content items map (JS object insertion order, which
// mirrors the JSON file order the server loads).
//
// Only POs (content.items) carry a dex number -- SIs (socket items) and
// TMs (transmutators) are not part of the v1 dex numbering per that same
// DTO field's contract, so they get no chip (dexNoOf returns a map that
// simply lacks their ids -> the caller renders the kind tag instead). No
// server round-trip: derived client-side from the /api/content payload the
// Dex already has, so this stays correct with zero new endpoint (the real
// per-item dexNo over the wire is REQ-0052/REQ-0064's market API, still
// queued -- see docs/REQ-0075-redesign-dex.md).
import type { ApiContentPayload } from '../api';

/** Maps each PO item id -> its 1-based position in content.items. SIs/TMs
 * are intentionally absent from the returned map (not in the dex
 * numbering). */
export function dexNoOf(payload: ApiContentPayload): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  for (const entry of Object.values(payload.items)) {
    n += 1;
    out[entry.id] = n;
  }
  return out;
}
