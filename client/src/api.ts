// Typed API client — REQ-0026 T0.1.
// Talks to server/api.cjs: GET /api/content, GET/PUT /api/profile/:id/canvas.
// Mirrors the ACTUAL live response shapes (inspected via
// `curl https://backpack-dev.qtie.jp/api/content` and .../profile/default/canvas
// during T0.1 implementation) -- not a guess from the spec doc. The
// normalization from raw wire payload -> engine-ready GameData is a direct
// TypeScript port of mock-src/ui.js's gameDataFromApiContent(): same fields,
// same defaulting rules, now typed. This is glue/data-shaping code, not
// engine logic -- Engine.create() itself is untouched (see engine/adapter.ts).
//
// REQ-0037: token-based guest auth. A token minted by an operator's
// invite link (server/cli_invite.cjs) is stored in localStorage (see
// TOKEN_STORAGE_KEY below) and attached as X-Auth-Token on every request
// that supports it (authHeaders()). No token stored -> no header sent at
// all, which the server treats as "dev_mode fallback" (see
// docs/REQ/REQ-0037-guest-auth.md) -- the client does not special-case
// "no token" beyond simply not sending the header.
//
// REQ-0145b (ca): this file is now a BARREL. The implementation lives in
// src/api/ (http / content / profile / dex / dismantle / schedule /
// warehouse / workshop / market / ragnarok / admin), split by domain so
// feature REQs stop colliding in one flat file. The re-exports below
// reproduce the old flat module's public surface EXACTLY (verified by
// scripts/dump_module_exports.mjs parity at the split commit) -- no
// consumer import path changes. EXTEND THE DOMAIN MODULES, NOT THIS
// FILE: a new endpoint belongs in the matching src/api/*.ts (or a new
// domain module re-exported here), never appended below.

export { TOKEN_STORAGE_KEY, getStoredToken, setStoredToken, clearStoredToken, ApiError } from './api/http';
export * from './api/content';
export * from './api/profile';
export * from './api/dex';
export * from './api/dismantle';
export * from './api/schedule';
export * from './api/warehouse';
export * from './api/workshop';
export * from './api/market';
export * from './api/ragnarok';
export * from './api/admin';

// ---- wire-shape DTO types: moved to shared/dto.ts (REQ-0047 (f2)) ----
// Re-exported so every existing `import type { ... } from './api'` keeps
// working (the ragnarok dto block rides src/api/ragnarok.ts the same way).
export type { ApiMarketPrice, ApiMarketPriceHistoryEntry, ApiMarketListing, ApiMarketListingsResponse, ApiMarketCreateListingRequest, ApiMarketListingResponse, ApiMarketBuyReceipt, ApiMarketBuyResponse, ApiMarketFurnaceResponse, EffectAst, ApiSocketDef, ApiPortDef, ApiI18nMap, ApiItemEntry, ApiSIEntry, ApiTmEntry, ApiTrees, ApiScenario, ApiRegistryBatch, ApiRegistry, ApiVocabLists, ApiContentPayload, ApiCanvasDoc, ApiErrorBody, ApiMe, AdminPutResult, AdminPutError, ApiCancelPolicy, ApiRoomSlot, ApiPendingSwap, ApiRoom, ApiRoomLastRun, ApiCreateRoomBody, ApiSortieBody, ApiRunEvent, ApiRunView, ApiRunRoster, ApiRunRosterSlot, ApiRunRosterEnemy, ApiSealMeta, ApiSealMintResponse, ApiSealMetaResponse, ApiSealEncounter, ApiSealTimeline, ApiSealParticipant, ApiSealComparison, ApiSealReplay, ApiDungeonEntry, ApiDungeonTypeEntry, ApiFormationEntry, ApiDungeonsPayload, ApiForecastProfile, ApiForecastPayload, ApiWarehouseItem, ApiDexCardDto, ApiDismantleResponse, ApiDismantleLedgerEntry, ApiDismantleLedgerResponse } from '../../shared/dto';
