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
(to be filled by the implementing session)
                        