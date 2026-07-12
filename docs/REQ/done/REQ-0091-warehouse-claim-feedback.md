# REQ-0091 — Warehouse claim button: press flash + SFX, fade-out on response, double-press guard

- **Status**: DONE (2026-07-07) — implemented on branch
  `req-0091-warehouse-claim-feedback` (worktree
  `~/backpack_ragnarok_worktrees/req-0091-warehouse-claim-feedback`, off
  `master` @ `e43e0bc`), commit `5df66ad`. **MERGED AND DEPLOYED**
  (2026-07-07, user go-ahead given in-session): merge commit `10622cc`
  on `master`, `backpack-web` restarted, live e2e re-verified (§6). Gates
  green (§5, one pre-existing/unrelated failure noted, not caused by
  this REQ). Scope class: **client-only, additive**; no server/DTO
  change.
- Origin: direct user instruction via this Cowork session, verbatim
  (`https://backpack-dev.qtie.jp/app/#/warehouse`):

  > claimボタンを押下したら、枠がフラッシュ演出して、効果音が鳴るようにしてください。
  > サーバ側からAPI応答が返ってきたら、フラッシュ演出をフェイドアウト演出にしてから削除させてください。
  > また、CLAIMボタンをその間に二回押せないようにしてください。

  (On pressing the claim button: flash the frame and play a sound
  effect. When the server's API response comes back, transition the
  flash into a fade-out before removing it. Also make sure the CLAIM
  button cannot be pressed twice during that window.)

## 1. Recon (before touching anything)

- Claim UI lives in `client/src/warehouse/WarehousePage.tsx` (extracted
  to its own top-level route by REQ-0086; two-phase claim design from
  REQ-0041, re-skinned by REQ-0072). `handleClaim(itemUid)`:
  `setClaimingUid(itemUid)` → `await apiClaimWarehouseItem(itemUid)`
  (the POST — this IS "サーバ側からAPI応答が返ってきたら", confirmed via
  `api.ts`'s `claimWarehouseItem`, a plain `scheduleJSON` POST that
  resolves/rejects exactly at the HTTP response) → client-side engine
  first-fit placement → cell/tab pulse → `notifyStateChanged()`
  (auto-save) → toast → `reload()`; `finally { setClaimingUid(null) }`.
- The button already wears `disabled={isClaiming}` + a `.placing` green
  pulse (`schedule-claim-btn.placing`, `@keyframes
  schedule-warehouse-place-pulse`, index.css) — but `claimingUid` is
  React state (batched/async), so a second native click arriving before
  the disabled attribute actually repaints could still re-enter
  `handleClaim` for the same row. No existing guard closes that window
  synchronously.
- No flash effect and no audio of any kind exists anywhere in this app
  today: `grep`-checked `client/src` for `audio`/`.mp3`/`.wav`/`.ogg`/
  `sfx`/`new Audio`, `client/package.json` for `howler`/`tone` — all
  empty. There is no asset pipeline or designer-authored sound to reuse
  (unlike the served `/redesign/assets/*.jpg` art convention).
- `.schedule-warehouse-row` (the row's own `<article>`, "枠"/frame) is
  the natural target for a press-flash — distinct from the claim
  button's own `.placing` pulse, which continues through phase 2 (engine
  placement/auto-save) rather than ending at the API response.

## 2. Design

- **Flash + chime, on press, immediately** (before the network
  round-trip starts): a new per-row `claimFx` state
  (`Record<uid, 'flash'|'fadeout'>`, keyed by itemUid rather than a
  single value like `claimingUid` — claim-all walks rows sequentially,
  but a fade-out timer from the PREVIOUS row can still be running while
  the NEXT row's flash starts, and the two must not stomp each other)
  drives a `schedule-claim-flash` class on the row (looping glow,
  `index.css`). `playClaimChime()` (new `warehouse/claimSfx.ts`)
  synthesizes a tiny two-note chime via the Web Audio API at call time —
  deliberately NOT a binary asset, since none exists and inventing one
  with no designer/pipeline behind it would be exactly the kind of
  "invented, unowned" data this project avoids elsewhere (see REQ-0072's
  own "omitted — no backing data" list). Best-effort: every failure mode
  (autoplay policy, unsupported/headless browser) is swallowed silently,
  same posture as this page's other non-critical touches.
- **Fade-out the moment the response is known**: `beginClaimFadeOut(uid)`
  swaps the class to `schedule-claim-fadeout` (one-shot CSS animation)
  and clears it entirely after `FLASH_FADEOUT_MS` (450ms, ≥ the 0.4s
  animation + margin — same "duration + margin" convention as the
  existing `TAB_PULSE_MS`). Called from TWO points: right after
  `apiClaimWarehouseItem` resolves (success path, before any client-side
  placement work), and as the first line of `catch` (covers the claim
  POST itself failing, or any later synchronous error in the same try —
  either way the attempt has concluded). This precisely matches "when
  the server's API response comes back" rather than "when the whole
  claim flow — including client-side placement — finishes", which can
  take visibly longer and is already separately indicated by the
  button's own `.placing` state.
- **Double-press guard**: `claimLockRef` (`useRef<Set<string>>`) is
  checked-and-added synchronously as the FIRST line of `handleClaim`,
  before any state update — a ref mutates immediately on the calling
  thread, closing the exact batched-state race the `disabled` attribute
  alone cannot. A blocked re-entrant call is a silent no-op (no second
  chime/flash, no second network request).

## 3. Implementation

- `client/src/warehouse/claimSfx.ts` (new, 63 lines): `playClaimChime()`
  — lazily-created shared `AudioContext`, two sine-wave notes
  (880Hz/1318.51Hz) with exponential gain envelopes (avoids click
  artifacts), wrapped in try/catch.
- `client/src/warehouse/WarehousePage.tsx`: `claimFx` state +
  `claimLockRef` ref (near the existing `claimingUid`/`claimingAll`
  state); `clearClaimFx`/`beginClaimFadeOut` helpers; `handleClaim`
  gains the guard check, the press-time flash+chime, and the two
  `beginClaimFadeOut` call sites (success path post-await; top of
  catch); `finally` also releases `claimLockRef`. `renderRow`'s
  `<article>` className gains a `fxClass` (`schedule-claim-flash` /
  `schedule-claim-fadeout` / none). Module header comment extended to
  record this REQ, same convention REQ-0072/0086 used.
- `client/src/index.css`: new `.schedule-warehouse-row.schedule-claim-
  flash` / `.schedule-warehouse-row.schedule-claim-fadeout` rules +
  `@keyframes schedule-warehouse-claim-flash` / `-fadeout` (gold glow,
  `rgba(235,217,164,*)` — matches `--gold-hi`, distinct from the
  button's own green `.placing` pulse and the red `.is-danger` inset).
  Inserted right after the existing place-pulse keyframes; documented as
  a NEW hook, not part of REQ-0072's kept selector contract.
- `client/e2e/warehouse-mjolnir.spec.ts`: one new test in the real-
  backend claim describe. Delays (never fabricates) the REAL claim
  response via `page.route('**/api/warehouse/claim', ...)` +
  `route.continue()` after a 900ms timer, giving a deterministic window
  to: (a) assert the row carries `schedule-claim-flash` and the button
  `.placing` while in flight; (b) fire two native `.click()` calls
  back-to-back inside one `page.evaluate` (before React can ever repaint
  `disabled`) and assert exactly ONE request reached the route —
  proving the synchronous `claimLockRef` guard, not just the
  (also-real) `disabled` attribute, is what closes the race; (c) assert
  the class becomes `schedule-claim-fadeout` once the delayed response
  lands, then is fully removed after the fade-out's own duration; (d)
  confirm the underlying claim still finalizes normally (toast,
  auto-save, canvas placement) underneath the FX. `npx playwright test
  --list` enumerates it correctly (5 tests in the file, was 4).
- Dist rebuild (`web/app/`) committed alongside source, this project's
  standing convention.

## 4. New hooks (not load-bearing for any older spec)

`schedule-claim-flash`, `schedule-claim-fadeout` (both applied to the
existing `.schedule-warehouse-row`, never a new element). Nothing in
REQ-0072's kept selector contract (`.schedule-warehouse-row`,
`schedule-claim-btn-<uid>`, `.schedule-claim-btn`, `.placing`, etc.) was
renamed, removed, or repurposed.

## 5. Gates

| gate | result |
|---|---|
| `node mock-src/tests/run.cjs` (via `test:quick`) | 100 / 0 (unaffected — no engine touch) |
| `node sim/tests/run.cjs` | 63 / 0 (unaffected — no sim touch) |
| sim replay goldens (determinism contract) | OK (unaffected) |
| engine type-surface drift check | OK, 49 members (unaffected) |
| `node server/tests/api_test.cjs` (files backend) | 153 / 0 (unaffected — no server touch) |
| `npx tsc -b` (client) | clean |
| `npm run build` (client: `tsc -b && vite build`) | clean, 795 modules |
| `npx playwright test --list` on `warehouse-mjolnir.spec.ts` | parses clean, 5 tests enumerated (was 4) |

**Pre-existing, unrelated** (confirmed, not caused by this REQ):
`node_modules/.bin/tsc -p tsconfig.server.json` (the server/shared
checkJs gate) fails on `server/pg_sync.cjs(59,86|100)`
(`TS2339: Property 'message' does not exist on type 'unknown'`).
Verified by running the identical command against `master`
(`~/backpack_ragnarok`, HEAD `e43e0bc`) directly, with no branch
checked out — same two errors, same lines, completely independent of
this worktree. This REQ never touches `server/`.

**Deferred**: `STORAGE_BACKEND=pg` server tests (server untouched,
orthogonal) and full e2e EXECUTION. This suite's `global-setup.ts`
backs up/restores the shared `data/profiles/default.json` and POSTs to
`http://127.0.0.1:8802` (the LIVE `backpack-api`, hardcoded, regardless
of `E2E_PARALLEL` fleet mode — confirmed by reading `tools/
e2e_fleet.cjs` and `global-setup.ts` directly: fleet mode isolates the
per-worker `/api/*` traffic during the test body via `local-proxy.cjs` +
`X-E2E-Worker`, but setup/teardown's own debris-clear hooks and profile
backup always hit the live service directly) — so running e2e now,
even in "isolated" fleet mode, would touch shared live state from an
unmerged branch. Same posture REQ-0086/REQ-0087 both recorded for the
identical reason; deferred to the coordinated merge/deploy step below.

## 6. Merge & deploy (done, with two real incidents handled live)

User authorized merge + live restart directly ("進めてください") after
reviewing this REQ's BUILT state in chat.

1. **`web/app/index.html` had an unrelated uncommitted change in the
   main checkout** (`~/backpack_ragnarok`) at merge time — a single
   `<script src>` line pointing at a different build hash, alongside
   dirty `content/vocab.json` / `tools/build_dungeon_preview.py` and new
   untracked `content/batches/batch-004-*` / `web/preview/*` content.
   Pattern strongly matches PROJECT.md's HANDS-OFF art-session activity
   (a preview/build tool run touching `web/app/` as a side effect, not
   an intentional deploy). Per "never commit or checkout over a
   collaborator's uncommitted files", this was NOT stashed or discarded
   blind — flagged to the user first. By the time `git stash push --
   web/app/index.html` actually ran (after the user's go-ahead), the
   file was already clean again on its own ("No local changes to save")
   — the other session had resolved it independently in the meantime.
   No stash was created; nothing of anyone else's was touched. The
   OTHER dirty files (`content/vocab.json`, `tools/
   build_dungeon_preview.py`, the untracked batch-004/preview content)
   were never touched at any point, per the user's explicit instruction
   to leave concurrent work alone.
2. **`master` had drifted** (`e43e0bc` → `f1e1ec1`: REQ-0090's Dismantle
   panel multi-select) while this REQ was in flight, breaking the
   planned `--ff-only`. Diffed `e43e0bc..master` first: real (non-dist)
   overlap was exactly one file, `client/src/index.css`, in a completely
   different section (REQ-0090 edited the Workshop/Dismantle modal
   block ~line 5124; this REQ's own addition sits in the Warehouse-tab
   block ~line 3560) — confirmed low-risk before merging, and `git merge
   --no-ff` auto-merged `index.css` cleanly with zero manual
   intervention, exactly as predicted.
3. The ONLY real conflicts were generated dist artifacts (`web/app/
   assets/index-*.css` and `init-*.js` rename/rename, `web/app/
   index.html` content) — both branches had independently rebuilt dist
   with different hashes. Resolved by removing the stale conflicting
   generated files (both sides) and rebuilding fresh from the now-merged
   source (`npm run build`: 796 modules, clean) rather than
   hand-resolving generated bytes, then committing the merge
   (`10622cc`).
4. Reran the full local gate suite on merged `master`: sim 63/63,
   goldens OK, mock-src 100/100, engine-drift OK, server `api_test`
   files-mode 153/153, client build clean (796 modules, up from 795 —
   REQ-0090's new `useListMultiSelect.ts` module).
5. Restarted `backpack-web` only (client-only change; `backpack-api`
   left running undisturbed). Verified via curl: local `:8801/app/` 200
   with the fresh `index-lPCCdoFg.js` hash, `:8802/api/health` 200, and
   the public tunnel (`https://backpack-dev.qtie.jp`) 200 on both
   `/app/` and `/api/health`.
6. Ran `warehouse-mjolnir.spec.ts` (all 5 tests, including this REQ's
   new one) against the LIVE public site — the real e2e confirmation
   deferred in §5: **5 passed, 0 failed (38.2s)**, including the new
   press-flash/double-press-guard/fade-out test. Global teardown
   confirmed the shared profile + both `content/live/*.json` files
   restored byte-identical (sha256 match=true on all three).

Net result: live and verified. `https://backpack-dev.qtie.jp/app/#/warehouse`
serves the new claim-press flash/chime/fade-out/double-press-guard
behavior.
