
> ## ART: SUPERSEDED by `art_pipeline.md` (REQ-0150, 2026-07-13)
>
> Everything in this file about **image generation** — checkpoints, LoRAs, samplers,
> steps, prompts, negative prompts, tiling, generation sizes, tool names — is
> **out of date and must not be followed**. It describes the retired SDXL route
> and/or the retired Norse dark-fantasy painterly art direction.
>
> The current route, style and tools are in **`art_pipeline.md`**. Two user
> decisions (2026-07-13) supersede this file's art content:
> **(1) one route: flux2** — SDXL is retired and its code is deleted;
> **(2) a new art direction** (InvokeAI Anime / Concept Art (Fantasy) templates,
> euler / 30 steps / cfg 1.0 / no LoRAs / no negative), which supersedes the Norse
> painterly direction **including REQ-0127's ratified unit roster style**.
>
> > The SDXL `SeamlessTile` fill recipe is **dead** — `SeamlessTile` is a NO-OP on
> FLUX (proved bit-identical, 4/4). The FLUX recipe is `CircularVAEDecode` alone.
> Skins are now generated AND composed by script: `tools/gen_bpskin.py` +
> `tools/bpskin_compose.py` (`art_pipeline.md` §6). The BS-G5 edge-tile rotation
> exception is moot: the welt is derived from a distance transform, so there is
> no tile atlas to orient.
>
> The NON-art content of this file (schema, data model, review flow) still stands.

# Backpack Skin Generation Pipeline — v1.0 (RATIFIED by user "all green", 2026-07-12)

> Split out of `unit_icon_pipeline_proposal.md` by user direction (2026-07-12).
> v0.2 applied user feedback (emblem removed; background layers + masks;
> capability-not-sales, likely UGC). v0.3 normalized the user's working terms
> to established industry vocabulary (user direction). v1.0: golden ratified
> ("all green", 2026-07-12) — BS-G5 ratified as proposed (90° rotation
> allowed for edge tiles only, as a written art_golden exception).
> Authoritative copy: `docs/llm_managed/backpack_skin_pipeline.md` on the
> server. v1.1 (2026-07-12, REQ-0134): §7 updated after the 2026-07-12
> review session (user verdict ALL GREEN) — item 4 removed as stale (BS-G5
> was already ratified in v1.0), item 5 DECIDED (alpha), item 3 method
> DECIDED (REQ-0143 harness), item 1 gates specced (REQ-0144); items 1
> (rollout scope) and 2 remain OPEN. `art_golden` references resolve to
> `common_content_pipeline.md` §2 (art_golden.md abolished by user
> directive, 2026-07-12).

## Terminology (user coinage → adopted standard term)

| User working term | Adopted term | Established lineage |
|---|---|---|
| overall_texture_background | **`fill_texture`** | nine-slice "center patch", generalized; seamless/tileable texture |
| per_tile_background | **`tile_fill_override`** | no single universal term; "tile variant/override" is the tilemap convention |
| should_draw bitmap | **`clip_mask`** | clipping/stencil/alpha mask (Photoshop clipping mask, CSS mask-image, PixiJS texture mask) |
| edge tile set as a family | **autotile set** | Wang/blob tiles; Godot "autotile", Tiled "terrain/Wang sets" |

The whole construction is best described as: **a nine-slice generalized to
arbitrary polyominoes, implemented as an autotile set with per-tile clip
masks.** Straight edge / outer (convex) corner / inner (concave) corner are
already the standard autotiling tile names and stay as-is.

## 0. What a Backpack Skin is

- A Backpack Skin themes a BP's **edge design pattern and interior fill** —
  what makes an elf's bag read elven and a barbarian's bag read barbarian —
  while changing NOTHING about the BP's shape, cells, HP, or any gameplay
  data. Skin ≠ shape: the polyomino is untouched.
- Skins are **replaceable cosmetics**. Every BP renders with some skin; the
  default resolves from its Unit's set. Skins are swappable assets, never
  hard-wired to a BP def.
- **Unit Skin + Backpack Skin ship as a paired SET** sharing one style token
  block (user ruling, 2026-07-12). Sets are reviewed together in one gallery.
- Skins are NOT for sale (user ruling, 2026-07-12 — capability only, Pay to
  Kill stays the single monetization axis). The replaceability exists as a
  feature; the likely long-term source is **UGC** (Nightmare Forge family:
  budgeted, validator-gated player content).

## 1. Asset model (per skin)

- **`fill_texture` — REQUIRED.** Seamless, tileable texture drawn across all
  owned cells of the BP, beneath everything else (the generalized nine-slice
  center patch).
- **`tile_fill_override` — OPTIONAL.** Replaces the fill within specific
  tiles.
- **Autotile edge set: straight edge, outer (convex) corner, inner (concave)
  corner.** Each edge tile carries TWO bitmaps:
  - the **art bitmap** (the visible edge design), and
  - a **`clip_mask`** — a mask texture declaring exactly where, inside that
    tile's area, the fill layer(s) may show through.
  Rationale (user, 2026-07-12): without a per-tile clip mask the
  `fill_texture` cannot be trimmed to the edge art's contour. A
  rounded-corner tile would leave a square fill corner poking past the
  curve, and the canvas background would never blend against the bag's
  rounded silhouette. The clip mask is what makes edge art and fill meet
  cleanly on any shape.
- **No emblem/accent tile** (removed per user, 2026-07-12).

## 2. Rendering composition (bottom → top)

canvas background → `fill_texture` clipped by (cell interiors + edge-tile
`clip_mask`s) → `tile_fill_override` (same clipping) → edge tile art →
items/POs → renderer overlays (damage state, links, charge UI).

Overlays are identical across all skins — a skin can never carry gameplay
signal (BS-G1). Implementation note: PixiJS (the client renderer) supports
texture-based masks natively, so the clip stage maps directly onto the
existing stack.

## 3. Core design constraint — one skin, any polyomino

A BP is an arbitrary polyomino, so a skin cannot be a single raster. The
autotile set (straight / outer corner / inner corner + clip masks) decorates
ANY polyomino, including shapes with inner corners and holes. This is the
only route that scales across player-crafted shapes ("not just what fills
them, but their very shapes").

Orientation: tiles must cover N/E/S/W. Either the renderer 90°-rotates master
tiles (needs an explicit carve-out from art_golden's no-rotation rule —
BS-G5), or all orientations are authored/derived at build time.

## 4. Backpack Skin Golden (RATIFIED 2026-07-12)

- **BS-G1 — Cosmetic-only.** A skin never changes shape, footprint, collision,
  or any gameplay-readable signal. Damage state, link overlays, charge UI stay
  renderer-drawn, identically across all skins.
- **BS-G2 — Cell legibility floor.** Items and cell boundaries must stay
  readable under every skin: edge art lives inside a fixed border band (width
  TBD, open item); fills must keep enough contrast headroom for item art
  (contrast budget TBD with the band width).
- **BS-G3 — Set coherence.** A Backpack Skin shares its style token block with
  its paired Unit Skin; the set is judged as one numbered gallery entry. A bag
  that doesn't read as its unit's bag at board scale is a FAIL.
- **BS-G4 — Any-shape + clip integrity guarantee.** A skin ships only if the
  autotile set renders seamlessly on the validation shape suite (incl. inner
  corners and at least one holed shape) AND no fill pixel ever draws outside
  a `clip_mask` on any suite shape. Rectangle-only skins and clip leakage are
  both FAILs.
- **BS-G5 — Rotation ruling (RATIFIED 2026-07-12, v1.0).** Edge tiles are
  pattern art, not character art: 90° rotation/mirroring is allowed for edge
  tiles ONLY, as the written exception recorded in
  `common_content_pipeline.md` §2 ("Ratified exceptions & scope map"). All
  other art never rotates.

## 5. Steps

- **S1 Brief.** Skin sets batched with their unit roster batch (paired
  review). Plain motif words for generation.
- **S2 Texture & tile generation.** AI-raster route generates (a) the
  `fill_texture` (seamless/tileable), and (b) a MOTIF SHEET (border strip
  samples) per skin from which master edge tiles are cut and cleaned.
  `clip_mask`s are then derived from each tile's contour (auto-trace of the
  edge art's inner boundary) with manual fixup allowed.

  CORRECTED 2026-07-12 (REQ-0138, measured). The v1.0 risk note said
  "diffusion models are weak at seamless tiling". That was wrong as stated —
  the weakness is in the default sampler/VAE *padding*, not in the model.
  `fill_texture` tiling is **SOLVED**, with no manual cleanup, via circular
  padding (`spinagon/ComfyUI-seamless-tiling`):
    - `SeamlessTile` (`tiling: enable`, `copy_model: "Make a copy"`) between
      the checkpoint loader and the KSampler — circular Conv2d padding in the
      UNet;
    - `CircularVAEDecode` (`tiling: enable`) in place of `VAEDecode` — the
      decoder pads independently, so a normal decode reintroduces the seam;
    - both patches, or the seam survives.
  Measured seam ratio (wrap-edge discontinuity / interior baseline; 1.0 =
  indistinguishable from the texture): **0.83–1.09 seamless vs 2.76–3.77
  control**, across 2 motifs × 2 seeds, zero overlap. Recipe is architectural
  and carries to any SDXL checkpoint — but **NOT to the FLUX family**, and that
  now bites.

  **THIS RECIPE IS FROZEN (user decision, 2026-07-13 — REQ-0150 "Flux2化").**
  The program moves to **one route: flux2** for all image generation; SDXL is
  retired. Circular Conv2d padding is SDXL-UNet-specific, so this recipe — the
  skin pipeline's only green result — **does not survive the migration** and
  must be **re-solved on FLUX** (a FLUX-native seamless analogue, or tiling
  repaired in post on an oversized flux2 render). That spike is a **blocking
  gate of REQ-0150**, and its verdict must be measured against the seam ratio
  below, not asserted.

  Until that spike lands: **no skin batch may be briefed**, and the numbers below
  stand only as the SDXL-era baseline to beat. Do NOT "fix" this by pointing the
  skin route at flux2 with the circular patches still in the graph (they are
  silently inert there), and do NOT quietly re-introduce SDXL — if FLUX has no
  answer, that is a finding to bring to the user, not a licence to fork the
  route.
  Circular padding makes a tile *joinable*, not *tileable-looking* — the
  allover-pattern prompt discipline (no focal object, no vignette/gradient,
  uniform density edge to edge) is still mandatory.

  **EDGE TILES (REQ-0131, measured 2026-07-12): the motif-sheet route is
  DISPROVED. Do not cut edge tiles out of a frame sheet.**

  The spike asked the model for an ornate square frame with a uniform border
  band, then cut `straight` from the top band and `outer corner` from the
  corner. A diffusion model does not paint a uniform band — it paints a
  decorative ARCH. The cut "straight" tile is therefore an arch, and repeating
  an arch along an edge gives a scalloped, discontinuous ribbon. Periodicity
  along its run is the one property a straight edge tile must have, and it is
  exactly the property a frame sheet cannot supply. (`band_thickness()` duly
  measured 463 px of 1024 as the "band"; the derived `clip_mask` became a blob
  covering 41.8 % of the tile and clipped the cell away.)

  **Route instead: GENERATE the edge periodic; do not cut it out.** This falls
  straight out of the fill recipe above. A straight edge tile must repeat along
  ONE axis — which is what circular padding delivers, already proved on this GPU
  route:
    - generate the straight edge as a **1-D seamless strip** (wide, short canvas,
      e.g. 1024×256; same `SeamlessTile` + `CircularVAEDecode` recipe; prompt a
      continuous ornamental border running left-to-right). It then tiles along
      its run BY CONSTRUCTION, exactly as `fill_texture` tiles in 2-D. Cut any
      cell-width piece; every piece joins.
    - **corners are authored or derived from the ratified straight tile**, never
      cut from a sheet. A frame sheet has no concave corner to cut at all.
    - `clip_mask` auto-trace and the BS-G5 rotation exception are only worth
      testing once a valid straight tile exists.

  **Harness caveat.** A leakage metric alone cannot pass this step: the spike's
  harness reported `leaking=0` on composites that were nearly EMPTY (nothing
  drawn cannot leak). Any S3 harness must pair leakage with a **coverage** check
  — did the fill actually render inside the silhouette?
- **S3 Assembly + validation harness.** Deterministic harness composites the
  full rendering stack (§2) on the validation shape suite (1×1, I, L, T, S/Z,
  inner-corner and holed shapes) over several contrasting canvas backgrounds,
  and produces a screenshot grid (fit-report pattern). Checks: seams/misjoins,
  fill leakage outside clip masks, rounded-corner blend against the canvas.
  Any failure = FAIL.
- **S4 Preview.** Gallery to `web/preview/bpskins-NNN/` on backpack-dev: each
  set shown as (a) unit portrait + skinned sample shapes side by side, (b) a
  real Squad canvas mock at board scale (BS-G3 judgment).
- **S5 STOP — user review.** Accepted numbers recorded in batch notes. Only
  then does the skin enter the registry.

## 6. Resolution & data model (sketch)

- Skin is an **instance-level cosmetic slot** on a BP (two BPs of the same def
  can wear different skins). Default resolution: Unit's set skin → neutral
  default skin → current plain BP rendering. Missing art never blocks
  rendering (mirrors REQ-0125's fallback chain).
- Registry: new asset kind (e.g. `bpskin/1`) beside items. The persisted
  cosmetic ref goes through `storage.cjs` (the only persistence chokepoint)
  and needs a migration entry — same family of decisions as REQ-0124.
- UGC consequence: because skins will likely be player-authored, every gate in
  S3 must be a **machine gate** (no hand review in the loop), same validator
  discipline the Nightmare Forge note mandates for forged dungeons.

## 7. Open items (updated 2026-07-12 — review session, ALL GREEN)

1. **UGC scope** — submission machine gates are now specified by REQ-0144
   (NSFW/CSAM classifier, best-effort IP screen, S3 harness as gate 0).
   STILL OPEN: friends-only vs global rollout.
2. **Market tradability** — are (UGC) skins tradable for Transmutators?
   STILL OPEN.
3. **Border band width + fill contrast budget (BS-G2)** — METHOD DECIDED:
   the numbers come from REQ-0143's automated luminance-contrast harness at
   board scale (64 px/cell) over the validation shape suite; the final
   values are a user ratification of that harness output.
4. *(removed — stale: BS-G5 was already ratified with v1.0, see §4.)*
5. **`clip_mask` encoding — DECIDED: alpha channel.** PixiJS consumes
   texture masks natively (alpha-based); a color key would only add a
   conversion step. (The old "if REQ-0135 adopts LayerDiffuse, alpha is
   produced at generation time anyway" rider is dead: REQ-0135b is a NO-GO, so
   alpha keeps coming from the post-hoc rembg matte. The decision above is
   unaffected — it never depended on that rider.)
