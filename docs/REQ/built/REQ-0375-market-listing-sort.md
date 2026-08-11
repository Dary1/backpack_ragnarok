# REQ-0375 — Market buy pane: sort controls + scale-ready listing render

## Status
built — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.
Built 2026-08-11 (Cowork session, worktree req-0375-market-listing-sort).
NOT merged, NOT deployed, NOT accepted.

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

## Build decisions (recorded at build time, 2026-08-11)
- DTO: **no change was owed.** `ApiMarketListing.createdAt` already exists
  (shared/dto.ts) and `server/services/market/views.cjs` already emits it
  (`toListingDto`), and that file's `listListings` already sorts
  createdAt-descending as its last step. So spec 1's "confirm the buy-view DTO
  carries createdAt (extend it if not)" resolved to *confirm* — hence no
  api_test, per the Gates' own condition ("api_test only if the DTO grows").
  The pane still re-sorts client-side rather than leaning on that server
  default, so the displayed order is the PANE's contract and cannot silently
  change if the server's default ordering ever moves.
- RENDER MODE (spec 2 offered either): **"read N more" batches of 50**, chosen
  by the user in chat 2026-08-11. Reasons recorded: the existing `.market-grid`
  is a CSS `auto-fill` multi-column grid, which a windowed list would have to
  fight with row-height measurement; and a batch reveal keeps the DOM equal to
  what the player was told is there, which is what makes the gate assertable
  (`toHaveCount(50)`) instead of viewport-dependent.
  `shown` resets on a sort/chip/query change but deliberately NOT on a
  `listings` refresh -- the post-buy `refreshAfterServerMutation` would
  otherwise yank a deep-scrolled browser back to the top. (MarketPage passes no
  `intervalMs` to usePolledResource, so browse is fetched per visit, not polled.)
- SORT PERSISTENCE (spec 3): module-scope `sessionSort` in BuyPane.tsx, chosen
  by the user in chat 2026-08-11. MarketPage renders exactly one pane, so the
  pane unmounts on every tab switch and component state alone would forget the
  choice; module scope is the smallest thing that survives that and dies with
  the tab. Deliberately NOT `sortie/sortiePrefs.ts` (REQ-0371): that precedent
  buys DURABILITY by riding the persisted canvas through the one auto-save PUT
  writer, a cost this spec's "per session" does not ask for. Both directions
  are pinned by e2e (survives a pane switch; gone after a reload).
- MULTI-TM PRICE ORDER (REQ-0195a, not raised by the spec): prices can be
  carved in different TMs and law 1 ("barter in kind -- no abstract coin
  exists") leaves no exchange rate that would make a cross-TM comparison
  meaningful. Primary key is therefore the raw carved qty (the honest reading
  of "cheapest number first"), with the TM id as secondary key so same-priced
  listings of one currency stay contiguous rather than interleaved, and
  createdAt/id last for determinism. A real cross-TM ordering needs a rate the
  game deliberately does not have; that would be its own REQ, not a silent
  fudge here. Latent today (only 'lrdst' is live).

## Server-paging threshold (spec 2's required record)
Client render cost is now bounded by the 50-card batch regardless of payload
size, so the trigger is a WIRE + parse cost, not a render one. A representative
active PO listing DTO (3 tags, ja name, dexNo, rollPct, priceHistory) measures
520 B with an empty priceHistory, 684 B at 3 history entries, 959 B at 8
(measured 2026-08-11 by serializing the `toListingDto` shape).

**Server-side pagination becomes its own REQ when the market-wide
active+suspended count passes 1,000, or the browse payload passes 1 MiB
uncompressed — whichever comes first.** At 1,000 listings the browse response
is ~0.50–0.91 MiB and every market visit fetches all of it. Re-measure at the
trigger rather than trusting these figures: priceHistory length is the term
that grows fastest, and it grows with trade volume, not listing count.
Observe with `GET /api/market/listings` (default filter = active + suspended).

## Gate results (2026-08-11, worktree req-0375-market-listing-sort)
- e2e `market.spec.ts` "REQ-0375 SORT": PASS. Three listings carved in the
  order ᚠ5 → ᚠ1 → ᚠ9 (so the newest order and both price orders disagree with
  the carve order and with each other): price-asc renders 1,5,9; price-desc
  renders 9,5,1; the default is newest and renders 9,1,5; the choice survives a
  buy→mine→buy pane switch and is gone after a document reload; a fourth
  listing carved afterwards leads under newest. Order is asserted RELATIVE to
  this test's own uids -- a hermetic fleet worker is shared by every spec file
  it is handed, so an absolute market-wide order/count is not a valid
  invariant (see the incidental fix below).
- e2e `market.spec.ts` "REQ-0375 SCALE": PASS. A stubbed 200-listing browse
  payload (the warehouse-mjolnir.spec `page.route` precedent; seeding 200 real
  listings would be 400 round trips for a payload whose SHAPE is the point)
  mounts exactly 50 cards, the shown/total note reads 50 of 200, price-asc
  brings the cheapest listing (the LAST card of the newest order) to position
  1 while still mounting 50 -- proving the sort spans the full list, not the
  mounted batch -- "read more" reveals 100/150/200 and then retires itself.
  Timing: best-of-3 wall clock for a sort switch against a [TUNABLE 1500ms]
  budget, the REQ-0230 shape; the structural assertions are the load-bearing
  ones, deliberately, because a wall clock measures the box.
- api_test: not owed (no DTO growth -- see Build decisions).
- i18n: en/ja added for all six new keys; parity gated at the i18n barrel.
- Full `tools/ci.sh`: **CI GREEN** (315s, scope=public — the diff touches no
  admin surface, so [6.5/8] admin trio and [6.6/8] registry-first self-skipped
  per REQ-0339/REQ-0238; 238 e2e passed / 0 failed / 1 skipped). Receipt tree
  854ebe64a7acdd9a67eee61e667782f3f3df42f5.
- Re-gated twice more as master moved under this branch (REQ-0371 docs, then
  REQ-0376): CI GREEN on the master-merged tree 423e0ac7 (281s), and again on
  the tree that actually became master — see the Outcome section.

## Incidental fix (found by this REQ's full-suite run, kept in the same commit)
The full run failed `market.spec.ts:166` with *expected 2, received 3*. Cause:
a hermetic fleet worker is handed several spec FILES in sequence and they share
its api and data, and `input-conventions.spec.ts` (REQ-0369, merged 2026-08-10)
creates a market listing and never withdraws it. `market.spec.ts`'s browse test
asserted an absolute market-wide card count, which was only ever true while it
happened to draw its worker first. Reproduced twice on the full suite, green in
every subset run — exactly the shape that gets mislabelled a flake.
Fixed on both sides, per ci.sh's own rule that a red is a defect or a stale
gate and neither is to be memorized (REQ-0159): input-conventions.spec.ts now
withdraws its listing in `afterEach` (the warehouse-sell.spec.ts convention
since REQ-0366), and market.spec.ts's browse test asserts its own two seeded
cards plus the search's include/exclude rather than a global count.
`board-render-ondemand` also went red once on an unlocked full-suite run at
load average 20–28 (three concurrent CI sessions on the box) and did NOT
reproduce: it passes in isolation and passed in every locked CI GREEN run —
the REQ-0230 contention class, no action taken.

**Second cross-spec leak, found at merge time (2026-08-11).** After merging
REQ-0376 (which adds `hall-guidance.spec.ts` and so redeals the file→worker
distribution), the merged tree went red on `sortie-prefill.spec.ts` (REQ-0371):
the launch button never enabled. Not contention — reproduced every time with
`playwright test market.spec.ts sortie-prefill.spec.ts` on ONE worker, and
still reproduced with this REQ's own tests excluded (`--grep-invert REQ-0375`),
i.e. pre-existing between REQ-0064 and REQ-0371 and merely re-dealt onto the
same worker. Probed the worker's dev profile after the market file: board
empty, all ten squad presets null — `devBuyerCanvas`, still there. Mechanism:
`store/autosave.ts` debounces 800ms and also flushes on pagehide, so
market.spec.ts's `afterEach` restore PUT was being overwritten by the market
app's OWN last save; sortie-prefill then found squad 0 empty and could not
muster it. Fixed at the source: the restore now tears the page down to
`about:blank` first (an unmounted app cannot race it) and verifies by reading
the canvas back, retrying the PUT rather than sleeping. Same command green
afterwards, 21/21.

## Out of scope
Server pagination, price-history charts, buy-side filters beyond today's
chips, watchlists.

## Files
- `client/src/market/BuyPane.tsx` — sort defs/comparators, `sessionSort`,
  `BUY_PAGE_SIZE`, the toolrow selector, the windowed grid + reveal footer.
- `client/src/i18n/market.ts` — `market.buy.sort*` / `showMore` / `shownOf`
  (en + ja).
- `client/src/styles/market.css` — `.market-sort`, `.market-more`, and their
  narrow-viewport rules.
- `client/e2e/market.spec.ts` — the REQ-0375 describe + the browse-test
  hardening.
- `client/e2e/input-conventions.spec.ts` — listing teardown.
- `web/app/` — committed dist rebuild (the deploy unit).
