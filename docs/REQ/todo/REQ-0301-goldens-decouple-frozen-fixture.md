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

## Gate results
_(on build)_
