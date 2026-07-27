# REQ-0310 — Promote the client-authoritative player actions into `shared/`

- **State**: todo
- **Program**: LLM Test-Play Fleet, track "整理整頓" (step 2 of 2).
  Design: `docs/llm_managed/2026-07-27-llm-testplay-fleet-design.md` §1.1, §4.3.
- **Depends on**: REQ-0309 (`shared/engine.js` must exist first).
- **Blocks**: REQ-0314 (`bpk` core) — and largely *defines* how small that REQ is.
- **Size**: L.

## 1. Why

Three player actions are two-phase, and **the authoritative second phase is the
client's**. The server rolls or reserves; the client mutates the canvas and PUTs;
that PUT is the commit:

- **Gacha** — `POST /api/workshop/gacha` records a pending row and returns the
  rolled BP. `server/routes/workshop.cjs` says it plainly: *"this route NEVER
  writes the caller's profile… The CLIENT deducts the cost from its own LRDST
  stack, first-fit-places the BP, and auto-saves -- THAT PUT is what finalizes the
  roll."* `finalizeGachaForCanvas` then verifies both the minted uid's presence
  **and** that the balance dropped by exactly the cost.
- **Warehouse claim** — `server/services/warehouse.cjs:226` marks the row
  `claiming` and returns a payload; the client places it (reusing the row's own
  uid, which is what `finalizeClaimingItemsForCanvas` scans for) and PUTs. A row
  left `claiming` reverts after 120 s.
- **Fresh profile** — the initial four starter Squads are built entirely
  client-side by `buildStarterUnitsState` in `client/src/store/boot.ts`, from
  `/api/content`'s `starterUnits`. `POST /api/starter/claim` grants nothing; it
  only meters regrants.

So "the rules of the game" partly live in a React app. Today that is merely untidy.
The moment a second client exists — `bpk`, REQ-0314 — it becomes a correctness
problem, because the second client would have to *reimplement* item-losing logic:
`WorkshopPage.tsx:251` refunds the spent LRDST via `engine.tmMove` when placement
fails, and `useWarehouseData.ts` has an equivalent no-space path that must leave the
warehouse row untouched. A bot that reimplements those and gets them subtly wrong
destroys real players' items, and does so silently.

**This REQ is the reason REQ-0314 is safe to write.** After it, the headless player
calls the same code the browser calls.

## 2. What moves

Target: two ESM modules, following the `shared/forecast.mjs` + `forecast.d.mts`
precedent exactly (ESM so Vite imports it unforked and Node can `import()` it;
hand-written `.d.mts` so the client keeps full typing; dependency-free, engine
passed in by the caller).

### 2.1 `shared/placement.mjs` (+ `.d.mts`)

Moved verbatim from `client/src/lib/placement.ts` — it is already pure and already
takes `engine` and `state` as parameters:

- `GRID_MIN`, `GRID_MAX`
- `firstFitPlace(engine, state, pool, uid, id, openPage, pageCount)`
- `firstFitOrMergeTM(engine, state, uid, id, qty, openPage, pageCount)`
- `firstFitPlaceBp(engine, state, rolled, openPage, pageCount)`
- the `PlacementResult` / `BpPlacementResult` shapes

### 2.2 `shared/player_actions.mjs` (+ `.d.mts`)

The three sequences, extracted as **pure state transitions** — no React, no chimes,
no tab pulses, no network:

```
applyGachaRoll(engine, state, rolled, cost, openPage)
   -> { ok:true, state } | { ok:false, reason:'insufficient_lrdst'|'no_space', state }
   spendTM -> firstFitPlaceBp -> on placement failure, REFUND via tmMove and
   return the state unchanged in effect. The refund path is the load-bearing part.

applyWarehouseClaim(engine, state, claimed, defs, openPage)
   -> { ok:true, state } | { ok:false, reason:'no_space', state }
   kind-dispatch (tm -> firstFitOrMergeTM, bp -> firstFitPlaceBp,
   po/si -> firstFitPlace), REUSING the warehouse row's uid.

buildStarterUnitsState(gameData, locale)
   -> GameState | null      (verbatim from store/boot.ts:89)

itemKindOf(id, defs)        (from client/src/lib/itemContent.ts)
```

The client's existing call sites keep their UX concerns (flash, chime, pulse,
auto-save, error toasts) and delegate only the state transition.

## 3. Non-goals

1. **No behaviour change anywhere.** This is an extraction. The e2e suite is the
   proof (§5 G3).
2. **No server change.** The two-phase protocol itself is not being revisited. It
   is odd, but it works, and changing it is a much larger REQ with live-data risk.
   *[ORCH default, vetoable]* — if the user would rather make gacha/claim
   server-authoritative, that is a different and bigger REQ, and it would make
   REQ-0314 smaller still.
3. **No new abstraction over the engine.** `shared/player_actions.mjs` takes an
   engine instance; it does not wrap, adapt, or re-export it.
4. **Do not move the React hooks** (`useWarehouseData.ts`) or page components.

## 4. Method

Worktree `req-0310-shared-player-actions` on top of REQ-0309. Order:

1. `shared/placement.mjs` + `.d.mts`; client re-points its imports; delete
   `client/src/lib/placement.ts`.
2. `shared/player_actions.mjs` + `.d.mts`; extract from `WorkshopPage.tsx`,
   `useWarehouseData.ts`, `store/boot.ts`, `lib/itemContent.ts`; those files call
   in instead.
3. New test `shared/tests/player_actions.cjs` (or wired into an existing runner):
   golden cases per §5 G4.

## 5. Gates

| # | Gate | How |
|---|---|---|
| G1 | shared/ charter intact | `shared/placement.mjs` and `shared/player_actions.mjs` import nothing from `client/`, `server/`, `sim/`, `mock-src/` |
| G2 | No forked copy remains | `client/src/lib/placement.ts` deleted; `buildStarterUnitsState` and `itemKindOf` exist in exactly one place repo-wide |
| G3 | **Full CI green, e2e included** | `tools/ci.sh`. The workshop-gacha and warehouse-claim e2e specs are the behavioural proof and must pass unmodified — if a spec needs editing to pass, the extraction changed behaviour and is wrong |
| G4 | New unit goldens | (a) gacha with sufficient LRDST + space → placed, balance −cost; (b) gacha with **no space** → refunded, net balance unchanged, no BP placed; (c) claim of each kind (po / si / tm-merge / bp) reuses the row uid; (d) claim with no space → state untouched; (e) `buildStarterUnitsState` output deep-equals what boot.ts produced on base |
| G5 | Invariant | every state produced by these functions passes `engine.checkUidInvariant` |
| G6 | Client typing preserved | `[3.5/7]` typecheck green; `.d.mts` files present, no `any` at the call sites |

G4(b) and G4(d) are the item-loss cases. They are the reason this REQ exists;
treat a failure there as a release blocker, not a test bug.

## 6. Risks

- **TS → ESM conversion loses inference.** Mitigated by hand-written `.d.mts`,
  which is exactly what `shared/forecast.d.mts` already does, and by G6.
- **Hidden coupling.** `WorkshopPage.tsx` interleaves state mutation with UI
  feedback across ~60 lines; the seam is not perfectly clean. Extract conservatively
  — when in doubt, leave the line in the component.
- **The refund path is barely covered today.** Writing G4(b) may surface a
  pre-existing bug. If it does: record it in this REQ, fix it in a separate commit
  clearly labelled as a behaviour change, and tell the user. Do not silently
  "correct" behaviour inside an extraction REQ.

## 7. Outcome

**Built 2026-07-27** on branch `req-0310-shared-player-actions`, based on master
`112bd5d`. Three commits: two pure extraction, one deliberate behaviour change.

| commit | what |
|---|---|
| `c24adee` | (1/3) `shared/placement.mjs` + `.d.mts`; `client/src/lib/placement.ts` deleted; client + the REQ-0273 gate re-pointed. Pure extraction. |
| `45cbd1c` | (2/3) `shared/player_actions.mjs` + `.d.mts` (`applyGachaRoll`, `applyWarehouseClaim`, `buildStarterUnitsState`, `itemKindOf`); call sites delegate; `shared/tests/player_actions.cjs` wired into `ci.sh` as `[3.2/7]`. Pure extraction. |
| `f4e6cae` | (3/3) **BEHAVIOUR CHANGE** -- first-fit the gacha refund. Fixes the section 9.1(3) currency-loss defect. Separate by design. |

### Gate results (actual output)

| # | Gate | Result |
|---|---|---|
| G1 | shared/ charter intact | **PASS.** `shared/placement.mjs`: 0 imports, 0 requires. `shared/player_actions.mjs`: exactly 1 import, `./placement.mjs` (intra-`shared/`). No reference to `client/`, `server/`, `sim/` or `mock-src/` outside comments. |
| G2 | No forked copy remains | **PASS.** `client/src/lib/placement.ts` deleted. Repo-wide `grep 'function buildStarterUnitsState\|function itemKindOf'` returns exactly 2 hits, both in `shared/player_actions.mjs`. |
| G3 | Full CI green, e2e included | **PASS.** `tools/ci.sh` final line: `CI GREEN`. e2e `196 passed, 1 skipped (8.6m)`. The 1 skip is `dex-admin.spec.ts:102` (REQ-0182b 409), which skips in FILES mode by design and is covered by `[6.6/8]`. **Specs unmodified: `git diff 112bd5d..HEAD -- client/e2e/` is EMPTY.** `workshop.spec.ts:121` (gacha happy path, balance 999->989 + server-side uid/deduction after finalize) and all 5 `warehouse-mjolnir.spec.ts` claim/claim-all tests pass untouched. |
| G4 | New unit goldens | **PASS.** `shared/tests/player_actions.cjs`: `player_actions: all green (76 checks)`, run in CI as `[3.2/7]`. Covers (a) balance -cost + BP placed; (b) no-space -> refunded, net balance unchanged, no BP; (c) po/si/tm-fresh/tm-merge/bp uid reuse; (d) no-space -> state byte-identical for all four kinds; (e) starter state deep-equals base. |
| G5 | Invariant | **PASS.** `engine.checkUidInvariant(state).ok` asserted after every transition, 18 call sites, including the no-space and refund paths and the starter seed through `migrateState` against the live content defs. |
| G6 | Client typing preserved | **PASS.** `[3.5/7]` `tsc -p tsconfig.server.json` clean; `[6/7]` client typecheck + build clean; `client/ pnpm exec tsc -b` clean. `placement.d.mts` and `player_actions.d.mts` present; no `any` at any call site (results are discriminated unions on `ok`). |

### The section 9.1(3) defect: REPRODUCED, and worse than specced

It reproduced, and the trigger is **much narrower than section 9.1(3) assumed**.
The addendum described it as "no page has room for even a 1x1 TM". In fact the
refund was `engine.tmMove(state, pg, uid, [1,1], 'lrdst', cost)` -- a **fixed
cell**, not a first-fit scan. `tmCanPlace` accepts `[1,1]` only when it is free
or already holds an `lrdst` stack, so the refund failed whenever **cell [1,1]
alone was occupied on every page**. A single PO parked on `[1,1]` of each page
is enough; the inventory need not be full.

Sharpest case: when the spend DRAINS the wallet stack to zero its cell is
freed, and the refund still fails because it never looks there -- the player
loses their **entire** balance with a legal cell sitting empty.

Both cases were first committed as *pinned defect* goldens asserting the lossy
behaviour (in `45cbd1c`, so the extraction provably changed nothing), then
flipped to assert full recovery in the fix commit `f4e6cae`:

- `[1,1]` occupied on every page: balance **20 preserved** (was 10 -- 10 destroyed)
- wallet drained to zero: balance **10 preserved** (was 0 -- total loss)

The fix routes the refund through `firstFitOrMergeTM`. This closes the hole
completely rather than narrowing it: after a successful page-scoped `spendTM`
on page `pg`, that page necessarily either still holds an `lrdst` stack (a legal
merge target) or has just had a cell freed by the stack that drained to zero, so
the page walk can always place the refund.

### Deviations and judgment calls

1. **The `shared/forecast.mjs` precedent section 2 cites does not exist** --
   REQ-0308 (`74860da`) deleted `forecast.mjs` + `forecast.d.mts` when it retired
   the ray forecast. The pattern was recovered from `74860da^` and followed
   exactly: `.mjs` + hand-written `.d.mts`, client resolves via
   `moduleResolution: bundler`.
2. **`itemKindOf`'s argument order is `(defs, itemId)`**, per the source and
   section 9.2(2) -- section 2.2's `itemKindOf(id, defs)` is transposed.
3. **A TM-MERGE claim cannot reuse the row uid**, contrary to a literal reading
   of G4(c)/section 9.2(1). `tmMove` deletes the dragged uid and keeps the
   destination stack's (engine TM model). The server already knows this:
   `finalizeClaimingItemsForCanvas` finalizes a tm row on
   `presentUids.has(itemUid) || presentTmIds.has(itemId)`. Both sub-cases are
   tested: fresh TM stack keeps the row uid verbatim; merged TM leaves the
   same-id stack the server actually scans for.
4. **`refunded` added to the `no_space` result.** Not a behaviour change (the
   caller ignores it and shows the same error); it makes the defect observable
   and gives REQ-0314 a hook.
5. **Bonus placement now precedes the cell pulse** (it followed it before).
   Bonuses are state and had to move; the pulse is UI and stayed. Saved state is
   identical and the pulsed cells are the BP's, unaffected by bonuses.
6. **`shared/tests` excluded from `tsconfig.server.json`.** `shared/**/*.cjs`
   would have pulled the new suite into `[3.5/7]`'s `checkJs`, demanding that
   deliberately partial fixtures be widened into full wire payloads. Excluded to
   match the existing convention: `server/tests` and `sim/tests` were never in
   `include` -- no test suite in this repo is typechecked.
7. **G4(e)'s golden was captured from the BASE implementation**, extracted from
   `112bd5d:client/src/store/boot.ts` and transpiled by the real `typescript`
   compiler rather than hand-stripped, so the comparison is independent of the
   hand-written port. Fixture is the live `content/live/starter_units.json`.
8. **`[7/7]` flaked once at the default 4 workers**, exactly as the dispatch
   warned. `workshop.spec.ts:121` failed with `newBpIds.size` `Expected: 1,
   Received: 2` (two freshly-minted BPs from one roll) alongside a burst of HTTP
   500s -- profile contamination, not a code defect. It passed 11/11 in
   isolation and the full suite then passed serially, twice. The recorded green
   is from `E2E_PARALLEL=1`.
9. **Ports: `tools/e2e_ports.sh 0310` yields 3100/3101/3102 (fleet 3104), NOT
   the 8100/8101/8102 section 9.4 states.** The tool on master still implements
   the pre-REQ-0251 rule `REQ*10` with no 5000 base. Ports were derived with the
   tool, never hand-typed; `[0/8]` passed. Flagged, not fixed -- out of scope.
10. **The `shared/engine.d.ts` vs `client/src/engine/engine.d.ts` question
    (section 9.5, "settle it only if cheap") is DEFERRED.** It was not cheap: it
    is untouched by this REQ's seam and both new `.d.mts` files consume
    `./engine.d.ts` cleanly. No new `.d.ts`/`.js` shadowing was introduced --
    `.mjs`/`.d.mts` is the correct pairing -- and `[3.5/7]` was run early per the
    warning, which is what caught item 6.

11. **The `web/app` bundle is deliberately NOT rebuilt on this branch.** CI step
    `[6/7]` regenerates it, and an early `git add -A` swept those artifacts into
    two commits; they were rewritten out. Repo convention is a dedicated
    `build(web): rebuild app bundle on merged tree for REQ-NNNN` commit at
    INTEGRATION (see `e5dc23f`, `5edbf25`, `f002b19`), and REQ-0286 records the
    cost of a stranded bundle. `web/app` on this branch is byte-identical to
    master `112bd5d`; the rebuild belongs to whoever merges.

### Notes for REQ-0314 (`bpk`)

- Import `shared/player_actions.mjs` and `shared/placement.mjs` directly; both are
  dependency-free ESM and `import()` from plain node with no build step.
- `applyGachaRoll` needs `{ mintUid }` injected for determinism;
  `defaultRefundUidMinter` reproduces the browser's timestamp uid if you do not care.
- **`spendTM` is page-scoped.** A bot holding 6+6 LRDST across two pages cannot
  pay 10. Consolidate stacks before rolling, or expect `insufficient_lrdst`.
- **Never mint a uid for a warehouse claim** -- pass `claimed.itemUid` through;
  it is the server's finalize contract. (TM merges are the documented exception.)
- Both transitions mutate `state` in place and return the same object. Persist by
  PUTting the canvas -- that PUT *is* the commit for gacha and claim.
- `POST /api/starter/claim` grants nothing; `buildStarterUnitsState` is the whole
  of fresh-profile creation, and its result must go through `engine.migrateState`.


---

## 9. Extraction addendum — the two entangled seams, read from source

Added by the orchestrator after REQ-0309 landed. §2.2 named the functions; this
section names the *lines that are easy to get wrong*. Both were read from source
(`client/src/schedule/WorkshopPage.tsx` ~200-290, `client/src/warehouse/useWarehouseData.ts`
~152-215) — do not re-derive them, verify them.

### 9.1 `applyGachaRoll` — four subtleties

1. **`spendTM` is page-scoped and never spends across pages.** The client builds
   `pageOrder = [openPage, ...every other page]` and tries `engine.spendTM(state,
   pg, 'lrdst', cost)` on **whole pages in order** until one page's own balance
   covers the cost. A player whose LRDST is split 6+6 across two pages cannot
   afford a cost of 10 — and that is correct, existing behaviour. Reproduce the
   loop exactly; do not "improve" it into a cross-page spend.
2. **The refund mints a uid from `Date.now()`.** On placement failure the client
   refunds with `engine.tmMove(state, pg, 'lrdst_refund_' + Date.now(), [1,1],
   'lrdst', cost)`. A pure function cannot call `Date.now()` and still be
   goldenable, so the extracted signature takes an injected minter:

       applyGachaRoll(engine, state, rolled, cost, openPage, { mintUid })

   The client passes its existing timestamp minter; tests pass a counter. This is
   the one signature change §2 does not already specify — take it.
3. **A latent hole to TEST, not to silently fix.** The refund loop breaks on the
   first `refund.ok`, and the return value is **never checked afterwards**. If
   placement fails *and* no page has room for even a 1×1 TM, the cost is deducted
   and never returned — the player loses currency. G4(b) must cover exactly this.
   If it reproduces, follow §6's standing rule: record it here, fix it in a
   separate clearly-labelled commit, and tell the orchestrator. An extraction REQ
   must not quietly change behaviour, not even to fix a bug.
4. **Bonuses are best-effort and come after the BP.** `rolled.bonuses` place with
   `firstFitOrMergeTM` (pool `'tm'`) or `firstFitPlace` (everything else); a bonus
   that finds no room is simply skipped. The guaranteed BP remains the sole
   finalize gate. Keep that asymmetry.

### 9.2 `applyWarehouseClaim` — three subtleties

1. **uid reuse IS the finalize contract.** The placed item must carry
   `claimed.itemUid` verbatim — that is what `finalizeClaimingItemsForCanvas`
   scans for. A freshly minted uid would leave the row stuck in `claiming` until
   it reverted, and the player would appear to lose the item. Assert it in G4(c).
2. **Kind resolution needs content defs.** `claimed.kind === 'tm' ? 'tm' :
   claimed.kind === 'bp' ? 'bp' : itemKindOf(content, claimed.itemId)` — hence
   `defs` in the signature. Three different placement calls follow, one per kind.
3. **The BP path has a post-placement restore step, and it is state, not UI.**
   `firstFitPlaceBp` sets only id/name/color/shape/origin/unit/hpMax, so the client
   then re-applies `name`, `color`, `cellCount`, `bonuses`, `roll` from the
   verbatim payload onto the placed BP — REQ-0195d's "a bought unit stays
   byte-faithful, never re-rolled". That loop **moves into `shared/`**. Leaving it
   behind would make a bought BP silently lossy for any second client.

### 9.3 Where the seam runs

Everything from `const engine = snapshot.engine` down to (but excluding) the first
UI call is state transition and moves. These stay in the component:
`setToast`, `setError`, `setClaimErrors`, `setRollResult`, `beginClaimFadeOut`,
`pulseCellsSuccess`, `pulseTab`, `notifyStateChanged`, and every `t(locale, …)`
lookup. The extracted functions therefore return enough for the caller to drive
its own UI — at minimum `{ ok, reason, page, cells }` — and never format a message.

Rule of thumb when the seam is unclear: **if removing the line would change what
gets SAVED, it moves; if it would only change what the user SEES, it stays.**

### 9.4 Ports

REQ-0310's e2e decade is `5000 + 310*10` → **8100 / 8101 / 8102**, fleet
8104-8109. Derive with `source tools/e2e_ports.sh 0310`; never hand-pick.
(REQ-0309 lost a re-run to a hand-typed `81092`, which is not a port.)

### 9.5 A trap REQ-0309 hit that this REQ can hit again

A `.d.ts` shadows a same-basename `.js` in TS module resolution. Moving a `.js`
next to an existing `.d.ts` silently changes how every consumer types it —
REQ-0309's `[3.5/7]` went red for exactly this reason and needed an unplanned
commit. **Before creating `shared/placement.mjs` / `shared/player_actions.mjs`,
check what `.d.mts`/`.d.ts` files will end up beside them, and run `[3.5/7]`
early rather than at the end.**

Related and still open: two engine type surfaces exist (`shared/engine.d.ts` and
`client/src/engine/engine.d.ts`, now a bare re-export), while `shared/engine.js`'s
own header still names the client one as its typed surface. REQ-0309 deferred it;
this REQ is the natural place to settle it, but only if it is cheap — say so and
defer again if it is not.

---

## 10. Orchestrator ratification (2026-07-27)

Re-verified on the server: commits as reported; `git diff 112bd5d..HEAD -- client/e2e/`
**empty** (the specs are provably unmodified, which is what makes G3 a behavioural
proof rather than a claim); `web/app` byte-identical to base; `client/src/lib/placement.ts`
gone; working tree clean; `shared/` now holds `placement.mjs`/`.d.mts` +
`player_actions.mjs`/`.d.mts` + `tests/`.

### Ruling 1 — commit `f4e6cae` (the behaviour change) is RATIFIED

The implementer did exactly what §6 and STEP 4 asked: pinned the lossy behaviour as
a golden first (so commits 1-2 are provably behaviour-preserving), then flipped it
in a separate, loudly-labelled commit.

The defect is **worse than §9.1(3) described, and the correction matters**. My
addendum said the refund failed when "no page has room for even a 1×1 TM". Reading
the source more closely than I did, the implementer found the refund was a
**fixed-cell** attempt at `[1,1]` — not a first-fit scan. `tmCanPlace` accepts that
cell only when free or already holding an `lrdst` stack, so a single PO parked on
`[1,1]` of each page is enough to destroy the refund. The inventory need not be
full, or anywhere near it.

The sharpest case is the one that should worry us: when the spend drains the wallet
stack to zero, that stack's cell is freed — and the refund still fails, because it
only ever looks at `[1,1]`. **A player can lose their entire LRDST balance to a
failed gacha roll while a legal cell sits empty.** This is live today.

The fix routes the refund through `firstFitOrMergeTM` — the module's own helper,
the same path the warehouse TM claim already uses. It closes the hole rather than
narrowing it: after a page-scoped `spendTM` succeeds on page `pg`, that page either
still holds an `lrdst` stack (a merge target) or has just had a cell freed, and the
walk visits every page regardless. Nothing else changed: the spend stays
page-scoped, the uid stays injected, `no_space` still leaves the pending roll
unfinalized.

### Ruling 2 — three spec defects, all called correctly

1. **`shared/forecast.mjs` no longer exists.** §2 told the implementer to follow
   its precedent "exactly"; REQ-0308 deleted it four commits before this REQ was
   dispatched. Recovering the pattern from `74860da^` rather than guessing was the
   right call. My spec was stale by one merge — a hazard of writing specs against a
   moving master, worth remembering for 0311+.
2. **`itemKindOf` argument order** was transposed in §2.2 (`(id, defs)` vs the
   source's `(defs, itemId)`). Source order kept. Correct.
3. **G4(c) is unsatisfiable as written for a TM *merge*.** I wrote "every kind
   reuses the row uid"; `tmMove` deletes the dragged uid and keeps the destination
   stack's. The server already anticipated this — `finalizeClaimingItemsForCanvas`
   finalizes a tm row on `presentUids.has(itemUid) || presentTmIds.has(itemId)`.
   Testing both sub-cases is the right resolution. My rule was too absolute; the
   uid-reuse contract holds for po/si/bp, and the tm merge is the documented
   exception.

### Ruling 3 — the port rule is BROKEN IN THE TOOLS, and that is not this REQ's fault

§9.4 told the implementer REQ-0310's decade was 8100 (PROJECT.md: `PORT = 5000 +
REQ*10 + i`). `tools/e2e_ports.sh 0310` returns **3100/3101/3102**. Verified
independently: `tools/e2e_ports.sh:4` implements `PORT = REQ * 10 + index` with no
5000 base, and `:32-34` still carries the "cap at 6552 because 6553*10+9 would
overrun 65535" reasoning — **the exact reasoning PROJECT.md postmortems** as
"a bound that asked what the port NUMBER FIELD allows and never what the kernel
will let us bind". `tools/check_e2e_ports.cjs:46` enforces the same old formula.

So PROJECT.md (the user-maintained golden) documents a rule the tools do not
implement, and the implemented rule is the one PROJECT.md explicitly describes as
dangerous. Filed separately as REQ-0321; not fixed here. The implementer derived
via the tool and never hand-typed, which is what the instruction actually required,
so this REQ's ports are correct-by-construction either way.

### Also noted

- `refunded` added to the `no_space` result: not a behaviour change (the caller
  ignores it), and it gives REQ-0314 a hook. Accepted.
- `shared/tests` excluded from `tsconfig.server.json`, matching the existing
  `server/tests`/`sim/tests` convention. Found by running `[3.5/7]` early per §9.5 —
  which is the whole reason that instruction was in the spec.
- G4(e)'s starter-seed golden was captured from the BASE implementation via the
  real TypeScript compiler rather than a hand-strip, so it is independent of the
  port. Good instinct; do this again for 0311+.
- `[7/7]` flaked once at 4 workers (`workshop.spec.ts:121`, `Expected 1 Received 2`
  — profile contamination), green 11/11 in isolation and green serially three
  times. That is now the **third** independent observation. REQ-0222's addendum
  stands.
- `web/app` deliberately not rebuilt: the house convention is a dedicated
  `build(web): rebuild app bundle on merged tree` commit at integration. Correct,
  and it is the orchestrator's to do.

### Deploy + acceptance (2026-07-27)

`pnpm build` on the merged tree; bundle committed as `0ebd5fb`
(`build(web): rebuild app bundle on merged tree for REQ-0310`), house convention
(cf. `e5dc23f`, `5edbf25`). `backpack-web` serves `web/` statically via
`python3 -m http.server`, so no service restart is involved; the api was already
restarted for REQ-0309 and is untouched here.

Live-verified: `http://127.0.0.1:8801/app/` references `assets/index-D-R9mjKI.js`,
that asset returns 200, `/api/health` 200.

**The gacha refund fix (`f4e6cae`) is now live.** A failed roll can no longer
destroy the LRDST it just spent.

Orchestrator error worth recording, because it is a trap this repo sets: the first
attempt committed the doc edit with `git commit -am`, which swept the freshly-built
bundle (a modified `web/app/index.html` and four deleted asset blobs) into a REQ
documentation commit. Caught by inspecting the commit's own `--stat` rather than
trusting the message, then split into `2b6b6bb` (doc) + `0ebd5fb` (bundle). **Never
use `-a` in this tree**: `web/app` holds tracked build output that any client build
silently modifies, so `-a` will attach it to whatever commit happens to be next.

`built → done`: merged (`ccbf06b`), deployed (bundle rebuilt and live-verified),
accepted.
