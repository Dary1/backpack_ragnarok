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
