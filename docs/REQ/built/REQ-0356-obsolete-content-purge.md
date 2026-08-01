# REQ-0356 — Purge obsolete content/batches and content/proposals from the working tree

**Reserved:** 2026-08-01
**Slug:** obsolete-content-purge
**Origin:** user directive 2026-08-01 (chat): art/content authoring has fully
moved to the contentadmin -> registry pipeline; the batch-era dirs are dead
weight (~593MB of the 752MB content/ tree) and shall be deleted.

## Spec

Delete `content/batches/` (433MB: 804 png, 92 json, 8 md, 1 html) and
`content/proposals/` (143MB: 132 png, 8 svg) entirely from the working tree
via `git rm -r`. History is NOT rewritten; the files remain reachable in git
history (this REQ stops future checkout/packfile growth, it does not shrink
.git).

## Evidence of obsolescence (verified 2026-08-01 on master a7dccb9c)

- Serving is registry-first: all 11 content kinds are in REGISTRY_KINDS
  (services/core.cjs; last kind monster_pack wired by REQ-0352, done).
  Authoring/adoption happens via contentadmin (server/routes/content.cjs);
  the parity gate (tools/verify_content_registry_parity.cjs) compares
  registry vs content/live files only — batches are outside every gate.
- Zero runtime reads: server/api.cjs, server/admin.cjs, services/*, storage/*
  contain no fs reads under content/batches or content/proposals (grep-clean;
  the only hits are prose comments).
- Tests: server/tests, shared/tests, client/e2e, sim/ read no real batch
  files (synthetic fixtures only; hits are comments).
- web/preview pages reference only local copied images (relative src), not
  content/batches paths.
- Remaining referencing tools are themselves legacy one-offs of the
  pre-registry promote-by-copy era and are kept as historical record:
  tools/promote_dungeon_batch.cjs (REQ-0122), tools/autobalance_pack_powerlevel.cjs
  (REQ-0303, BASE_PACKS), tools/req0136_perfprobe.py, tools/req0138_gallery.py,
  tools/req0150_build_defs.py, tools/gen_monster_art.py, tools/gen_bpskin.py,
  tools/bpskin_compose.py, tools/build_dungeon_preview.py. After this REQ they
  fail fast on a missing input dir if ever rerun; acceptable (user-ratified).
- content/proposals: zero references anywhere except one prose comment in
  tools/matte_transparent.py.

## Gates

- server test suite green in this worktree after the deletion.
- grep gate: no non-comment reference to the deleted paths outside tools/.

## Outcome

(filled at built)

## Outcome (2026-08-01)

- Deletion commit: 1045 files, content/batches + content/proposals removed
  entirely (working tree content/ 752MB -> 178MB; remaining bulk is
  content/art 177MB, out of scope here).
- Gate 1 (server suite, files backend): 229 passed / 0 failed, 1950
  assertions, in this worktree post-deletion.
- Gate 2 (grep): zero non-comment references to the deleted paths outside
  tools/ legacy one-offs.
- NOT done here: .git history rewrite (941MB stays; rewriting would
  invalidate commit hashes pinned in REQ files — separate decision).

## Correction (2026-08-01, found by the release gate)

The claim "tests read no real batch files" was WRONG for sim/: the grep
missed path.join(..., "content", "batches", ...) comma-joined constants.
sim/tests/run.cjs (fixtures + the REQ-0122 lossless-provenance invariant,
which byte-compares content/live/dungeon against the promoted-from
batch-002 dir) and sim/dungen.cjs test_fixed read batch-002 JSONs.
Resolution: ALL *.json/*.md under content/batches restored (812KB — the
size win was always the PNGs); deletion now covers images/html only.
content/proposals stays fully deleted. release.sh rerun after this fix.

## Correction 2 (2026-08-01, found by the release gate rerun)

The image purge also deleted the 8 PNGs the REQ-0152 inspection-kit golden
vectors (tools/tests/inspect_kits_test.py, ci.sh stage [4.7/7]) validate:
bpskin-frames-0150 {leather,iron,wood}_frame_{s1,s202}.png,
batch-003-item-icons/candidates/blade_c1_s101_alpha.png,
bpskin-flux2-0150/elven_s101_seamless.png. Those gate vectors are frozen
REGRESSION fixtures, not dead authoring inputs. Restored exactly those 8
files (2.4MB); everything else about the image purge stands.
