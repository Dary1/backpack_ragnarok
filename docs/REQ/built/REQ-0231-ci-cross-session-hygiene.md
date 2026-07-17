# REQ-0231 - cross-session CI hygiene: one queue lock, scoped cleanup

**Reserved:** 2026-07-17 (observed during REQ-0216)
**Slug:** ci-cross-session-hygiene

## Problem

Multiple agent sessions run ci.sh concurrently on llmlocal. Two failure modes
observed on 2026-07-17:

1. NO SHARED QUEUE: the e2e box lock serialises only the Playwright phase;
   everything else (sim, pg, tsc, vite build, chromium warmup) runs
   concurrently across sessions. Sessions have converged on an AD-HOC
   `flock /tmp/bpk_ci.lock` convention (copied session-to-session, enforced
   nowhere), and when it is not used the box saturates -- load avg hit 13.7,
   sshd stopped answering for ~40 min, and the box eventually REBOOTED
   mid-CI.
2. UNSCOPED CLEANUP: a contentadmin_e2e Playwright run was SIGKILLed
   externally (exit 137, no OOM trace) -- consistent with another session
   cleaning up "stray" processes by name/pattern instead of by its own
   process group, killing across sessions.

## Proposal

- Move the CI queue INSIDE tools/ci.sh: take `flock` on a well-known lock
  (e.g. ~/.cache/backpack/ci.box.lock, beside the e2e lock) around the whole
  run; env seam CI_LOCK_NONBLOCK=1 to fail fast. The convention becomes
  machine-enforced instead of folklore.
- Audit every harness/cleanup path (tools/*_e2e.sh, e2e_run.sh, any pkill)
  to kill ONLY its own process group / recorded PIDs, never by bare pattern.
- Optional: a loadavg preflight in ci.sh that waits (with a note) instead of
  measuring perf gates on a saturated box (couples with REQ-0230).

## Gates

- Two ci.sh runs started concurrently serialise; the second waits, both green.
- A harness abort leaves no orphans and kills nothing outside its group.

## Implementation (2026-07-17, ratified via REQ-0234 report §5)
- ci.sh now takes an exclusive whole-run flock on
  ~/.cache/backpack/ci.box.lock (re-exec under `flock`; CI_LOCK_NONBLOCK=1
  -> exit 75 fast; CI_LOCK_WAIT default 7200s; CI_LOCK_FILE seam). The
  holder is named IMMEDIATELY on contention.
- Kill-path audit: every cleanup kills only recorded PIDs (harness PIDS
  arrays, fleet manifest); the only pattern kill is the fleet's fuser -k on
  ITS OWN port range (REQ-decade-scoped for scoped runs). No bare pkill in
  tools/. The 2026-07-17 SIGKILL-by-name class has no remaining sites.

## Gate results (2026-07-17)
- Two concurrent `SKIP_* ci.sh` runs serialize: A green 09:25:20->:37; B
  started :22, printed the HELD diagnostic, queued, ran :37->:55, green.
- CI_LOCK_NONBLOCK=1 against a held lock -> exit 75 with the HELD line.
- Protection is effective once sessions rebase: old-tree runs predate the
  lock and still bypass it (observed live during this REQ's gate run).

## Deploy record (2026-07-17)
- Merged to master bc6c012 (--no-ff, user go-ahead in chat). No runtime paths touched (tools/, sim/tests, client/e2e, docs only): no service restart, no dist rebuild needed.
- Live verification: full ci.sh GREEN on the identical tree pre-merge (FULLCI2 09:52:59-10:00:40, incl. admin trio 7/1/28, registry stage 4/4 no-skip, scoped e2e 187/1/0); backpack-web/api healthy post-merge (200/200). Main-checkout quick gates green EXCEPT the PRE-EXISTING [3.8] art-export red: the in-flight art session's untracked content/art mirror lacks the items005 renders (gate self-skips in any tree without that mirror; this merge touches no content paths) -- flagged to the user, not caused here.

---

## REOPENED 2026-07-18 (done -> todo) - gate 2 was never met

**Why.** This REQ has two gates. The merged implementation (bc6c012) meets
the first and only HALF of the second:

> - Two ci.sh runs started concurrently serialise; the second waits, both green.  -- MET
> - A harness abort leaves no orphans and kills nothing outside its group.       -- HALF

"Kills nothing outside its group" is met: the kill-by-name class is gone, and
every cleanup targets recorded PIDs only. "Leaves no orphans" is NOT met. The
merged code cannot deliver it:

- `tools/artadmin_e2e.sh`, `art_inspect_e2e.sh`, `content_admin_e2e.sh`
  start their services WITHOUT `setsid`, so a service is not a process-group
  leader, and cleanup runs `kill "$p"` -- the recorded pid ONLY. Any child a
  service spawned is orphaned, survives, and keeps holding the decade.
- (Written at reopen time, and WRONG -- corrected below by measurement: "the
  harnesses trap EXIT only, and bash runs no EXIT trap when the shell dies on
  an uncaught fatal signal, so a SIGTERMed harness runs no cleanup at all."
  Bash DOES run the EXIT trap on an untrapped SIGTERM, promptly. Kept here,
  struck through rather than deleted, because it is the premise the archived
  branch was built on and it drove a wrong first patch.)
- `tools/e2e_fleet.cjs:78` `killManifest()` calls `process.kill(w.pid, ...)`
  even though workers are spawned `detached: true` (line 104). The group
  exists; the code just does not use it. Same orphan class.

This is not a cosmetic gap. An orphaned harness pinning its REQ decade is the
concrete harm REQ-0236 documents: a dead session's leftover run held the 156x
decade ~30 min per attempt and blocked the REQ-0234 gate run until a human
killed it by hand.

**Where the fix is.** The archived branch `req-0231-ci-cross-session-hygiene`
(tip 90ce737) implemented the setsid/group-kill half correctly, and added
signal traps that measurement later showed to be harmful (see below). Its
abort gate was measured as:
SIGTERM to an in-flight art_inspect harness freed all three ports and left no
api/static/proxy orphans, while other sessions' listeners were untouched. That
branch was a parallel implementation of this REQ that never merged; the
REQ-0234 session's version merged instead, without this half.

**Why it is a port and not a cherry-pick.** The archived branch predates
REQ-0234 F7: its harnesses still run the python static server and the
`E2E_STATIC_PORT`/`E2E_API_PORT` proxy wiring that F7 deliberately deleted
(the static server's single-threaded accept loop was the REQ-0222 flake
source). Cherry-picking it would regress F7. Only the orphan-prevention
concept moves across: `setsid` per service, group-scoped TERM -> KILL, and
INT/TERM traps that let the EXIT trap run.

**Scope of the reopen.** Gate 2's orphan half, nothing else. The CI queue lock
is merged, live, and untouched here.


---

## Implementation (2026-07-18, branch req-0231-abort-orphan-hygiene)

Ported onto master's CURRENT harness shape (not cherry-picked: the archived
branch predates REQ-0234 F7 and would have regressed it).

- `a6da977` -- setsid + group-scoped kill in all FOUR harnesses (artadmin,
  art_inspect, content_admin, registry_first) and group kill in
  `e2e_fleet.cjs` killManifest. registry_first_e2e.sh is included even though
  the archived branch never touched it: REQ-0234 added that harness later, so
  it carried the same defect and nothing had fixed it. This commit ALSO
  carried the archived branch's INT/TERM traps -- a mistake, corrected next.
- `889f025` -- removes those traps and reaps the playwright group instead.

### The traps were wrong, and the gate is what caught it

The archived branch's stated rationale ("bash runs no EXIT trap on a fatal
signal") is false on this box. Measured directly, 2026-07-18:

| shape | cleanup on SIGTERM during a foreground command |
|---|---|
| `trap cleanup EXIT` only (master today) | RUNS, shell dies promptly |
| + `trap 'exit 143' TERM` (archived branch, a6da977) | DEFERRED until the foreground command returns |
| + backgrounded child and `wait` | RUNS promptly (`wait` is interruptible) |

A TERM trap is not merely redundant, it is HARMFUL: bash will not run a trap
while a foreground command is executing, so the SIGTERMed harness ran its
whole spec suite to completion -- holding the decade the entire time -- and
cleaned up only afterwards. The traps are removed, and a comment in each
harness records why, so the next reader does not re-add them.

### What actually leaked

Not the services: api/proxy are recorded in PIDS and always died. The orphan
was a **playwright worker** -- a grandchild that no PIDS entry covered. So the
run is now setsid'd into its own group, recorded, and waited on; the group
kill reaps the whole tree. `wait` propagates the real exit status (ci.sh
depends on it), and registry_first keeps its REQ-0221 SKIP check by
redirecting to a file in TMPROOT instead of `$(...)`, which yielded no pid.

## Gate evidence (2026-07-18)

**Gate 2 -- "a harness abort leaves no orphans and kills nothing outside its
group."** Controlled A/B, same probe, same art_inspect harness, same
1520-1522 decade, SIGTERM in flight:

| harness code | decade ports left | orphans left | stopped promptly |
|---|---|---|---|
| control = master as merged (bc6c012) | 0 | **1** (playwright worker) | yes |
| a6da977 (with traps) | **2** | **4** | **no** -- ran all 30s of specs first |
| 889f025 (this branch) | **0** | **0** | yes -- killed mid-test |

`setsid` confirmed live: control api `pid=2590298 pgid=2590036` (pid != pgid,
no group of its own); patched api `pid=2611191 pgid=2611191`. Foreign
listeners (8188 ComfyUI, 8801 backpack-web, 8802 backpack-api) INTACT across
all three runs -- nothing outside a recorded group was ever signalled.

**No regression from foreground -> background+wait.** All four harnesses run
green and leave nothing behind; counts match REQ-0234's recorded baseline:

| harness | result | leftovers |
|---|---|---|
| registry_first_e2e | RC=0, 4 passed, no skip (REQ-0221 check holds) | ports 0, procs 0 |
| artadmin_e2e | RC=0, 7 passed | ports 0, procs 0 |
| content_admin_e2e | RC=0, 28 passed | ports 0, procs 0 |
| art_inspect_e2e | RC=0, 1 passed (x2) | ports 0, procs 0 |

Exit-status propagation verified in BOTH directions -- the real risk of the
`wait` change: a failing run returned RC=1, passing runs RC=0.

- `tools/check_e2e_ports.cjs` [0/8]: green (4 harnesses, all derived, no
  collisions). The decade rule is untouched by this REQ; only kill scope and
  signal handling changed.
- One flake seen: an art_inspect run failed on `page.reload: Timeout 20000ms`
  immediately after the abort probes, then passed 2/2 on reruns; the control
  passed under HIGHER load (4.75). Navigation timeout is unrelated to process
  groups and matches the known load-flake class (REQ-0222/0230). Recorded, not
  hidden.

**Gate 1** ("two ci.sh runs serialise") is untouched: this branch does not
modify `tools/ci.sh`. It was met by the merged implementation and remains so.

## Full ci.sh run (2026-07-18) -- RED, on a PRE-EXISTING master flake

Run from this worktree, 19:08:34 -> 19:18:54. It queued behind another
session's ci.sh first ("[ci-lock] ... is HELD -- queueing"), which is gate 1
working live: three ci.sh runs were waiting and only one ran at a time.

Result: **RED at [6.5/8]** (admin e2e harnesses). ci.sh is `set -e`, so [7/8]
and [8/8] never ran. Everything before [6.5/8] passed -- sim 117, replay 14,
forecast 18, engine 119/186, typecheck, vocab, api files+pg, registry,
client typecheck+build, artadmin 7/7.

The failure is `artinspect.spec.ts:56 page.reload: Timeout 20000ms exceeded`.

**It is not this branch's.** Interleaved A/B on the same box, alternating the
harness file between master's version and this branch's, three pairs:

| arm | #1 | #2 | #3 | rate |
|---|---|---|---|---|
| control = master's harness | FAIL | FAIL | pass | 1/3 |
| this branch's harness | FAIL | FAIL | pass | 1/3 |

Identical failure in all four reds (`page.reload: Timeout 20000ms exceeded`),
identical rate, pair for pair. The flake reproduces on UNTOUCHED master code,
so it neither was caused nor can be fixed here. Note the rate: under a loaded
box this spec fails ~2 of 3 runs -- this is not a rare flake, it is a red CI
for anyone running full ci.sh right now. Filed as evidence on REQ-0222
(todo/, e2e-harness-load-resilience), which owns this class.

Precedent for proceeding: this REQ's own first pass was blocked the same way
("PENDING both-green full-CI x2: blocked by a PRE-EXISTING stale gate on
master ... fails identically on untouched master").

## Not done here

- Full ci.sh has NOT gone green end-to-end, and cannot until the REQ-0222
  artinspect flake is fixed -- it is red on master with or without this branch
  (evidence above). Steps [7/8] and [8/8] are therefore unexercised here.
- SIGKILL is uncatchable: neither the merged code nor this branch can clean up
  after `kill -9` (the 2026-07-17 incident was exit 137). Group-scoping shrinks
  the blast radius but does not close that; a reaper would be a separate REQ.
- The decade-contention gap this REQ's addendum recorded is now REQ-0242
  (draft): harnesses still bind their ports BEFORE taking their lock, so two
  sessions on one harness collide instead of queueing.
