# REQ-0328 — Sell a drop DIRECTLY from the warehouse to the market (+ player UI)

- **State**: reserved. Program: Reactive Test-Play Fleet (owner spec items 8-9).
- **Depends on**: nothing structurally (market + warehouse exist). **Blocks**: REQ-0330.

## Truth (owner, 2026-07-28)
> 8. On notification, the bot lists ALL its drops straight onto the market.
> 9. If there is no way to do 8 directly from the warehouse, implement it (a
>    player-facing UI is also required).

## Current state (surveyed)
- **There is NO direct path.** Market listing requires the item to occupy a cell in
  the SELLER'S INVENTORY (canvas): `services/market.cjs:29` "the listing occupies a
  cell in the seller's inventory while listed"; `createListing` reads from the
  canvas. Rewards land in the WAREHOUSE and require the two-phase CLAIM
  (`services/warehouse.cjs:226` -> place -> PUT) to reach the canvas first.
- So today "sell a drop" = claim to canvas, then list — two steps, and it needs free
  inventory cells. Item 9 therefore applies: build a direct warehouse->market path.

## What to build
### Server
- `POST /api/market/listings/from-warehouse { warehouseRowId, price }` (or extend
  `createListing` with a `source:'warehouse'`): atomically consume the CLAIMABLE
  warehouse row and create an active listing WITHOUT routing through the seller's
  canvas/inventory. The item's home while listed is the listing itself, not a canvas
  cell (this is the new case — a listing whose provenance is a warehouse row, not a
  deployed/undeployed canvas item).
- Reuse existing pricing/validation from `market/listings.cjs`; reuse warehouse-row
  consumption from `warehouse.cjs` (mark the row consumed, first-wins, idempotent via
  `Idempotency-Key` like the rest of the market).
- Settlement/withdraw: on withdraw or expiry the item returns to the warehouse (not
  to a canvas), preserving the "never silently lose an item" invariant.
- Bulk helper for item 8: accept an array (or the fleet calls it per row) — the fleet
  needs to dump the WHOLE warehouse. A `POST .../from-warehouse` that accepts
  `rows:[...]` is convenient but optional; per-row is acceptable if rate-safe.

### Client (player UI)
- In the Warehouse screen, add a "Sell" action on a claimable row that opens a price
  prompt and calls the new endpoint — so a HUMAN can sell straight from the warehouse
  too (item 9's explicit UI requirement). Show the resulting listing under My
  Listings.

## Gates / acceptance
- Unit/integration: claimable warehouse row -> `from-warehouse` -> active listing
  exists, row consumed, no canvas mutation, no inventory cell used. Withdraw ->
  item back in warehouse. Idempotency-Key dedupes.
- Client e2e: warehouse "Sell" lists an item end-to-end. `tools/ci.sh` green.
