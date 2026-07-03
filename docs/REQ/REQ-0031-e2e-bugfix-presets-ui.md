# REQ-0031 -- E2E rig + two bug fixes (Phase A) + auto-save/8x8/presets/UI (Phase B): outcome

Status: Phase A DONE, Phase B DONE. This file documents what actually
happened during Phase A (server-side headless-Chromium E2E rig, plus
fixing the two already-known-broken behaviors: inventory tab-switch
freeze, and BP inventory<->canvas transfer) and Phase B (auto-save, 8x8
grids, the engine preset model, tab-row UI restructure, long-press
rename -- see the dedicated section near the end of this file). No prior
`docs/REQ/` directory existed in this repo before this file -- REQ-000x
labels up to this point were a commit-message-only convention, never
backed by a written spec doc. This file is written after the fact, as a
record of each phase's outcome, not as a spec that preceded the work.

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

## Phase B outcome (2026-07-04, DONE)

Implemented in server repo ~/backpack_ragnarok, 5 commits:
  (a) 5438f6e -- canvas + inventory page grid 6x6 -> 8x8. content/live/
      scenario.json's layout field is the single source of truth for
      BOTH canvas dims (mock-src/data.js's LAYOUT, regenerated via
      tools/tool_gen_data.cjs) and inventory page dims (engine.js's
      page() grid == canvas ROWS x COLS by design, unchanged since
      REQ-0030) -- one JSON edit + one regenerate covered the whole
      requirement, no engine code change needed. All 4 existing BPs'
      origins/placements stayed legal unchanged (max prior extent was
      row/col 6, comfortably inside 8x8). One test fixed (a hardcoded
      [6,6] out-of-canvas probe became legal at 8x8; now derives the
      probe from Data.LAYOUT.ROWS+1/COLS+1 so it stays correct at any
      grid size). 31/31 green.
  (b) 4ec2814 -- engine preset model (ADDITIVE): st.presets={active,
      names,store}, store[active] always null (content lives at the
      top-level st.{linked,bps,pos,sis} fields, unchanged shape/API).
      New API: PRESET_COUNT/makePresetsMeta/emptyPresetSlot/
      switchPreset/addPreset/renamePreset/renameInvPage/invPageNames/
      checkUidInvariant. migrateState() extended to materialize
      st.inv.names and st.presets on any pre-Phase-B saved profile
      (idempotent otherwise). +13 tests (switch round-trip preserves
      BOTH configs, no-op/out-of-range, addPreset empties + name
      growth, rename incl. defensive materialization, uid-invariant
      fresh-pass + injected-duplicate-caught across switchPreset and
      across the shared inventory, migration upgrade + idempotency).
      44/44 green.
  (c) ca9a77d -- client auto-save. Choke point: store.ts's
      notifyStateChanged(), confirmed the ONE function every committed
      engine mutation already flows through (every drag-drop/rotate/
      seat-stow commit, chain-link toggle, loadGame()'s field
      replacement) and NEVER called mid-drag (drag.ts's carry pub-sub
      is separate and never touches `state`) -- so "don't save while a
      drag is in progress, commit then save" required zero extra guard
      code. 800ms debounce, monotonic-token-guarded PUT, three-state
      indicator (saved/saving/offline). Save/Load buttons retired from
      Header.tsx; boot-time load unchanged (fully automatic).
  (d) 3226fe0 -- tab-row UI restructure + preset UI + long-press
      rename. New shared LongPressTabs.tsx (pointerdown 600ms timer +
      8px move-cancels-timer, used by both Tabs.tsx and new
      PresetTabs.tsx) so a long-press arms an inline rename input while
      a plain click still switches immediately on pointerup. Inventory
      tabs moved into the "Inventory" label row (right-aligned); the
      "items parked here take no effect" note moved below the
      inventory board, left-aligned. Canvas title row gained
      PresetTabs.tsx (preset tabs + "Preset+" button, appends+switches
      via one action). Preset switching needed NO setOps()/Application
      churn (unlike inventory page switching): canvas ops already read
      state.bps/pos/sis directly, so switchPreset() mutating those same
      fields + notifyStateChanged() is everything Board.tsx's existing
      render-on-stateVersion-bump effect needs; beams/combos always
      recompute fresh from state on every render, so no extra
      invalidation was needed for the newly-active preset's own
      connections either.
  (e) f937757 -- E2E extensions + full gate + deploy. New specs:
      grid-8x8, preset-switch (place+switch+switch-back via drag,
      Preset+), long-press-rename (both tab kinds, Escape-cancel,
      short-click-still-switches), auto-save (zero-click persistence
      round trip, mid-drag-does-not-save). Existing specs (bp-transfer,
      baseline-smoke) updated to use a new shared client/e2e/helpers.ts
      instead of clicking the now-retired Save button. Bug found+fixed
      during this gate: the 8x8 grid widened each board from ~556px to
      716px, overflowing the E2E rig's 1400x1000 viewport and wrapping
      Canvas above Inventory -- every drag-based spec failed with the
      target simply never having moved (grab point computed outside the
      viewport). Fixed via playwright.config.ts (2000x1400 viewport,
      re-specified inside projects[0].use since devices['Desktop
      Chrome']'s own viewport otherwise wins over the top-level
      default).

Gate (final, all green): engine tests 44/44 (31 pre-existing + 13 new);
server/tests/api_test.cjs 9/9; tsc -b --noEmit clean; oxlint 0/0;
vite build succeeds; node scripts/check_sprites.mjs 21/21 non-blank;
E2E full suite 21/21 (smoke 2, baseline-smoke 3, bp-transfer 4,
tab-switch-stability 1, grid-8x8 3, preset-switch 2, long-press-rename
4, auto-save 2); pages 200 (/, /app/, /mock/, /preview/batch-001/,
/preview/batch-001/fit/); web/app/ + web/mock/ redeployed; real profile
(data/profiles/default.json) proven byte-identical throughout via
direct sha256sum (e0b1015a73039498d6757a7ed3757400a6b1240b0a4bf71528000f27e9319846)
across 3 full E2E runs' global-teardown plus this session's own
before/after checks; git tree clean after every commit.

No deviations from the task spec; the only unplanned addition was the
E2E viewport fix (a genuine latent config bug the 8x8 change exposed,
not a scope change).
