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

## Audit remediation (2026-07-25, orchestrated audit)
Grounded audit (see docs/llm_managed/2026-07-25-req-0304-0306-orchestrator-audit.md). Verdict:
READY-WITH-FIXES. The mechanism (`--check`/`--emit` + `powerlevel_calibrated_from` marker) was code-verified
present and correct. Wiring clarifications added:
- Deliverable 1 MUST be a SCRIPT `tools/predeploy_recalibrate_powerlevel.cjs` (check -> emit; emit uses the marker
  defaults alpha 0.7 / loops 8 / seeds 6 -- no custom tuning at deploy; CLEAN -> no-op, zero writes). A runbook
  line documents the script; it does NOT substitute for it (a remembered manual step is the very failure this REQ
  removes).
- Deliverable 2 (ci advisory): insert as `node tools/autobalance_pack_powerlevel.cjs --check || echo "[advisory]
  powerLevel drift"` so `set -euo pipefail` does not abort ci; ship a `--self-test`. "Flip to hard gate" = remove
  the guard. Keep ci ADVISORY only; put the HARD enforcement in the predeploy step (a hard ci gate would block WIP
  branches that edited content before recalibrating).
- `--check` is CHECKOUT-relative (ROOT = tool dir), = "live" ONLY on the main checkout @ master. Reword "live"
  accordingly.
- Deliverable 3 hook point: there is NO separate live checkout -- the main checkout @ master IS live (backpack-api
  user unit, mtime hot-reload); `deploy/` is ComfyUI units only and `tools/release.sh` deploys the client dist, not
  content. Define the hook as the MANDATORY final step of the content-deploy runbook, run on the main checkout
  after any `promote_dungeon_batch.cjs`/surgical edit and before `systemctl --user restart backpack-api`.
- Known gaps / out of scope: `content/scaling_profile.json` and sim-code changes are level-affecting but outside
  the sha dirty-set (still need a manual `--emit`); additive source batches 005/006/007 carry no powerLevel (a
  future wholesale re-promotion would drift -- same trap REQ-0305 touched). Determinism applies to
  powerLevel/packs.json (goldens + REQ-0122 lossless), NOT the wall-clock marker `date`.
- Acceptance: add a DB-free self-test for the predeploy script (dirty fixture -> emit + marker updated + --check
  clean after; run twice -> second is a no-op).
- Ordering: REQ-0305 is now SUPERSEDED, so 0306 is the sole owner of deploy-time recalibration; no ordering
  conflict remains.
Status unchanged (`todo`): still ready to implement, now with the above wiring pinned.

## Implementation (2026-08-01) -- branch req-0306-powerlevel-autobalance-deploy-hook, commit 9ffd9d59

All three deliverables landed exactly as the audit pinned them:

1. **`tools/predeploy_recalibrate_powerlevel.cjs`** (SCRIPT, not a runbook line): `check` ->
   CLEAN = no-op with ZERO writes / DIRTY = ONE batched round-robin `emit` with the MARKER
   DEFAULTS (alpha 0.7 / loops 8 / seeds 6; `autobalance({})` -- no custom tuning at deploy) +
   marker re-stamp, then a re-`check` that THROWS (exit 1) if somehow still dirty (refuses to
   report false success). Idempotent; `--check` semantics stay CHECKOUT-relative (= live only on
   the main checkout @ master), per the audit rewording. The check/emit/autobalance tool is
   injectable, which is what makes the DB-free self-test possible; the REAL mechanics remain
   REQ-0297's and are untouched (zero diff to autobalance_pack_powerlevel.cjs).
2. **ci.sh [3.997/7]**: `--self-test` runs HARD; the drift check is the audit-verbatim ADVISORY
   `node tools/autobalance_pack_powerlevel.cjs --check || echo "[advisory] ..."` so
   `set -euo pipefail` cannot harden it by accident. "Flip to hard" = delete the `|| echo`
   guard (documented in-line). Hard enforcement deliberately lives in the predeploy script, not
   ci (a hard ci gate would block WIP branches).
3. **Hook point**: NEW `docs/llm_managed/content_deploy_runbook.md` -- the content-deploy runbook
   the audit found missing. The predeploy script is its MANDATORY final content step, run on the
   MAIN checkout after any promote_dungeon_batch.cjs/surgical edit, before committing the
   regenerated files and `systemctl --user restart backpack-api`. Known gaps recorded verbatim
   (scaling_profile.json + sim-code outside the sha dirty-set -> manual --emit; additive source
   batches 005/006/007 carry no powerLevel -> sync before wholesale re-promotion).

## Gate results (2026-08-01, on the worktree)

- `tools/ci.sh`: **CI GREEN**, scope=both (FULL gate: files+pg api, typecheck, client build,
  admin-e2e 28/28, registry-first e2e 4/4, client e2e fleet), 344s. Receipt re-minted on the
  final tree (see branch HEAD).
- `predeploy_recalibrate_powerlevel.cjs --self-test`: 10/10 assertions (dirty-no-marker acts;
  post-emit clean; marker records defaults; second run no-op with byte-identical files; re-dirty
  re-acts; non-stamping emit -> STILL DIRTY throw).
- END-TO-END dirty path against REAL content (worktree, then reverted): whitespace-touched
  live skills.json -> predeploy reported DIRTY(skills.json), recalibrated 14 packs in 20.8s,
  re-stamped marker, ended CLEAN -- and the regenerated packs.json was BYTE-IDENTICAL to the
  pre-touch bytes (determinism + REQ-0122 lossless preserved, acceptance's "goldens
  byte-identical" trivially so since content/ was restored). Clean path verified as a true
  zero-write no-op (git status clean).

## Acceptance mapping

- auto-regenerate on level-affecting edit, clean deploy skips, marker tracks: predeploy script +
  runbook step (hard point) -- VERIFIED above.
- ci advisory flags dirty-but-uncalibrated checkout: [3.997/7] advisory -- in place, report-only.
- deterministic/reproducible: byte-identical packs.json on re-emit of unchanged content --
  VERIFIED (marker `date` wall-clock exempt, as specced).
