# REQ-0302 -- offsite mirror: tolerate non-ff branches (stop one diverged branch aborting the whole backup)

## Problem
backpack-mirror.service (REQ-0132; timer every 15 min -> tools/offsite_mirror.sh) had been
FAILED since ~2026-07-22. Root cause: the script runs under `set -euo pipefail` and did
`git push --all`; two feature branches diverged from their GitHub counterparts
(req-0280-schedule-ray-vfx-art-kind: merged-stale, local+9/remote+1;
req-0289-bp-grab-handle-unit-pivot-rotation: active, local+29/remote+11), so `git push
--all` returned non-zero (non-fast-forward on those two) and `set -e` aborted the ENTIRE
run -- master backup, tag push, and the daily state tarball all stopped.

## Why not just force
The mirror is deletion-safe BY DESIGN (REQ-0132: no --mirror/--prune/--force -- local
damage never propagates deletions to the backup). req-0289 has 11 commits on the mirror
that are NOT local; force-pushing would destroy backup history. So force is out.

## Fix
Tolerate the non-ff exit instead of aborting. `git push --all` still pushes master and
every fast-forwardable branch in ONE connection (fast); it only returns non-zero for the
diverged branches, which are now logged (`|| echo ...`) and left for a human to reconcile.
No --force; deletion-safe design preserved. master is also pushed explicitly first so the
critical ref is backed up even if --all has issues.

## Verification
Manual run: EXIT=0, "mirror OK: master=..., 172 branches pushed", the two diverged
branches logged as skipped, last_success stamped 2026-07-24. Service started clean
(oneshot success); timer active. Diverged branches req-0280 (stale/merged) and req-0289
remain for the owner to reconcile by hand (git push --force-with-lease after review, or
delete the stale local branch).

## Status
reserved -> done (operational hotfix, user-requested 2026-07-24).
