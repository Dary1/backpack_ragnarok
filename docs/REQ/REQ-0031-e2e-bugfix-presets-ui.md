# REQ-0031 Phase A -- E2E rig + two bug fixes: outcome

Status: DONE. This file documents what actually happened during Phase A
(server-side headless-Chromium E2E rig, plus fixing the two
already-known-broken behaviors: inventory tab-switch freeze, and BP
inventory<->canvas transfer). No prior `docs/REQ/` directory existed in
this repo before this file -- REQ-000x labels up to this point were a
commit-message-only convention, never backed by a written spec doc. This
file is written after the fact, as a record of Phase A's outcome, not as
a spec that preceded the work.

## 1. E2E rig

- `client/playwright.config.ts`, `client/e2e/global-setup.ts` /
  `global-teardown.ts`, `client/e2e/smoke.spec.ts`.
- Chromium was already installed on this box
  (`~/.cache/ms-playwright/chromium-1228`) and launched successfully; no
  missing-shared-library fallback was needed. (If it ever is needed on a
  fresh box: `npx playwright install-deps --dry-run` prints the exact
  `apt-get` command without running it, since this environment has no
  sudo.)
- `baseURL` is the public tunnel hostname (`https://backpack-dev.qtie.jp`),
  confirmed via curl BEFORE writing the config: `127.0.0.1:8801/api/content`
  404s (no local proxy from the static-file port to the API port); only
  the tunnel's ingress rule splits `/api/*` to `:8802`.
- Profile safety: `global-setup.ts` backs up `data/profiles/default.json`
  (sha256-recorded) before any test runs; `global-teardown.ts` restores
  it byte-for-byte after, verified via a second sha256 comparison, even
  on test failure.
- See `server/README.md`'s new "E2E test suite" section for exact run
  commands and the full test-file list.

## 2. Bug 2 -- inventory tab-switch freeze

**Root cause** (confirmed live, via a CDP `Debugger.pause` taken
repeatedly mid-hang, not just by reading code): `InventoryBoard.tsx`
destroyed and recreated its whole PixiJS `Application` (a new WebGL
context on the same `<canvas>`) on every tab switch.
`Application.destroy()` releases the GL context via
`WEBGL_lose_context.loseContext()`, which is ASYNCHRONOUS per the WebGL
spec -- the very next line of the same effect flush immediately created a
NEW context on that same canvas, racing the still-in-progress teardown.
Under this server's software GL path (swiftshader, no real GPU here),
that race left the driver permanently unable to compile shaders
afterward, sending PixiJS's `GlLimitsSystem.contextChange() ->
checkMaxIfStatementsInShader()` into its `while(true)` retry loop
FOREVER -- confirmed by the debugger landing on that exact stack frame
every single pause attempt, and the renderer process's CPU climbing to
~100% and staying there (16+ seconds observed with no recovery in that
window).

**Fix**: `BoardRenderer.setOps()` re-points an already-mounted board at a
different `BoardOps` (re-registering the `drag.ts` board registry entry
under the new `BoardId`) with NO Application/canvas/context churn.
`InventoryBoard.tsx` now mounts once per boot and swaps ops on tab
change via a second effect.

**Evidence**: `client/e2e/tab-switch-stability.spec.ts` -- FAILED before
(`Test timeout of 25000ms exceeded`, hung on the second tab click) PASSED
after (9.6s for all 15 clicks, 3 rounds).

## 3. Bug 1 -- BP inventory<->canvas transfer sometimes silently failing

**Root cause** (confirmed live via a repeated-drag harness with temporary
instrumentation): every PixiJS `Application`'s `EventSystem` attaches its
own native `pointermove` listener directly on `document` (not scoped to
its own `<canvas>`). With two independent Applications (canvas board +
inventory board), EVERY mouse move during a drag fires
`globalpointermove` on BOTH boards' stages -- including whichever board
the pointer is NOT physically over, which maps the (foreign) screen
coordinates into its own local space and can compute a legal-looking (or
illegal) cell purely by coincidence, then unconditionally overwrites
`carry.drop`. Whichever board's handler ran LAST for a given native event
won the race. The ENGINE side (`canTransferBP`/`transferBP` in
`mock-src/engine.js`) was independently verified correct beforehand via a
standalone Node sanity script -- this was purely a client
interaction-layer race, never an engine rule gap.

**Fix**: `BoardRenderer.onGlobalPointerMove` now only acts as the
authority for a move event when the pointer is actually within its own
canvas's current `getBoundingClientRect()`; otherwise it clears its own
ghost/target visuals but leaves `carry.drop` untouched.

**Evidence**: `client/e2e/bp-transfer.spec.ts` (4 tests, run with
`--repeat-each=2` since this was a race, not deterministic every single
attempt) -- 3 of 8 runs FAILED before the fix (`expect(moved).toBeTruthy()`
receiving `undefined`), 8/8 PASSED after.

## 4. Gate (final)

- Engine tests (`node mock-src/tests/run.cjs`): 31/31.
- API tests (`node server/tests/api_test.cjs`): 9/9.
- Sprite check (`node client/scripts/check_sprites.mjs`): 21/21.
- `npx tsc -b --noEmit`: clean.
- `npx vite build` run twice back-to-back: byte-for-byte identical output
  (`diff -rq` on both `web/app/` trees reported no differences).
- Full E2E suite: 10/10 passed.
- `curl https://backpack-dev.qtie.jp/app/`: HTTP 200, referencing the
  freshly-built bundle hash.
- Live profile file sha256 unchanged before vs. after this entire
  session's work (see the Phase A session's own report for the exact
  hash pair).

## 5. Ambiguities resolved by judgment

- The default scenario has no BP sitting in inventory and no free PO
  outside a BP by default (a legacy scenario, migrated on load) -- a
  custom fixture canvas (PUT to `/api/profile/default/canvas` as test
  setup) was built for both the bug-1 tests and the baseline free-PO/
  rotate tests, rather than trying to force the default scenario into
  those shapes.
- The "live data indicator" is `Header.tsx`'s `.data-source-badge`
  element, text `"live"`, class `badge-live` when `source==='live'`.
- The rotate-PO baseline test intentionally targets `tower_shield` (a 2x2
  PO), not the first PO tried (`dagger`) -- several POs in the fixture
  legitimately reject a 90-degree rotation in their current position
  (Dead Space / occupied, correct engine behavior), so the PO used for
  this smoke test was chosen specifically because engine.rotatePO()
  reports it as unconditionally legal there (verified via a direct
  engine sanity check before writing the test).
