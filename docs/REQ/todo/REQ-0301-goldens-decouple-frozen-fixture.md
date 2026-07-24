# REQ-0301 - Decouple determinism goldens from editable content (dedicated frozen fixture)

**Status:** todo (user 2026-07-24: "unpin the goldens from the batch-002 roster; reconsider what the
golden actually is"). Unblocks the pack-fix (editing batch-002/live packs must NOT force a golden rebaseline).

## HANDOFF
- SSH `ssh -i ~/.ssh/backpack_ed25519 qtie@192.168.0.6`; worktree `~/backpack_ragnarok_worktrees/req-0301-goldens-decouple-frozen-fixture` (branch same; off master). Node via nvm. sim/ dependency-free. STATUS: NOT STARTED.

## Problem (what the golden IS, today -- wrong)
`sim/tests/goldens.cjs` reads its content from EDITABLE live/batch files:
- line 22-23: `content/live/scenario.json`, `content/live/live_items.json`.
- line 26-31: `content/batches/batch-002-dungeon-pilot/{enemies,skills,dungeon,packs}.json`.
- line 52-58 (REQ-0207): pins dungen by faking `os.homedir()` to a temp dir seeded from batch-002, so
  `dungen.generate('default'/'test_fixed')` reads the dungeon domain (enemies/skills/packs/dungeon.json/
  dungeons/gimics/formations/items) from batch-002.
So `sim/tests/goldens/replay_hashes.json` is pinned to that content: ANY edit to those files (e.g. adding
monsters to a pack) drifts the hashes and forces a rebaseline. A determinism golden must freeze the ENGINE
(same input -> byte-identical replay), NOT track editable content.

## Fix
1. Create a DEDICATED, FROZEN goldens fixture `sim/tests/goldens/fixture/` = a byte snapshot of EXACTLY the
   content goldens.cjs reads TODAY: the batch-002 dungeon domain files + content/live/scenario.json +
   content/live/live_items.json (copy the current bytes verbatim). This fixture is OWNED by the test and is
   NEVER touched by content work (add a README noting: edit here only to deliberately re-freeze the engine
   contract, never to track live content).
2. Redirect ALL of goldens.cjs's content reads to the fixture: the direct reads (22-31) AND the homedir-fake
   target (54-58) point into `sim/tests/goldens/fixture/`. dungen still resolves via the faked homedir, but
   now the fake is seeded from the FIXTURE, not from `content/batches/batch-002`.
3. BYTE-IDENTICAL: the fixture is a copy of current content, so `node sim/tests/goldens.cjs` reproduces every
   stored hash; `sim/tests/goldens/replay_hashes.json` is UNCHANGED. Verify both `check` (default) and a
   `gen` dry-run produce identical hashes. Do NOT edit replay_hashes.json.
4. Supersede REQ-0207's batch-002 pin (document it): the golden fixture is now content-independent and
   self-owned. Update the header comment in goldens.cjs.

## Acceptance
- `node sim/tests/goldens.cjs` -> BYTE-IDENTICAL (replay_hashes.json untouched, git-clean).
- `node sim/tests/run.cjs` green.
- PROVE the decoupling: after the fixture is in place, a temporary edit to `content/batches/batch-002-dungeon-
  pilot/packs.json` (e.g. add a member) leaves `node sim/tests/goldens.cjs` GREEN/unchanged (then revert the
  temp edit). Report this proof.

## Out of scope
- The pack-fix (adding monsters to the 10 <30% packs) -- separate REQ, now golden-safe once this lands.

## Gate results (built 2026-07-24 -- branch req-0301-goldens-decouple-frozen-fixture, base 1161be7)

Commit `bc71419` (fixture + goldens.cjs redirect); this gate-results note is a follow-up doc commit.

- **Fixture** `sim/tests/goldens/fixture/` -- verbatim byte-copy of EXACTLY the content the goldens
  consumed. `cmp` confirms byte-identity on all 10 files: `content/live/scenario.json`,
  `content/live/live_items.json`, and `content/live/dungeon/{dungeon,dungeons,enemies,formations,
  gimics,items,packs,skills}.json` (the 8 batch-002 dungeon-domain `*.json` the os.homedir()-fake
  copies; `notes.md` is not `.json`, so it was never copied and is not in the fixture). Added a
  `README` with the FROZEN / never-track-live-content warning.
- **goldens.cjs redirected** -- direct reads (scenario/live_items + enemies/skills/dungeon/packs) now
  resolve under `FIXTURE_LIVE`/`FIXTURE_DUNGEON`; the os.homedir()-fake seeds
  `.../content/live/dungeon` from `FIXTURE_DUNGEON` instead of `content/batches/batch-002`. Header +
  REQ-0207 comment reframed: the golden is a content-INDEPENDENT engine-determinism contract that
  supersedes the batch-002 pin. `REPO_ROOT` retained (still used by gen-mode `path.relative`);
  `BATCH_DIR`/`batch-002-dungeon-pilot`/old mkdtemp prefix fully removed.
- **BYTE-IDENTICAL** -- `node sim/tests/goldens.cjs` -> `goldens OK (12 cases, replay determinism intact)`.
  A non-destructive `gen` dry-run (write intercepted) reproduces the committed `replay_hashes.json`
  byte-for-byte. `replay_hashes.json` sha256 `da69d0fc45a1e8448de9b780019061c7690afb2c4b0e5eb15db8d3ff2b59a426`
  UNCHANGED; `git diff` clean; never regenerated.
- **Suite** -- `node sim/tests/run.cjs`: 183 passed, **1 failed**, and the single failure is
  PRE-EXISTING / environmental, NOT caused by REQ-0301. The failing case is `REQ-0122 lossless promotion
  invariant ... enemies.json sha256 matches the LAST additive layer provenance` (expected `895df769...`
  got `d80e9e65...`). Proof it is independent of this change: (a) it fails byte-for-byte identically at the
  branch base `1161be7`, before any REQ-0301 edit (also 183/1); (b) this branch touches only
  `sim/tests/goldens*` + this doc -- no `content/live`, `content/registry.json`, `dungen.cjs`, `combat.cjs`,
  or `run.cjs`. Root cause: that test reads live content via `dungen.liveDungeonDir()` =
  `~/backpack_ragnarok/content/live/dungeon` (os.homedir(), the MAIN checkout) and compares it to THIS
  worktree's `content/registry.json`. The main checkout was advanced by external deploys (`acfa2a2` REQ-0299,
  batch-006/007 additive promotes) so its `enemies.json` is now `d80e9e65...`, while this worktree (off an
  earlier master) still holds the internally-consistent snapshot `895df769...` (worktree live file ==
  worktree registry). So the test cross-reads a newer repo against an older registry -- a worktree-staleness
  artifact that reconciles on rebase/merge to master. Fixing it is OUT OF SCOPE for REQ-0301 (it would mean
  rebaselining live content/registry, which this REQ must not touch). All 12 determinism goldens are now
  hermetic (fixture-sourced) and fully green regardless.
- **Decoupling PROVEN** -- added a dummy member to `content/batches/batch-002-dungeon-pilot/packs.json`
  (`pack_frost_scouts` 2 -> 3 members; file materially changed on disk), re-ran goldens ->
  `goldens OK (12 cases, replay determinism intact)`, `replay_hashes.json` still `da69d0fc...` UNCHANGED.
  Reverted (`git checkout`); `packs.json` sha256 restored to `96b44fec...`; tree clean. The goldens no
  longer read batch-002 (nor live content).

Status stays **todo** (folder not moved). Unblocks the pack-fix: adding monsters to the `<30%` packs is now golden-safe.

## ORCHESTRATOR AUDIT (2026-07-24)
Byte-identical + correct: `node sim/tests/goldens.cjs` -> goldens OK, `replay_hashes.json` UNCHANGED (git-clean
diff), fixture `sim/tests/goldens/fixture/` created (README + scenario/live_items + 8 dungeon-domain json),
decoupling PROVEN (subagent: edit batch-002 packs.json -> goldens stay green -> revert). Commits bc71419, 6d6f0fc.
The lone `run.cjs` REQ-0122 lossless failure is NOT this REQ: it is worktree-STALENESS -- this branch is off an
OLD master (e62f7b8); a PARALLEL session merged REQ-0299 (44 monster-pack flavor skills + a powerLevel recalibrate
via the REQ-0297 autobalance tool) to master (now c239eb6), advancing the main-checkout live enemies.json
(895df7 -> d80e9e6) that the non-hermetic lossless test cross-reads. It clears on rebase onto current master.
STATUS: BUILT; MERGE PENDING a rebase onto current master c239eb6 (then the lossless artifact clears).
