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

*(to be filled at build time.)*

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
