# REQ-0020 — Complete Port of the Fit Algorithm

- **Status**: DONE
- **Date**: 2026-07-03 (orchestrator gen2)

## Outcome
Full parity reached. All reference functions ported verbatim (incl. rotate_mask,
solve_any_angle, load_content raster path, render). Parity suite
`tools/tests/test_fit_parity.py`: **21/21 green** (masks array-equal, solve/any-angle
results identical, render pixel-identical). Reference archived verbatim at
`tools/reference/fit_algorithm_reference.py`. One real deviation found & corrected in
the old partial port (fftconvolve dtype float64 → reference float32; no result changes
on any real asset — regression CHECK on sprite_all_v4 byte-identical: 6 PASS / 8 FAIL
/ 6 SKIP). Old tool kept as `tool_fit_check.py.req0019.bak`. CLI adds:
`fix --any-angle`, `fix --content-image IMG --layout "..."`.

## Context
REQ-0019 ported only the subset of `tmp/fit_algorithm.py` needed for the batch-001 fix
(CHECK containment + 90°×flip solve). User directive: **port it completely** —
`tools/tool_fit_check.py` must reach full functional parity with the reference.

## Addendum (2026-07-03 evening) — placement-selection policy, adoption layer
User observed prescribed fixes render left-aligned (hilt). Diagnosis: NOT a port bug —
reference `find_placement` returns `np.argwhere(conv<0.5)[0]`, i.e. the first
zero-overlap position in row-major scan order (top-left-most). The objective is max
scale only; position among equally-feasible placements is unspecified. Policy: our fix
APPLICATION layer picks the CENTER-most position from the same feasible set (same
scale/rot/flip as solve()); the reference core and parity tests stay untouched.
Applied fixes iterate sprite v5 → v6.

## Addendum 2 (user ruling, 2026-07-03 night) — fix trigger semantics
**Fixes execute because of OVERFLOW, not because of per-cell coverage.**
- fit verdict (PASS/FAIL) ⇔ overflow only (content outside allowed region / pad contact).
- Per-cell coverage is a SEPARATE, informational art metric (art_golden v3.1 floor 20%
  → reported as ART-WARN, never a fit-FAIL, never a reason to run or to block a fix).
- Tool + fit-report page updated to these semantics.

## Addendum 3 (user directive, 2026-07-03) — PAD parameter
Padding raised **2px → 5px per 100px cell (5%)** in the working tool. The archived
reference keeps PAD=2 verbatim; parity tests pin PAD=2 when comparing against it
(mechanism parity, not constant parity). Fixer re-applied under PAD=5 → sprite v7.

## Trust directive (user, 2026-07-03 — BINDING)
The reference algorithm is **fully tested and trusted; it is normative**. If results
look wrong, the defect is in OUR adoption/interpretation (SVG rasterization, alpha-mask
extraction, layout construction, coordinate/scale mapping, CHECK-mode semantics) —
never in the reference. Port it verbatim in logic; no "improvements", no
reinterpretation. On any mismatch, the reference wins and the port must be corrected.

## Scope
1. All reference sections present and faithful: `build_region` (CELL=100, PAD=2,
   pad on faces without an owned neighbor), `load_content` (kept for raster inputs;
   our alpha-mask path stays for SVG), `scaled` (safe-side ≥1px coverage), `find_placement`
   (FFT sliding collision), `max_scale` (descending coarse scan — feasibility is
   NON-monotonic in scale — + fine upward refinement, floor pruning),
   `solve` (4 rot × 2 flip), **`rotate_mask` + `solve_any_angle`** (coarse 5° full
   sweep → staged refinement (4.0,1.0),(0.75,0.25), floor pruning), `render`
   (white cells / pink pads / dark content / blue grid).
2. CLI: existing `check` / `fix` modes preserved; add `--any-angle` for solve_any_angle;
   raster-image input supported (reference `load_content` path) in addition to SVG symbols.
3. Comments translated to English (language policy); logic unchanged.
4. **Parity tests**: run the reference file and the port side-by-side on fixtures
   (incl. the reference's own `__main__` layout) and assert identical scale/rot/flip/pos
   results for solve and solve_any_angle; keep as `tools/tests/test_fit_parity.py`.

## Deliverables
- [ ] `tools/tool_fit_check.py` at full parity, English comments, CLI documented in header.
- [ ] `tools/tests/test_fit_parity.py` green via `.venv/bin/python`.
- [ ] Reference copy stored at `tools/reference/fit_algorithm_reference.py` (verbatim,
      provenance noted) so parity stays testable after FS tmp/ cleanup.
- [ ] REQ-0019 CHECK results unchanged on sprite_all_v4 (regression guard).
