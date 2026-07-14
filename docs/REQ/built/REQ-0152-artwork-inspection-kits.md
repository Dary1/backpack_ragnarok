# REQ-0152 — artwork-inspection-kits: per-type inspection kits wired into the artwork admin

**Ratified:** 2026-07-13 (user, chat) — including rulings on Q1–Q3 below. Queued behind
REQ-0151 implementation; the REQ folder is the sole status record.
**Requested by:** user, 2026-07-13 (chat): "after an image is generated, run the type-appropriate
inspection kit, display the result on screen, and save the result to the DB as well. Investigate
the per-type kits and their return-value mechanisms; if a kit is obsolete, propose deprecation
or update it in a separate REQ." Spec authored by orchestrator (Fable) from an Opus 4.8
inspection-tooling audit of the same date (inventory, coverage matrix, obsolescence verdicts).

**Standing rule (user ruling, 2026-07-13):** inspection is ADVISORY. REQ-0151 treats kits as
optional — the user verifies visually; no kit verdict ever blocks adoption. The sole exception
is the bpskin FRAME-SOURCE gate, which lives inside the generation recipe (compose consumes only
PASS frames) and predates this REQ.

**Depends on / coordination:**
- REQ-0151 (artwork-registry-admin) — provides the registry (`artworks`/`renders` in Postgres
  behind storage.cjs), the admin UI, and the job queue this REQ extends.
- REQ-0150 completion (transitively, via REQ-0151).

## Decision / Goal
After every successful generation in the artwork admin, automatically run the inspection kits
registered for that artwork's kind (po | si | unit | monster | bpskin), persist each result to
the DB, and render them in the admin UI next to the render. Kits are versioned, re-runnable,
and advisory. This REQ also executes the kit refresh the audit found necessary: give the matte
band a machine output, promote the seam metric out of spikes/, retire the SVG-era fit tooling
from this flow, and author the missing monster kit.

## Kit interface (unified; grounded in what existing kits already emit)
A kit is a pure function of (render bytes + declared params) — nothing unreproducible from the
render row.

Identity: `kit_id` (e.g. `bpskin.frame_gate`), `kit_version` (semver; bump on threshold or
algorithm change), `applies_to` ⊆ {po, si, unit, monster, bpskin}, `blocking` (bool; today true
only for `bpskin.frame_gate`, and only inside the generation recipe).

Input: `{ png_bytes, alpha_bytes|null, kind, shape, gen_width, gen_height, params }`.

Output (one row per (render_id, kit_id, kit_version)):
```
{ verdict: PASS | WARN | FAIL,          -- FAIL meaningful only for blocking kits;
                                        -- advisory kits top out at WARN
  metrics: { <name>: number, ... },
  checks:  [ {name, ok, value, threshold}, ... ],
  notes:   [ "human-readable", ... ],
  ran_at, kit_input_sha256 }            -- input hash -> staleness/re-run detection
```

Metric naming MUST disambiguate the three quantities all historically called "coverage":
`image_alpha_coverage` (whole-image α>8 fraction — matte band, gallery floor),
`cell_content_coverage` (per-owned-cell content fraction — packing/fit),
`silhouette_coverage` (frame-silhouette fraction — bpskin gate).

## Storage
New table `render_inspections(render_id FK, kit_id, kit_version, verdict, metrics JSONB,
checks JSONB, notes JSONB, kit_input_sha256, ran_at)`, UNIQUE(render_id, kit_id, kit_version).
Added via `server/migrations/`; ALL access via `server/storage.cjs` (the only persistence
chokepoint). A render is *stale* for a kit when the registered kit_version is newer than the
stored row or `kit_input_sha256` changed → UI shows stale badge + re-run button. Deleting a
render cascades its inspection rows.

## Kit roster v1 (from the 2026-07-13 audit)

**Adopt (wire in):**
- `bpskin.frame_gate` v1 — existing `gen_bpskin.validate()` 5-check (margin / silhouette
  coverage / single-component / solidity / rim). KEEP AS-IS; flux2-native, already blocking
  inside the recipe. This REQ only normalizes its report (`frame_report.json` fields) into
  `render_inspections`.
- `matte.coverage_band` v1 — existing `gen_item_icons.matte_alpha()` band (0.02–0.90) for
  po / si / unit. UPDATE REQUIRED: it currently emits stdout lines only ("MATTE …", "WARN …
  OUT-OF-BAND"); refactor to return `{method, image_alpha_coverage, in_band}` as data. In-band →
  PASS, out-of-band → WARN. Never rejects.
- `po.cell_packing` v1 — existing `tool_icon_score.py` metrics (score, scale/coverage/uniformity
  terms, per-cell coverage) for po only. UPDATE: demote its `winner` field to advisory notes —
  ratified doctrine (art_pipeline.md §7) is "scoring is a FILTER; the human adopts".
- `tiling.seam` v1 — `seam_metric` (wrap-edge/interior gradient ratio) LIFTED OUT of
  `tools/spikes/req0150_flux_tiling.py` into a real module, for bpskin fills (and monsters only
  if a tiling use appears). Ratio within the REQ-0138 band → PASS, else WARN + mandatory
  half-shift eyeball note (metric reads high on low-contrast tiles — spike finding).

**Author fresh (audit gaps):**
- `monster.render_sanity` v1 — monsters have ZERO inspection today (no matte, no coverage, no
  report). Minimum: white-background fraction + subject-presence (non-white content fraction and
  bounding-box vs canvas), emitting `image_alpha_coverage`-style metrics. Thresholds proposed by
  the implementer, ratified by the user at S7.
- `si.subject_frame` v1 (user-ratified 2026-07-13: AUTHOR IT): single-centered-subject / margin
  check for 256×256 SIs. Cell-based kits structurally cannot serve SI (no shape) — authored
  fresh in this REQ; thresholds proposed by the implementer, ratified at S7.

**Deprecate / do not wire (proposal, per user's "propose deprecation" instruction):**
- `tool_fit_check.py` (check mode) + `build_fit_report.py` — SVG-sprite era: they inspect
  `<symbol>`s in `content/sprite_all_v11.svg`; the flux2 route emits raster PNG + matte, never
  SVG symbols, so containment cannot run on a flux2 render as-is. Keep them untouched for the
  legacy SVG sprite; do NOT wire into the admin. If PO overflow-vs-cells checking is wanted
  later, re-express it on the raster alpha (which `po.cell_packing` already loads) as a
  `po.cell_overflow` v1 kit — separate follow-up, not this REQ.
- The 14 `DEPRECATED (REQ-0150)` tools and 4 `tools/spikes/` HISTORY files stay reference-only.
- `build_flux2_gallery.py` stays as the whole-batch human-review surface; it is not a per-render
  kit and its 20% floor doctrine ("filter, never a verdict") is already subsumed by
  `matte.coverage_band` + UI display.

## Flow
1. Generation job succeeds → registry row written (REQ-0151) → inspection jobs for
   kits_for(kind) enqueued on the same single-GPU-safe queue (kits are CPU-only; they must not
   delay pending GPU jobs — run at lower priority).
2. Each kit writes its `render_inspections` row; UI updates the render card: verdict chips
   (PASS green / WARN amber / FAIL red) + expandable metrics/checks/notes table.
3. Kit version bump or input change → stale badge; re-run button re-executes just that kit.
4. Adoption flow is untouched: verdicts are displayed at the adoption dialog but never gate it.

## Out of scope
- Making any advisory kit blocking; auto-adoption; aesthetic scoring.
- Porting the SVG fit tooling to raster (`po.cell_overflow` — follow-up REQ if wanted).
- Fixing REQ-0150-owned staleness (e.g. `gen_unit_icons.py` "4 steps" docstring) — coordinate
  with REQ-0150; do not touch its files from this branch.

## Gates
- G1 chokepoint + migration: `render_inspections` via storage.cjs only; migration applies
  cleanly; cascade-on-render-delete tested.
- G2 kit purity: same input → same output; `kit_input_sha256` recorded and verified in tests.
- G3 golden vectors: each adopted kit replays a known artifact bit-for-bit —
  `bpskin.frame_gate` reproduces the recorded wood_frame_s202 double-FAIL (margin 0.798,
  rim_luma_delta 0.6) and the 5 recorded PASSes from
  `content/batches/bpskin-frames-0150/frame_report.json`; `matte.coverage_band` and
  `po.cell_packing` replay one recorded batch entry each; `tiling.seam` reproduces a
  findings.json leg.
- G4 e2e (mocked generation, no GPU in CI): generate → kits auto-run → verdict chips visible →
  results persisted → kit_version bump → stale badge → re-run → new row; adoption possible
  regardless of WARN.
- G5 hygiene: no report files written outside the DB (except the recipe-internal
  frame_report.json REQ-0150 already owns); no new PNG under content/.
- S7 user acceptance: user reviews kit output on real renders and ratifies thresholds
  (especially `monster.render_sanity` and `si.subject_frame`).

## Risks
- Threshold drift: kits carry thresholds measured on specific batches; the kit_version +
  golden-vector discipline exists precisely so threshold edits are visible, versioned, and
  re-runnable.
- Double bookkeeping with REQ-0150's file-based reports (frame_report.json): the DB is the
  registry of record for admin renders; batch files remain for the CLI pipeline. Do not try to
  unify them in this REQ.
- Kit runtime deps (rembg/birefnet for mattes, scipy) must be importable from the server-side
  job runner — verify in G4 setup, pin via the existing pnpm/pip conventions.

## Resolved questions (user rulings, 2026-07-13)
- Q1 `si.subject_frame`: AUTHOR IT (see roster).
- Q2 `tiling.seam` scope: bpskin fills only; monsters only if a tiling use case appears
  (confirmed default).
- Q3 backfilled renders: LAZY — shown as "not inspected", kits run on demand via the re-run
  button.

## Implementation log
### Session 2026-07-14 (implementing engineer, worktree req-0152-artwork-inspection-kits)

**Architecture**
- Kits are pure Python functions of (render PNG bytes + declared params), living in
  `tools/inspect_kits.py`; `tools/inspect_job.py` is the CLI boundary the Node queue spawns
  (mirrors REQ-0151's `art_job.py`). Identity/version/routing are in ONE manifest
  `tools/inspect_kits.json`, read by BOTH the Node side (`server/services/kit_registry.cjs`:
  `kits_for(kind)`, current `kit_version`, `kit_input_sha256`) and the runner (stamps
  `kit_version`). Kits reuse the existing measurement code by IMPORT, never fork:
  `gen_bpskin.validate()`, `gen_item_icons.matte_alpha_data()`, `tool_icon_score.score_candidate()`,
  `inspect_seam.seam_metric()`.
- Persistence: new table `render_inspections` (migration `008_render_inspections.sql`,
  UNIQUE(render_id,kit_id,kit_version), FK ON DELETE CASCADE). ALL access via storage.cjs
  (`storage_art.cjs` adds the CRUD, re-exported through the `...artStore` spread -- the sole
  chokepoint holds). A same-version re-run overwrites in place; a kit_version BUMP inserts a
  new row (history) and the UI shows the latest per (render,kit).
- `kit_input_sha256 = sha256(image_sha256 | kit_id | kit_version | {kind,shape,gen_w,gen_h})`,
  computed Node-side. Because `image_sha256` IS sha256 of the stored PNG bytes, staleness is
  checkable in the route without re-hashing the blob: stale = (stored kit_version != current)
  OR (stored hash != recompute). A re-generated image, an edited shape, or a version bump all
  flip it. G2 verifies the stored hash equals a fresh Node recompute.
- Queue (`art_jobs.cjs`): the one serialized worker now drains a HIGH-priority generation
  queue before a LOW-priority inspection queue, so CPU-only kits never delay a pending GPU job
  ("same single-GPU-safe queue, lower priority"). A successful render auto-enqueues
  `kits_for(kind)`. Inspection failures log-and-skip (best effort) and never wedge the pump or
  affect generation/adoption.

**Kit roster v1 (versions + thresholds; [S7] = implementer-proposed, pending user ratification)**
- `bpskin.frame_gate` v1 -- KEPT AS-IS (flux2-native, blocking inside the recipe; can emit FAIL).
  Normalizes `gen_bpskin.validate()`'s 5-check into the table; `coverage` -> `silhouette_coverage`.
  Runs validate() on the render PNG unless a real recorded report is present in `params`
  (the REQ-0151 mock stub lacks validate fields, so it re-runs).
- `matte.coverage_band` v1 -- band 0.02..0.90 (in-band PASS, out WARN, never rejects).
  `gen_item_icons.matte_alpha()` refactored (the spec's UPDATE REQUIRED) into
  `matte_alpha_data()` returning `{method, image_alpha_coverage, in_band, image}`; `matte_alpha()`
  is now a thin wrapper (file write + logs unchanged -> callers unaffected). birefnet primary,
  border-key fallback; a provided alpha PNG is measured directly.
- `po.cell_packing` v1 -- weights scale 0.35 / coverage 0.50 / uniformity 0.15, content gate 0.02
  (all from `tool_icon_score`). `winner` DEMOTED to an advisory note (art_pipeline.md §7). Emits
  `cell_content_coverage` (= mean per-cell coverage), score, scale, terms.
- `tiling.seam` v1 -- `seam_metric` LIFTED verbatim from `tools/spikes/req0150_flux_tiling.py` into
  the real module `tools/inspect_seam.py`. PASS band [0.83, 1.10] [S7] (from REQ-0138's ratified
  seamless range 0.83-1.09; upper rounded 1.09->1.10 for float safety); both ratio_x/ratio_y must
  be in band else WARN + MANDATORY half-shift eyeball note.
- `monster.render_sanity` v1 -- AUTHORED FRESH (monsters had zero inspection). Metrics
  `image_alpha_coverage` (non-near-white subject fraction), `white_bg_fraction`,
  `subject_bbox_fill`. Thresholds [S7]: content 0.02..0.92, white_bg >= 0.05.
- `si.subject_frame` v1 -- AUTHORED FRESH (cell kits cannot serve SI: no shape). Single-centered-
  subject + margin for 256x256 SIs. Thresholds [S7]: content 0.03..0.92, largest_component >= 0.80,
  centroid_offset <= 0.25 (of half-diagonal), margin >= 0.02.
- Metric naming disambiguated everywhere: `image_alpha_coverage` / `cell_content_coverage` /
  `silhouette_coverage`.

**Deprecation proposal (per the user's "propose deprecation" instruction) -- NOT wired**
- `tool_fit_check.py` (check mode) + `build_fit_report.py` are SVG-sprite-era (they inspect
  `<symbol>`s in the sprite SVG); the flux2 route emits raster PNG + matte, never SVG symbols, so
  their containment check cannot run on a flux2 render as-is. They are left UNTOUCHED for the
  legacy SVG sprite and deliberately NOT wired into this admin. If PO overflow-vs-cells checking
  is wanted later, re-express it on the raster alpha (which `po.cell_packing` already loads) as a
  new `po.cell_overflow` v1 kit -- a separate follow-up REQ, not this one. The 14 DEPRECATED
  (REQ-0150) tools + the `tools/spikes/` HISTORY files stay reference-only; `build_flux2_gallery.py`
  stays the whole-batch human-review surface (not a per-render kit).

**Gate results (all machine gates GREEN)**
- [x] G1 chokepoint + migration + cascade -- `008_render_inspections.sql` applied to the Supabase
  pg; `inspection_test.cjs` (pg) proves upsert/list ONLY via storage.cjs, same-version overwrite,
  version-bump history + latest-wins, and cascade-on-render-delete (delete render -> 0 inspection
  rows). 5/5.
- [x] G2 kit purity -- `inspect_kits_test.py` runs each adopted kit twice on identical input and
  asserts byte-identical output (4/4 purity legs); `inspection_test.cjs` asserts `kit_input_sha256`
  is deterministic, flips on image/version/shape change, and that the STORED hash equals a fresh
  Node recompute after the auto-run flow.
- [x] G3 golden vectors -- `inspect_kits_test.py` 31/31: `bpskin.frame_gate` reproduces the
  wood_frame_s202 double-FAIL (verdict FAIL, margin_worst_side 0.798, rim_luma_delta 0.6,
  silhouette_coverage 0.865, failing checks = {margin, rim}) AND all 5 recorded PASSes from
  `content/batches/bpskin-frames-0150/frame_report.json` (silhouette_coverage matches each);
  `matte.coverage_band` replays blade_c1_s101_alpha -> image_alpha_coverage 0.114983 (in-band PASS);
  `po.cell_packing` replays the recorded scores.json entry -> score 54.97, scale_term/coverage_term
  match, per_cell_coverage [0.1525, 0.1221]; `tiling.seam` reproduces the findings.json elven-s101-
  seamless leg -> ratio_x 1.088181734085083, ratio_y 0.985894 (PASS, in the REQ-0138 band).
- [x] G4 e2e (mocked, no GPU) -- `client/e2e/artinspect.spec.ts` PASSES (18.3s) via the isolated
  bringup `tools/art_inspect_e2e.sh` (HOME-namespaced pg instance of this worktree,
  ART_ROUTE_MOCK=1, ART_KIT_MATTE_METHOD=borderkey): create po sword -> generate -> kits auto-run
  -> chips visible (po.cell_packing PASS green, matte.coverage_band WARN amber) -> expand metrics
  -> persist across reload -> POST dev/bump-kit -> STALE badge -> re-run -> stale cleared (new row)
  -> ADOPT despite the WARN (advisory doctrine) -> served 200.
- [x] G5 hygiene -- kits write NO files (pure, return data); branch diff has no new PNG or report
  file under content/ (the recipe-internal frame_report.json REQ-0150 owns is untouched); the
  vite build output (web/app) was reverted (deploy rebuilds).
- [ ] S7 -- user ratifies thresholds on real renders (esp. monster.render_sanity, si.subject_frame,
  and the tiling.seam 1.09->1.10 rounding). OPEN, not this session.

**Deviations from spec (documented)**
- Generation/kit python resolvers (`ART_JOB_PYTHON` / `ART_KIT_PYTHON`): kits need
  numpy/scipy/rembg and the mock render needs PIL, both of which live in the box's USER
  site-packages under the real HOME -- unreachable once HOME is remapped for e2e namespace
  isolation. The tests/e2e point both at the project venv (`~/backpack_ragnarok/.venv`, HOME-
  independent); production keeps `python3` (real HOME -> deps present). Default unchanged for prod.
- `ART_KIT_MATTE_METHOD=borderkey` + a dev-only `dev/bump-kit` hook (+ an in-memory kit-version
  override in kit_registry): test/e2e affordances only. border-key gives a fast, model-free,
  deterministic matte for e2e; bump-kit simulates a kit_version bump so the stale-badge + re-run
  path is exercisable through the real HTTP route + UI without editing the manifest mid-run.
- No new PNG committed; the matte golden vector uses a recorded, committed matted PNG (provided
  alpha), so G3 needs no birefnet model. rembg/birefnet importability is asserted by
  `inspect_job.py mode=verify` (all deps import: numpy/scipy/PIL/skimage/rembg).

**Files touched**
- New: `server/migrations/008_render_inspections.sql`, `server/services/kit_registry.cjs`,
  `server/tests/inspection_test.cjs`, `tools/inspect_kits.py`, `tools/inspect_seam.py`,
  `tools/inspect_kits.json`, `tools/inspect_job.py`, `tools/tests/inspect_kits_test.py`,
  `tools/art_inspect_e2e.sh`, `client/e2e/artinspect.spec.ts`, `client/e2e/artinspect.config.ts`.
- Modified: `server/storage_art.cjs`, `server/services/art_jobs.cjs`, `server/routes/art.cjs`,
  `client/src/api.ts`, `client/src/artadmin/ArtAdminPage.tsx`, `tools/gen_item_icons.py`
  (matte_alpha_data), `tools/ci.sh`.
- No regression: `server/tests/api_test.cjs` 155/155 (files), `artwork_test.cjs` 6/6 (pg),
  server tsc (checkJs) green, client `tsc -b && vite build` green.

**Commits (branch req-0152-artwork-inspection-kits)**
- 649e145 migration 008 + storage chokepoint + kit registry
- 7195d40 inspection-kit library (6 kits) + CLI runner + matte_alpha_data refactor
- 6894608 auto-run kits at lower priority + admin API (stale flags, re-run, dev/bump-kit)
- df94bf3 admin UI verdict chips + stale badge + re-run
- f1d1492 gate tests (G1-G4) + ci wiring
- (this commit) REQ log

**Open (not machine gates)**
- S7 threshold ratification on real GPU renders (monster.render_sanity, si.subject_frame, tiling
  band rounding).
- Deploy-time web bundle rebuild (deferred to end of chain, as REQ-0151).
- `po.cell_overflow` (raster overflow check) remains a proposed follow-up REQ if wanted.

                        
## Integration pass -- 2026-07-14 (integration owner)

- Master @ `c41fdee` re-certified green via `tools/release.sh` (full `tools/ci.sh` incl. pg backend; `SKIP_E2E`, e2e run separately). Fresh `vite build` == the committed dist (**"dist unchanged -- nothing to commit"**), so the live static bundle already reflects this REQ. `backpack-api` + `backpack-web` restarted 2026-07-14 00:24 UTC (both active; web/api/ingress HTTP 200).
- Post-deploy live e2e (`http://127.0.0.1:8803`, sanctioned `pnpm run e2e`): **156 passed / 10 failed** -- the 10 are exactly the REQ-0159-accounted set (7x artadmin/artinspect/contentadmin 403-by-design; nav-routing:26 + dex-card:65 + schedule:1065). No unaccounted red.
- **Code**: already merged to master before this pass (branch tip is an ancestor of `c41fdee`); no new merge performed. Dedicated merge `73431d9`. Inspection-kit golden vectors + pg-backend kit tests green this pass.
- **Disposition**: STAYS in built/ -- open S7 threshold ratification / real-GPU acceptance.
