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
