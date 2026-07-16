# REQ-0195d — market-unit-listings: unit (BP) instances on the market

**Phase of REQ-0195 (see REQ-0195a §4; §4.2/4.3 unit rows).**
**Ratified:** 2026-07-16 (user directive).
**Depends on:** REQ-0195a.

## Scope
- Server: kind:'unit' listings — inventory pages[].bps[] eligibility; EMPTY-only (nested pos[]/sis[] within its footprint -> 409 {reason:'not_empty'}); deployed -> suspended; gone -> auto-withdraw; settle strips the bps[] entry and delivers a NEW warehouse row kind:'bp' carrying the full instance payload `bp` (shape/unit/hpMax/cellCount/bonuses/roll — verbatim, never re-rolled); claimWarehouseItem validates payload.unit.id against unitDefsById and returns the payload.
- shared/dto.ts: ApiWarehouseItem += kind 'bp' + bp payload.
- Client: SellPane unit tab (unit name/icon via unitDefsById); WarehousePage/WarehouseTab claim places kind:'bp' rows via lib/placement firstFitPlaceBp (the Workshop's own path); BuyPane/MinePane cards.
- Tests: server suite (empty-check 409, payload round-trip, claim validation) + e2e unit listing bought and claimed onto the canvas.

## Status log
- 2026-07-16 split from REQ-0195 while in todo/.
- 2026-07-16 implemented + committed. Server (20ea324): kind:unit listings
  (findInventoryBP eligibility, EMPTY-only bpHasContents -> 409 not_empty,
  unit.id validation, deployed->suspended, gone->auto-withdraw), settle strips
  the bps[] entry + delivers a kind:bp warehouse row with the verbatim BP
  payload (never re-rolled), claimWarehouseItem validates payload.unit.id and
  returns it. Client (ab44199): SellPane Units tab, MarketThumb unit icon,
  warehouse claim places kind:bp via firstFitPlaceBp (+ verbatim-field
  restore), i18n kindUnit EN/JA. Gates: server api_test 181 passed / 0 failed
  (files backend, incl. the new unit BP suite); server tsc (tsconfig.server.json)
  clean; client tsc -b + vite build clean. e2e: unit browse+buy authored
  (content-agnostic, discovers a live unit id) -- not executed here (the default
  e2e suite targets the LIVE services owned by the main checkout; same posture
  as phases a-c). todo -> built.
- 2026-07-16 (orchestrator review) market e2e EXECUTED against the isolated
  worktree fleet -- 14/14 passed (the original 13 + a new content-bound
  kind-chips case for review fix F1); tools/ci.sh SKIP_PG=1 SKIP_E2E=1 => CI
  GREEN; server api_test 183 passed / 0 failed (files backend). This CORRECTS
  the earlier "e2e authored but not executed / would hit the LIVE services"
  note(s) above: tools/e2e_fleet.cjs spawns THIS worktree's server/api.cjs under
  isolated /tmp homes and the local-proxy serves THIS worktree's web/app build,
  so the specs run the worktree code, not live services.
- 2026-07-16 (orchestrator review) review-fix commits this session: 80b774c
  (F1 browse filter/query resolve defs per kind + kind chips), 1207134 (F2/F3/F4
  PriceTag currency label + skip unit-less BPs + reset tm sell form), ec4c86b
  (F5 stale envelope docs -> v2 tms[]), 8744310 (F1 kind-chips e2e).
