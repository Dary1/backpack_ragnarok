# Content-deploy runbook (live dungeon/skill/monster content)

Premise: main checkout @ master IS live (mtime hot-reload); recalibrate marker flow per REQ-0306.
Expires-when: replaced by an automated deploy gate.

_Created by REQ-0306 to give deploy-time powerLevel recalibration a concrete,
named chokepoint. There is NO separate "live checkout": the MAIN checkout
`~/backpack_ragnarok` @ `master` IS live (the `backpack-api` user unit serves
it with mtime hot-reload). `deploy/` holds ComfyUI systemd units only, and
`tools/release.sh` deploys the client dist, not content -- so this runbook is
the only content-deploy path._

All steps run on the MAIN checkout, in order:

1. Land the content change on `master`: merge the worktree branch, run
   `tools/promote_dungeon_batch.cjs`, or make a surgical edit of
   `content/live/dungeon/*.json` (REQ-0122 lossless rules apply).
2. **MANDATORY final content step:** `node tools/predeploy_recalibrate_powerlevel.cjs`
   (REQ-0306). Checkout-relative `--check` against the
   `powerlevel_calibrated_from` marker; DIRTY -> ONE batched all-pairs
   round-robin `--emit` with the marker defaults (alpha 0.7 / loops 8 /
   seeds 6) + marker re-stamp; CLEAN -> no-op with ZERO writes. Never skip it
   on "my change was not level-affecting": the clean path is cheap and writes
   nothing. This script -- not a remembered manual `--emit` -- is the hard
   enforcement point; the ci.sh [3.997/7] drift check is ADVISORY only.
3. Commit whatever step 2 regenerated (`content/live/dungeon/packs.json`,
   `content/batches/batch-002-dungeon-pilot/packs.json`,
   `content/registry.json`) on `master`.
4. `systemctl --user restart backpack-api`
   (needs `export XDG_RUNTIME_DIR=/run/user/$(id -u)`).

Known gaps (manual `node tools/autobalance_pack_powerlevel.cjs --emit` still
required; outside the sha dirty-set -- candidates for their own REQ):

- `content/scaling_profile.json` edits and sim-code changes are
  level-affecting but NOT detected by `--check`.
- Additive SOURCE batches (batch-005/006/007 `packs.json`) carry no
  powerLevel; sync them before any wholesale re-promotion (flagged by
  `--emit` output), or the re-promotion drifts.
