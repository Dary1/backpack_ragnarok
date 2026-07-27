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
