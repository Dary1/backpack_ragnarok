# REQ-0150 — icon-skin-checkpoint-divergence

**Status:** draft (blocked on a user decision — see Decision required)
**Reserved:** 2026-07-13
**Slug:** icon-skin-checkpoint-divergence
**Raised by:** REQ-0127 merge (2026-07-13). REQ-0131 surfaced the cross-risk;
REQ-0136's verdict made it real.

## The problem in one line

The icon route is now **FLUX**; the only working skin-tiling recipe is
**SDXL-only**; nobody has decided what happens to the skin route.

## How we got here

- **REQ-0136** (built): the user ratified **flux2** — FLUX.2 klein 4B distilled,
  GGUF Q8_0 — as the default icon route (2026-07-12, reconfirmed 2026-07-13).
  It beat JuggernautXL V9 and DreamShaperXL Turbo on brief compliance (16/16
  near-white backgrounds vs 5/16 and 1/16), painterly style, speed (10 s vs 40 s
  and 20 s) and licence (Apache 2.0).
- **REQ-0127** (built): the 11-unit roster shipped on flux2, S7 ALL GREEN.
- **REQ-0138** (the skin pipeline's *only* green result): the seamless
  `fill_texture` recipe is built on `SeamlessTile` + `CircularVAEDecode`. Both
  patch **Conv2d circular padding into the SDXL UNet**. They are
  **architecture-specific and do not apply to FLUX-family checkpoints**
  (`backpack_skin_pipeline.md` §"Checkpoint portability").
- **REQ-0131**: the recommended edge-tile route (1-D seamless strip) rests on the
  same two patches, so it inherits the same constraint.

So the ratified icon checkpoint **cannot run the skin pipeline's tiling recipe**.
This was never priced into the bakeoff — REQ-0131 flagged it, but the flag was
attached to a factually wrong claim (that flux2 had never been ratified), and the
wrong claim is what got argued about. The real constraint stands.

## Decision required (user)

**The user has explicitly NOT decided this.** Verbatim, 2026-07-13:
"circular padding は、別の方法でやり方を考えます" and "スキンが、SDXL を必要とするなら
分岐で。私にはわかりません。"

That gives a direction (re-solve circular padding another way; divergence is
acceptable if skins truly need SDXL) but not a route. Options:

**A. Formal divergence — icons = flux2, skins = SDXL (V9).**
Cheapest, works today. Cost: two checkpoints resident in the art pipeline, two
prompt idioms (FLUX ignores negatives at cfg 1.0; SDXL needs them), two style
ceilings — and skins keep V9's photorealism bias, the exact ceiling that got
batch-003's item art NG'd at S7. Risk: skins visually drift from the icons they
sit behind.

**B. Re-solve seamless tiling on FLUX.**
Keeps one checkpoint. Requires finding a FLUX equivalent of circular Conv2d
padding (does the FLUX VAE/DiT even expose the seam the same way?), then
re-running the REQ-0138 offset check to re-establish the seam ratio
(0.83–1.09 seamless vs 2.76–3.77 control). Unknown effort, unknown feasibility;
this is the "別の方法" the user gestured at. Should be a **spike**, not a
commitment.

**C. Sidestep tiling in the generator.**
Do not ask the model for a seamless tile at all — generate oversized on FLUX and
make it tile in post (offset + inpaint/blend the wrap seam, or synthesise the
tile from a non-tiling texture). Checkpoint-agnostic by construction; the quality
question moves from the UNet to the seam-repair step.

## Scope (once a route is chosen)

Not written yet — deliberately. The scope depends entirely on the decision above,
and writing it now would smuggle the decision in.

## Gates

- Decision recorded here with the user's reasoning, before any implementation.
- If B or C: a spike REQ with a measured seam ratio against the REQ-0138 baseline
  (0.83–1.09 seamless / 2.76–3.77 control) before any skin batch is briefed.
- No skin batch may be briefed on an unresolved checkpoint story.

## Do not

- Do NOT "resolve" this by quietly pointing the skin route at flux2 — the recipe
  is documented not to work there.
- Do NOT re-litigate the flux2 icon verdict. It is ratified and shipped
  (REQ-0127). This REQ is about the skin route only.

## Lesson carried from the incident that produced this REQ

REQ-0131 concluded "no bakeoff has been run, no winner ratified" by reading
`docs/REQ/*/` on master while REQ-0136's bakeoff and verdict sat on an unmerged
branch — and wrote that inference into master as fact, striking a true user
decision as a false claim. **A REQ's folder is its status on YOUR branch, not in
the program.** Before declaring that work never happened, check `git log --all` /
`git branch --contains`, or ask the user. Inference is not evidence.
