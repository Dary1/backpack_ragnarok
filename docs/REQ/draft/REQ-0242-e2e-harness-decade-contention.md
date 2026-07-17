# REQ-0242 - e2e harness decade contention: bring-up must happen under the lock

**Reserved:** 2026-07-18
**Slug:** e2e-harness-decade-contention

## Status

draft - AGENT-FILED (2026-07-18, chat). Blocked on an owner decision before
work may start: the fix changes the locking contract of every admin harness,
and option (a) below has a same-description deadlock hazard that PROJECT.md
already flags for ci.sh. Needs ratification of the approach, not just of the
problem.

## Provenance

Carried over from REQ-0231's gate-run addendum, which recorded this as an
observed, out-of-scope RESIDUAL GAP and named a follow-up REQ as the remedy.
REQ-0231 itself was implemented and merged by the REQ-0234 session (bc6c012)
and is `done/`; its own branch (req-0231-ci-cross-session-hygiene) was a
duplicate implementation and was retired on 2026-07-18 with user go-ahead,
so this file is the ONLY surviving record of the gap. The addendum's text is
quoted in full at the bottom.

## Problem

Derived ports (REQ-0172) guarantee that two DIFFERENT REQs' harnesses never
collide. They do nothing about two SESSIONS running the SAME harness: both
resolve to the same decade by construction. The serialization lock that is
supposed to cover that case is taken too late to do so.

Ordering in `tools/artadmin_e2e.sh` on master (c10a7d6); art_inspect_e2e.sh
and content_admin_e2e.sh follow the identical pattern:

| line | action |
|------|--------|
| 32 | `source e2e_ports.sh 0156` - derive ports, preflight them |
| 50-67 | start api + local-proxy - **the decade is BOUND here** |
| 70-77 | wait up to ~60s for both to accept connections |
| 83-84 | `e2e_run.sh` - **the lock is acquired here**, ~40-60s too late |

Three consequences:

1. **The lock cannot serialize what it claims to.** artadmin_e2e.sh:79-82
   says of its harness-scoped lock: *"Same-harness runs still queue."* They
   do not. A second session dies at the line-32 preflight (exit 75) or on
   bind, long before it ever reaches the lock at line 83. The lock only
   serializes the Playwright phase of runs that already WON the port race.
   The comment states an intent the code order does not deliver.

2. **The preflight is a TOCTOU check, not a reservation.** Lines 32 and 50
   are separated by shell work. Two harnesses starting inside that window
   both pass the preflight, then both bind; the loser's node silently fails
   to bind, and its specs die on exactly the ECONNREFUSED cascade that
   e2e_ports.sh:71-75 exists to prevent. Checking a port is free is not the
   same as holding it.

3. **The diagnostic actively misleads.** e2e_ports.sh:88-90 asserts a
   collision "is a LEFTOVER PROCESS, never two REQs clashing." Sound for two
   REQs, wrong for two sessions on one harness - the observed case. It sends
   the reader hunting a stray process that does not exist.

Observed, twice, during REQ-0231's own gate run (2026-07-17): req-0232's and
req-0222's live artadmin harnesses legitimately held 1560-1562; two full-CI
runs aborted at [6.5/8] with exit 75. Politely, and with a clear line - but
they aborted, and a run that should have QUEUED instead needed a human retry.

Not covered by the REQ-0231 CI lock: `ci.box.lock` serializes whole `ci.sh`
runs against each other, so two post-0234 ci.sh runs never reach this. The
gap is live for (i) harnesses invoked DIRECTLY, outside ci.sh - which is how
they are documented to be run - and (ii) any pre-0234 tree, whose ci.sh has
no lock at all (REQ-0236).

## Proposal

**(a) Acquire the harness lock FIRST, hold it across bring-up + specs.**
Preferred. Move the flock to the top of each harness, before e2e_ports.sh,
and hold it through cleanup. The lock - not the port check - becomes the
arbiter, which makes the line-82 promise true and closes the TOCTOU: no
second harness can be in bring-up at all, so there is nothing to race.

Hazard to design around: `e2e_run.sh` would then try to lock a file the
caller already holds. PROJECT.md and ci.sh both flag same-description flock
deadlock. The seam already exists - e2e_run.sh:56 EXPORTS
`E2E_BOX_LOCK_HELD=1` as an output; invert it into an input, so e2e_run.sh
skips locking when its caller declares the lock held. Must be an explicit
handshake, not a guess.

**(b) Session-offset ports.** Rejected, recorded so it is not re-proposed: a
decade is 10 wide, 0/1/2 are static/api/proxy and 4-9 are the REQ-0217 fleet.
There is no room for a session axis without abandoning PORT = REQ*10 + index.

**(c) Status quo** - exit 75 + human retry. The current interim behaviour.

Whichever lands, fix the e2e_ports.sh:88-90 diagnostic to name same-harness
contention as a cause alongside leftover processes.

## Gates

- Two sessions start the SAME harness concurrently: the second QUEUES on the
  lock and then runs green - it does not exit 75. (Today: it exits 75.)
- Neither run's services are killed or unbound by the other; each cleans up
  only its own process groups (REQ-0231 invariant, must not regress).
- A harness invoked directly (not via ci.sh) still works standalone, and a
  full ci.sh run still passes with the nested lock - specifically, no
  same-description deadlock: ci.sh -> harness -> e2e_run.sh completes.
- `tools/check_e2e_ports.cjs` [0/8] stays green (the decade rule is unchanged
  by this REQ; only the acquisition ORDER changes).

## Out of scope

- The PORT = REQ*10 + index rule itself (unchanged).
- Retiring/rebasing stale worktrees - REQ-0236 owns that; it is the other
  half of the "old trees bypass the protections" story.
- The REQ-0217 freeze mechanism.

## Appendix - REQ-0231 addendum, verbatim (source of this REQ)

> RESIDUAL GAP (observed, out of scope, candidate follow-up REQ): derived
> ports prevent inter-REQ collisions, but two SESSIONS running the SAME
> harness still contend for one decade, because harnesses bind ports BEFORE
> e2e_run.sh takes the box lock. Moving bring-up under the box lock (or
> session-offset ports) would close it; exit-75 + retry is the interim
> behaviour.

Since that was written, REQ-0234 (F2) moved the admin harnesses off the box
lock onto per-harness locks (e2e.<REQ>.lock). That does not change the gap -
it sharpens it: the per-harness lock is keyed to exactly the decade under
contention, so it is the RIGHT lock, merely taken at the wrong time.
