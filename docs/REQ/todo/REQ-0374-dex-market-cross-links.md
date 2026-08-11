# REQ-0374 — Cross-links: wire the dex market block + close the loop CTAs + player-vocabulary copy

## Status
built — gates green on branch `req-0374-dex-market-cross-links` (2026-08-11);
NOT merged, NOT deployed, NOT accepted. Spec by Cowork session 2026-08-10
(gamer-lens UI gap analysis batch); ratified by user 2026-08-10, chat:
「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Findings P1-5 + P1-8.

## Problem (gamer-facing)
1. The dex detail's "Market Engravings" block is a PERMANENT empty state:
   anchor renders a literal "—" and the listing count is hardcoded 0 — the
   REQ-0075 comment in `client/src/dex/ItemDetailCard.tsx:210-216` admits no
   dex-facing feed was wired. The market meanwhile OWNS real anchor data
   (`market.sell.anchor` renders it on the sell pane). A reference block that
   always says "no data" is worse than absent. Its "View in the market"
   button also jumps to `#/market` unscoped, losing the item.
2. The buy-done modal says the goods went to the vault but offers no way
   there (`market.buy.doneBody` — no link).
3. Inventory-full failures (`schedule.warehouse.claimNoSpace`,
   `schedule.warehouse.capFull`) name the problem but offer no path to fix it.
4. Workshop copy leaks implementation: 'workshop.ruleTwoPhase' /
   'workshop.rollResultNote' explain "two-phase … finalized by the auto-save"
   — internals that read as "your item might not be final", the opposite of
   reassurance.

## Spec
1. Wire the dex market block: real anchor + real active-listing count for the
   viewed item (server: expose per-item anchor/count — the market views
   service already computes anchors; add a lean read endpoint or fold into
   the dex payload), and make "View in the market" open the buy pane
   pre-filtered to that item (the search-by-dex-No path already exists:
   `market.buy.dexBound`).
2. Buy-done modal gains an "Open warehouse" button (hash route).
3. claimNoSpace / capFull surfaces gain an "Organize inventory" link →
   backpacks inventory (REQ-0373's arrange button is the landing affordance
   when present).
4. Rewrite the two-phase copy in player vocabulary (en+ja), e.g. "Yours for
   good once you place it in the Backpacks hall." No mechanics change; keys
   may rename (i18n barrel parity gate).

## Gates
- e2e: dex item with a settled trade shows its anchor; "View in the market"
  lands filtered to that item; buy → done → Open warehouse arrives; full
  warehouse claim failure shows the organize link.
- grep: no player-facing workshop string mentions auto-save/two-phase.
- api_test for any new/extended endpoint, both backends. CI green.

## Out of scope
Price-history charts (REQ-0377 item), watchlists/favorites, warehouse sort.

---

## Execution (2026-08-11, Cowork session; branch `req-0374-dex-market-cross-links`)

### Decisions

**D1 — a lean market endpoint, not a fold into the dex payload.** The spec
allowed either. The dex DETAIL pane is rendered from `/api/content` (not from
`/api/dex/card/:kind/:id`, which only the card subwindow fetches), so folding
the numbers into the card DTO would not have reached the block at all, and
folding them into `/api/content` would put per-player-visible market state
inside the mtime-cached content payload. `GET /api/market/dex/:itemId` lives
where the data lives: `services/market/views.cjs`'s `dexMarketInfo`, behind
both market facades (`server/services/market.cjs`, `server/market.cjs` — rule
3), wire shape `ApiMarketDexInfo` in `shared/dto.ts`.

**D2 — `activeCount` is the BROWSE set (active + suspended), not stored-active.**
The block's own button lands the player on the default browse, filtered to this
item. Any other counting rule prints a number the destination page immediately
contradicts. The api_test asserts this as a derived invariant (`activeCount ==
the browse count for that itemId`) rather than a hardcoded number, so a future
divergence fails in CI instead of shipping.

**D3 — the anchor reuses `priceHistoryFor`.** The settled-price history is
already the DTO's `priceHistory`; computing "the anchor" a second way is how
the sell pane and the dex block would eventually disagree.

**D4 — auth: the market family's own preamble, unchanged.** The answer is
caller-independent, but this route does not become the one anonymous surface in
the market just because its consumer sits on a content page. A client that
cannot resolve keeps REQ-0075's empty state (see D5).

**D5 — degradation IS the old behaviour.** A failed/unresolved fetch renders
exactly REQ-0075's dashed empty state. The block that used to always say "no
settlements" now says it only when true or when the market is unreachable; it
never invents a number. The block moved into `client/src/dex/DexMarketBlock.tsx`
so `ItemDetailCard` stays a pure projection of an already-loaded entry, and
re-reads by remounting (`key={dexEntry.id}` — `usePolledResource` loads once per
mount by design).

**D6 — the deep link carries a market QUERY, not an id.**
`#/market?buy=<query>` (`MARKET_BUY_HASH_RE`, `marketBuyFocus`) is the BUY-side
twin of REQ-0198's `#/market?sell=<uid>`. It reuses the market's own search
grammar (Dex No. exact-match, else EN/JA name substring — `views.cjs`'s
`matchesQuery`, mirrored in `BuyPane`) rather than adding a second
item-addressing scheme to the market. MarketPage resets the chip to `all` when
consuming it: chip and query are ANDed, so a stale chip could otherwise empty
the grid the deep link just filled.

**D7 — which surfaces get the organize CTA.** The full-warehouse banner (not
the milder `capWarning` — nothing is being asked of the player yet), the
no-space claim toast, and the per-row error line (the toast self-clears after
4s; the row line does not, so it is where a player who looked away still finds
it). `useWarehouseData` grew a `toastAction` field rather than a richer toast
value, because `toast` is a plain string every other call site sets directly.

**D8 — workshop key renamed.** `workshop.ruleTwoPhase` -> `workshop.ruleReceipt`
(it named the internal, not the rule). `workshop.rollResultNote` keeps its name.
en+ja rewritten; no mechanics change; barrel parity holds (both locales edited
in the same module).

### Amendment to the spec
Spec item 3 named `claimNoSpace` and `capFull`. The per-ROW claim error line
carries the same message as the toast and outlives it, so it got the link too —
three surfaces, not two.

## Gate results

`tools/ci.sh` on `req-0374-dex-market-cross-links` @ `0dd9991f`, 2026-08-11:
**CI GREEN** (385 s, scope `both`, receipt tree `669d64e5`).

- **api_test, both backends**: 238 passed / 0 failed each (files 2066 executed
  assertions, pg 2067; REQ-0145a parity tally). Two new tests in
  `server/tests/api/market.cjs`:
  - the anchor equals the stored engraving head (asserted against
    `readMarketDexHistory`, not recomputed), the wire anchor is the DTO history
    shape, `activeCount` equals the default browse count for the item, an
    unknown id is `200 {anchor:null, activeCount:0}`, non-GET is 405;
  - a SUSPENDED listing still counts, proved by a reversible board reference
    with the un-reference in a `finally` (a leaked reference would suspend that
    listing for every later group — the REQ-0159 cross-test leak class).
- **e2e ([7/7], 239 passed)**: `REQ-0374 DEX: ... anchor + on-hearth count, and
  "View in the market" lands on the BUY pane filtered to that item`;
  `REQ-0374 BUY: the done modal offers the warehouse ... and it lands there`;
  `REQ-0374: an inventory-full claim failure offers the way out`. Admin trio
  [6.5], registry-first [6.6] and signed-out [6.7] all green.
- **grep gate**: no player-facing workshop STRING mentions auto-save/two-phase —
  `grep -n "^\s*.workshop\..*:" client/src/i18n/workshop.ts | grep -i
  "auto-save\|two-phase\|二段階\|自動保存"` returns nothing. (The only remaining
  matches in that file are the code comments recording what the copy used to
  say, which is the point of keeping them.)
- **Client typecheck + build** green; `web/app/` dist rebuilt in the code commit
  (the e2e serves this worktree's own `web/`).

### Reds found and fixed on the way (both stale gates, not defects)
CI's first [7/7] on this branch failed twice, both cross-spec state leaks that
had gone latent only because the scheduler had never paired the leaking spec
with its victim; adding tests changed spec runtimes and the pairing changed.
Fixed in `0dd9991f`, not memorized (REQ-0159):
1. `market.spec.ts`'s exact browse counts vs. a listing leaked by REQ-0369's
   `input-conventions.spec.ts` — exactly the failure `devClearAllListings`'s doc
   comment predicted in writing. That file now clears the hearth in `beforeEach`;
   the leaking spec now cleans up after itself.
2. `sortie-prefill.spec.ts` asserts "fresh profile" but never established one —
   a predecessor's presets-less fixture canvas made `assertSeatAllowed` 400
   "squadIndex out of range for this player" while the client showed five
   perfectly launchable squads. It now re-seeds the worker's own `e2e_ci`
   fixture and pre-clears rooms/recruiting troops.

## Build
- `838c9121` — implementation (server endpoint + facades + DTO, DexMarketBlock,
  `#/market?buy=` route, buy-done warehouse CTA, organize CTAs, workshop copy,
  api_test + e2e coverage, dist rebuild).
- `0dd9991f` — e2e hygiene (the two stale gates above).

## Outcome
Built on branch `req-0374-dex-market-cross-links`. NOT merged, NOT deployed,
NOT accepted. Out-of-scope items unchanged: price-history charts (REQ-0377),
watchlists/favourites, warehouse sort.
