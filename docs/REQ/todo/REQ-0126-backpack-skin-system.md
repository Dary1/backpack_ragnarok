# REQ-0126 — backpack-skin-system

**Status:** todo (user-cleared without further approval, 2026-07-12 chat)
**Reserved:** 2026-07-11
**Slug:** backpack-skin-system
**Reference:** `backpack_skin_pipeline_proposal.md` v0.3 (on the FS; moves to
`docs/llm_managed/backpack_skin_pipeline.md` once its golden is ratified)
**Ordering:** after REQ-0124 (naming) is preferable but not blocking; skin
art production (pipeline S1–S5) is a SEPARATE concern and NOT part of this REQ.

## Goal

Implement the Backpack Skin SYSTEM — rendering stack, data model, and
validation harness — independently of any real skin art. Deliver with a
neutral default skin plus one programmer-art dev skin proving the stack.

## Scope

1. **Rendering stack** (client, PixiJS): compose per §2 of the pipeline doc —
   canvas background → `fill_texture` clipped by (cell interiors + edge-tile
   `clip_mask`s) → `tile_fill_override` (same clipping) → edge tile art →
   items/POs → overlays. Overlays (damage, links, charge) render identically
   across all skins.
2. **Autotile resolver**: given any BP polyomino (incl. inner corners and
   holes), select and place straight/outer-corner/inner-corner tiles.
   Orientation strategy per BS-G5 ruling (default until ruled: author/derive
   all orientations at build time; no renderer rotation).
3. **Data model**: new asset kind `bpskin/1` in the registry; skin =
   instance-level cosmetic slot on a BP. Resolution chain: Unit's set skin →
   neutral default skin → current plain BP rendering. Missing art never
   blocks rendering.
4. **Persistence**: cosmetic ref through `server/storage.cjs` (the only
   chokepoint) + migration under `tools/migrations` for existing profiles
   (default: no skin ref = neutral).
5. **Validation harness** (S3 of the pipeline doc): deterministic composite
   of the full stack over the shape suite (1×1, I, L, T, S/Z, inner-corner,
   holed) on contrasting canvas backgrounds; screenshot grid (fit-report
   pattern); machine checks for seams, fill leakage outside clip masks, and
   rounded-corner blend. Built as a MACHINE GATE from day one (UGC-ready,
   Nightmare Forge validator discipline).
6. **Dev assets**: one neutral default skin + one deliberately ornate
   programmer-art skin (rounded corners mandatory) to exercise the clip-mask
   path.

## Out of scope

- Real skin art batches (pipeline S1–S5) and their golden ratification.
- UGC submission flow, market tradability (open items of the pipeline doc).
- Unit icon rendering (REQ-0125) and generation (REQ-0127).

## Gates

- Harness green on the full shape suite (zero leakage, zero seams).
- e2e: board renders with skin system on for existing squads (no visual
  regression with neutral skin); dev skin toggles correctly on one BP
  instance; missing-asset fallback proven.
- pnpm test green in touched packages; e2e via `tools/e2e_run.sh` only.
- Storage migration proven on a copied profile fixture.
