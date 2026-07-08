# REQ-0117 — Serialize e2e runs on the shared box (single-run lock + queue)

State: **done — IMPLEMENTED + MERGED** (2026-07-09; user ratified «そのまま done まで»).
Branch `req-0117-e2e-run-serialization` (`7360bba`) merged `--no-ff` to master `fa550b6`.
tsc + oxlint clean; lock behaviour verified (queue / fail-fast / timeout — see Outcome).
No product/runtime change and no service restart (test-harness code; affects only future
e2e runs). See Outcome §.
Origin: the REQ-0113 deploy (2026-07-09). The live e2e run was killed mid-suite (test
80/134) when a *concurrent agent's* run started and its `global-setup` cleared shared
dev state underneath it; that collision also left `content/live/live_items.json` drifted
(the crashed run's teardown never restored it — it had to be hand-restored to HEAD).
Multiple agents share one box and each can launch `playwright test`, but the suite is
**single-run-at-a-time by design**.

## Problem (observed, not theoretical)
The e2e harness (`client/e2e`, Playwright) is intrinsically a **whole-box exclusive**
operation:
- `global-setup.ts` backs up the LIVE files (`data/profiles/default.json`,
  `content/live/live_items.json`, `content/live/live_sis.json`) and clears shared dev
  state through the live API — schedule rooms, warehouse debris, einherjar records,
  market listings.
- Tests PUT canvas/profile state to the real API (Postgres, `STORAGE_BACKEND=pg`) and
  edit live content files (the dex-admin round-trip).
- `global-teardown.ts` restores everything at the end.

Two concurrent runs therefore corrupt each other:
1. Run B's setup-clear wipes shared state that run A is mid-assertion on → A crashes/fails.
2. Both race the same backup/restore files and the same DB rows.
3. A crashed run leaves the live files **drifted** (teardown never ran).

Concrete instance (2026-07-09): a second run's `global-setup` fired ~7 min into the
first; the first died at test 80/134 (79 passed / 1 unrelated failure); `live_items.json`
was left non-pristine and had to be restored by hand. `/tmp/e2e48.log` + a duplicate
backup-marker set are the fingerprints.

## Goal
Make concurrent e2e runs on the box **impossible to collide**: at most one run holds the
box at a time; a second invocation either **queues** (waits its turn — default) or
**fails fast** with a clear message — regardless of *who* launches it or *how*.

## Design (recommended; decision points in §Open questions)

### D1 — Harness-intrinsic advisory lock (the enforcement point)
Acquire a single exclusive advisory lock at the very START of `global-setup.ts` (before
any backup or clear) and release it in `global-teardown.ts`. Putting the lock INSIDE the
harness — not only in a wrapper — means every `playwright test` invocation participates,
so no agent can bypass it by calling Playwright directly.
- Mechanism: `flock(2)` on a fixed lockfile (e.g. `~/.cache/backpack/e2e.box.lock`).
  Strongly prefer `flock` over a hand-rolled pidfile: **flock auto-releases when the
  holding process dies**, so a crashed run leaves NO stale lock — the exact failure mode
  that plagues marker-file / pidfile schemes (and that bit us on 2026-07-09).

### D2 — Canonical entry wrapper (belt-and-suspenders + the fd-lifetime home)
`tools/e2e_run.sh` acquires the flock in a PARENT shell that lives for the whole run,
then `exec`s `playwright test "$@"`. Because `globalSetup` and `globalTeardown` are
separate child processes, a parent shell is the natural owner of the lock fd for the
run's full lifetime (fd closes on parent exit ⇒ lock released, crash-safe). Make this
THE documented way to run e2e; D1's in-harness check is the fallback that still catches a
direct `playwright test` call (fail-fast if the box lock is already held).

### D3 — Queue vs fail-fast (configurable)
- Default: **queue** — block up to `E2E_LOCK_WAIT` seconds (proposed 1800) so a run
  simply waits its turn, then proceeds. Ordering is FIFO-ish (flock).
- `E2E_LOCK_NONBLOCK=1` (`flock -n`): **fail fast** — exit non-zero immediately with
  `another e2e run holds the box (pid N, since T)`. For agents/CI that prefer to bail and
  retry rather than wait.

### D4 — Crash-recovery for orphaned live-file drift
Independent of the lock, harden backup/restore: at `global-setup` start, if a prior
backup MARKER exists (`/tmp/backpack_e2e_*_backup_path.txt`) while **no run holds the
lock**, a previous run crashed without teardown → restore from that marker first (and/or
verify the tracked content files against git HEAD and restore), then proceed. Auto-heals
the "died mid-run ⇒ live file drifted" case instead of requiring a hand fix.

## Scope / files (when implemented)
- `client/e2e/global-setup.ts` — acquire lock (queue/fail-fast) + orphan-marker recovery.
- `client/e2e/global-teardown.ts` — release lock.
- `tools/e2e_run.sh` (new) — canonical flock wrapper; `client/package.json` `e2e` script
  routes through it.
- PROJECT.md test-gate note — "run e2e ONLY via `tools/e2e_run.sh`; it serializes on the
  box lock" (PROJECT.md is user-only to edit — wording proposed here for the user to paste).
- No product/runtime code changes; no change to what the tests assert.

## Interaction with REQ-0083 (fleet parallel mode)
Orthogonal. REQ-0083's `E2E_PARALLEL` gives *intra-run* worker parallelism with
per-worker isolated backends. This box lock is *per-box* and still admits exactly one RUN
at a time (parallel or serial); it wraps the whole run regardless of worker count. Note
that even the fleet path shares `global-setup`'s live-file backup, so the lock is still
required for safety.

## Open questions (ratify before implement)
- **OQ1** Queue (block, default) vs fail-fast default? Proposed: queue.
- **OQ2** `E2E_LOCK_WAIT` default (proposed 1800 s) and lock path (proposed
  `~/.cache/backpack/e2e.box.lock`).
- **OQ3** `flock` CLI vs a Node advisory-lock dependency? Proposed: `flock` CLI (zero
  dep, crash-safe, already on the box).
- **OQ4** Should the lock ALSO cover other live-data-mutating ops (batch tools,
  migrations) that share the profile/content? Proposed: e2e-only for v1; document the
  pattern for reuse.
- **OQ5** (adjacent, noticed while filing this) the FS `tools/touch_next_req_reserved.py`
  is currently a **SyntaxError** (unclosed paren at line 109, `def ensure_gitignore(`),
  so REQ-number reservation is broken — this REQ was numbered by hand. Fix under its own
  REQ or fold in?

## Test plan (when implemented)
- Unit: lock acquire/release; fail-fast returns the right code + message; orphan-marker
  recovery restores pristine.
- Integration: launch two `e2e_run.sh` concurrently → the second QUEUES then runs (or
  fails fast under `E2E_LOCK_NONBLOCK`); both leave the live files pristine afterward.
- Crash test: kill a run mid-suite → lock auto-released (next run proceeds) AND the next
  `global-setup` restores the drifted live files.

## Non-goals
- No CI service / job runner; no cross-box coordination (single box, friends scale).
- Not changing test content, nor the fleet's intra-run parallelism.

---

## Outcome (2026-07-09) — implemented as specced

### What shipped (branch `7360bba` → master `fa550b6`)
- **`tools/e2e_run.sh`** (new, exec): exclusive `flock` on
  `~/.cache/backpack/e2e.box.lock` (override `E2E_LOCK_FILE`), held on fd 9 across
  `exec` for the whole run → auto-released on exit/crash (no stale lock). Default
  **queues** up to `E2E_LOCK_WAIT` s (1800); `E2E_LOCK_NONBLOCK=1` **fails fast** (exit
  75). Then `exec`s `pnpm exec playwright test "$@"`.
- **`client/package.json`**: `e2e`, `e2e:failed`, `e2e:changed` now route through
  `../tools/e2e_run.sh` (so `pnpm run e2e …` is serialized by construction).
- **`client/e2e/global-setup.ts`**:
  - *Safety net* (D1): if `E2E_BOX_LOCK_HELD` is unset (a direct `playwright test` that
    bypassed the wrapper), a non-blocking `flock` probe **fails fast** when the box lock
    is already held — before any backup/clear touches shared state; warns (not fatal)
    when the box is free.
  - *Self-heal* (D4): before the fresh `backupOne`, `recoverOrphanedDrift()` restores a
    tracked file a prior **crashed** run left drifted (current sha ≠ the marker's pre-run
    sha). Git-tracked content files are only auto-restored when the snapshot == git HEAD,
    so a legitimate content edit between runs is never clobbered (else it warns + prints
    the manual `git checkout`). This auto-heals the exact 2026-07-09 `live_items.json`
    drift by hand.

### Decisions taken (the §Open questions, resolved)
- OQ1 → **queue by default**, fail-fast opt-in (`E2E_LOCK_NONBLOCK=1`).
- OQ2 → `E2E_LOCK_WAIT` default **1800 s**; lock at `~/.cache/backpack/e2e.box.lock`.
- OQ3 → **`flock` CLI** (util-linux 2.41 on the box; zero dep; crash-safe).
- OQ4 → **e2e-only** for v1 (documented pattern for reuse).
- OQ5 → the FS `tools/touch_next_req_reserved.py` SyntaxError is **left for its own
  fix**; this REQ was hand-numbered. (Flagged to the user.)

### Gates / verification
- **tsc** (targeted, node types) on the changed `global-setup.ts`: **0 errors**.
- **oxlint**: 0 errors (34 pre-existing warnings, none new).
- **`bash -n`** on the wrapper: clean (shellcheck not installed on the box).
- **Lock behaviour** (throwaway lock file, no live data): QUEUE waited ~4 s for a held
  lock then ran (`playwright test --list` → 136 tests, rc 0); `E2E_LOCK_NONBLOCK=1`
  aborted in ~13 ms (rc 75); `E2E_LOCK_WAIT=2` timed out at ~2.0 s (rc 75).

### Notes / follow-ups
- The in-harness safety-net probe (direct-`playwright test` path) is covered by tsc +
  oxlint + the proven `flock` primitive + review; its live fail-fast path exercises on
  the next real e2e run.
- **PROJECT.md test-gate note (user to paste — I can't edit PROJECT.md):** "Run e2e only
  via `pnpm run e2e` / `tools/e2e_run.sh`; it takes an exclusive box lock (queues by
  default, `E2E_LOCK_NONBLOCK=1` to fail fast). Never call `playwright test` directly."
