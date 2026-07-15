# REQ-0183 — po-shape-conditioned-generation: PO renders respect their cell shape, in artadmin

**Ratified:** 2026-07-15 (user, chat). The user's requirement, in full:

> POを画像生成したら、どんな形状でもうまい事考慮して、画像生成AIがその形状に合わせた
> ものを出力してくれる。そして、それは、artadmin上で出来る。ただ、それだけの話し。

Generate a PO in artadmin, on ANY shape, and the model returns art that fits that
shape. Nothing else. This REQ is the production wiring REQ-0153 deferred; REQ-0153
proved the mechanism and handed over a recipe, but wired nothing.

## Problem — the shape never reached the model

A po artwork's 5x5 cell mask is drawn by the operator in the REQ-0151 editor, stored
on the artwork, and used to derive gen_width/gen_height (`art_sizing.cjs`
`deriveSize`). It was also handed to the REQ-0152 inspection kits — the things that
JUDGE a finished render.

It was never handed to the thing that MAKES the render. `art_jobs.cjs`
`processGenJob` built its job payload from kind/main_object/prompt_template/
style_override/width/height/seed/tiling and stopped there, so `art_job.py` ->
`art_route.build_txt2img` generated with no knowledge of the silhouette. The model
was asked to hit a target nobody had told it about, then graded on whether it hit
it. On shapes whose subject happens to suit the bounding box (1x3 spear, 2x2 shield)
the ratified aspect-sizing law carries it; on the awkward ones (L, T) it free-composes
and misses. REQ-0153 measured the unconditioned baseline at **28.6% identity-fit
feasible**.

`build_txt2img` did carry a `mask_image` -> ConditioningSetMask path, but (a) nothing
on the admin route ever passed it, and (b) REQ-0153 established it is a NO-OP on this
route anyway: ConditioningSetMask rides SDXL cross-attention and does not port to
FLUX.2's DiT joint attention. Its only caller is the legacy `gen_item_icons.py`.

## What was ratified before this REQ (do not relitigate)

REQ-0153's verdict, GREEN-with-recipe: **Arm C = ReferenceLatent (mid-gray scaffold)
+ SetLatentNoiseMask (dilated shape over a white-canvas latent), D=8**, on the fixed
Flux.2 Klein 4B route. 100% identity-fit feasible with zero deep-overflow vs 28.6%
baseline; best median best-fit (61.43); pure white backgrounds; no ghosting. Arm A
(reference alone) = 60%, the fallback. Arm B (img2img init) killed. ControlNet and
the ConditioningSetMask port rejected. Model stays klein 4B as loaded.

## Decisions taken in THIS REQ

- **ON BY DEFAULT for every po, no toggle.** REQ-0153's addendum recommended exposing
  a per-item toggle because the hard lock costs subject legibility on blocky shapes.
  The user overrode that here: it should just work, on any shape, with no operator
  decision. A `shape_conditioning: false` seam exists in the job payload as an
  internal escape hatch; NO UI sends it, and none should without a fresh ruling.
- **po only.** si/unit/monster/bpskin/custom are untouched: si is locked 256x256 with
  no cell shape, and the rest are loose canvases. Monster grid shapes stay out of
  scope exactly as REQ-0153 scoped them.
- **The route stays byte-identical when unconditioned.** All three new
  `build_txt2img` inputs default None; every existing caller's graph is unchanged.
- **Prompt wording deviates from the addendum's sketch, deliberately.** The sketch's
  `edit_instruction` appended "white background, bold outline" itself; on the admin
  path the po `prompt_template` ALREADY owns that clause (default
  `{main_object}, white background, bold outline`), so re-stating it would duplicate
  it in every prompt. `art_style.edit_instruction` therefore only adds the shape
  directive and the caller wraps it in the kind/override style template as usual.
  Same tokens, stated once. The shape lock is mechanical, not prompt-order dependent.

## Implementation

- **`tools/art_shape.py` (new)** — the production scaffold builder, promoted from
  `tools/spikes/req0153_shape_scaffold.py`. 5x5 mask -> (a) mid-gray silhouette
  scaffold on white, (b) hard mask dilated by D, (c) white canvas, all at gen
  resolution. Gen size via `art_style.gen_size` over the mask bounding box — the same
  derivation `art_sizing.cjs` `deriveSize('po')` performs, so scaffold and artwork
  always register.
  **PIL only, no numpy/scipy** — a hard constraint, not taste: the generation worker
  runs under `jobPython()` (`ART_JOB_PYTHON`, else bare `python3`), which has PIL but
  not the kit venv's numpy/scipy. The spike could import scipy because it ran under
  the venv. Dilation is still EXACT: the shape is a union of axis-aligned cell rects,
  the disc dilation of a rect is that rect expanded by D with corners rounded at
  radius D, and dilation distributes over union — so a rounded rectangle per cell
  reproduces scipy's disc dilation. Verified bit-identical against the spike's own
  scipy implementation across L/T/1x3/2x2 x D in {0,8,16}: **0 pixels differ**.
- **`tools/art_route.py`** — `build_txt2img` grows `reference_image`,
  `shape_mask_image`, `mask_init_image` (all default None). Set the first for Arm A
  (LoadImage -> VAEEncode -> ReferenceLatent into the positive); add the other two for
  Arm C (white canvas VAEEncode -> SetLatentNoiseMask of the dilated mask, as the
  sampler's latent_image). Guards refuse the incoherent combinations (mask_image +
  reference_image share nodes; a mask without its init latent; masking without a
  reference). `mask_image`'s docstring now records that it is inert on FLUX.2.
- **`tools/art_style.py`** — `edit_instruction(subject)`: "Turn the gray shape into
  {subject}. Keep the silhouette exactly." A scaffold riding as a ReferenceLatent has
  to be addressed as an EDIT, which is what klein's unified t2i+edit architecture
  expects and what REQ-0153 scored GREEN with.
- **`tools/art_job.py`** — `po_shape_mask(job)` decides; on a hit it composes the edit
  prompt, renders the scaffold trio into ComfyUI's input dir (content-addressed by
  shape+size, so repeat renders reuse the same PNGs and two artworks can never read
  each other's scaffold) and passes them to the route. `preview` mode reports
  `shape_conditioned` + the real prompt but writes NO files (previews stay cheap and
  side-effect free).
- **`server/services/art_jobs.cjs`** — passes `shape: artwork.shape` into the
  generation job. This is the one-line heart of the REQ. Also records
  `params.shape_conditioned` / `params.shape_dilation_px` on the render: a render's
  params are the record of HOW it was made, and "was the shape enforced" is now part
  of that.
- **`server/routes/art.cjs`** — `hPreview` passes the shape too, so the preview shows
  the prompt generation will actually run, and returns `shape_conditioned`.
- **No client change.** Default-on needs no UI: the operator draws the shape they
  already draw, and generation now honours it.

## Verification

- **Dilation equivalence**: production PIL rounded-rect dilation vs the spike's scipy
  disc dilation — 0/0 pixels differ, all shapes, D in {0,8,16}.
- **Graph equivalence**: `build_txt2img(reference_image, shape_mask_image,
  mask_init_image)` vs the spike's own `wf_armC` — node-for-node, wire-for-wire
  IDENTICAL (ignoring prompt text). The graph that ships IS the graph that scored
  GREEN.
- **Unconditioned regression**: with no shape the graph keeps `latent_image = ["6",0]`
  (EmptyFlux2LatentImage) and carries no reference/mask nodes.
- **Gate**: `tools/ci.sh` (SKIP_E2E; e2e run separately). `artwork_test.cjs` 9/9
  including the new REQ-0183 test.
- Gen sizes reproduce the ratified examples (L 512x512, T 768x512, 1x3 256x768,
  2x2 512x512), and an off-origin mask trims to its bbox.

### A note on the G3 provenance test
`artwork_test.cjs`'s G3 asserts `final_prompt` is stored verbatim by comparing the
generated prompt against a `preview` call. That preview call did not pass the shape,
so once generation became shape-conditioned it compared two unlike things. Fixed by
passing the shape to the preview — which is exactly what `hPreview` now does. The
assertion is intact; it is being given matching inputs.

## Cost (budget for it, it is not a bug)
Reference-latent jobs run ~2-3x slower than plain t2i on the 8 GB card (REQ-0153
measured ~76-130 s vs ~15-50 s; VRAM peak 6.7-6.8 GB, no OOM). Every po render now
pays this. It buys 28.6% -> 100% identity-fit.

## Known trade-off (REQ-0153's finding, inherited on purpose)
The harder the silhouette lock, the more subject legibility it spends. On blocky
shapes the T `war hammer` reads as an abstract cracked-metal T and a 2x2 `round
shield` fills as a full disc rather than a heater shield. On shapes whose subject
already suits the bbox, conditioning mostly buys extra cell coverage rather than a
rescue. This is the price of "any shape, always", which is what was asked for. If it
grates in practice, the escape hatch is `shape_conditioning: false` per job, or Arm A
(reference without the hard mask, ~60% containment) — either needs a fresh ruling.

## Out of scope
- Monster grid shapes; si (no cell shape).
- Any UI toggle (explicitly declined by the user).
- Re-running the REQ-0153 arm matrix; its verdict is ratified and reused as-is.
- The dead `mask_image`/ConditioningSetMask path — documented as inert, left for its
  legacy caller, not removed.

## Gate results — 2026-07-15

- `tools/ci.sh` (SKIP_E2E, e2e run separately per the standing practice): **CI GREEN**.
- `artwork_test.cjs` (pg backend): **9 passed, 0 failed**, including the new REQ-0183 gate.
- `tools/artadmin_e2e.sh`: **5 passed** (create -> generate -> lightbox -> adopt -> serve
  -> delete rules -> re-adopt; filters; queue cancel/retry; deep link; custom kind).
- `tools/art_inspect_e2e.sh`: **1 passed**.
- Dilation vs the spike's scipy disc dilation: **0 pixels differ** (L/T/1x3/2x2 x D 0/8/16).
- Arm C graph vs the spike's own `wf_armC`: **node-for-node identical** (prompt text aside).
- Commits: `d317d5f` (implementation), `47db34f` (reservation).

**Not yet done:** the S7 eyeball on REAL GPU renders, and merge/deploy to live artadmin
(main checkout + services are HANDS-OFF without a fresh user go-ahead). The GPU was busy
with another session's ComfyUI job throughout this pass; per the standing GPU etiquette
(serialize, coordinate, no retry storms) no demo render was queued against it.

## Integration pass — 2026-07-15 (user go-ahead in chat: "masterへマージしてlive artadmin")

- **Merged to master.** Branch re-based over the master that had moved under it
  (`8830ace` -> `e3bc77d`, docs-only, zero overlap with this REQ's files), re-certified,
  then fast-forwarded: master is now `e720e95`.
- **Re-certified before the merge:** `tools/ci.sh` (SKIP_E2E) **CI GREEN** on the merged
  branch. Earlier on the same code: `artwork_test.cjs` 9/9 (pg), `artadmin_e2e.sh` 5/5,
  `art_inspect_e2e.sh` 1/1.
- **No client rebuild needed:** this REQ changes 0 files under `client/`, so the committed
  dist stays valid; `backpack-web` was left alone.
- **Deployed:** `backpack-api` restarted 2026-07-15 00:28:54 UTC (it runs the main
  checkout's `server/api.cjs`, so the restart is what picks this up). `backpack-api` /
  `backpack-web` / `backpack-tunnel` all active; web 8801, api 8802, ingress and
  `/app/#/artadmin` all HTTP 200.
- **Verified LIVE, not just in tests** — `POST /api/art/artworks/<po>/preview` against the
  running api returns `shape_conditioned: true` and the edit prompt
  ("Turn the gray shape into iron sword, ... Keep the silhouette exactly."), while an `si`
  artwork returns `shape_conditioned: false` with its plain subject. The deployed process
  is running this code.
- **Timing note:** another session's default e2e suite (178 passed) was holding the box
  lock during this pass; the restart waited for it to finish rather than breaking it.

**Disposition: STAYS in built/.** Merged and deployed, but NOT yet accepted: the S7 eyeball
on real GPU renders has not happened. Throughout this pass ComfyUI was busy with another
session's job (GPU 100%), so per the standing GPU etiquette no demo render was queued and
no artwork was created in the LIVE registry unprompted. Moving to done/ requires the user
generating a po in artadmin and accepting the result.

## Acceptance — 2026-07-15
**Accepted by the user in chat ("doneでOKです"), with the S7 eyeball deliberately delegated
to a separate job: REQ-0187-po-shape-conditioning-s7-verification (todo/).**

Recorded plainly so history is not misread: this REQ reached `done/` on API-level evidence
(CI GREEN, artwork_test, artadmin e2e, live preview returning the edit prompt and the
conditioned flags) and on REQ-0153's inherited spike measurements. **No real GPU render
produced by this code has been looked at** — the GPU was busy with another session's job
throughout. REQ-0187 owns that verification and may return an AMBER/RED that sends work
back here.
