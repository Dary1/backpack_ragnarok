# HANDOFF-WIP — resume point for finishing REQ-0073 / batch-003

Session ended 2026-07-07 (orchestrator model hit usage cap mid-run; server
also rebooted during the last phase). Branch: `req-0073-item-icon-gen`.
Everything listed below is committed on that branch. Read
`docs/REQ-0073-item-icon-gen.md` + `docs/handoff.md` first.

## State at handoff

DONE and verified:
- REQ-0073 spec; style guide; all 8 entries in content/live/live_items.json
  have gen_prompt/gen_negative/gen_render (independently verified on disk).
- tools/gen_item_icons.py — generation OK (32/32 raw candidates generated,
  ~23s/img warm) AND matting fixed: birefnet-general + border-key fallback,
  validity band 2–90%, `--rematte-only` flag. All 32 `_alpha.png` re-matted
  and verified (coverage table in tmp/rematte.log; visual spot-checks OK:
  blade & flame_tablet silhouettes now real).
- tools/tool_icon_score.py — degenerate-case gate added and verified:
  MIN_CONTENT_FRAC=0.02 → infeasible "content_too_small"; content_frac +
  reason now recorded per candidate. (Backup of pre-patch file:
  tmp/tool_icon_score.py.orig.bak.)
- tools/build_batch003_report.py — report builder (bug-fixed: raw/alpha
  path derivation, selected/ population, relative spec link).

STALE — must be regenerated before trusting/publishing:
- content/batches/batch-003-item-icons/{scores.json,fit_renders/,selected/}
  and web/preview/batch-003/ — ALL built from the PRE-fix alphas/scorer.
  Old (invalid) winners incl. blade 85.61 / flame_tablet 87.33 were
  matting-failure specks. Numbers WILL change after re-scoring.

NOT DONE:
1. tools/tests/test_tool_icon_score.py was NOT updated for the gate.
   Designed patch (apply it): bump the `sparse` fixture patch 10×10→20×20
   (content_frac 4.36%, keeps "full beats sparse" meaningful); add test:
   512×512 with 10×10 speck → infeasible, score 0.0, reason
   content_too_small; add test: 100×100 with 10×25 rect (exactly 2.5%) →
   feasible, reason null, score>0. Currently 1 test fails against the
   patched scorer (test_full_rect_beats_sparse_blob_on_square_item —
   fixture too sparse for the new gate; expected, fix via the bump).
   Then run: .venv/bin/python -m unittest tools/tests/test_tool_icon_score.py
   and tools/tests/test_fit_parity.py (both must pass).
2. Re-run scorer (exact CLI in docs/handoff.md §5) → verify: scores.json
   has 8 items × 4 candidates each with content_frac/reason; winner ==
   argmax(score) per item; selected/ has 8 files; expect dagger winner to
   flip to c4 (26.24% real content, previously beaten by a speck).
3. Re-run tools/build_batch003_report.py → link-check all src/href resolve
   inside web/preview/batch-003/ → visually verify blade + flame_tablet
   winner alphas and one fit render.
4. Review the one flagged matte: tower_shield_c2_s202_alpha.png coverage
   90.89% (OUT-OF-BAND, borderkey kept). If it looks wrong on the report,
   either accept (it's a big square shield, high coverage is plausible) or
   exclude manually and note it.
5. Commit: "REQ-0073: re-scored batch-003 after matte/gate fixes + final
   report" (add only batch-003 paths + web/preview/batch-003 + tests file).
6. Verify public page https://backpack-dev.qtie.jp/preview/batch-003/
   (web/preview/* is served statically; batch-001/002 pages are the
   reference that this works). ComfyUI is NOT needed for steps 1–6.
   If regeneration is ever needed: check ComfyUI is up after the reboot
   (curl 127.0.0.1:8188/system_stats) — it was started manually, may not
   be a service.
7. Optional cleanup: tmp/req0073_* scratch, tmp/rematte.log,
   tmp/tool_icon_score.py.orig.bak.

## Known open design notes (not blockers)

- blade prompt says "no hilt" but SDXL drew full swords in all 4 — decide
  whether to accept (reads fine as an icon) or re-prompt (e.g. "isolated
  blade only, tang visible, hiltless") and regenerate blade only.
- Foreign files in the worktree NOT belonging to this REQ (do not touch,
  do not commit): tools/footprint_fit_check.py, content/proposals/monster*,
  web/preview/monster_images_samples/ — separate monster work.
- Score weights (.35/.50/.15) are first-pass; if humans disagree with
  rankings on the report, tune weights in a follow-up REQ, never ad hoc.
