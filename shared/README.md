# shared/ — cross-package single sources of truth (REQ-0047)

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
mock-src/ — dependencies point INTO shared/, never out of it.
