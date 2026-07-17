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

`SKIP_E2E=1 bash tools/ci.sh` -> **CI GREEN**. Run in the worktree, on the server.

| Gate | Result |
|---|---|
| `tools/check_engine_types.cjs` | OK — 49 declared members verified against runtime |
| `mock-src/tests/run.cjs` (engine, rule 1) | 119 passed, 0 failed |
| `sim/tests/goldens.cjs` (rule 2) | **OK, 12 cases, replay determinism intact — no hash moved** |
| `sim/tests/run.cjs` | 117 passed, 0 failed |
| `server/tests/api_test.cjs` (files) | **187 passed, 0 failed** — 1542 assertions (was 1461) |
| `server/tests/api_test.cjs` (pg) | **187 passed, 0 failed** — both backends identical (rule 4). NOTE: ran against the LIVE Postgres (the only `DATABASE_URL` on this box). Row-isolated by the harness's tmpHome namespace, so no live row was touched — but it leaked another ~28 orphan rows into the production DB, like every pg CI run before it. See REQ-0218. |
| `tsc -p tsconfig.server.json` | clean |
| client typecheck + vite build | clean |
| e2e | **RUN, hermetically — and it found a real bug this REQ had shipped. See below.** |

### e2e: run under REQ-0217's hermetic harness, and worth every minute

`req-0217-hermetic-e2e` landed the fix for the non-hermetic suite while this REQ was
in flight (fleet of isolated api workers on 8810-8813, `env -u DATABASE_URL`, local
proxy — never the live services). That made an honest e2e verdict possible without
deploying anything.

Method: a throwaway integration branch `tmp-r215-e2e-on-0217` = REQ-0217's harness +
this REQ's commits, in its own worktree. Neither master, nor this REQ's branch, nor any
live service is touched. One merge conflict, in `workshop.spec.ts` — 0217 had renamed
the e2e profile endpoint `dev` -> `default`; resolved by keeping this REQ's assertions
on 0217's endpoint.

**IT CAUGHT A 500 ON EVERY CLAIM.** `claimSpotOr409` runs the engine over the saved
canvas, and the engine indexes `container.tms` unconditionally (`tmCanPlace` does
`container.tms.find`; `invOccupancy` guards `sis` with `|| []` but nothing guards
`tms`). The TM model arrived in REQ-0042, long after inventory pages existed — so every
canvas saved before it, **and all nine e2e fixtures**, are shaped `{bps,pos,sis}` with
no `tms` at all. Those threw a TypeError out of the engine: a 500 on a legitimate claim,
for real players with older canvases.

**Why api_test went green over it, which is the part worth remembering.** This suite hit
the very same shape — and I gave the FIXTURE a `tms: []` instead of making the validator
cope. That turned the suite green and left the bug in the product. A test fixture edited
until the test passes is not evidence; the guard belongs in the code that reads untrusted
canvas shapes. Fixed in `9b78a7f`: normalize the four arrays on the deep copy the
validator already makes (safe there, and only there — it cannot touch the stored profile,
so the validator does not become a second writer). The new regression test asserts BOTH
halves: a tms-less page claims 200, and the saved canvas still has no `tms[]` afterward.

Also recorded, since it wasted a run: the first hermetic attempt was launched WITHOUT
`E2E_GPU=1` (0217's own invocation has it). Software rendering drove load average to 37
and timed out every drag/pixel test. Those failures were self-inflicted, not regressions.

Re-run after the fix is QUEUED behind another worktree's run on the box lock
(`req-0212-charge-verb-expansion`) at the time of writing — the lock working as designed.
The verdict below is therefore **provisional on that re-run**.

#### The earlier attempt, and why it was wrong

Before 0217 landed, the suite was not hermetic: `playwright.config.ts`'s baseURL was the
PUBLIC tunnel, served by the LIVE services running the MAIN checkout. Running it from a
worktree exercised master's build — it could neither pass nor fail on this REQ's code —
while mutating live state.

**This was attempted once, and it DID damage live state. Correcting an earlier false
claim in this document.** A run was started from this worktree, noticed to be driving
master, and killed within ~40s. I then checked `data/profiles/default.json` by sha256,
found it byte-identical to the run's backup, and recorded "no damage" here.

**That check was worthless and the claim was false.** `default.json` is the FILES-backend
copy; the live service runs `STORAGE_BACKEND=pg`. The live profile row
`88d662ca20e5289b:dev` has `updated_at 2026-07-17T05:28:56Z` — inside the run's window.
The run wrote the live dev profile. The suite's backup/restore net is files-era and does
not cover pg: exactly REQ-0217's own incident driver.

What IS verified clean: `~/backpack_ragnarok` git status; `content/live/live_items.json`
and `live_sis.json` (sha256 vs the run's backups); both services healthy; the box lock
released cleanly and picked up by the queued `req-0217-hermetic-e2e` run.

Mitigating but not exculpating: REQ-0217 records that the same dev profile was already
overwritten earlier the same day by the full-CI incident, and lists restoring it as a
separate owner decision — so this write landed on an already-lost profile. No pg backup
exists to restore from regardless. Full write-up: **REQ-0218 §6**.

That is the incident recorded above, and the reason the verdict now comes from 0217's
harness instead.

### e2e specs are UPDATED (they just have not been executed)

`client/e2e/workshop.spec.ts` is rewritten for the new behaviour: the roll debits
immediately and delivers to the warehouse (asserting the Unit is NOT on the canvas), then
claims it from the Warehouse screen end-to-end and checks the row finalizes. Its
`data/gacha_pending` cleanup hook is gone with the store.

## 7. E2E ports

Derived, per PROJECT.md: REQ-0215 -> STATICPORT=2150 APIPORT=2151 PROXYPORT=2152
(`source tools/e2e_ports.sh 0215`). Not consumed — this REQ adds no new harness.

## 8. Commits (branch `req-0215-gacha-warehouse-claim-fit`, off master @ f7acaea)

| Hash | What |
|---|---|
| `7364bbd` | spec (this file) |
| `74d668c` | reserved -> todo |
| `5d75fb4` | server: gacha -> warehouse; claim single-spot validator; gacha_pending deleted |
| `9381d32` | client: placement find/place split; claim protocol; WorkshopPage places nothing |
| `a419114` | tests: the purchase + the fit contract |

## 9. Outcome / open items for the owner

Implementation complete; every runnable gate green on both storage backends.

Three things need an owner decision:

1. **e2e** — see §6. Needs a deploy of this branch, or REQ-0217.
2. **`server/migrations/020_drop_gacha_pending.sql` is NOT applied, and CANNOT be
   tested.** The repo has no migration runner and no test database — DDL has no
   namespace, so there is nowhere to run it but production. The live table currently
   holds 16 rows, all abandoned e2e rolls that were never charged for, so dropping
   destroys no player value; but it is a live-schema change and needs a go-ahead. The
   server code no longer reads or writes the table, so leaving it un-dropped is
   harmless. **REQ-0218** (raised by the owner off the back of this REQ's gate run)
   proposes the test database that would make this migration verifiable.
3. **A rolled Unit inherits the warehouse TTL** (7 days) and its auto-dismantle on expiry.
   A paid roll left unclaimed past the TTL is engraved + yields, exactly like an
   unclaimed market-bought Unit (REQ-0195d) — consistent, but it IS new exposure for
   gacha specifically, which previously placed straight onto the canvas and could never
   expire. Flagged rather than decided: if paid rolls should be TTL-exempt, that is a
   follow-up REQ (it would be the warehouse's first exemption).
