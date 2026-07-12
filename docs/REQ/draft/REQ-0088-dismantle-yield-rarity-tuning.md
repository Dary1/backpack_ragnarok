# REQ-0088 — Dismantle Yield: Rarity-Tiered Tuning (deferred from REQ-0063)

- **Status**: DRAFT (原案) — captured per the user's explicit request during
  REQ-0063 (Dismantle System) implementation ("その旨を、REQを作っておいてください")
  to not lose this idea, but NOT queued for build. REQ-0063 shipped with the
  user's own interim pick instead (see below); this REQ exists purely so the
  richer version has a home to land in later, whenever revisited.
- Depends on: REQ-0063 (Dismantle System) — this REQ only replaces
  REQ-0063 §3's yield FORMULA; the ledger, suppression/quality-roll mechanic,
  deployed/fixed-job gates, and TTL auto-dismantle hook are all unaffected and
  stay exactly as REQ-0063 shipped them.

## What REQ-0063 shipped (for contrast)
REQ-0063 §3 flagged the yield as "deliberately tiny" and offered two shapes
(new small-change TM "Scrap", vs a direct flat low-rate Weathervane). The user
picked the simplest possible interim version to unblock shipping: **flat 1
Weathervane (`lrdst`) per dismantle, regardless of the dismantled item's
rarity or kind** ("一旦weathervane1個で進めてください"). This is
`server/services/dismantle.cjs`'s `YIELD_TM_ID = 'lrdst'` / `YIELD_QTY = 1`
constants today, and also the flat rate `warehouse.cjs`'s TTL auto-dismantle
path grants (at its own separate 50% [TUNABLE] proc chance — that probability
knob is outside this REQ's scope; only the per-dismantle AMOUNT is).

## What this REQ proposes instead (deferred)
Scale the yield by the dismantled item's **rarity**, so dismantling something
rarer is worth more than dismantling filler — e.g. (illustrative only, not a
commitment):

| Rarity   | Yield (flat-today) | Yield (tiered, illustrative) |
|----------|---------------------|-------------------------------|
| Common   | 1 lrdst             | 1 lrdst                       |
| Uncommon | 1 lrdst             | 2 lrdst                       |
| Rare     | 1 lrdst             | 4 lrdst                       |
| Relic    | 1 lrdst             | 8-10 lrdst [TUNABLE]           |

This is the more "natural-feeling" long-term shape (dismantling a Relic
should feel more consequential than dismantling a Common), but it was
deliberately NOT what shipped first, because:
- REQ-0063's own economy.md framing insists the yield stay small and never
  become "the optimal reflex" -- a tiered table needs real balancing against
  drop rates/market prices to avoid accidentally making high-rarity farming
  +dismantling a better income loop than intended, which flat-1 sidesteps
  entirely by construction (there's no rarity-comparison incentive to reason
  about at all when every yield is identical).
- Kind matters too, not just rarity: should an SI's dismantle yield the same
  curve as a PO's, or its own (SIs and POs are not necessarily equally
  "worth" at the same rarity label today) -- open question, not answered by
  REQ-0063's flat scheme and not pre-judged here either.

## Design sketch (non-binding)
- `YIELD_QTY` becomes a function of `(kind, rarity)` instead of a constant --
  a small lookup table in `server/services/dismantle.cjs`, same shape
  `suppressionFloor`'s CAP/DECAY constants already use (named constants at
  the top of the file, flagged [TUNABLE]).
- `dismantleItem` already resolves the item's def via `findInventoryItem` /
  the content map before stripping it, so `rarity` is already in hand at the
  yield-computation call site -- this is a small, local change, not a
  reshaping of the dismantle flow itself.
- The TTL auto-dismantle path (`warehouse.cjs`'s `purgeExpiredWarehouseItems`)
  would need the SAME rarity lookup wired through it (it currently hardcodes
  the same flat `dismantle.YIELD_TM_ID`/`YIELD_QTY` REQ-0063 exports) --
  both call sites must move together or the two dismantle paths (manual vs
  TTL-expiry) would silently diverge in value per rarity.
- Client-side: `DismantlePanel.tsx`'s confirm panel and result toast already
  read `result.yield.qty` straight from the server response (never a
  hardcoded "1") -- REQ-0063's client shipped yield-amount-agnostic on
  purpose, so this REQ needs ZERO client changes to the amount display
  itself if it ships later. Only the tuning TABLE moves.

## [USER] decision list
1. Whether to build this at all, or keep flat-1 permanently (REQ-0063's own
   yield is not visibly broken or complained about -- this REQ is a
   nice-to-have captured for later, not a fix for anything).
2. The actual per-rarity (and per-kind, if different) yield table.
3. Whether Scrap (REQ-0063 §3's OTHER deferred option -- a dedicated
   small-change TM, 10 Scrap -> 1 Weathervane) should ship ALONGSIDE
   rarity-tiering, replace flat lrdst yield entirely, or stay separately
   deferred -- the two ideas are orthogonal (one is "how much", the other is
   "in what denomination") and this REQ takes no position on the second.

## Test plan (if adopted)
- server: yield-by-rarity table lookup covers every rarity currently defined
  in content (no silent fallback to 0/undefined for an unmapped rarity);
  manual dismantle and TTL auto-dismantle paths verified to agree on the
  SAME item's yield (shared lookup, not two copies that can drift); existing
  REQ-0063 dismantle tests (ledger engraving, deployed gate, suppression)
  unaffected -- this REQ only touches the yield AMOUNT computation.
- client: no new E2E expected (DismantlePanel already renders whatever `qty`
  the server returns) -- a quick manual/E2E spot check that a Relic-tier
  dismantle's toast shows a number other than 1 would be the only new
  assertion worth adding.
