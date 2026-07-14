// client/src/api/workshop.ts -- REQ-0145b (ca): Workshop gacha
// endpoints (extracted VERBATIM from the old flat api.ts).
import { scheduleJSON } from './http';

// ---- REQ-0042: Workshop gacha ----

/** A freshly-rolled gacha result -- server/services/gacha.cjs's rollPackBp()
 * output shape, echoed verbatim in the POST /api/workshop/gacha response.
 *
 * REQ-0170: what a roll produces is a UNIT (a character from the pack's pool)
 * plus the BP that is its inventory. `unit` is what gets PERSISTED on the BP
 * (identity + seat, nothing else); `unitDef` is a read-only echo of the def for
 * the result modal -- the def itself is re-read from /api/content on every boot,
 * so nothing here is a second source of truth. The retired `linker:{off,dirs}`
 * (rolled beams, no identity) is GONE and has no successor field. */
/** REQ-0062: one rolled bonus-slot item, echoed alongside the guaranteed BP. `def`
 * is a read-only echo for the result modal; only `id`/`uid`/`qty` are persisted when
 * the client first-fit-places the bonus into inventory. */
export interface ApiRolledBonus {
  slot: number;
  pool: 'po' | 'si' | 'tm';
  id: string;
  uid: string;
  qty: number;
  def?: { id: string; name: string; icon: string; rarity?: string; i18n?: { ja?: { name?: string } } };
}

export interface ApiRolledBp {
  uid: string;
  shape: Array<[number, number]>;
  unit: { id: string; off: [number, number] };
  hpMax: number;
  cellCount: number;
  unitDef?: {
    id: string;
    name: string;
    icon: string;
    rarity: string;
    connection_shape: string;
    i18n?: { ja?: { name?: string; flavor?: string } };
  };
  /** REQ-0062: the pack's rolled bonus-slot items (empty/absent for the Common pack). */
  bonuses?: ApiRolledBonus[];
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
export function rollWorkshopGacha(kind: string = 'common_bp'): Promise<{ ok: true; cost: number; rolled: ApiRolledBp }> {
  return scheduleJSON('/api/workshop/gacha', { method: 'POST', body: JSON.stringify({ kind }) });
}
