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
- The same harnesses trap EXIT only. Bash does not run an EXIT trap when the
  shell dies on an uncaught fatal signal, so a SIGTERMed harness -- the exact
  abort the gate names -- runs no cleanup at all and leaks everything.
- `tools/e2e_fleet.cjs:78` `killManifest()` calls `process.kill(w.pid, ...)`
  even though workers are spawned `detached: true` (line 104). The group
  exists; the code just does not use it. Same orphan class.

This is not a cosmetic gap. An orphaned harness pinning its REQ decade is the
concrete harm REQ-0236 documents: a dead session's leftover run held the 156x
decade ~30 min per attempt and blocked the REQ-0234 gate run until a human
killed it by hand.

**Where the fix is.** The retired branch `req-0231-ci-cross-session-hygiene`
(archived, tip 90ce737) implemented all three, with the abort gate measured:
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
