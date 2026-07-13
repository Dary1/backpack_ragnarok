// client/src/api/workshop.ts -- REQ-0145b (ca): Workshop gacha
// endpoints (extracted VERBATIM from the old flat api.ts).
import { scheduleJSON } from './http';

// ---- REQ-0042: Workshop gacha ----

/** A freshly-rolled common_bp gacha result -- server/schedule.cjs's
 * rollCommonBp() output shape, echoed verbatim in the POST /api/workshop/
 * gacha response. */
export interface ApiRolledBp {
  uid: string;
  shape: Array<[number, number]>;
  linker: { off: [number, number]; dirs: number[] };
  hpMax: number;
  cellCount: number;
}

/** POST /api/workshop/gacha {kind:'common_bp'} -- REQ-0042 two-phase
 * roll (mirrors POST /api/warehouse/claim's two-phase shape, see
 * server/schedule.cjs's startGachaRoll doc). Verifies the caller's
 * LAST-SAVED LRDST balance >= cost server-side and returns the rolled BP
 * definition WITHOUT deducting anything yet -- the caller (WorkshopPage)
 * is responsible for deducting `cost` from its own LRDST stack via
 * engine.spendTM, first-fit-placing the rolled BP, and then letting the
 * normal auto-save (notifyStateChanged()) persist it, exactly like
 * claimWarehouseItem's own doc describes for warehouse claims. Throws
 * ApiError(409) if the balance is insufficient. */
export function rollWorkshopGacha(kind: 'common_bp' = 'common_bp'): Promise<{ ok: true; cost: number; rolled: ApiRolledBp }> {
  return scheduleJSON('/api/workshop/gacha', { method: 'POST', body: JSON.stringify({ kind }) });
}
