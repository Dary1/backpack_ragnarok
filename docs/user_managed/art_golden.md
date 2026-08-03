**LLM MAY NOT EDIT THIS FILE BUT ONLY THE USER**

# Art Golden (binding)

> Promoted from `common_content_pipeline.md` §2 by user grant (2026-08-02,
> guardrail audit C1.3). Original `art_golden.md` (abolished 2026-07-12) and
> the §2 history: git.


> `art_golden.md` was abolished as a separate doc by user directive
> (2026-07-12, REQ-0134). Its rules are carried here VERBATIM with their
> original dates. Any reference anywhere to "art_golden" (the doc or the
> rule set, any version v3.x) resolves to THIS section; historical citations
> like "art_golden v3.3" in tool comments and done REQs stay valid version
> references. Lineage note: v2 was removed entirely by the user 2026-07-03;
> the lighting rule was explicitly ruled unnecessary (2026-07-03).

### Coverage floor (binding)

Every owned cell of an icon must have **≥ 20% draw coverage** (content pixels / cell
pixels, measured by `tools/tool_fit_check.py` CHECK at 100 px/cell). Below 20% = FAIL;
resolution is a redraw or an explicit per-case user waiver — never a silent pass.
(v3 set this at 30%; lowered to 20% by user directive, 2026-07-03.)

### Aspect ratio is inviolable (binding, user directive 2026-07-04)

An icon's aspect ratio must NEVER be changed — by any tool, fixer, build step, or
renderer. There is no situation where anisotropic scaling is acceptable.
- Fit fixes may translate, uniformly scale, rotate (90° steps), or flip — never distort.
- Renderers (mock, client, preview) must contain-fit art uniformly; `stretch`-style
  fills and independent width/height are forbidden.
- A symbol whose viewBox aspect does not match its shape's bbox aspect is a structural
  FAIL (rendering it would distort) — never fix by squeezing.

### Original design is respected (binding, user directive 2026-07-04)

When art orientation and cell shape disagree (the 90° scale-tie case), the art is NOT
rotated. The ART is authoritative: fix the cell shape (or the shape-reading code) to
match the original design. Fixer rotation prescriptions for aspect-mismatch cases are
ESCALATIONS ("shape/art mismatch — fix the shape or redraw"), never auto-applied.

### Illustration-first (binding, user directive 2026-07-05)

Art comes BEFORE data, for ALL content (monsters, items, entities, currencies):
1. Create the illustration/icon FIRST; footprints/cell shapes/aspect ratios are
   DERIVED FROM the approved art afterwards (irregular footprints allowed — same
   BP-style collision, no need for neat rectangles).
2. Use plain, simple names and concepts when generating art (gorgeous names do not
   yield better art); the USER evaluates quality via NUMBERED proposal galleries
   and returns the accepted numbers.
3. No content entity ships stats/placement before its art is approved.

### Ratified exceptions & scope map (2026-07-12)

- **BS-G5 exception (ratified 2026-07-12) — now MOOT in practice (REQ-0150).**
  It permitted 90° rotation/mirroring of backpack-skin autotile EDGE TILES. There
  is no longer a tile atlas to rotate: the welt is derived per-pixel from a
  distance transform of the polyomino, so straights, outer corners and inner
  corners fall out with the correct orientation by construction
  (`art_pipeline.md` §6). The exception stands on paper; nothing exercises it.
- **Rotation scope map:** item icons — fit-fix 90°/flip allowed, but NEVER to
  resolve an aspect mismatch ("Original design is respected"); Unit icons —
  never rotated, upright forever (`unit_icon_pipeline.md` G3); skins — edge
  tiles per BS-G5 only; fill textures never rotate.
