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
- `forecast.mjs` + `forecast.d.mts` — THE ray-forecast fold (REQ-0057):
  walkRayPath (a walkRay-equivalent geometry walker), the analytic
  entry-cell distribution, and forecastPressure(). ESM so the client can
  `import` it through Vite unforked and node can `await import()` it in
  sim/tests. Dependency-free; its copies of sim's FIELD/RAY/JITTER
  constants are pinned to sim's originals by
  `sim/tests/forecast_parity.cjs`, which also proves the walker is
  byte-equal to `sim/lib/ray.cjs`'s walkRay. Edit the walker and that gate
  goes red — by design.
- (planned, REQ-0047 (f)) `dto.d.ts` — API payload types shared by
  client and server route JSDoc. Deferred to (f) because the client's
  current `Api*` types are entangled with hand-written engine types,
  which (e) replaces first.

Rules: modules here may not require() from server/, sim/, client/, or
mock-src/ — dependencies point INTO shared/, never out of it. Since REQ-0309
that is a fact about every module here, not an aspiration: `engine.js`, the
one that used to sit outside, contains no `require(` and no `import` at all.
