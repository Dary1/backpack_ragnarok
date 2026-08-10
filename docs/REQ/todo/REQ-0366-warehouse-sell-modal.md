# REQ-0366 — Warehouse direct-sell price entry: replace window.prompt with the market price-carve modal

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork): full client/src read + all 13 i18n modules +
REQ-board cross-check + live signed-out inspection. Finding P0-4 of that report.
This file is self-contained; the JA report stays user-side.

## Problem (gamer-facing)
The warehouse's direct market sell (REQ-0328) collects the price via
`window.prompt` — the ONLY raw browser dialog in the product. It breaks the
MJOLNIR presentation completely, validates only after the fact
(`schedule.warehouse.sellInvalidPrice`), is poor on mobile, and is invisible to
the styling/i18n systems. Meanwhile the market page already owns a finished,
lore-correct price UI.

## Evidence (verified 2026-08-10)
- `client/src/warehouse/useWarehouseData.ts:254-255` — `window.prompt(t(locale,
  'schedule.warehouse.sellPrompt'))`.
- The finished alternative: SellPane's "Carve the price" block
  (`client/src/market/SellPane.tsx`) — ± steppers, integer clamp 1..999, dex
  anchor line (`market.sell.anchor` / `anchorNone`), projected receipt
  (`estPay`/`estBurn`/`estGet`), ceiling copy.

## Spec
1. Extract SellPane's price-carve block (steppers + anchor + projection) into a
   shared component (new file under `client/src/market/` or `client/src/lib/`;
   SellPane keeps its exact DOM/classes — its e2e selectors must not move).
2. Warehouse sell flow opens that component in a modal instead of prompt().
   POST contract and eligibility rules unchanged.
3. Retire `schedule.warehouse.sellPrompt` / `sellInvalidPrice` (or repurpose for
   the modal); en/ja parity maintained at the i18n barrel.
4. Modal behavior (Esc/overlay-click/focus) follows REQ-0369 conventions; if
   0369 has not landed, implement locally in the same shape 0369 will adopt.

## Gates
- `grep -rn "window.prompt" client/src` → zero hits (add as a spec assertion in
  an e2e or unit-level check so it cannot regress).
- e2e: warehouse → Sell → modal → price 25 → listed; My Listings shows it.
- Anchor line shows the item's real dex anchor when one exists.
- en/ja key parity gate green; `pnpm run test:quick` and full CI green.

## Out of scope
Pricing rules, burn rate, market backend, SellPane visual redesign.
