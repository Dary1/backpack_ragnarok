# shared/ — cross-package single sources of truth (REQ-0047)

- `engine.js` — THE game engine: the placement/canvas/link model, i.e.
  the definition of what a legal canvas IS. Moved here from `mock-src/` by
  REQ-0309, byte-identical. It was always shared — server, sim, client and
  the mock all load it — it merely lived in a directory named for a
  throwaway mock, so every package had to require OUT of the tree to reach
  it, inverting the rule at the bottom of this file. Consumed AS-IS and
  NEVER forked (REQ-0026 T0.1): `server/services/core.cjs` and
  `sim/combat.cjs` plain-`require` it, `mock-src/build.py` inlines it, and
  the client loads it through `client/src/engine/adapter.ts`'s `?raw` + CJS
  shim because it is a hand-written UMD. Its typed surface is `engine.d.ts`
  beside it, pinned to the runtime by `tools/check_engine_types.cjs` (a CI
  step). Its 129 KB test suite deliberately stays at `mock-src/tests/run.cjs`
  and reaches it through a symlink.
- `content_validate.cjs` — THE validator for admin content edits
  (allowlists, closed vocab, range rules). Moved verbatim from
  `server/admin.cjs` in REQ-0047 (b). Dependency-free, no file I/O;
  callers pass `vocab` in. Error messages are part of the HTTP 400
  contract (api_test asserts them) — do not reword casually.
- `placement.mjs` (+ `placement.d.mts`) — the first-fit placement helpers
  (`firstFitPlace` / `firstFitOrMergeTM` / `firstFitPlaceBp`, plus REQ-0373's
  whole-page `arrangePage`). Promoted verbatim from
  `client/src/lib/placement.ts` by REQ-0310. ESM so Vite imports it
  unforked and node can `import()` it; dependency-free, engine passed in by the
  caller. Pinned by `client/scripts/check_placement.mjs` (REQ-0273) and
  `client/scripts/check_arrange.mjs` (REQ-0373). The first three answer "where
  does ONE new thing go?" and stay separate variants by a recorded verdict —
  read it before merging them; `arrangePage` repacks a whole page and states
  its own laws (what never moves, what it may not invent) in its header.
- `player_actions.mjs` (+ `player_actions.d.mts`) — THE three
  client-authoritative player actions as pure state transitions:
  `applyGachaRoll`, `applyWarehouseClaim`, `buildStarterUnitsState`, plus
  `itemKindOf`. REQ-0310 promoted them out of `WorkshopPage.tsx`,
  `useWarehouseData.ts` and `store/boot.ts` because the authoritative second
  phase of gacha/claim is the CLIENT's, and a second client (REQ-0314's
  headless `bpk`) reimplementing them would silently destroy players'
  inventories. No React, no chimes, no network, no message formatting: the
  caller keeps its own UI and gets `{ ok, reason, page, cells }` back. Goldens:
  `shared/tests/player_actions.cjs` (ci.sh `[3.2/7]`).

- (planned, REQ-0047 (f)) `dto.d.ts` — API payload types shared by
  client and server route JSDoc. Deferred to (f) because the client's
  current `Api*` types are entangled with hand-written engine types,
  which (e) replaces first.

Rules: modules here may not require() from server/, sim/, client/, or
mock-src/ — dependencies point INTO shared/, never out of it. Since REQ-0309
that is a fact about every module here, not an aspiration: `engine.js`, the
one that used to sit outside, contains no `require(` and no `import` at all.
