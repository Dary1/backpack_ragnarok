# REQ-0374 — Cross-links: wire the dex market block + close the loop CTAs + player-vocabulary copy

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

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
