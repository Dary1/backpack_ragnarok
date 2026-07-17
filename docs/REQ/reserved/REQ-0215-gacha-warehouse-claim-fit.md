# REQ-0215 — Gacha delivers to the Warehouse; claim is a client-searched, server-validated single-spot fit

## 1. External spec (user instruction, 2026-07-17 — BINDING)

Verbatim intent, recorded before any internal design:

1. Opening a unit gacha pack puts the Unit in the **WAREHOUSE**, not directly into the
   inventory.
2. Claiming moves it warehouse → inventory. If there is **no gap** in the inventory that
   the shape fits into, that is an **ERROR** (not a silent no-op).
3. The fit **search** is the CLIENT's job. Protocol: the client receives the shape,
   returns the inventory index + position the shape fits at; the server tests **only that
   one spot**; if OK, the item moves warehouse → inventory.
4. Error scope: **every** warehouse claim (PO / SI / TM / BP), not only the gacha Unit.

Internals were explicitly delegated by the user ("外部仕様は伝えたので、内部は勝手に
やってほしい"). Sections 2-5 are therefore this REQ's own calls, not user decisions.

## 2. Why this is not additive: the gacha finalize gate dies

The Workshop gacha (REQ-0042/0170) finalizes a pending roll on TWO conditions
(services/gacha.cjs `finalizeGachaForCanvas`):

  (a) the minted BP uid appears in the just-saved canvas, AND
  (b) the player's LRDST balance dropped by >= the roll's cost.

Spec item 1 makes **(a) structurally impossible**: the BP never enters the canvas on roll
any more — it lands in a warehouse row. Gate (a) is what makes the roll unforgeable; (b)
alone is NOT a substitute, and this must be stated plainly because it is the whole reason
the payment design changes:

> **Rejected — "balance-drop only".** Keep the two-phase, let the client debit LRDST, and
> finalize on (b) alone. This is exploitable: spend >= cost LRDST on ANYTHING else within
> the 120s pending window (a market buy already debits the canvas server-side, so it
> qualifies) and the next profile PUT finalizes the roll. The player receives the Unit
> without ever paying for the roll. A free-Unit hole; not shippable.

> **Rejected — "receipt in the canvas".** Add a `spentRolls:[rollUid]` ledger to the
> canvas and gate on `rollUid ∈ spentRolls AND balance dropped`. Restores today's gate
> strength and keeps design rule 5 intact — but requires a canvas schema field the engine
> does not know about, which pushes on rule 1 ("the engine is consumed AS-IS") for a
> problem that already has a sanctioned, precedented answer (below). Not worth the blast
> radius.

## 3. Decision — the gacha becomes what it now structurally IS: a purchase

After spec item 1, a gacha roll and a market buy have the *same shape*: **pay a TM, the
goods are delivered to the buyer's warehouse as a claimable row.** services/market/trade.cjs
`buyListing` already does exactly this, and already carries the **sanctioned rule-5
exception** for it (docs/llm_managed/architecture.md rule 5; the divergence is documented
at the head of services/market.cjs).

So `startGachaRoll` is rebuilt on the `buyListing` pattern, synchronously, in one call:

  1. resolve the pack, read the LRDST balance off the last-saved canvas (unchanged)
  2. **pre-check the warehouse cap** BEFORE the commit point (`buyListing` step-order:
     no partial settle) — a full warehouse 409s and nothing is charged or rolled
  3. roll the BP from a crypto-random master seed (`rollPackBp`, UNCHANGED — the roll math,
     the seeded sub-streams and the bonus slots are not touched by this REQ)
  4. debit `cost` LRDST from the canvas server-side (`debitTmFromCanvas`) + `writeProfile`
  5. deliver the BP as a `kind:'bp'` warehouse row carrying the verbatim instance —
     **the REQ-0195d row shape, byte-for-byte**, which the warehouse list, the claim
     validator and the client's `firstFitPlaceBp` path ALREADY handle for market-bought
     Units. This REQ adds no new row kind.
  6. deliver each rolled bonus (PO / SI / TM) as its own ordinary warehouse row —
     `grantWarehouseItem` / `grantTmQty` shapes, no new mechanism
  7. `ensureBio(uid, 'gacha', name)` at roll time — the Unit is born when it is rolled and
     delivered, which is now a single atomic moment

**Deleted, not deprecated:** `gacha_pending`, `startGachaRoll`'s pending doc,
`normalizeGachaPendingStatus`, `purgeExpiredGachaPending`, `finalizeGachaForCanvas` and its
call site in the profile PUT handler. A roll can no longer be abandoned — it either fully
happened or fully did not — so the 120s lazy-revert window has nothing left to revert.

**Inherited cost (accepted, same as the market's):** the server writes the buyer's canvas,
so a stale in-flight auto-save can resurrect the pre-roll canvas and hand the LRDST back
while the Unit sits in the warehouse. Mitigation is the market's own documented one,
tightened because a roll (unlike a market settle) is always initiated by THIS client:
`flushAutoSave()` before the roll POST, re-GET the profile after it. Both windows closed
on the initiating client; a second tab is the same known posture the market already has.

## 4. Decision — claim: client searches, server validates ONE spot, client writes

Spec item 3 says the server "tests only that spot, and if OK moves it from warehouse to
inventory". `move` is deliberately NOT read as "the server writes the canvas": that is
design rule 5, and REQ-0041 documented BUG #3 (server + client auto-save as dual writers →
the claimed item silently vanishes from the persisted profile) by live reproduction. The
market's rule-5 exception exists only because an exchange between two players cannot be
client-two-phased — a claim has one player and no such constraint, so it keeps rule 5.

The claim therefore gains a **validation** step, not a writer swap:

  1. client `flushAutoSave()` — the server validates against the LAST-SAVED canvas, so the
     client's live state must be the saved state or the verdict is meaningless
  2. client first-fit-searches its LIVE state (`lib/placement.ts`, unchanged helpers) →
     `{page, position}`
  3. **no fit → error immediately, no server call** (spec item 2, all kinds — spec item 4)
  4. `POST /api/warehouse/claim {itemUid, page, position}` — new required fields
  5. server rebuilds the engine over the last-saved canvas and tests **that one spot only**
     (`invCanPlacePO` / `invCanPlaceSI` / `invCanPlaceBP` / `tmCanPlace`); reject → 409
     `no_space`. This is an anti-cheat backstop, not a search: the server never scans.
  6. OK → row flips to `claiming`, payload returned (unchanged shape)
  7. client places at EXACTLY the validated `{page, position}` (it does not re-search) →
     `notifyStateChanged()` → the auto-save PUT persists → `finalizeClaimingItemsForCanvas`
     deletes the row (UNCHANGED — the uid-membership finalize still holds, because a
     claimed item DOES enter the canvas)

Supersedes the "no space → leave it `claiming`, let it lazy-revert after 120s" posture
(services/warehouse.cjs `claimWarehouseItem`, WarehousePage's `claimNoSpace` toast) for
every kind, per spec items 2 + 4. The lazy-revert stays as the crash/tab-close safety net.

## 5. Interpretations flagged

- **`position` semantics are kind-dependent** and match each engine call's own anchor
  convention: PO = anchor cell, SI = anchor cell, TM = anchor cell (merge target's own cell
  on the merge path), BP = `origin`. The wire field is one `[row, col]` pair either way.
- **`page` is an inventory page index** (0..PAGE_COUNT-1), the "inventory index" of spec
  item 3.
- **Rolling into a full warehouse 409s** rather than silently dropping. This DIVERGES from
  `addToWarehouse`'s documented drop-on-overflow posture for dungeon rewards — deliberately:
  a dropped reward is re-earnable, a dropped roll was paid for. Same call `buyListing`
  already made for a paid delivery.

## 6. Gates

(to be filled: ci.sh [0/8] port check, engine types, mock-src suite, api_test files+pg,
client unit, e2e; commit hashes; outcome)

## 7. E2E ports

Derived, per PROJECT.md: REQ-0215 → STATICPORT=2150 APIPORT=2151 PROXYPORT=2152
(`source tools/e2e_ports.sh 0215`).
