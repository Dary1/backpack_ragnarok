# Art Golden — v3.4 (minimal)

> 2026-07-03: the user removed art_golden v2 entirely. By user directive, exactly ONE
> rule survives. Nothing else in the former v2 (occupancy band, lighting, palette,
> construction recipe, self-review process) is binding anymore. The lighting rule was
> explicitly ruled unnecessary by the user (2026-07-03).

## Coverage floor (binding)

Every owned cell of an icon must have **≥ 20% draw coverage** (content pixels / cell
pixels, measured by `tools/tool_fit_check.py` CHECK at 100 px/cell). Below 20% = FAIL;
resolution is a redraw or an explicit per-case user waiver — never a silent pass.
(v3 set this at 30%; lowered to 20% by user directive, 2026-07-03.)

## Aspect ratio is inviolable (binding, user directive 2026-07-04)

An icon's aspect ratio must NEVER be changed — by any tool, fixer, build step, or
renderer. There is no situation where anisotropic scaling is acceptable.
- Fit fixes may translate, uniformly scale, rotate (90° steps), or flip — never distort.
- Renderers (mock, client, preview) must contain-fit art uniformly; `stretch`-style
  fills and independent width/height are forbidden.
- A symbol whose viewBox aspect does not match its shape's bbox aspect is a structural
  FAIL (rendering it would distort) — never fix by squeezing.

## Original design is respected (binding, user directive 2026-07-04)

When art orientation and cell shape disagree (the 90° scale-tie case), the art is NOT
rotated. The ART is authoritative: fix the cell shape (or the shape-reading code) to
match the original design. Fixer rotation prescriptions for aspect-mismatch cases are
ESCALATIONS ("shape/art mismatch — fix the shape or redraw"), never auto-applied.

## Illustration-first (binding, user directive 2026-07-05)

Art comes BEFORE data, for ALL content (monsters, items, entities, currencies):
1. Create the illustration/icon FIRST; footprints/cell shapes/aspect ratios are
   DERIVED FROM the approved art afterwards (irregular footprints allowed — same
   BP-style collision, no need for neat rectangles).
2. Use plain, simple names and concepts when generating art (gorgeous names do not
   yield better art); the USER evaluates quality via NUMBERED proposal galleries
   and returns the accepted numbers.
3. No content entity ships stats/placement before its art is approved.
