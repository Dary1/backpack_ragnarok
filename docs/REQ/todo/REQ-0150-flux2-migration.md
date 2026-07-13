# REQ-0150 — flux2-migration (Flux2化)

**Status:** todo (user-ratified 2026-07-13: "一旦全て Flux2 にしましょう")
**Reserved:** 2026-07-13
**Slug:** flux2-migration
**Supersedes:** the draft `icon-skin-checkpoint-divergence`. The divergence
question is CLOSED — the user chose **no divergence: everything moves to flux2.**

## Decision (user, 2026-07-13)

**One route for all image generation: `flux2` — FLUX.2 klein 4B distilled, GGUF
Q8_0 (Apache 2.0).** SDXL (JuggernautXL V9, DreamShaperXL Turbo) is retired as a
production route.

Two explicit consequences the user accepted when taking this decision:

1. **The seamless-tiling recipe dies with SDXL.** REQ-0138's `fill_texture`
   recipe (`SeamlessTile` + `CircularVAEDecode`) patches circular Conv2d padding
   into the **SDXL UNet** and does not apply to FLUX. It was the skin pipeline's
   only green result. The user's direction: **re-solve it on FLUX by other
   means** — that spike is a gate of this REQ, not a follow-up.
2. **Everything generated on SDXL gets re-generated on flux2 and shown to the
   user.** Not just new art: the existing SDXL-era assets are re-run and
   presented for a single review pass.

## Goal

Leave the program with (a) exactly one generation route in the code and in every
doc, (b) a FLUX answer for seamless tiling or a measured verdict that there
isn't one, and (c) one gallery where the user can see **every** image-generation
pipeline's output, regenerated on flux2, and rule on it.

## Scope

### 1. Route unification (code)

- `tools/gen_item_icons.py`: `ROUTE = "flux2"` is already the default. Demote the
  `sdxl` branch to **frozen**: keep it runnable for reproducing historical
  batches, mark it in-code as non-production, and make sure no default path,
  wrapper, or doc reaches it implicitly.
- `tools/gen_unit_icons.py`: already flux2 via the wrapper — verify no residual
  SDXL sampler defaults (30 steps / cfg 6.5 / dpmpp_2m / karras) leak in.
- `tools/gen_monster_art.py`: **still pure SDXL** (steps 30, cfg 7.0, LoraLoader
  chain onto a checkpoint's MODEL/CLIP). This is the largest port in this REQ.
  Open question to settle inside it: **the LoRA chain.** Monster art leans on
  LoRAs; FLUX LoRA support is a different loader and the existing LoRAs are
  SDXL-trained, so they do NOT carry over. Decide and record: drop the LoRAs,
  find FLUX equivalents, or (if monster art genuinely cannot cross) escalate to
  the user rather than silently keeping an SDXL island.
- No tool may keep an implicit SDXL default after this REQ.

### 2. Seamless tiling on FLUX — BLOCKING SPIKE

The one genuinely unknown piece. Deliverable: a measured verdict, not an opinion.

- Baseline to beat, from REQ-0138 (SDXL): **seam ratio 0.83–1.09 seamless vs
  2.76–3.77 control**, 2 motifs × 2 seeds, zero overlap. Same metric, same
  offset check, or the comparison is worthless.
- Routes to try, cheapest first:
  a. A FLUX-native equivalent of circular padding (does the FLUX DiT/VAE expose
     the seam the same way circular Conv2d padding does? If a `SeamlessTile`
     analogue exists for FLUX, this is the short path).
  b. Sidestep the model: generate oversized on flux2 and make it tile in post
     (offset + inpaint/blend the wrap seam). Checkpoint-agnostic by
     construction; moves the quality question to the seam-repair step.
- **If neither reaches the REQ-0138 seam ratio, that is a real result** — report
  it and stop; do not quietly ship a seamed skin. Escalate to the user; the SDXL
  fallback for skins ONLY comes back on an explicit user decision.

### 3. Regenerate every SDXL-era asset on flux2

| surface | current state | action |
| --- | --- | --- |
| Unit icons (`units-001-roster`) | already flux2, S7 ALL GREEN (REQ-0127) | none — include in the gallery as the flux2 reference |
| Item icons (`batch-003-item-icons`) | V9; **NG'd at S7** | regenerate all on flux2 |
| Monster art (`monsters-001`, `monsters-002`) | SDXL + LoRAs | port the tool, then regenerate |
| Backpack skins (`bpskin-tiling-0138`, `bpskin-spike-0131`) | SDXL, recipe is SDXL-only | blocked on the §2 spike; regenerate once it lands |
| `bakeoff-0136` | the bakeoff itself | none — history, keep as-is |

Rules that carry over and are NOT re-litigated here:

- **The negative prompt is INACTIVE on flux2** (distilled klein samples at
  cfg 1.0; the graph zeroes the conditioning). Steer style from the POSITIVE.
  Any prompt ported from SDXL that leans on `gen_negative` must be rewritten,
  not copied.
- **Stop ComfyUI before the matte phase.** rembg `alpha_matting` peaks at
  12–13 GB RSS and will not fit beside a resident model on the 23 GB box —
  `--no-matte`, stop ComfyUI, then `--rematte-only`. This OOM has already
  killed two runs (REQ-0135b, REQ-0136) and paused a third (REQ-0127).
- **Restart ComfyUI between routes.** `/free` does not return weights to the OS;
  a process that served SDXL and then FLUX reached 19.2 GB RSS and took the box
  off SSH (REQ-0136).
- Scoring stays a **FILTER ONLY** (coverage ≥ 20% auto-FAIL). It never picks a
  winner; the user's gallery verdict does.
- Box contention is real: check nothing else is holding a model before launching
  (REQ-0127 was paused at 13/48 for exactly this).

### 4. Documentation — one route, everywhere

Every doc that describes image generation states flux2 as THE route, with SDXL
named only as retired/historical:

- `item_content_pipeline.md`, `unit_icon_pipeline.md` — already switched to
  flux2 (2026-07-13); demote the `sdxl` fallback wording to "frozen, historical
  reproduction only".
- `backpack_skin_pipeline.md` — the SDXL fill recipe is FROZEN pending §2.
- `monster_content_pipeline.md` / `architecture.md` — carry the flux2 route once
  `gen_monster_art.py` is ported.
- Superseded pointers into REQ-0131, REQ-0138, REQ-0147, whose forward
  instructions still pin SDXL.

### 5. Present every pipeline result to the user (the point of this REQ)

One gallery — `web/preview/flux2-all/` on backpack-dev — showing **every**
image-generation pipeline's flux2 output side by side:

- item icons · unit icons · monster art · backpack skins (if §2 lands)
- every candidate at **256 px AND 64 px**, numbered (golden G4), so the verdict
  can be given by key
- where an SDXL-era predecessor exists, show it **next to** the flux2 version:
  the user is being asked to judge a migration, and a migration is judged
  against what it replaced
- matte quality visible; auto-FAIL (<20% coverage) flagged and greyed, never
  silently dropped

**STOP at S7.** The user rules on the gallery. Nothing enters `content/live/` in
this REQ.

## Out of scope

- Unit/item def authoring (connection shape, charge, effects, `i18n.ja`) —
  illustration-first; art precedes data.
- Client rendering (REQ-0125).
- Character-identity LoRA work (REQ-0137) — but note §1's LoRA question may
  change its footing; cross-check before that REQ resumes.

## Gates

- [ ] No production code path or doc reaches an SDXL checkpoint by default.
- [ ] `gen_monster_art.py` runs on flux2, with the LoRA question answered in
      writing (ported, dropped, or escalated).
- [ ] **Seamless tiling: a measured verdict on FLUX** against REQ-0138's seam
      ratio (0.83–1.09 vs 2.76–3.77 control) — a green recipe, or an honest NO
      with the numbers. Blocking for any skin regeneration.
- [ ] Every SDXL-era surface regenerated on flux2 (item icons, monster art,
      skins-if-§2-green), coverage filter ≥ 20%, 0 unexplained FAIL.
- [ ] One gallery at `web/preview/flux2-all/`, 256 + 64 px, numbered, flux2 shown
      against its SDXL predecessor where one exists.
- [ ] S7 stop honored: nothing written to `content/live/`.

## Risks, stated up front

- **Monster art may not cross.** SDXL-trained LoRAs do not load on FLUX. If
  monster identity depends on them, this REQ cannot silently "port" it —
  escalate.
- **Tiling may have no FLUX answer.** Then the program owns a real conflict:
  one route (user's decision) vs working skins (REQ-0138). Surface it with
  numbers; do not resolve it by quietly re-introducing SDXL.
- **This is a large GPU job.** Item icons + monster art + skins is many batches
  on a 23 GB box that has already OOM'd three times. Sequence them, one model
  resident at a time, and expect to run unattended with `setsid nohup`.

## Lesson carried in (do not repeat it)

REQ-0131 declared "no bakeoff has been run, no winner ratified" by reading
`docs/REQ/*/` on master while REQ-0136's bakeoff and the user's verdict sat on an
unmerged branch — and wrote that inference into master as fact, striking a true
user decision as a false claim. **A REQ's folder is its status on YOUR branch,
not in the program.** Before declaring that work never happened: `git log --all`,
`git branch --contains`, or ask the user. Inference is not evidence.

---

# Implementation log

## Session 2026-07-13 — §1 route unification + §2 tiling spike

User-set scope for this session: §1 and §2 only. §3 (regeneration), §4 (docs)
and §5 (the gallery) are untouched and remain open.

Worktree `~/backpack_ragnarok_worktrees/req-0150-flux2-migration`, branch
`req-0150-flux2-migration`.

## §1 — Route unification: DONE

**`tools/gen_item_icons.py`** — `ROUTE = "flux2"` was already the default. The
`sdxl` branch is now explicitly FROZEN: marked non-production in-code, and
selecting `--route sdxl` prints a banner saying it is neither a production route
nor a fallback and must not be used to work around a flux2 problem. `CKPT` is
labelled sdxl-only. No default, wrapper or code path reaches it implicitly.

**`tools/gen_unit_icons.py`** — audited for the residual-SDXL-defaults question
the REQ raised. Result: **no leak, and never was.** The wrapper hardcodes no
sampler numbers; it delegates to `gen_item_icons.main()`, which resolves
steps/cfg/sampler from `ROUTE_DEFAULTS[ROUTE]` (flux2 → 4 / 1.0 / euler). What
DID leak was the *docstring*, which advertised "30 steps, cfg 6.5, dpmpp_2m/
karras" and claimed the wrapper "does NOT cover" a FLUX route — both false and
both an invitation to re-apply SDXL numbers by hand. Rewritten. Separately,
`--ckpt` used to print a reassuring "checkpoint override: X" while doing nothing
on flux2 (CKPT is read only by the sdxl graph); it now says so.

**`tools/gen_monster_art.py`** — ported. This was the real work: the tool was
pure SDXL/SD1.5 (`CheckpointLoaderSimple` + `LoraLoader` chain + `KSampler`,
30 steps / cfg 7.0 / dpmpp_2m / karras + latent-upscale hires-fix). It now
builds the same flux2 graph gen_item_icons uses (`UnetLoaderGGUF` + `CLIPLoader
(flux2)` + `VAELoader` → `CFGGuider` → `SamplerCustomAdvanced`), sized for a
portrait illustration. It **imports `FLUX` and `ROUTE_DEFAULTS` from
`gen_item_icons`** rather than restating them, so the program now has exactly one
definition of "the route" — which is the point of this REQ. The old SDXL graph is
kept, unchanged in behaviour, behind the frozen `--route sdxl` for reproducing
monsters-001/monsters-002.

Two SDXL-era job fields are now dead on the production route and say so instead
of failing silently: `negative` (inactive at cfg 1.0 — zeroed conditioning) and
`hires` (an SDXL workaround for sampling away from ~1MP; FLUX.2 is native there,
so set width/height directly).

### The LoRA question — ANSWERED: dropped

The REQ demanded this be settled in writing rather than silently "ported".

The monster jobs use exactly two LoRAs: **`detail_tweaker`** (strength 0.4) and
**`cel_shaded_art_style`** (strength 1.0), on `rpg_v5`. Neither is a
character-identity LoRA. They are generic style/detail boosters — they were
buying, in weights, what a stronger text encoder gives from the prompt. FLUX.2
klein's Qwen3-4B text encoder follows "comic book illustration, line art, cell
shading, white background" from the POSITIVE directly, which is where style has
to live on this route anyway (the negative is inactive). **So no monster loses
its identity by dropping them.** What changes is the rendering style — and that
is exactly the thing the §5 gallery exists to let the user rule on.

Escalation was considered and rejected: escalating "may we drop two generic style
LoRAs" to a user who has said, in terms, that they judge only by generated
results would be asking them to arbitrate a mechanism they cannot see. The
correct escalation is the gallery: flux2-no-LoRA next to SDXL+LoRA, and they say
which they want. If the flux2 look is rejected there, the answer is a prompt fix
or a FLUX-native style LoRA — **not** a quiet return to SDXL.

On flux2 a job carrying `loras` is **refused with a hard error**, not ignored:
a silently-dropped style LoRA is how a style regression hides for a month.

Note for **REQ-0137** (character-identity LoRA): unaffected in intent — it was
never these two LoRAs — but its footing does change. It must now train on FLUX,
not SDXL. Cross-check before it resumes.

## §2 — Seamless tiling on FLUX: **GREEN**, and the recipe is SIMPLER than SDXL's

`tools/req0150_flux_tiling.py`, batch `content/batches/bpskin-flux2-0150/`,
`findings.json`. Same metric (`seam_metric`, copied verbatim from
`tools/req0138_tiling.py`), same 2 motifs (elven/barbarian) × 2 seeds (101/202),
same 1024 px tile, same half-shift offset check as REQ-0138. 20 generations.

### Result 1 — REQ-0138's recipe does not transfer, and we can prove it

`SeamlessTile` is a **NO-OP on FLUX.2**. It patches `torch.nn.Conv2d` modules;
FLUX.2's denoiser is a DiT (Linear patch-embed, Linear attention) and holds none.

This is not inferred, it is measured: the `seamless` leg (SeamlessTile +
CircularVAEDecode) and the `vae_circ` leg (CircularVAEDecode alone) came out
**bit-identical on 4/4 pairs, max abs diff = 0**. Half of REQ-0138's recipe is
dead code on this route.

### Result 2 — `CircularVAEDecode` ALONE is the FLUX answer

| leg | seam ratio (8 measurements) | | verdict |
| --- | --- | --- | --- |
| | min–max | mean | |
| **control** (plain flux2) | 0.92 – 2.73 | 1.83 | seam, as expected |
| **`vae_circ`** = CircularVAEDecode only | **0.76 – 1.43** | **1.00** | **GREEN** |
| `seamless` = + SeamlessTile | 0.76 – 1.43 | 1.00 | identical to vae_circ (no-op) |
| `blend` (oversize + wrap crossfade) | 0.92 – 1.22 | 1.08 | REJECTED — see below |
| `inpaint` (offset + flux2 seam inpaint) | 0.98 – 1.66 | 1.17 | REJECTED — see below |

REQ-0138's SDXL baseline, for comparison: seamless **0.83–1.09**, control
**2.76–3.77**.

**flux2 + CircularVAEDecode is equivalent to REQ-0138's SDXL recipe** (mean 1.00
vs a 0.83–1.09 band) at a quarter of the graph and ~10 s/tile.

### The one out-of-band measurement, checked by eye rather than waved through

7 of 8 `vae_circ` measurements land in 0.76–1.09. One does not: elven s202,
`ratio_y` = **1.43**. Inspected at 6× on the wrap line: **there is no visible
seam** — the leaf strokes run straight through the join. The ratio is inflated
because that particular tile is low-contrast, so the *interior* baseline in the
denominator is small, not because the wrap is broken. **Recorded as a property of
the metric**: `seam_metric` is a ratio against local contrast and reads high on
smooth textures. It stays a FILTER, never a verdict (program rule).

### Why `blend` and `inpaint` are rejected despite passing the metric

Both are model-agnostic post-processes and both hit the number. Both fail the
eye, which is why REQ-0138 mandated the offset check alongside the ratio:

- **`blend`** (generate 1280, crossfade a 256 px wrap band down to 1024): heavy,
  obvious **ghosting** — a milky double-exposure smear through the blend band.
  The metric cannot see it: crossfading two plausible continuations *guarantees*
  pixel continuity, which is exactly why the number is meaningless here.
- **`inpaint`** (offset by half, inpaint the seam cross with flux2 at denoise
  0.75, composite back through a feathered mask): produces **starburst and smear
  artifacts** on the seam cross — on barbarian s202 it invented a radial black
  burst; on barbarian s101 it flattened the strap pattern into a blank leather
  panel. A 4-step distilled model given a cross-shaped hole does not reconstruct
  a structured pattern.

Neither is needed: `vae_circ` wins on both the number and the eye.

### Recipe to adopt (supersedes REQ-0138's for the flux2 route)

```
UnetLoaderGGUF -> CFGGuider -> SamplerCustomAdvanced -> CircularVAEDecode(tiling=enable)
```
No `SeamlessTile` (it does nothing here). Keep `seam_metric` as a per-tile
**filter**: a tile over ~1.2 gets an eyeball, and if it really is seamed, reroll
the seed — at ~10 s/tile a reroll is cheaper than any repair.

### Consequence

**Backpack skins are UNBLOCKED.** The REQ's stated risk — "tiling may have no
FLUX answer, and then the program owns a real conflict between one route and
working skins" — **did not materialise.** No conflict, no escalation, no reason
to bring SDXL back. `bpskin-tiling-0138` can be regenerated on flux2 in §3.

## Gate status

- [x] No production code path reaches an SDXL checkpoint by default. (Docs: §4,
      still open — the gate is only half met.)
- [x] `gen_monster_art.py` runs on flux2, LoRA question answered in writing
      (DROPPED, with reasons, and refused rather than silently ignored).
- [x] **Seamless tiling: measured verdict on FLUX.** GREEN — CircularVAEDecode
      alone, mean seam ratio 1.00 vs REQ-0138's SDXL seamless band 0.83–1.09.
      SeamlessTile proven a no-op (bit-identical, 4/4). Skins unblocked.
- [ ] Every SDXL-era surface regenerated on flux2. — §3, not started.
- [ ] Gallery at `web/preview/flux2-all/`. — §5, not started.
- [x] S7 stop honored: nothing written to `content/live/`.

## Box notes for §3 (the long GPU session)

- RTX 2080, **8 GB VRAM** (not the constraint the REQ's "23 GB box" line implies —
  23 GB is system RAM). FLUX.2 klein Q8_0 + the Qwen3-4B text encoder do **not**
  co-reside in 8 GB, so ComfyUI swaps them per prompt.
- Cost of that swap, measured: **first generation of a run ≈ 460 s** (cold load).
  Subsequent generations on the same prompt: **2–16 s**. A prompt change forces a
  text-encoder reload: **30–100 s**. → **Batch by prompt, not by seed**, and never
  judge throughput on the first image.
- ComfyUI peaked at ~11.8 GB RSS during the spike; the box stayed responsive.
- ComfyUI was stopped at the end of this session; the GPU is free.

## Session 2026-07-13 (cont.) — §3: the art direction is RE-RATIFIED, and the parity batch

### BINDING USER DECISION (2026-07-13) — new art direction

The user found settings in **InvokeAI Community Edition** that produce results
they are happy with, and ratified them as the program's art direction:

| | template | prompt shape |
| --- | --- | --- |
| items | InvokeAI **Anime** | `<subject>, white background, bold outline` |
| units | InvokeAI **Anime** | `<subject>, portrait, looking at viewer, white background` |
| monsters | InvokeAI **Concept Art (Fantasy)** | `<subject>, white background` |

FLUX.2 klein 4B · **no LoRAs** · euler · **steps 30** · seed 1 · flux2 VAE ·
Qwen3-4B encoder · **generation size matched to the intended CELL FOOTPRINT**.

**This SUPERSEDES the Norse dark-fantasy painterly direction**, including
REQ-0127's ratified (S7 ALL GREEN) unit roster style. §3's table above says unit
icons need no regeneration — **that line is now WRONG.** They do.

Two settings that are NOT the old defaults and must not be "corrected" back:

- **steps 30, not 4.** klein is a distilled 4-step model and the pipeline
  defaulted to 4. The user's verdict was reached at 30. 30 it is.
- **aspect-ratio-matched generation, not square-then-downscale.** Items are
  generated at 256 px/cell, monsters and textures at 128 px/cell. The differing
  scale is fine; the invariant that matters is that the ASPECT RATIO matches the
  cell footprint at a resolution the model is happy at.

### The parity batch — `tools/req0150_parity.py`, `content/batches/flux2-parity-0150/`

Reproduce the user's exact 12 assets on OUR pipeline **before** betting a full
regeneration on it. Three things could have silently diverged:

**1. Prompt weighting — and a bug that would have poisoned the batch.**
InvokeAI's templates carry its own emphasis syntax (`+` ×1.1, `++` ×1.21).
ComfyUI does not understand it; pasted verbatim the plus signs tokenise as text.
Converted to ComfyUI's `(text:weight)`.

The first conversion regex was **wrong in a way only a printed prompt reveals**:
it read the hyphen in `cel-shaded coloring` as a *de-emphasis* marker and emitted
`(cel:0.909)shaded coloring`, and it left `anime++` as `(anime+:1.1)`. Every
anime-template asset would have carried a corrupted style clause. Fixed with a
trailing-boundary lookahead, and the trap is documented in-code.

Probe (weighted vs weights-stripped, identical seed): **not identical** — mean
abs diff **38.9** (sword), **8.8** (goblin). The weighting does real work on the
Qwen3 encoder, and the weighted leg is visibly better: the sword fills its 1×3
cell footprint, while the flattened one floats small in the frame. **Weighted
adopted.**

**2. The negative prompt.** Both InvokeAI templates carry one; it is inactive on
this route (distilled klein, cfg 1.0, ConditioningZeroOut). Dropped explicitly,
recorded in `manifest.json`, not silently carried.

**3. Size snapping.** Two of the user's sizes are not valid latent sizes: sword
`256x756` → `256x768` (= 3 cells × 256); goblin `512x386` → `384x512` (the
landscape reading was a slip — confirmed with the user; a humanoid goblin is
3 cells wide × 4 tall). In `manifest.json` → `size_notes`.

### Result: items, monsters and units land. Two assets did not.

Both were **content** problems, not pipeline problems, and both are now fixed —
`tools/req0150_fixups.py`.

**`unit_thief` → a modern uniformed police officer.** "a female thief" + the Anime
template (shounen/seinen) produced a peaked cap, suit and tie. The subject needed
fantasy anchoring; the template is untouched. Three variants generated
(`unit_thief_v1..v3`), all correct fantasy rogues. Note a framing drift: adding
"leather armor / belts / dagger" pulls the model from a **bust** (which is what
elf and princess are) to a **half-body**. `v2` holds the bust framing closest and
is the recommendation.

**`bpskin_leather` → a leather patch, not a fill.** The Anime template's "bold
outline" + cel-shading rendered a discrete, rounded, stitched, black-outlined
leather *object* on white. Tiled, it produces a grid of patches with visible
borders. **The §2 tiling recipe worked correctly — the seam was zero; the CONTENT
was wrong.** "bold outline" is the exact opposite of what a fill needs.

The user's read of this was right, and it maps onto the architecture: *"use the
inside of the patch as the texture and the border as a frame — a second
pipeline?"* REQ-0126 confirms the skin composes as **`fill_texture` tiled across
the cell interiors + autotiled edge tiles**. But it also constrains the idea:

- A backpack is an arbitrary **polyomino** (I, L, T, S/Z, inner-corner, holed).
  A crop of a fixed patch cannot cover a shape whose size it does not know —
  **the fill must genuinely tile.** So the fill gets its own wording (allover,
  edge-to-edge, *no focal object, no border, no outline, no frame*) + `CircularVAEDecode`.
  Regenerated: `bpskin_leather_fill_a` (seed 101) — seam ratio **0.93 / 1.00**,
  tiles clean with no visible repeat. `..._fill_b` (seed 202) also tiles (1.07 /
  1.27) but its creases align on the tile edges and read as a lattice at 2×2.
  **fill_a is the pick.**
- The border is **not one rectangular frame**: the autotiler needs straight /
  outer-corner / inner-corner tiles. The bordered patch render is a good SOURCE
  to slice those from. That is exactly **REQ-0146 (bpskin-edge-strip-spike)**,
  already reserved — the user's "second pipeline" has a number waiting for it.

### Gate status (updated)

- [x] Route unified in code; sdxl frozen. (Docs — §4 — still open.)
- [x] LoRA question answered (dropped; the user's direction independently
      confirms it: **no LoRAs**).
- [x] Seamless tiling on FLUX: GREEN (CircularVAEDecode).
- [ ] **§3 regeneration — pipeline PROVEN on the ratified direction (12/12 assets
      reproduced), but only the parity set. The full batches (batch-003 items, the
      11-unit roster, monsters-001/002) are NOT yet regenerated.**
- [ ] §4 docs — not started.
- [ ] §5 gallery at `web/preview/flux2-all/` — not started.
- [x] S7 stop honored: nothing written to `content/live/`.

## Session 2026-07-13 (cont.) — the two follow-ups, both settled by test rather than opinion

### "portraitで、安定しませんか？" — no. And the word was never the variable.

`portrait, looking at viewer` was **already in all three** of v1/v2/v3 — and it is
also in `elf` and `princess`, where it holds a bust perfectly. So it was not the
missing ingredient. The hypothesis was that the **GEAR NOUNS** widen the shot:
"dagger", "belts and pouches", "leather armor" name things that live below the
shoulders, and the model pulls back to show them. elf and princess carry no gear
nouns and stay busts.

Tested with a falsifier (`tools/req0150_thief_framing.py`, same template, same
seed, `portrait` kept throughout):

| | prompt delta | framing |
| --- | --- | --- |
| `v4` | fantasy anchor only, **zero gear** | **BUST** ✓ — matches elf/princess |
| `v5` | v4 + "bust, head and shoulders" | bust ✓ (but the model gives her a low-cut top — not wanted) |
| `v6` | v4 **+ "leather armor"** | **widens to torso + belt** ✗ |

v6 is the whole argument: one gear noun added to a working bust prompt, and the
crop widens. **The gear nouns cause it; `portrait` is exonerated.**

**PICK: `v4`** — bust, correct framing, clearly a hooded fantasy rogue.

Honest cost: v4 and v5 **lose the visible leather armor** — she reads as a hooded
figure rather than an armoured rogue. If armour must be visible, the options are
(a) accept the wider crop for this unit, or (b) generate half-body and crop to
bust in post. Not decided here; the user rules on it in the gallery.

### The backpack skin is composed BY SCRIPT — `tools/req0150_bpskin_compose.py`

The user's instruction, with a hand-edited mock-up: the seamless fill is not the
finished asset; the finished asset is **fill + a real edge**, and the edging must
be produced **by script**, not by hand in an image editor.

Inputs — and note that the "failed" asset is now load-bearing:
- **FILL** = `bpskin_leather_fill_a.png` (seamless, REQ-0150 §2, seam 0.93 / 1.00)
- **FRAME** = `bpskin_leather.png` — the Anime-template render that FAILED as a
  fill: a rounded, stitched, black-outlined leather patch. Useless as a fill,
  exactly right as an edge source. That was the user's own read of it.

Method (no hand-editing, one tunable):
1. **Silhouette** — flood-fill the near-white background inward from the four
   corners, so only background *connected to the border* is removed. Rounded
   corners and the side keeper-tabs survive as alpha.
2. **Ring** — Euclidean distance transform; `ring = silhouette AND dist <= band`.
   That is the black keyline + the leather welt + the stitch line, and nothing
   else. `band` is the only knob; it is swept (45/60/75/95), not guessed. **75 px
   is the pick.**
3. **Compose** — fill inside, welt on top, feathered 2 px.

Two bugs found and fixed, both of the kind that only a rendered image reveals:

- **The distance transform had no background to measure from.** The patch runs to
  the image border, so the nearest zero pixel was the *far-away corner white* —
  the ring materialised only at the four rounded corners and nowhere along the
  sides. Fixed by padding the mask with background before the EDT.
- **The welt had no direction.** The first polyomino pass tiled one `band × band`
  swatch isotropically across the canvas; it read as a repeating chain of blobs,
  because a welt has an orientation and a swatch does not. Fixed: cut two
  **directional** strips (a clean run of the source's top edge, and of its left
  edge), ordered outer → inner, and mirror-tile them along their run.

**And it generalises, which is the point.** `--shape {square,L,T,holed}` composes
the same skin over a real polyomino. scipy's *feature* transform gives, for every
ring pixel, the nearest background pixel; the offset to it yields **depth** (which
row of the welt strip) and **normal** (which strip). So straights, outer corners,
inner corners and holes all fall out of the same three lines — **no tile atlas, no
autotile lookup table, no renderer rotation.** Verified on square / L / T / holed.

Remaining rough edges, stated: the corner miter is whatever the nearest-edge
heuristic produces (it reads fine at 128 px cells but is not an authored miter),
and the mirror-tiled welt run has a faint symmetry at its midpoint.

This is the substance of **REQ-0146 (bpskin-edge-strip-spike)**, which was
reserved and empty. It should be written up there and moved out of `reserved/`.

## Session 2026-07-13 (cont.) — §3 skin generator, and §4: the new scripts ARE the pipeline

### The frame source is generated ON PURPOSE now, and GATED — `tools/gen_bpskin.py`

Until now the frame source was an accident: `bpskin_leather.png` was a FILL brief
that failed by coming out as a bordered patch, and it happened to be extractable.
"Happened to be" is not a pipeline.

**S1 generate** a patch of the material with an explicit border, on white, **with a
margin** — the margin is in the brief now, not left to luck.
**S2 GATE** it, because a frame source is only usable if the extractor can actually
find it. Five machine checks: `margin` (outer 4% ring ≥ 95% background on EVERY
side), `solidity` ≥ 0.88, `single` component ≥ 95%, `coverage` 45–93%, `rim`
(luma delta ≥ 8 or gradient ratio ≥ 1.25). FAIL → reroll; a failing candidate never
reaches the tool.
**S3 compose** only PASS candidates, paired with a seamless fill of the same
material, over any polyomino.

**The gate is not theoretical.** Run against the *original accidental* frame source
it REJECTS it — margin 0.047, coverage 0.996. That one only ever worked by luck.
On its first real run it rejected 1 of 6 fresh candidates (`wood_frame_s202`:
margin 0.798, rim luma delta 0.6 — the patch bled to an edge and had no border).

Three skins built end to end (`content/batches/bpskin-frames-0150/`): **leather,
iron, wood** — frame source → gate → fill → composed square + L.

Open, and visible in the output: **fill and frame are generated independently, so
their palettes drift.** The wood pair is a light frame over a dark fill. Colour-
matching them is not solved.

### §4 — the session's scripts are now the pipeline; the old ones are dead

User directive: *"これまでのツールを全て陳腐化させて、当セッションで作った（または改修した）
スクリプトをメインストリームにしましょう"*.

**The route and the style each live in exactly one file now.** They were copied
into four: `gen_item_icons`, `gen_monster_art`, `req0150_parity` and
`req0150_flux_tiling` each carried their own FLUX config and their own copy of the
flux2 graph. That is how a route drifts.

| new | what |
| --- | --- |
| **`tools/art_route.py`** | THE route + THE graph (`build_txt2img`, `tiling=True` → `CircularVAEDecode`), the ratified sampler settings, and the measured box timings. |
| **`tools/art_style.py`** | THE style layer: the ratified templates, the InvokeAI→ComfyUI emphasis conversion (with the `cel-shaded` trap documented), `FILL_STYLE`, `gen_size()`. |
| `tools/gen_bpskin.py` | was `req0150_frame_gen.py` |
| `tools/bpskin_compose.py` | was `req0150_bpskin_compose.py` |
| `tools/spikes/` | the four REQ-0150 spikes. History; findings encoded in the two modules above. |

`gen_item_icons.py`, `gen_unit_icons.py` and `gen_monster_art.py` were rewired onto
the two modules and their private FLUX configs / graphs deleted. Verified: **no
SDXL node (`CheckpointLoaderSimple`, `LoraLoader`, `KSampler`, `EmptyLatentImage`,
`LatentUpscale`) is reachable from any default path** in either tool.

14 superseded tools carry a `DEPRECATED (REQ-0150)` banner naming what replaced
them (`req0131_spike`, `req0136_*`, `req0138_*`, `req0127_gallery`,
`build_batch003_report`, `scratch_req0135_*`).

#### ⚠ I deleted the SDXL route, and that CONTRADICTS this REQ's own §1

§1 of this REQ says the sdxl branch stays "runnable for reproducing historical
batches". It is now **gone**, not frozen. My reasoning, stated so it can be
overruled:

- The user has since ratified a **new art direction**, so every SDXL-era asset is
  being **regenerated**, not reproduced. There is nothing left for the frozen
  route to reproduce.
- The user then directed that all previous tools be obsoleted.
- A second code path that nothing may use is a liability, not an asset — and it is
  in git history if it is ever needed.

If you want the frozen SDXL route back, say so; it is one revert away.

### Docs — `docs/llm_managed/art_pipeline.md` (NEW), one doc for all image generation

The art halves of `item_content_pipeline.md`, `unit_icon_pipeline.md`,
`monster_content_pipeline.md` and `backpack_skin_pipeline.md` were four
descriptions of one thing, all now wrong. They are replaced by one
**`art_pipeline.md`**: the route, the style layer, the sizing law, per-kind deltas,
the skin gate, and the box's timings. It writes down the things that get "fixed"
back by someone who has not read them — steps 30 (not klein's 4), no negative, no
LoRAs, no `SeamlessTile` — and the two invisible traps (the emphasis regex, the
unpadded distance transform).

The four per-kind docs keep a banner saying their ART content is superseded and
their schema/data content still stands. `common_content_pipeline.md` §4 S5 now
points at `art_pipeline.md`; its BS-G5 edge-tile rotation exception is recorded as
**moot** (there is no tile atlas to rotate any more); its infra section carries the
8 GB / batch-by-prompt facts.

### Gate status

- [x] §1 route unified; SDXL gone from code and docs.
- [x] §2 seamless tiling: GREEN.
- [x] §4 docs — one `art_pipeline.md`; the four per-kind docs redirected.
- [ ] §3 — the PIPELINE is proven (parity batch + 3 skins), but the **full batches
      are not regenerated**: batch-003 items, the 11-unit roster, monsters-001/002.
- [ ] §5 gallery at `web/preview/flux2-all/`.
- [x] S7 stop honored: nothing in `content/live/`.

## Session 2026-07-13 (cont.) — §3 COMPLETE, §5 COMPLETE

### The regeneration, in two rounds

| | round 1 | round 2 | final |
| --- | --- | --- | --- |
| items | 3/8 | +4 fixed | **7/8** (`hilt` still fails) |
| units | 4/11 | +7 fixed | **11/11** |
| monsters | 24/24 | — | **24/24** |
| skins | 3 materials, gated | — | **3/3** |

**The STYLE landed everywhere on the first try. What failed was the SUBJECT**, and
it failed in three distinct, reproducible ways — now written into
`tools/art_style.py` so the next person does not rediscover them with another two
GPU hours. See the commit and the module header for the full statement; in brief:

1. **The Anime template drifts modern.** Its `shounen, seinen` tokens, handed a
   subject with no fantasy iconography of its own, produce a contemporary anime
   character: `"angel"` → a blonde girl in a **blazer and tie**, no wings, no halo;
   `"berserker"` → a young man in a tank top; `"hooded watcher"` → a man in a
   **modern hoodie**; `"young squire"` → a boy in a school uniform. The four units
   that *landed* on a plain name (elf, thief, shieldmaiden, priest) all carry
   fantasy iconography **above the shoulders**. **Concept Art (Fantasy) does NOT do
   this** — `mythological, digital painterly` carries the signal itself, which is
   why the monsters came out right on bare nouns. **The drift is a property of the
   ANIME template, not of FLUX.**
2. **Any noun implying something outside the head drags it into frame** and widens
   the shot out of a bust — *even with `portrait` present*, which it was in every
   failing prompt. The earlier "no GEAR nouns" rule was right but **too narrow**:
   `KIT` ("dagger") → half-body; `STATURE` ("dwarf") → full body 2/4;
   `RELATION` ("light cavalry **rider**") → **a horse**, 4/4.
3. **Item PART-OF nouns and compound nouns resolve to the wrong object**, and there
   is **no negative prompt** on this route to say what a thing is not:
   `"sword hilt"` → a whole sword; `"tower shield"` → a **stone tower**;
   `"beast jaw"` → a whole monster head.

Round 2 applied the rules and **every fix worked as predicted** — dwarf became a
bearded blacksmith bust, angel grew wings and a halo, the cavalryman lost his
horse, the blade lost its handle, the tower became a shield, the jaw became a bone.

### `hilt` — an honest failure, escalated

`"a detached sword handle only, grip and crossguard and pommel, with no blade
attached, just the handle"` still produces **a whole sword, 4/4**. The model's
prior that a hilt comes attached to a blade cannot be talked down without a
negative prompt, and this route has none. It is the one asset the pipeline could
not produce. **Your call:** accept a sword for `hilt`, re-concept the item, or
solve it another way (a crop of a blade render is one option).

### The coverage floor bites the thin weapons — a real conflict, stated

**8 of 106 candidates auto-FAIL the ≥20% coverage floor** (Art Golden, binding):
`blade` (17.7%, 14.1%), `dagger` (18.7%, 15.5%, 19.6%), `hilt` (9.4%, 17.4%,
17.2%). They are **correct art**: a bare blade in a 1×2 cell *is* thin. The
aspect-matched generation gives the right proportions and the floor then rejects
them for being what they are. The floor and these items disagree, and that is a
design question, not a bug — **accept a per-shape exemption, thicken the subjects,
or re-shape the cells.** Flagged and greyed in the gallery, never silently dropped.

### §5 — the gallery

`web/preview/flux2-all/` — **106 numbered keys, 208 images, 8 auto-FAIL flagged.**
256 px / 64 px toggle, matte-on-checkerboard toggle, and every row shows its
**SDXL-era predecessor next to** the flux2 candidates. Self-contained.

**NOT DEPLOYED.** Serving it on backpack-dev means touching the main checkout /
live services, which PROJECT.md marks HANDS-OFF without a fresh go-ahead. It is
built and committed on the branch; say the word and it goes up.

**S7 STOP HONORED: nothing is in `content/live/`.** The verdict is yours, by key.

### Gate status — FINAL

- [x] §1 no production path or doc reaches SDXL. It is deleted, not frozen.
- [x] §2 seamless tiling on FLUX: GREEN (`CircularVAEDecode`).
- [x] §3 every SDXL-era surface regenerated: items, units, monsters, skins.
- [x] §4 docs: one `art_pipeline.md`; the four per-kind docs redirected.
- [x] §5 gallery built, 256+64 px, numbered, flux2 against its predecessor.
- [x] S7 stop honored.
- [ ] **Deploy the gallery** (needs a go-ahead — main checkout is HANDS-OFF).
- [ ] **User verdict.** Until it lands, this REQ stays in `todo/`.
