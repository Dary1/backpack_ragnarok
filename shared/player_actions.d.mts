// shared/player_actions.d.mts -- REQ-0310: the typed surface of
// shared/player_actions.mjs.
//
// Hand-written, same reason and same precedent as placement.d.mts beside it:
// one source, consumed unforked by the client (TS/Vite, moduleResolution
// bundler maps .mjs -> .d.mts) and by node (which ignores this file).
//
// The wire payloads come from ./dto.ts -- shared/ importing shared/ is the one
// direction the charter allows. Nothing here reaches into client/src/api.
import type { Cell, EngineInstance, GameState } from './engine.d.ts';
import type { ApiContentPayload, ApiStarterUnits, ApiWarehouseBp } from './dto.ts';
import type { RolledBpLike } from './placement.mjs';

/** Mirrors client/src/store/core.ts's Locale. Declared here rather than
 * imported so shared/ keeps pointing inward. */
export type Locale = 'en' | 'ja';

/** A rolled BP plus the pack's bonus slots. The client's ApiRolledBp satisfies
 * this structurally. */
export interface GachaRolledBp extends RolledBpLike {
  /** REQ-0062: the pack's rolled bonus-slot items (absent for the Common pack). */
  bonuses?: Array<{ pool: 'po' | 'si' | 'tm'; id: string; uid: string; qty?: number }>;
}

/** The POST /api/warehouse/claim response body, structurally. */
export interface ClaimedWarehouseRow {
  /** REUSED VERBATIM as the placed item's uid -- this IS the finalize contract. */
  itemUid: string;
  itemId: string;
  kind?: 'tm' | 'bp';
  qty?: number;
  bp?: ApiWarehouseBp;
}

export interface GachaOptions {
  /** Injected so the transition stays goldenable; defaults to
   * defaultRefundUidMinter (`'lrdst_refund_' + Date.now()`). */
  mintUid?: () => string;
}

export type GachaResult =
  | { ok: true; state: GameState; page: number; origin: Cell; cells: Cell[] }
  | { ok: false; reason: 'insufficient_lrdst'; state: GameState }
  /** `refunded:false` means the cost was deducted and could NOT be returned --
   * see REQ-0310 section 9.1(3). */
  | { ok: false; reason: 'no_space'; state: GameState; refunded: boolean };

export type ClaimResult =
  | { ok: true; state: GameState; kind: 'po' | 'si' | 'tm' | 'bp'; page: number; cells: Cell[] }
  | { ok: false; reason: 'no_space'; state: GameState };

export function itemKindOf(defs: ApiContentPayload | null, itemId: string): 'po' | 'si';

export function defaultRefundUidMinter(): string;

export function applyGachaRoll(
  engine: EngineInstance,
  state: GameState,
  rolled: GachaRolledBp,
  cost: number,
  openPage: number,
  opts?: GachaOptions
): GachaResult;

export function applyWarehouseClaim(
  engine: EngineInstance,
  state: GameState,
  claimed: ClaimedWarehouseRow,
  defs: ApiContentPayload | null,
  openPage: number
): ClaimResult;

export function buildStarterUnitsState(
  gameData: { starterUnits?: ApiStarterUnits | null },
  locale: Locale
): GameState | null;
