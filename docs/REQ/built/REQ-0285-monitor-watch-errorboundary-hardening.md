# REQ-0285 — Monitor Watch error-boundary + roster mount hardening (freeze-class close-out)

**Status:** Built
**Reserved / built:** 2026-07-22
**Slug:** monitor-watch-errorboundary-hardening
**Follow-up of:** REQ-0284 (monitor-mount-freeze-hotfix), which itself repaired a REQ-0283 regression.

## Why (owner report, live, backpack-dev /app/#/schedule)
After REQ-0284 deployed (bundle index-CUfhEA_S.js) the owner reported the "Watch"
freeze ("The troop is forming up…" then the whole view hard-locks/blanks) STILL
happens in their environment. This REQ ran the LIVE app AS THE OWNER'S OWN PLAYER
(the most-recently-active pg profile, a Supabase guest — `p_2867d894921c`,
namespaced `88d662ca20e5289b:` = sha256(REPO_ROOT)[:16]) via a full, read-only
scoped-harness replica (their exact canvas + room + lastRun copied into a scoped
`e2e_ownerrepro` profile, driven headless against the DEPLOYED bundle with the
tunnel's /api→:8802 ingress split).

## What the same-player repro actually showed
The deployed bundle **renders the owner's real data cleanly** — modern run (roster
of 8 placed enemies), a legacy rosterless run, settled + Play@4× + skip-end, and a
unit-less-BP variant ALL mount and replay with no throw, no hang, no blank
(screenshot-captured). REQ-0284's fix IS live and correct. The owner's *current*
persisted state does not, by itself, reproduce the freeze on the shipped code.

## Root cause (the class REQ-0284 diagnosed but only half-closed)
REQ-0284's own root-cause note recorded the real mechanism: *"There is no error
boundary anywhere in the client, so the uncaught throw tears down the React root —
the entire Watch view goes blank (the freeze)."* REQ-0284 patched the ONE throw
site it had found (the unit-less-BP `seatCell` deref) but left the CLASS open:

1. **No error boundary** anywhere in the client (confirmed by grep: zero
   `componentDidCatch`/`getDerivedStateFromError`). ANY uncaught throw in the
   Monitor subtree still tears down the whole React root → the identical
   freeze/blank, for any not-yet-enumerated data shape.
2. **One remaining UNGUARDED synchronous mount-time throw path**:
   `Monitor.tsx` `setRoster(run.roster)` → `EnemyPlane.setRoster` →
   `buildActor`, whose `for (const [r,c] of cells)` iterates the run roster's
   `fieldCells` raw. A malformed cell (a bare number, a non-pair, a NaN — a
   shape neither e2e's fresh runs nor REQ-0284 enumerated) throws
   `"<x> is not iterable"` / produces NaN geometry, UNGUARDED, right at monitor
   mount while the feed still shows "forming up" — exactly the reported symptom.
   (Every e2e fixture and every one of the owner's *current* runs happen to carry
   well-formed rosters, so neither the suite nor the live snapshot hit it.)

## Fix (minimal, defense-in-depth — closes the whole class)
1. `schedule/MonitorErrorBoundary.tsx` (new): a React error boundary wrapping the
   Monitor in `SchedulePage`. Any uncaught render/effect throw in the Watch
   subtree now degrades to a localized, retryable card (`schedule-monitor-error`,
   en+ja) — the rest of the schedule keeps working. The whole-app freeze/blank
   symptom is now structurally impossible. Keyed on the room id (remount + clears
   a prior error on room switch).
2. `schedule/monitorActors.ts` `EnemyPlane.setRoster` — each enemy is built inside
   its OWN try/catch; `sanitizeFieldCells()` keeps only finite `[row,col]` pairs
   first; non-finite `hpMax` is skipped. A single malformed roster entry degrades
   to "skip this one enemy" (its lazy first-seen fallback still fires), never a
   throw — mirroring `applyEvents`' per-event guard.
3. `schedule/Monitor.tsx` — the `setRoster` call is wrapped in try/catch (the one
   unguarded synchronous mount path), belt-and-suspenders with (1) and (2).

## Regression test
`client/e2e/schedule.spec.ts` — REQ-0285 spec: mounts the monitor, then drives the
exact (previously) unguarded mount path via a new `__monitorDebug[room]
.setTestRoster()` seam with a roster of **2 well-formed enemies + 1 malformed**
(`fieldCells:[5]`). Pre-fix the `setRoster` throw propagated (the whole Watch view
blanked); post-fix it returns **2** built actors (malformed skipped), the monitor
stays mounted, and NO error card shows. The REQ-0284 unit-less-BP regression stays
green (no regression from these changes).

## Gates
`tsc -b` clean; `oxlint` 0 errors (44 pre-existing warnings, none in changed
files); scoped schedule e2e (REQ-0285 decade, derived ports) — REQ-0284 + REQ-0285
regressions both GREEN.

## Residual risk
The fix closes the uncaught-throw class (the documented freeze mechanism). It does
NOT change behaviour for the owner's current well-formed data (renders identically
before/after). If the owner's residual freeze were instead a non-throw cause (a GPU
driver hang, or an infinite loop inside a single event handler — none found: every
`applyEvents` handler is try/caught and the ray-VFX trail self-destroys per
animation), the error boundary would not catch it; no such cause was found in code
or in the exhaustive same-player replay.
