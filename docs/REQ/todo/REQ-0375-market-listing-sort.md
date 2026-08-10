# REQ-0375 — Market buy pane: sort controls + scale-ready listing render

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Finding P1-6.

## Problem (gamer-facing)
The buy pane offers search (No./name) and category chips — and that is all:
no price sort, no newest sort, no pagination or windowing
(`client/src/market/BuyPane.tsx`, verified by grep: no sort/slice/paging
logic). With the bot fleet (50 players, REQ-0329) and public co-op growing
listing volume, the hearth becomes an unordered wall exactly when players
start comparison-shopping — the moment a market UI must answer "cheapest
first".

## Spec
1. Sort control on the buy pane: price ascending / price descending / newest.
   Newest needs listing age on the wire — age already exists for own listings
   (`market.mine.dayN`); confirm the buy-view DTO carries createdAt (extend
   `shared/dto.ts` + the views service if not).
2. Scale-ready render: incremental display ("show more" batches of 50 or
   windowed list) so a many-hundreds payload cannot jank the pane. Server-side
   pagination is explicitly NOT this REQ (payload stays the full list);
   record the listing-count threshold at which server paging becomes its own
   REQ.
3. Sort choice persists per session (module state is fine); default = newest.
4. i18n en/ja for the control labels; chips/search/selectors unchanged.

## Gates
- e2e: three listings at ᚠ5/ᚠ1/ᚠ9 → price-asc renders 1,5,9; newest puts a
  just-created listing first; a 200-listing fixture renders and stays
  responsive (reuse the perf-gate conventions, REQ-0230 lineage).
- api_test only if the DTO grows. CI green.

## Out of scope
Server pagination, price-history charts, buy-side filters beyond today's
chips, watchlists.
