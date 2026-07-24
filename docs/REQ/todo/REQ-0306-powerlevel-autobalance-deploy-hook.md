# REQ-0306 - Wire the powerLevel auto-adjuster dirty-trigger into the deploy pipeline

**Status:** todo (RATIFIED: REQ-0297 Phase 3 decided the dirty-trigger; user 2026-07-24 asked to wire the
auto-hook as a follow-up). The MECHANISM exists (REQ-0297: tools/autobalance_pack_powerlevel.cjs --check /
--emit + the `powerlevel_calibrated_from` registry marker); it is currently run MANUALLY (the parallel
REQ-0299 did `--emit` by hand). This REQ makes it AUTOMATIC + batched at deploy.

## Decision (REQ-0297 Phase 3, verbatim intent)
Editing LEVEL-AFFECTING content (skill / monster / monster_pack) marks the pack domain DIRTY -- detected by
comparing the live content sha256 (registry.json) of skills/enemies/packs against the stored
`powerlevel_calibrated_from` marker. The all-pairs round-robin auto-adjuster runs ONCE, BATCHED, at
MERGE/DEPLOY time when dirty (a pre-deploy step), regenerates every pack.powerLevel, records the new marker,
and ships the regenerated packs.json. A clean (non-dirty) deploy skips it. NOT per single edit.

## Current gap
`deploy/` holds only systemd units; content deploy is the manual surgical sync (+ tools/promote_dungeon_batch.cjs).
No step runs `--check`/`--emit`, so recalibration is a thing to REMEMBER -- exactly what the parallel REQ-0299
had to do by hand.

## Deliverables
1. **Pre-deploy recalibration step** `tools/predeploy_recalibrate_powerlevel.cjs` (or a documented deploy-runbook
   step): run `autobalance_pack_powerlevel.cjs --check`; if DIRTY, run `--emit` (regenerate all pack.powerLevel
   via the deterministic round-robin, update the `powerlevel_calibrated_from` marker), then the regenerated
   packs.json + registry go out via the existing surgical content-deploy path (REQ-0122 lossless kept green).
   If CLEAN, no-op. Idempotent, deterministic, batched (once per deploy).
2. **Machine-enforced guard** in tools/ci.sh: an ADVISORY step that FAILs/WARNs if the live level-affecting
   content is dirty vs `powerlevel_calibrated_from` (i.e. a deploy landed content without recalibrating). Ship
   report-only first (exit 0, prints the drift); flip to a hard gate once the pre-deploy step is reliably run.
3. Hook it into wherever a level-affecting content change is promoted (after promote_dungeon_batch.cjs /
   surgical sync, before the live checkout is finalized) so a monster/skill/pack change can never deploy with
   stale powerLevel.

## Acceptance
- After a monster/skill/pack edit, the deploy step auto-regenerates powerLevel (no manual `--emit`); a clean
  deploy skips it; the marker tracks the last calibration; the ci advisory flags a dirty-but-uncalibrated live.
- Deterministic/reproducible; goldens byte-identical (powerLevel is inert to the sim goldens -- REQ-0301 also
  makes any content change golden-safe).

## Gate results
_(on build)_
