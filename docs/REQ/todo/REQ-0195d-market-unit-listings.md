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
