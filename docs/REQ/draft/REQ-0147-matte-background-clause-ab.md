# REQ-0147 — matte-background-clause-ab

**Origin:** fallout of REQ-0135b (LayerDiffuse NO-GO, 2026-07-12). The matte
pain that motivated REQ-0135 is untouched by that NO-GO, and REQ-0135b's own
investigation surfaced a cheaper suspect that was never tested.
**State:** `draft/` — spec written, awaiting user ratification and a quiet GPU
box. Not cleared to run.
**Reference:** `docs/llm_managed/item_content_pipeline.md` (S5-4 matte),
`docs/llm_managed/unit_icon_pipeline.md` (S4 matte quality concern),
`docs/REQ/done/REQ-0135b-layerdiffuse-matting-eval.md`.

## Hypothesis

**Our matte pain may be partly self-inflicted by our own prompt.**

Every icon prompt in the live defs carries `plain uniform near-white background`
/ `clean flat backdrop`. That clause was written to make separation *easier*.
For the subjects that actually fail it is the **worst possible condition**:
birefnet must separate a pale, thin, specular object (steel blade, dagger tip,
hilt filigree, light hair, feather edge) from a background of nearly the same
luminance. Low contrast at exactly the boundary the model has to find.

Verified pain, both from a near-white background:

- `hilt` — matte coverage **10.99%** (item pipeline smoke test)
- `blade` — matte coverage **11.50%** (REQ-0135b route A, birefnet-general)
- unit S4 explicitly flags fine silhouettes (hair, weapon tips, wings)

REQ-0135b built arm C to test precisely this suspicion (`spike_defs_nobg.json`,
background clause stripped) and **never obtained valid data** — LayerDiffuse was
inert throughout, so every number that run produced measured plain SDXL. The
suspicion is untested, not refuted.

## Why this is worth doing before anything exotic

- It needs **no new model, no new node, no ComfyUI change.** Route A only
  (`gen_item_icons.py` + rembg `birefnet-general`), exactly as it ships.
- It is GPU-light: SDXL generation only, no second heavy model resident.
- If it wins, the fix is a **prompt edit** — the cheapest possible outcome.
- If it loses, we have finally *measured* the background clause instead of
  assuming it, and the matte problem is legitimately a model problem. That
  reopens the exotic options (a better separation model, SAM-HQ, or a ported
  LayerDiffuse) on evidence rather than on vibes.

## Scope

Single route (production route A). One variable: the background clause.

| arm | background clause in the positive prompt |
|---|---|
| W | `plain uniform near-white background`, `clean flat backdrop` (**live, control**) |
| G | mid-grey backdrop (luminance far from both pale steel and dark leather) |
| C | saturated chroma backdrop (green/magenta — maximal chroma distance) |
| N | no background clause at all (arm C of REQ-0135b, `spike_defs_nobg.json`) |

- Subjects: the REQ-0135 spike five — `blade`, `hilt`, `dagger` (verbatim live
  prompts), `wing` (feather probe), `elf_bust` (unit-hair probe).
- 2 candidates x seeds 101/202 = 10 images per arm, 40 total.
- Same checkpoint (JuggernautXL V9), same sampler (30 steps, cfg 6.5,
  dpmpp_2m/karras). **Only the background clause moves.** `gen_negative` stays
  byte-identical across arms (as `scratch_req0135_build_nobg_defs.py` already
  guarantees).
- Reuse `content/batches/req-0135-layerdiffuse-spike/spike_defs.json` (arm W)
  and `spike_defs_nobg.json` (arm N); build G and C with the same builder.

## Method — MANDATORY, per REQ-0135b's lesson

**Run generation and matting as separate passes.** ComfyUI (~11 GB RSS with SDXL
resident) and birefnet (~12 GB) cannot be co-resident on this 23 GB host; route A
was OOM-killed at job 2/10 twice on 2026-07-12. Use the escape hatch REQ-0135b
landed:

    1. gen_item_icons.py --no-matte      x4 arms   (ComfyUI up, no rembg)
    2. stop ComfyUI                                (frees ~11 GB)
    3. gen_item_icons.py --rematte-only  x4 arms   (rembg, ComfyUI down)
    4. tool_icon_score.py on all four arms
    5. numbered A/B/C/D gallery -> web/preview/req-0147-matte-bg/

## Gates

- Matte coverage per subject per arm, and the production scorer
  (`tool_icon_score.py`) on all four arms.
- Edges inspected at **256 px AND 64 px** (the 64 px cell is where thin
  silhouettes actually die).
- Numbered side-by-side gallery under `web/preview/` with checkerboard alpha,
  for the user verdict.
- **An effect assertion, not an artifact assertion** (REQ-0135b's expensive
  lesson): the gate is "arm G/C/N coverage differs materially from arm W on the
  failing subjects", not "files appeared".
- Decision recorded in this file. If an arm wins: update the live item/unit
  prompt templates + the S4/S5-4 pipeline docs. That is the implementation and
  it follows as its own change.

## Preconditions

- **Quiet GPU box.** No REQ-0136 bakeoff / REQ-0138 tiling / REQ-0127 rematte /
  any other art workload sharing the ComfyUI queue. Coordinate with the user.
  See REQ-0135a's incident log for what contention did to REQ-0135.
- ComfyUI started manually at `127.0.0.1:8188` and **stopped afterwards**
  (manual-start policy stands until REQ-0139 lands a single-owner queue).

## Non-goals

- No checkpoint change (that is REQ-0136).
- No `content/live/` writes; no pipeline-doc rewrite until there is a verdict.
- No new separation model, no LayerDiffuse (REQ-0135b: NO-GO). If this REQ
  loses, *then* the model question reopens.
