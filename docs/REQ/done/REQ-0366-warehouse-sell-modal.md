# REQ-0366 — Warehouse direct-sell price entry: replace window.prompt with the market price-carve modal

## Status
done — merged to master (ff-only, head 8cd0744f) and LIVE 2026-08-10;
deploy verified end-to-end (see Outcome). Deploy ordered by the user in
chat 2026-08-10: 「merge and deploy」.
Was: built — all gates green 2026-08-10 (Cowork session), commit b205c82f
on branch req-0366-warehouse-sell-modal.
Was: todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis
batch); ratified by user 2026-08-10, chat:
「では、それらを全て、TODOのREQとして書き出してください」.

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

## Implementation (2026-08-10, Cowork session)
Worktree/branch `req-0366-warehouse-sell-modal`, code commit `b205c82f`
(one commit == CI receipt tree `3d5eacb5`, dist `web/app` rebuilt
in-commit per the receipt's dirty-tree rule).

Decisions taken within the spec's degrees of freedom:
- Spec 1 — the shared component is `client/src/market/priceCarve.tsx`:
  `usePriceCarve` (the clamp-law price state machine), `anchorFor`, and
  three render fragments `CarveAnchor` / `CarveStepper` / `CarveEst`
  rather than one monolithic block, so SellPane could adopt them IN
  PLACE and keep its rendered DOM/classes/testids byte-identical
  (market-price-down/input/up, market-cap-note, market-carve-anchor,
  market-est-* all render from the shared file now, unmoved).
- Spec 2 — `client/src/warehouse/SellModal.tsx`; WarehousePage owns the
  open-row state, `useWarehouseData.handleSell(itemUid, qty)` keeps the
  POST (contract + eligibility untouched; `SELL_TM_ID` exported so the
  modal's PriceTag shows the TM the POST actually carves in). The modal
  fetches ONE browse-listings snapshot on open for the anchor line +
  REQ-0195a multi-TM flag; fetch failure degrades to anchorNone.
- Spec 3 — `sellPrompt` / `sellInvalidPrice` retired outright (the
  stepper/input clamp to 1..999 by construction, so "invalid price" is
  unreachable); added `sellModalTitle` / `sellModalTitleEn` /
  `sellCancel`. en/ja parity kept.
- Spec 4 — 0369 has NOT landed, so the conventions hook was created at
  the exact path/shape 0369 names (`client/src/lib/useModalConventions.ts`:
  Esc-to-close, overlay-click-to-close, focus trap, initial focus +
  focus restore) with the warehouse SellModal as sole adopter; 0369
  adopts the same hook across the other player-facing modals.

## Gate results (2026-08-10)
- `grep -rn "window.prompt" client/src` → 0 hits. Regression assertion
  added as a source-scan test in `client/e2e/warehouse-sell.spec.ts`
  (walks E2E_CODE_ROOT/client/src; the needle is split so the spec
  never matches itself). GREEN.
- e2e warehouse → Sell → modal → price 25 → listed; My Listings shows
  it (server-truth checks: row consumed, active listing qty 25, tm
  lrdst, kind po). GREEN. New Esc/cancel-close-without-listing test
  also GREEN (suite 3/3).
- Anchor line: rendered in the modal via the SAME shared
  `anchorFor`/`CarveAnchor` SellPane uses (real-anchor path covered by
  the existing market coverage); e2e asserts the line renders (a fresh
  dev grant has no settled history → the codex empty-state). GREEN.
- SellPane selector contract: `market.spec.ts` 18/18 GREEN, untouched.
- en/ja key parity: per-module en/ja key-set diff over all 13 i18n
  modules → identical. GREEN.
- `tsc -b` 0 errors; oxlint 0 errors (48 warnings vs master's 45; the 3
  new are pre-existing classes — 2× react(only-export-components) on
  the new shared file, same as marketShared.tsx; 1×
  exhaustive-deps on SellPane's preselect effect, guarded by its
  existing preselectDone ref).
- `pnpm run test:quick` GREEN (25.7s). Full `tools/ci.sh` CI GREEN
  (257s: sim + goldens + mock + typecheck + drift + api files/pg +
  client build + both e2e families), receipt tree `3d5eacb5` ==
  commit `b205c82f`'s tree.

## Out of scope (unchanged)
Pricing rules, burn rate, market backend, SellPane visual redesign.
Rollout of useModalConventions to the OTHER modals stays REQ-0369's.

## Outcome (2026-08-10, deploy)
- Merged: `git merge --ff-only req-0366-warehouse-sell-modal` on the main
  (live) checkout; master ed86ff85 -> 8cd0744f. The checkout was verified
  clean before the merge (coordination check per PROJECT.md).
- Runbook: `tools/predeploy_recalibrate_powerlevel.cjs` run post-merge per
  the standing rule -> CLEAN, no-op, zero writes (no content in the diff).
  No `backpack-api` restart: zero server/content files changed; the client
  ships as committed `web/app` statics served from disk by backpack-web.
- Live verification: `http://127.0.0.1:8801/app/` AND
  `https://backpack-dev.qtie.jp/app/` (through the tunnel) both serve the
  new bundle `index-DYMYrAGh.js` (asset 200), and that bundle contains the
  `warehouse-sell-modal` testid -- the served artifact IS the modal build.
  Behavior is covered by the hermetic gates (warehouse-sell 3/3, market
  18/18, full CI GREEN receipt tree 3d5eacb5); live runs dev_mode-off /
  signed-out (REQ-0365), so no live warehouse interaction was performed.
- Worktree `~/backpack_ragnarok_worktrees/req-0366-warehouse-sell-modal`
  left in place (branch fully merged; removable at the next sweep).
