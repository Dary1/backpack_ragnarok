# REQ-0019 — Icon↔Cell Fit Algorithm Adoption (fit-check tool + icon fixes + preview regen)

- **Status**: DONE (implementation) — S7-style user review of regenerated preview + escalation verdicts PENDING
- **Date**: 2026-07-03 (orchestrator gen2)

## Outcome (2026-07-03)
- **Authoritative sprite identified**: `mock-src/item_icons_all.svg` (2026-07-02 20:41; matches
  old preview art 28/28). `content/sprite_all_v3.svg` is STALE for the 6 Frost symbols
  (predates the REQ-0017 redraw). First subagent pass used v3 per a wrong orchestrator brief →
  fully redone from mock sprite by a second pass.
- `tools/tool_fit_check.py` live (venv `.venv`: numpy/pillow/cairosvg/scipy; CHECK gate exits
  non-zero on FAIL; FIX prescribes transforms). `tools/build_preview.py` rebuilt (deterministic,
  embeds sprite). Batch staging salvaged: `draft.json` (6 Frost entries; effects are recovered
  tooltip TEXT — original Effect AST is lost, flagged, not guessed).
- **Fixes applied** (translate+scale) → `content/sprite_all_v4.svg`:
  beast_jaw (scale 1.093), permafrost_ward (1.0144, coverage 78–96%), niflheim_crown (0.959).
  Already-PASS: rime_shard, frost_nail, tower_shield.
- **Escalations (need user/orchestrator verdict)**:
  1. hoarfrost_creep + glacier_cleaver — fit fix would push a cell below the 30% coverage
     floor (27.9% / 29.1%). Options: waive floor for those cells / orchestrator redraw
     (Fable-inline rule) / leave. Currently UNFIXED in v4 (visible slight overflow).
  2. Five legacy icons drawn TALL (1×2) vs WIDE (2×1) live shapes: blade, flame_tablet,
     oil_flask2, dagger2, herb_satchel — need 90° reorientation or redraw (pre-existing,
     violates shape-change-regen rule; same appearance as old preview).
  3. hilt — coverage ~29% (<30 floor); already legacy-justified in REQ-0017, kept as-is.
- Preview regenerated from v4: https://backpack-dev.qtie.jp/preview/batch-001/ (200, 28/28
  symbols, old page backed up as index_v3_backup.html). Contact sheet + report:
  FS `tmp/fit_report/`. Orchestrator visually reviewed both passes.

## Context
Gen1's last open problem: item icon artwork does not reliably match the item's cell
shape (overflow past owned cells / contact with exposed cell faces). The user obtained
a reference solution in a separate session and delivered it as **`tmp/fit_algorithm.py`**
(FS). It both *inspects* fit and *prescribes* how to fix the image. This REQ adopts it.

## Server inventory findings (2026-07-03, gen2 recon) — memory drift detected
Present: `tools/{tool_gen_data.cjs, tool_integrate.cjs, eff_render.cjs, _effrender_shim.cjs,
self_test_vocab.cjs}`, `content/{vocab.json, live/ (8 core entries), sprite_all_v3.svg
(28 symbols incl. 6 Frost), item_icons5b.svg (rejected), registry.json}`,
`web/preview/batch-001/index.html` (58 KB, self-contained, embeds batch data),
`mock-src/` intact (12-test suite), Python 3.14.4 + venv, **no** numpy/PIL/cairosvg/scipy.

**MISSING vs PROJECT.md records**: `tools/tool_validate.cjs`, `tools/tool_art_check.py`
(incl. coverage metric), `tools/build_preview.py`; batch-001 staging `draft.json`/icons
(only `batch001_notes.md` remains). No git on server — no recovery path; data must be
salvaged from the self-contained preview HTML and `sprite_all_v3.svg`.

## Algorithm summary (`tmp/fit_algorithm.py`)
- Allowed-region mask: 100 px per cell; on every cell face with **no owned neighbor**
  (blank cell or grid edge), a **2 px no-contact padding** strip is forbidden.
- Content mask extracted from the image; placement tested by FFT convolution
  (sliding collision test); max scale found by descending scan (feasibility is
  non-monotonic in scale due to grid alignment) + fine refinement.
- Search space: 4×90° rotations × flip (plus an any-angle variant, `solve_any_angle`).
- Output: best transform = scale / rotation / flip / top-left position + rendered
  visualization (owned cells white, padding pink, content black).

## Adoption decisions
1. **Port to server** as `tools/tool_fit_check.py`. Python venv at
   `~/backpack_ragnarok/.venv` with numpy, pillow, cairosvg, scipy
   (if scipy unavailable on 3.14, replace fftconvolve with an np.fft implementation).
2. **Content mask from alpha**, not `gray<128`: our icons are colored SVGs rasterized
   on a transparent background (cairosvg, 100 px/cell). The reference's grayscale
   threshold was for scanned JPGs.
3. Two modes:
   - **CHECK**: rasterize the symbol at its natural shape mapping and verify
     containment in the allowed mask (report PASS/FAIL + overflow pixel count and
     which faces/pads are violated). Exit non-zero on FAIL → usable as a gate.
   - **FIX**: run `solve()` and emit the prescribed transform per icon.
4. **Fix policy**: apply **translate + scale only** automatically (SVG group
   transform / viewBox adjustment inside the symbol). Rotation/flip prescriptions are
   REPORTED but not auto-applied — they can break top-left lighting, seam contracts,
   and item semantics (art_golden §2.3, §4); orchestrator decides per case.
   Occupancy band 82–94 % per owned cell (art_golden §2.8) still applies; the fit
   scale is a **ceiling**, not a target.
5. Fit-check becomes a **mandatory S5 auto-check** (content_pipeline §3) from now on,
   and runs again at S6 build time.
6. **Salvage batch-001 staging**: extract the 6 Frost defs embedded in
   `web/preview/batch-001/index.html` → restore `content/batches/batch-001-niflheim/draft.json`.
7. **Rebuild minimal `tools/build_preview.py`** (S6): regenerates
   `web/preview/batch-001/index.html` from staging defs + sprite. Keep the current
   page's look; the builder must be deterministic (data+sprite in → page out).
8. Sprite output under a NEW filename `content/sprite_all_v4.svg` (ops rule: never
   overwrite build artifacts in place); preview + later mock consume v4.

## Deliverables
- [ ] `tools/tool_fit_check.py` on server, venv ready, CHECK+FIX modes working.
- [ ] Fit report for all 28 symbols (6 batch-001 Frost prioritized, legacy 22 next).
- [ ] Violating icons fixed (translate/scale) → `sprite_all_v4.svg`; rot/flip cases
      escalated to orchestrator instead of auto-applied.
- [ ] Batch staging restored (`draft.json`).
- [ ] `tools/build_preview.py` rebuilt; `web/preview/batch-001/` regenerated from it.
- [ ] Contact sheet PNG (per icon: fit visualization before/after) delivered to FS
      `tmp/fit_report/` for orchestrator visual review, then user review.
- [ ] User confirms regenerated preview at https://backpack-dev.qtie.jp/preview/batch-001/

## Execution
Sonnet subagent (structured/technical; never Fable per policy). Orchestrator reviews
the contact sheet and the live page before handing to the user. This is a FIT fix
pass, not a redraw — any icon needing actual redrawing goes back to the
orchestrator-draws-inline rule (REQ-0017 §3).

## Queued (out of scope here)
- Rebuild lost `tool_validate.cjs` (S2) and full `tool_art_check.py` (palette +
  coverage metric) — needed before the next batch.
- Propose git init on the server to stop silent artifact loss (user decision).
- Propagate fixed sprite to mock (`mock-src/item_icons_all.svg` + rebuild) after S7 green.
