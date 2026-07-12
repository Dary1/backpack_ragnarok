# REQ-0136 — icon-checkpoint-bakeoff

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** icon-checkpoint-bakeoff
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/item_content_pipeline.md` (S5-2),
`docs/llm_managed/unit_icon_pipeline.md` (S2); pattern: `monsters-002-style-bakeoff`.

## Goal

Stop paying the "NOT photorealistic" tax. JuggernautXL V9 is a photoreal-biased
checkpoint being prompt-corrected toward painterly output on every generation —
a structural mismatch that caps the style ceiling. Run ONE bakeoff batch to pick
the default icon checkpoint on merit.

## Contenders

1. Baseline: JuggernautXL V9 + current anti-photoreal prompting (control).
2. A stylized SDXL checkpoint (painterly/fantasy-native), optionally + style LoRA.
3. FLUX.2 klein 4B, GGUF-quantized — reported to run within 8 GB VRAM at
   few-step speed (2026 low-VRAM guides). Verify locally before judging.

## Scope

- Same subjects across all contenders (2 items + 2 unit busts), same
  candidates/seed discipline as the item route; gallery at 256 px AND 64 px.
- Record VRAM headroom and s/image on the RTX 2080 for each contender.
- **License gate:** verify commercial-use terms of any new checkpoint BEFORE
  adoption; record the finding here. No adoption on unclear terms.

## Non-goals

No pipeline-doc rewrite until a winner is ratified; no live writes; matting
route comparison is REQ-0135 (run this bakeoff with the incumbent matte).

## Gates

- Numbered gallery; user verdict selects the default checkpoint.
- License verification recorded. Findings + winner appended here; pipeline docs
  updated as implementation of this REQ.

---

## WIP state (session end 2026-07-12 ~04:55; unattended completion running)

- Contenders + licenses VERIFIED: DreamShaperXL Turbo v2.1 (OpenRAIL++-M,
  HF Lykon) and FLUX.2 klein 4B distilled GGUF Q8_0 (Apache 2.0, BFL;
  9B is non-commercial - do not confuse) downloaded byte-verified;
  ComfyUI-GGUF installed. v9 leg 7/16 done + resume running; dsxl/flux
  legs queued behind it via ~/scratch/req_seq5.sh (waits for v9+0138,
  then dsxl -> flux -> galleries to web/preview/, all detached).
- Tooling committed here: tools/req0136_bakeoff.py (sequential legs,
  perf/VRAM stats, matte_light for unit busts - alpha_matting pymatting
  spikes >12GB RSS on characters and OOMed the shared box: dmesg 02:42,
  03:25 ComfyUI itself, 04:14, 04:33), tools/req0136_gallery.py,
  content/batches/bakeoff-0136/unit_defs.json.
- NEXT SESSION: check ~/scratch/req_seq5.log DONE; run
  ~/scratch/finalize_fill.py (renders findings tables from runstats
  JSONs + patches skin pipeline S2); commit artifacts; rsync
  web/preview/bakeoff-0136 into the main checkout docroot; verify URL;
  ASK USER VERDICT (checkpoint selection). Roster batch (REQ-0127) runs
  only after that verdict.

---

## Findings (2026-07-12) — batch complete, AWAITING USER VERDICT

Gallery: https://backpack-dev.qtie.jp/preview/bakeoff-0136/
48 candidates (3 contenders × 4 subjects × 4 seeds), each at 256 px and 64 px,
numbered by key `<leg>-<subject>-<seed>`.

### 1. License gate — PASSED, all three clear for commercial use

| contender | license | verdict |
|---|---|---|
| JuggernautXL V9 (control) | RunDiffusion/Juggernaut terms | incumbent, already adopted |
| DreamShaperXL Turbo v2.1 | CreativeML OpenRAIL++-M (HF `Lykon/dreamshaper-xl-v2-turbo`) | commercial use of model + outputs permitted, standard use restrictions |
| FLUX.2 klein 4B distilled, GGUF Q8_0 | **Apache 2.0** (BFL, open weights for commercial use). Quant: `unsloth/FLUX.2-klein-4B-GGUF` | clear |

Kept from the download session: FLUX.2 klein **9B** is non-commercial. The 4B
distilled is the Apache-2.0 one, and the 4B is what we are running.

### 2. Brief compliance — the decisive result, and it was not anticipated

Every subject's positive prompt ends with *"plain uniform near-white background,
clean flat backdrop, no shadow, no gradient"*, and the negative leads with
*"photograph, photorealistic, realistic, 3d render, cgi"*. So "did the
checkpoint obey the brief" is measurable, not a matter of taste. Metric: median
colour of a 6 px border ring of the raw 1024 px generation.

| leg | dark <128 | grey 128–200 | near-white ≥200 | median bg |
|---|---|---|---|---|
| v9 | 6 | 5 | 5 | 162/255 |
| dsxl | 13 | 2 | 1 | 74/255 |
| **flux** | **0** | **0** | **16** | **254/255** |

Threshold-independent — nowhere between 128 and 200 can the line be drawn to
change the story. FLUX put the subject on a near-white ground **16 times out of
16**. The incumbent managed 5/16. DreamShaperXL — added to this bakeoff
*specifically because it was supposed to be the stylized contender* — managed
1/16, and is in practice the most photoreal of the three: its berserker is a
dark-backdrop photographic movie-poster bust, produced against a negative
prompt that explicitly forbids "photograph, photorealistic".

REQ-0136's founding hypothesis is confirmed, and harder than expected: the
"NOT photorealistic" prompting tax is real, the incumbent loses the argument
with its own prompt more often than it wins it, and **swapping to a different
SDXL checkpoint does not fix it** — the SDXL family fights this brief.

Easy to miss, and expensive: **an off-brief background is also a matte
failure.** The matte (birefnet + border-key fallback) has no clean key to work
from, so a dark generation quietly becomes a shredded icon.
`v9-unit-berserker-101` is the worst case — the raw is a rock wall with several
partial heads, and the matted 256 px result is a hole-punched mess. That is a
GENERATION failure, not a matting failure (so it is not REQ-0135's to fix), and
no existing gate catches it: `tool_icon_score.py` only auto-FAILs coverage
< 20 %, and a full-frame rock wall scores HIGH coverage precisely *because* it
fills the frame.

### 3. Seed diversity — the raw number misleads; look at the images

Mean pairwise pixel difference between the 4 candidates of a subject:

| leg | hilt | tower_shield | unit-elf | unit-berserker | mean |
|---|---|---|---|---|---|
| v9 | 27.4 | 40.2 | 45.9 | 50.8 | 41.1 |
| dsxl | 19.5 | 18.5 | 40.4 | 37.2 | 28.9 |
| flux | 5.4 | 12.5 | 20.9 | 19.6 | **14.6** |

Taken alone this reads as a FLUX weakness: a distilled 4-step model at cfg 1.0
with a zeroed negative samples almost deterministically, so 4 seeds buy less
than they do on SDXL. That is a real cost at S7 — fewer genuinely distinct
options to choose between.

But look at the images before pricing it. V9's four `hilt` seeds are: one sword;
a sword *plus two loose pommel ornaments*; *two* swords side by side; and a
broken cropped close-up. Three of the four violate the prompt's "single centered
object". **V9's high diversity is largely diversity of failure modes** — it is
not offering four usable alternatives, it is offering one usable image and three
re-rolls. FLUX's four are the same hilt design with small variations, and all
four are usable.

Honest statement: FLUX trades candidate *variety* for candidate *reliability*.
Whether that is a loss depends on whether S7 wants options or wants
first-time-right assets — a judgement for the user, not for this file.

### 4. Performance — FLUX is the FASTEST, and the old numbers were a lie

Measured on a quiet, exclusive box (`tools/req0136_perfprobe.py`), 1024×1024,
RTX 2080 8 GB, all three back to back, cold model load discarded from the warm
median:

| leg | steps | warm s/img | cold load | VRAM peak | 48-candidate roster batch |
|---|---|---|---|---|---|
| **flux** | 4 | **10 s** | 407 s | 6842 MiB | **14.8 min** |
| dsxl | 8 | 20 s | 316 s | 6388 MiB | 21.3 min |
| v9 (incumbent) | 30 | 40 s | 212 s | 6516 MiB | 35.5 min |

FLUX is the fastest per image **and** the fastest for a whole roster batch, even
though it pays the longest cold load — the load is amortised once across 48
candidates. It also fits: 6.8 GB peak on an 8 GB card.

**The "FLUX takes 9.5 minutes per image" figure from the earlier legs was an
artifact of our own bug, not a property of FLUX.** The old `postprocess()`
called ComfyUI `/free` (`unload_models`) before mattes, inline between
generations. FLUX's weights are ~12.3 GB (4.3 GB UNet + 8.0 GB text encoder), so
every `/free` forced a full reload on the next image — i.e. every single image
in that leg paid a ~400 s cold load. That is exactly the ~570 s/image observed,
and exactly the 407 s cold load measured here.

So **one bug produced both disasters**: the same inverted RAM guard (§5) that
OOM-killed the box eight times also made the best checkpoint look 50× slower
than it is. Had the bakeoff been judged on those numbers, FLUX would have been
rejected on a speed objection that does not exist.

Config note. The text encoder `qwen_3_4b.safetensors` is 8.04 GB fp16 —
unquantized. It and the UNet cannot be co-resident on an 8 GB card. ComfyUI's
own log shows the dance: `Requested to load Flux2TEModel_` → `loaded partially,
1395 MB offloaded` → `Unloaded partially: 6277 MB freed` → `Requested to load
Flux2` → `loaded completely, full load: True`. The encoder is evicted before
every sampling pass. Warm, that swap comes from page cache and costs nothing
measurable. Cold, or under memory pressure, it comes from disk — which is what
the old 570 s was.

Measured (`tools/req0136_fluxfix.py`): `CLIPLoader device="cpu"` gives the SAME
warm speed (10.0 s) and a slightly shorter cold load (365 s vs 407 s). No
regression, no material gain. **Shipping `device: "default"`**; `"cpu"` is
recorded as the lever to pull if VRAM headroom ever gets tight.

Sampling itself is fully GPU-resident: `loaded completely; 4209.39 MB loaded,
full load: True`, `lowvram patches: 0`, 4 steps at 1.54–2.29 s/it. FLUX is not
secretly running on the CPU.

### 5. Operating finding — the box (kept because it cost a day)

8 global OOM kills on 2026-07-12; ComfyUI killed 3×; the Cloudflare tunnel
dropped its connections at 10:12. Root cause: an **inverted RAM guard** in
`req0136_bakeoff.py`. It skipped the ComfyUI `/free` before ITEM mattes on the
theory that "item matte is RAM-light" — but items are exactly the path that
enables rembg `alpha_matting` (pymatting solve, 12–13 GB RSS at 1024 px), while
characters, which got both the cheap matte *and* the `/free`, are the light
ones. Precisely backwards. A full SDXL resident in ComfyUI (11–18 GB RSS) plus a
13 GB pymatting solve does not fit a 23 GB box.

`/free` is not a fix on its own: `unload_models` returns weights to the Python
allocator, not to the OS (measured: ComfyUI idle for 4.5 h still holding 13.8 GB
RSS). Generation and matting are now **separate phases** (`--phase gen|matte`)
with ComfyUI stopped in between, and the matte phase refuses to start with under
15 GB free. The dsxl leg — which had failed twice — then completed 16/16 with
zero OOM events, and FLUX's true speed became visible for the first time.

Why dsxl specifically kept killing the box: it is a full SDXL **and** it owned
the item subjects, so it was the one leg that put an 11 GB ComfyUI and a 13 GB
pymatting solve in memory simultaneously. Nothing to do with DreamShaper.

### Summary for the verdict

| axis | flux | dsxl | v9 (incumbent) |
|---|---|---|---|
| style (painterly, not photoreal) | **best** | worst | poor |
| brief compliance (near-white bg) | **16/16** | 1/16 | 5/16 |
| matte cleanliness (follows from bg) | **clean** | poor | poor |
| warm speed | **10 s** | 20 s | 40 s |
| roster batch (48) | **14.8 min** | 21.3 min | 35.5 min |
| licence | **Apache 2.0** | OpenRAIL++-M | incumbent terms |
| seed variety | 14.6 (low) | 28.9 | 41.1 (mostly failure modes) |
| negative prompt | **inactive** (cfg 1.0, zeroed) | active | active |

FLUX leads every axis the REQ set out to test. Its two real costs are lower
seed variety and an inactive negative prompt (style control is
positive-prompt-only at cfg 1.0) — neither of which the bakeoff can weigh for
the user.

### Gates

- [x] Numbered gallery, every candidate at 256 px + 64 px (G4).
- [x] License verification recorded for all three contenders.
- [x] VRAM + s/image recorded per contender (clean-box re-measure).
- [ ] **User verdict selects the default checkpoint.** ← BLOCKING
- [ ] Pipeline docs updated with the winner (implementation of this REQ).

REQ-0127's roster batch and REQ-0137's identity pilot are both parked behind
this verdict.


---

## VERDICT (user, 2026-07-12): **flux2 — ADOPTED as the default route**

FLUX.2 klein 4B distilled (GGUF Q8_0) is the default checkpoint for both the
item and unit icon pipelines.

### Implementation of this REQ (done)

- `tools/gen_item_icons.py`: real route switch, `ROUTE = "flux2"` by default.
  `--route {flux2,sdxl}`. The SDXL route stays working for fallback and for
  reproducing historical batches. `--ckpt` alone could not express this — FLUX
  is a different graph (UnetLoaderGGUF + CLIPLoader(flux2) + Flux2Scheduler +
  SamplerCustomAdvanced), exactly the case REQ-0127 flagged in advance.
- Sampler defaults are now RESOLVED FROM THE ROUTE, not hardcoded. This was a
  live trap: `--steps` defaulted to 30 and `--cfg` to 6.5 — SDXL numbers that
  would hand distilled klein (4 steps, cfg 1.0) a 7× slower path to garbage,
  and argparse would have reported "steps=30" as if it had been asked for.
- The flux2 route WARNS ONCE per run that the negative prompt is inactive.
  Silently accepting a negative that does nothing is how a style regression
  hides for a month.
- `ConditioningSetMask` subject-placement bias ported to the flux graph (masks
  the positive only; the negative is a zero-out of the UNMASKED positive).
- `docs/llm_managed/unit_icon_pipeline.md` and `item_content_pipeline.md`:
  ratified-route section appended; the item doc's stale "checkpoint choice is
  under re-evaluation" note marked SUPERSEDED.

### Operating rule added the hard way

**Restart ComfyUI between routes — `/free` is not enough.** After this session's
verdict, a single long-lived ComfyUI that had served the 0131 spike (SDXL) and
then FLUX reached **19.2 GB RSS**, filled swap (3864/3891 MB), and the box
stopped answering SSH. `unload_models` returns weights to the Python allocator,
not to the OS. Every batch runner must start ComfyUI fresh and stop it before
the matte phase.

### Gates

- [x] Numbered gallery, 256 px + 64 px (G4). 48 candidates.
- [x] License verification recorded for all three contenders.
- [x] VRAM + s/image recorded per contender (clean-box re-measure).
- [x] **User verdict: flux2.**
- [x] Pipeline docs updated with the winner.

Unblocks REQ-0127 (roster batch, now on flux2) and, behind it, REQ-0137.
