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

## Outcome (built 2026-07-28)

Implemented the DIRECT warehouse->market sell path plus the player UI.

### Server
- New endpoint `POST /api/market/listings/from-warehouse { warehouseRowId, price }`
  (`server/routes/market.cjs`). Resolves the caller like every other market
  route, threads the optional `Idempotency-Key`, and returns the same DTO
  envelope as `POST /api/market/listings`.
- `createListingFromWarehouse` (`server/services/market/listings.cjs`):
  reuses createListing's exact price validation + Idempotency-Key replay +
  7-day TTL. Peeks the CLAIMABLE warehouse row via new
  `warehouse.peekClaimableRow` (`server/services/warehouse.cjs`), validates
  the content id + kind, and only THEN consumes the row (`deleteWarehouseItem`)
  -- so a validation failure never strands the item. First-wins is automatic
  (single-threaded synchronous). A tm/currency row is rejected (400
  `unsellable_kind`); a row being claimed -> 409 `claiming`; unknown/expired
  -> 404 (no-leak, reads only the caller's own warehouse).
- The listing carries `source:'warehouse'` and ESCROWS the item on itself
  (kind + itemId, `q` for a po/si, `bp` for a unit). It never occupies a
  seller canvas cell.
  - `deriveView` / `rollPctOf` (`views.cjs`): a warehouse-sourced listing is
    never deploy-suspended and never item-gone; its roll travels on the
    listing.
  - `buyListing` (`trade.cjs`): NO seller-canvas read/write at all -- the
    escrowed item is delivered to the buyer's warehouse and the seller's
    proceeds land as the usual kind:'tm' warehouse row.
  - Withdraw / TTL-expiry (`listings.cjs` `returnEscrowToWarehouse`): the item
    RETURNS to the seller's warehouse as a fresh claimable row (cap-exempt,
    same reasoning as seller proceeds) -- "never silently lose an item".

### Client (player UI)
- `sellFromWarehouse` in `client/src/api/market.ts`;
  `ApiMarketSellFromWarehouseRequest` in `shared/dto.ts`.
- A "Sell" action on each claimable (non-currency) row in the Warehouse
  screen (`client/src/warehouse/WarehousePage.tsx` +
  `useWarehouseData.ts`): opens a price prompt and calls the new endpoint;
  the consumed row leaves the warehouse and the listing appears under the
  Market page's My Listings. i18n en+ja added.

### Gates
- `node server/tests/api_test.cjs`: 212 passed, 0 failed (was 206; +6 new
  REQ-0328 tests covering from-warehouse -> active listing + row consumed +
  NO canvas mutation, validation/no-leak, withdraw-returns-to-warehouse,
  Idempotency-Key dedupe, end-to-end buy with no seller-canvas mutation,
  expiry-returns-to-warehouse). PASS.
- `tsc -p tsconfig.server.json`: exit 0. PASS.
- `cd client && pnpm exec tsc -b` (+ `pnpm build`): exit 0. PASS.
- Client e2e: `client/e2e/warehouse-sell.spec.ts` authored (dev-grant ->
  Sell -> My Listings, mirroring warehouse-mjolnir.spec.ts) and validated
  via `playwright test --list`. NOT executed here: the shared e2e box is
  under the REQ-0217 FREEZE, so the box-exclusive fleet was not run to avoid
  disrupting it / the parallel tracks. Runtime coverage is the 6 server
  integration tests above.

### Deviations / follow-ups
- Only po/si/unit drops are direct-sellable; a tm/currency row returns 400
  `unsellable_kind` (the fleet in REQ-0330 simply skips currency rows).
- The direct-sell price is carved in the market's default/sole live TM
  (`lrdst`); a per-listing TM selector can follow when a 2nd live TM ships.
- Per-row endpoint (no `rows:[...]` bulk variant) -- rate-safe; the fleet
  calls it per row, as the spec allows.
- The listing DTO does not surface `source` on the wire (dtoVersion stays 2,
  no existing shape changed); it is white-box on the stored record.

