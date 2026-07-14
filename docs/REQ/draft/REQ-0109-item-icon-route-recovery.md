# REQ-0109 — Recover & merge the REQ-0073 AI item-icon route

- **Status**: see folder (board law). Ratified via todo/ placement; executed 2026-07-12 by the integration-owner orchestrator (user delegation, 2026-07-12 chat).
- **Date**: 2026-07-09
- **Owner**: integration-owner orchestrator (delegated 2026-07-12)
- **Source branch**: `req-0073-item-icon-gen` (worktree `~/backpack_ragnarok_worktrees/req-0073-item-icon-gen`), HEAD `d5f1078` as of 2026-07-09.

## Background

The AI-raster item-icon route was built under REQ-0073 on branch `req-0073-item-icon-gen`
but **never merged**. A server restore clobbered the branch's original commit refs (objects
survive in the `.git` object store; re-committed afterward — see the addendum in
`docs/llm_managed/recovered_from_server/req-0073-item-icon-gen__HANDOFF-WIP-req-0073-resume.md`).
On **master/live** none of it exists: `content/live/live_items.json` carries 0 `gen_*`
fields and master `tools/` has none of the icon-gen scripts. ComfyUI (127.0.0.1:8188) is
started manually, not a persistent service.

Verified 2026-07-09 on the branch worktree: 8 `live_items` entries carry
`gen_prompt`/`gen_negative`/`gen_render`; tools `gen_item_icons.py`, `tool_icon_score.py`,
`build_batch003_report.py` present; `content/batches/batch-003-item-icons/` present
(`candidates/`, `fit_renders/`, `scores.json`, `selected/`, `style_guide.md`).

## Goal

Bring the REQ-0073 route (per-entry generation fields + tools + batch-003 exemplars) onto
master/live, finish the unfinished finalization, and resolve the raster-vs-SVG
live-rendering gap.

## Tasks

1. **Recover & verify the branch.** Confirm on `req-0073-item-icon-gen` that the following
   are intact and consistent: (a) `gen_prompt`/`gen_negative`/`gen_render` on all 8
   `live_items` entries (po/2-additive); (b) tools `gen_item_icons.py`, `tool_icon_score.py`,
   `build_batch003_report.py`; (c) `content/batches/batch-003-item-icons/` incl.
   `style_guide.md`; (d) scorer tests. If any objects were lost in the restore, recover from
   the `.git` object store (candidate commits a8288ad / 04101fa / 8876225 / 6cc60d4 per the
   HANDOFF addendum) via `git cat-file` / cherry-pick.

2. **Finish the WIP finalization** (per `req-0073-item-icon-gen__HANDOFF-WIP-req-0073-resume.md`):
   - Patch `tools/tests/test_tool_icon_score.py` for the `MIN_CONTENT_FRAC=0.02` gate: bump
     the `sparse` fixture 10×10→20×20; add a 512×512 + 10×10-speck → infeasible / score 0.0 /
     `content_too_small` test; add a 100×100 + 10×25 (2.5%) → feasible / score>0 test.
   - Run `.venv/bin/python -m unittest tools/tests/test_tool_icon_score.py` and
     `tools/tests/test_fit_parity.py` — both must be green.
   - Re-run the scorer (STALE `scores.json`/`fit_renders/`/`selected/` are pre-fix;
     regenerate). Expected: 8 items × 4 candidates each carry `content_frac`/`reason`;
     winner == argmax(score); `selected/` has 8 files; `dagger` winner likely flips to c4.
   - Re-run `build_batch003_report.py`; link-check `web/preview/batch-003/` (all src/href
     resolve); verify the public page https://backpack-dev.qtie.jp/preview/batch-003/ ;
     review the flagged matte `tower_shield_c2_s202_alpha.png` (90.89% coverage, out-of-band).

3. **Model decision — DECIDED 2026-07-09: keep V9 (installed), per user.** batch-003 was generated with
   `JuggernautXL_RunDiffusionPhoto2_V9_Final` (installed). Original request was Juggernaut XL
   **v6** (not installed). If V6 is chosen: user installs the V6 checkpoint (art infra is
   user-owned / HANDS-OFF for agents), then regenerate the batch-003 candidates under V6
   (seeds are NOT portable across checkpoints — the fixed-seed baseline 101/202/303/404 must
   be re-generated) and re-run task 2's scorer + report. If V9: keep the existing candidates.
   The geometry scorer (`tool_icon_score.py` / `tool_fit_check.py`) and the `gen_px`
   resolution recipe are model-agnostic — unaffected either way.

4. **Merge to master.** Bring gen fields (additive, po/2-compatible) + the three tools +
   `batch-003-item-icons/` onto master. Coordinate before touching the `~/backpack_ragnarok`
   main checkout / live services (PROJECT.md HANDS-OFF). Ensure `bash tools/ci.sh` is green;
   sanity-check the live game still boots (it reads `content/live/*.json` as root). Register
   in `content/registry.json` if treated as a batch (record provenance).

5. **Live-rendering integration [may split to a follow-up REQ].** live/mock/client currently
   render item icons from the SVG sprite (`content/sprite_all_vN.svg` via `icon-<id>`
   symbols). The REQ-0073 route produces raster PNGs and was explicitly a non-goal for
   engine/client/live-sprite changes. Decide and implement: either wire the selected raster
   icons into the renderer, or keep raster as reference-only and continue SVG for live. Scope
   this explicitly rather than leaving it implicit.

## Gotchas (from REQ-0073 handoff)

- Cell convention is `[row,col]` everywhere; confirm against `tool_fit_check.shape_to_cellset`.
- `tool_fit_check.py` is a NORMATIVE reference port (REQ-0020): import it, never fork/reimplement.
- Scoring is geometry-only: `score = 100·(0.35·scale + 0.50·coverage + 0.15·uniformity)`,
  0 if infeasible; `MIN_CONTENT_FRAC=0.02`. NEVER add an aesthetic term (user directive) —
  humans judge look on the report page.
- Reproducibility: fixed seeds, deterministic scoring + report builder.
- Matting: rembg `birefnet-general` + border-color-key fallback; validity band 2–90% opaque.
- ComfyUI at 127.0.0.1:8188 is not a service; `curl 127.0.0.1:8188/system_stats` to check;
  start manually if down. bash-over-ssh has short timeouts → run >30s jobs via
  `setsid nohup … &` and poll the log.
- Foreign files in the worktree not belonging to REQ-0073 (monster*, `footprint_fit_check.py`,
  etc.) — do not touch or commit.
- Coverage floor ≥20% per owned cell (`art_golden.md`) applies; aspect ratio is inviolable
  (no anisotropic scaling).

## Out of scope

- Aesthetic scoring; art-style redirection; authoring NEW item content. This REQ recovers and
  merges the existing 8-item exemplar route only.

## Outcome & gate results (2026-07-12)

- Merged `req-0073-item-icon-gen` into `req-0109-item-icon-route-recovery`
  (from master post-REQ-0124). Conflict resolutions: `live_items.json` kept
  BOTH master's `align` blocks and the branch's `gen_*` fields (8/8 entries,
  JSON-validated); `warehouse-mjolnir.spec.ts` + `web/app` dist took master
  wholesale (branch carried stale 0072-era iterations, superseded).
- Task 2 (WIP finalization) done: designed test patch applied
  (sparse 20x20 bump + 2 MIN_CONTENT_FRAC gate tests);
  `test_tool_icon_score` 10/10, `test_fit_parity` 23/23 (fresh `.venv`:
  numpy pillow scipy cairosvg).
- Scorer re-run: 8/8 scored, 4 candidates each with `content_frac`/`reason`;
  winner == argmax(score) verified programmatically; `selected/` = 8 files;
  dagger winner flipped to c4 exactly as the HANDOFF predicted.
- Flagged matte `tower_shield_c2_s202` REVIEWED AND ACCEPTED: it is a true
  full-square tower shield; 90.89% coverage is legitimate; matte clean.
- Report rebuilt; link-check: 105 refs, 0 missing.
- Registry: `batch-003-item-icons` entry added (awaiting_user_review).
- `tools/ci.sh`: stages 1–6 GREEN (sim, goldens, mock, tsc, drift, vocab,
  api fs 155 + pg 155, pg_sync 4, client build). e2e: 137 passed;
  dex-card:65 + nav-routing:26 are the PRE-EXISTING suite debt documented in
  REQ-0124's gates (assert unmerged Dex-R3 classes; not a regression);
  schedule:1065 + warehouse-mjolnir:203 are state-pollution flakes — both
  PASS in a clean isolated run (2 passed / 11s). Same carve-out REQ-0124
  merged under.
- Task 5 (live raster wiring) SPLIT OUT as its own REQ (see follow-up REQ in
  draft/): it depends on REQ-0125's skin-resolution machinery; items stay on
  the SVG sprite for live rendering until then.
- ComfyUI untouched (not needed: no regeneration).

---

## S7 verdict — batch-003 NG; restart on the refreshed pipeline (2026-07-12)

- **User verdict (2026-07-12, chat): batch-003 as generated is NG** ("一回NG")
  — https://backpack-dev.qtie.jp/preview/batch-003/ (JuggernautXL V9 route).
  Acceptance refused → this REQ moves **built → todo** (board law: rejection
  at acceptance is a backward move).
- **What stays valid:** the ROUTE recovery itself is merged on master
  (merge f3e1f32) — tools, gen_* fields, scorer tests, report builder.
  Nothing is reverted.
- **What is rejected:** the batch-003 ART outcome (candidates / selected /
  report as material for live adoption).
- Task 3s "keep V9 (DECIDED 2026-07-09)" is **SUPERSEDED** by this NG +
  REQ-0136 (checkpoint bakeoff).
- **Restart plan (the remaining work of this REQ):**
  1. Wait for REQ-0136 (checkpoint winner + license gate). **The REQ-0135
     half of this blocker is CLEARED (2026-07-12): REQ-0135b returned NO-GO,
     LayerDiffuse is rejected and removed, the matte route is unchanged
     (rembg birefnet-general + edge-key). Do not wait on it.** REQ-0138/0139
     are conveniences, not blockers. REQ-0147 (background-clause A/B, draft) is
     also NOT a blocker: it can only improve the matte, and its outcome is a
     prompt edit that can be applied to a later regeneration.
     NOTE for the regeneration itself: on this box, generate with
     `gen_item_icons.py --no-matte`, stop ComfyUI, then `--rematte-only`.
     ComfyUI (~11 GB) and birefnet (~12 GB) cannot be co-resident on 23 GB.
  2. Regenerate batch-003 candidates on the refreshed pipeline (NEW
     fixed-seed baseline — seeds are not portable across checkpoints),
     re-run scorer + report, redeploy the preview.
  3. S7 user review again; live/registry writes only after green (S8),
     per common_content_pipeline.md.
- REQ-0133 (live wiring) is unaffected machinery-wise; its route question is
  half-resolved (raster — unit_icon_pipeline.md §3.2, ALL GREEN 2026-07-12).

---

## Integration-owner pass (2026-07-14) -- route CONFIRMED on master; remaining work is content-gen + S7 (stays in todo)

Wave-2 integration owner reviewed this REQ against current master. Findings:

- **The REQ-0073 route recovery is already on master** and intact: merge f3e1f32
  is an ancestor of master; content/live/live_items.json carries 8/8
  gen_prompt/gen_negative/gen_render fields; tools/gen_item_icons.py,
  tools/tool_icon_score.py, tools/build_batch003_report.py are present;
  content/batches/batch-003-item-icons/ is present; content/registry.json carries
  the batch-003-item-icons entry. There is nothing to re-merge -- the
  integration/merge half of this REQ is DONE (this matches the 2026-07-12 outcome
  log above; the S7 NG only rejected the batch-003 ART, not the route).
- **The REQ-0136 checkpoint blocker is CLEARED**: user VERDICT (2026-07-12) is
  flux2 -- ADOPTED as the default route (docs/REQ/built/REQ-0136-icon-checkpoint-bakeoff.md).
  So the "wait for REQ-0136" precondition in the restart plan above is satisfied.
- **The batch-003 regeneration has been OVERTAKEN by REQ-0150 (flux2 migration,
  now in done/)**: master already carries content/batches/batch-004-item-icons-flux2/
  (candidates/ + item_defs.json, 7/8 items) produced on the flux2 pipeline (commit
  ee89739). Restart-plan step 2 (regenerate item icons on the refreshed pipeline)
  has therefore largely already happened -- but as a SEPARATE batch (batch-004)
  under REQ-0150, not as a batch-003 re-roll under this REQ.

Remaining work is NOT integration work and was intentionally NOT forced:
1. Decide whether batch-004-item-icons-flux2 (REQ-0150) SATISFIES this REQ, or
   whether a dedicated batch-003 re-roll on flux2 is still wanted. Product/user call.
2. If a re-roll is wanted: regenerate on the flux2 pipeline (heavy ComfyUI GPU work
   on user-owned art infra -- VRAM constraint: ComfyUI ~11GB + birefnet ~12GB
   cannot co-reside on 23GB, so gen --no-matte, stop ComfyUI, then --rematte-only),
   re-run scorer + report, redeploy the preview.
3. **S7 user review is required** either way (the prior batch-003 was NG at S7;
   live/registry adoption is S8, only after a fresh S7 green). Per board law +
   integration-owner scope, S7 / user-eyeball work stops here.

Disposition: **stays in todo** -- the route is merged but the batch-003 ART is
still NG, no fresh regeneration + S7 has occurred, and the remaining steps are
content generation + user acceptance (out of autonomous-integration scope). Task 5
live-wiring remains split to REQ-0133 (draft/).

## Retirement note (2026-07-14, user ruling)
User ruling (orchestrator session, 2026-07-14): with the content-system overhaul
landed (registry/admin REQ-0151..0157 line), the legacy icon batches are all laid
to rest ("supuyo/kuyou") for now — no batch-003 flux2 re-roll, no batch-004
satisfaction claim. The recovered route itself is already merged (f3e1f32).
Moved todo -> draft; any future item-icon batch goes through the current
registry/content-admin pipeline instead.
