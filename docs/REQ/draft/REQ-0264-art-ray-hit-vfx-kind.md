# REQ-0264 — art-ray-hit-vfx-kind: ray and hit VFX become first-class registry art, on a still-image pipeline that cannot animate

**Status:** draft — spec written, BLOCKED on user review. Three things need the user before work
may start: (1) §6 — whether ray/hit VFX get a **new art kind `vfx`** (recommended) or reuse
**`custom`**; the two live precedents contradict each other (REQ-0175 ruled "add the kind, required
not optional" for `gacha_pack`; REQ-0179 shipped `custom` one day later *for gacha_pack*), and an
LLM may not pick between two user rulings. (2) §7.3 — **the hit effect cannot be animated.** The
ratified route is a still-image txt2img graph with no temporal coherence and no video node; this REQ
specifies a still + a renderer-driven ramp and states the cost of the alternative rather than
inventing a pipeline. (3) §10 — the **no-baked-glow** authoring rule is a new golden, and it
constrains art the user has not yet seen.
**Reserved:** 2026-07-18
**Slug:** art-ray-hit-vfx-kind
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — spec item (i), verbatim: 「Rayは一旦すべて同一の線、ヒットエフェクト
は同一エフェクトとしますが、**差し替えられるようにしておき、artworkに追加する為のREQ**を起こしてください」.
**Depends on:** **REQ-0262** (expedition-ray-vfx) — HARD. Its §9 seam (`RayVfxKey`/`RayVfxStyle`/
`RayVfxProvider`/`DefaultRayVfx`) is this REQ's landing surface, and this REQ adopts its key
verbatim rather than inventing a parallel one. **REQ-0151** (the artwork registry + the sizing law),
**REQ-0152** (inspection kits), **REQ-0179** (the `custom` kind — the closest precedent, and §6's
alternative), **REQ-0211** (art kind `gimic` == art kind `monster` — the "configure it identically"
precedent this REQ follows where it fits and departs from where it does not).
**Blocks:** nothing. This REQ is a leaf: it makes per-skill VFX art POSSIBLE. It does not commission it.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §6.

## 1. Goal

Spec item (i) has three clauses and they are not the same request:

1. **"一旦すべて同一の線 / 同一エフェクト"** — ship ONE ray line and ONE hit effect now. **REQ-0262
   §9.2 already does this** (`DefaultRayVfx`, one constant style). This REQ does not redo it.
2. **"差し替えられるようにしておき"** — keep them swappable. **REQ-0262 §9.2 already does this too**
   (the `RayVfxProvider` interface). This REQ does not redo it either.
3. **"artworkに追加する為のREQを起こしてください"** — raise a REQ so VFX can be **added to the artwork
   registry**. **This is the whole of this REQ**, and it is the only clause REQ-0262 does not cover.

So the job is narrow and precise: **make ray/hit VFX a kind of thing the artwork registry can hold,
generate, inspect, adopt and export** — and wire the REQ-0262 seam to read from it, with a fallback
that can never blank and never crash.

**What ships: TWO assets** (`vfx_ray_default`, `vfx_hit_default`) — exactly the user's "one line, one
hit effect". **What is ENABLED: up to 162** (81 skills × 2 roles, §8.2). **Enabled is not
commissioned.** An art REQ that quietly implies 162 assets when the user asked for 2 is mis-scoped;
this one says 2, and says what the ceiling costs if the user later wants it.

**Out of scope, explicitly:** the ray's motion, trail, impact highlight, glow budget, nova
coalescing, reduced-motion behaviour — **all REQ-0262**. Skill icons — **REQ-0265**. Generating any
art — the user runs the art pipeline (PROJECT.md HANDS-OFF); this REQ is a **request**, and it never
runs `ComfyUI` or touches `monster_matte_variants/` or any `*-artsession` tree.

## 2. The ruling that authorizes this

Brief §6, verbatim:

> Ray VFX (g,h,i): … One ray line + one hit effect for now, but behind a swappable seam (i) ->
> art REQ-0264.

REQ-0262 §13 ("Out") assigns this REQ two things by name:

> **`skill` on `ray_fire`** (§9.3) and **any art** — REQ-0264. The seam ships inert.

**So this REQ owns a SIM change** (`skill` on `ray_fire`), not only an art change. §9 specifies it.
That is not scope creep — REQ-0262 measured that the seam's chosen key **is not on the wire**, and
handed the field to this REQ explicitly.

## 3. Verified current state — every row read or measured, not assumed

| fact | source | evidence |
|---|---|---|
| art kinds are exactly six | `server/services/art_sizing.cjs:24` | `const KINDS = ['po', 'si', 'unit', 'monster', 'bpskin', 'custom'];` — **there is no VFX kind** |
| …and `gimic` makes seven after the merge | `git show req-0211-gimic-content-kind:server/services/art_sizing.cjs` | REQ-0211 ruling 3; REQ-0255 merges it |
| every kind's size is LOCKED or DERIVED | `art_sizing.cjs:83-108` | `si`->256x256, `unit`->512x512, `bpskin`->1024x1024 **locked**; `po`->mask bbox x256px/cell, `monster`->{w,h} x128px/cell **derived**; `custom`->operator-typed |
| **the route is a STILL-IMAGE txt2img graph. There is no animation node of any kind.** | `docs/llm_managed/art_pipeline.md` §2 | `UnetLoaderGGUF -> CLIPTextEncode -> CFGGuider -> SamplerCustomAdvanced -> VAEDecode -> SaveImage`. No AnimateDiff, no video model, no frame-sequence node. §7.3 |
| **seamless tiling EXISTS and is measured** | `art_pipeline.md` §2; `tools/art_route.py:25,104-109,210-211` | `build_txt2img(..., tiling=True)` swaps `VAEDecode` -> **`CircularVAEDecode`**. Measured seam ratio **0.76-1.43, mean 1.00** vs a plain-decode control of 0.92-2.73. §7.2 |
| …and `tiling` is **already a per-render flag for ANY kind** | `server/routes/art.cjs:282` | `const tiling = art.kind === 'bpskin' ? true : !!b.tiling;` — a non-bpskin artwork can already be generated tileable by passing `tiling:true`. **No new capability is needed for the ray.** §7.2 |
| `tiling` reaches the job and is recorded in `params` | `tools/art_job.py:108,133-134,153,181`; `server/services/art_jobs.cjs:123,128,159` | `"tiling": bool(job.get("tiling", False))` is stamped into the render's params — so a gate can assert it |
| `custom` has **ZERO** inspection kits | `tools/inspect_kits.json` (whole file) | no kit lists `custom` in `applies_to`. `kitsFor('custom')` returns `[]`. §6.2 |
| `tiling.seam` exists, and is scoped to bpskin | `tools/inspect_kits.json` | `{"kit_id":"tiling.seam","kit_version":"1","applies_to":["bpskin"],"blocking":false}` — band [0.83, 1.10] **[S7]** |
| kit routing is **kind**-granular, not shape-granular | `server/services/kit_registry.cjs:19` | `kitsFor(kind) => kits().filter(k => k.applies_to.includes(kind))` — §12.2 |
| …but a kit **does** receive the shape | `kit_registry.cjs:43-50` | `kitParams(artwork)` returns `{kind, shape, gen_width, gen_height}`. **So a shape-aware kit is possible with no routing change.** §12.2 |
| `custom`'s prompt is a passthrough — **no style template** | `server/routes/art.cjs:195`; `tools/art_job.py:96-101` | `defaultsForKind('custom') -> {prompt_template:'{main_object}'}`; `if kind == "custom": return subject, subject` (no `KIND_TO_STYLE` entry) |
| the style map is closed at four kinds | `tools/art_job.py:15`; `tools/art_style.py:51` | `KIND_TO_STYLE = {"po":"item","si":"item","unit":"unit","monster":"monster"}`; `KIND_TEMPLATE = {"item":"anime","unit":"anime","monster":"concept_art_fantasy"}` |
| export path is `content/art/<kind>/<system_name>.png` | `server/services/art_export.cjs:39-41` | `path.join(exportRoot(), adopted.kind)` + `system_name + '.png'` |
| the artwork registry is **pg-only**; the files backend serves `{}` | `server/lib/content.cjs:227` | `if (process.env.STORAGE_BACKEND !== 'pg') return {};` — §11's fallback must survive this |
| `ray_fire` carries **no** `skill` / `element` / `cause` | REQ-0262 §3, measured on golden-A | field set `seq,t,ev,src,field,entry,dir,pen,aoe` — §9 |
| `telegraph` **does** carry `skill` | REQ-0262 §3, measured | field set `seq,t,ev,src,skill,edge,fires_at` — the value exists, on the wrong event. §9.2 |
| the telegraph->fire join is **already incomplete** | REQ-0262 §9.3, measured | **35 telegraphs for 36 `ray_fire`s** on golden-A. §9.2 |
| glow law, verbatim | `web/redesign/styleguide.html:553-554` | 「発光は4つの瞬間のみ — ①焦点(hover/選択) ②伝説級以上の顕現 ③生存する連結ビーム ④命中の瞬間。…外発光は blur ≤ 8px(等倍)・1要素1色。パネルは内影のみ。**同時発光源は ≤ 3/画面。**」 |
| REQ-0262 rations glow to impacts and caps it at 3 | REQ-0262 §8 R1/R2 | trails and heads **do not glow**; ≤3 impact glows, priority nova > hit > aoe, culled impacts keep a non-glowing highlight |
| up to **19** rays are in flight at once | REQ-0262 §4, measured | the number §10's authoring rule exists to survive |
| `G2` — no gameplay state in art | `docs/llm_managed/unit_icon_pipeline.md` §1 | *"Connection shapes, charge progress, link rays, team/enemy tint are renderer overlays. An icon containing an arrow, gauge, or beam is a FAIL regardless of beauty."* — §10 is its analogue for light |

## 4. MEASURED — what a VFX asset is actually consumed at

Derived from REQ-0262's ratified geometry (§5.3, §7, §11.2) at REQ-0260's `EXP_CELL = 40`:

```
one diagonal          = EXP_CELL * sqrt(2)          = 56.57 px      (a 45 deg step)
trail length          = EXP_TRAIL_DIAGONALS (6)     = 339.4 px      (6 x 56.57)
impact cell highlight = EXP_CELL                    = 40 x 40 px
nova shockwave (peak) = ~3 cells across            ~= 120 px
ray flight, longest   = RAY_STEP_BUDGET 512 diagonals = 28,964 px of path
```

**The two numbers that decide the whole asset contract:**

1. **A ray's path length is UNBOUNDED at authoring time** (512 diagonals is the retained budget;
   the median ray is 28.25 diagonals = 1,598 px). **No fixed-size raster can cover it.** The asset
   must therefore be **tiled**, not stretched — a stretched 256 px strip over 1,598 px is a 6.2×
   smear. §7.2.
2. **A hit is 40–120 px and lasts `EXP_IMPACT_GLOW_MS = 180` ms.** At 60 fps that is **~11 frames**.
   §7.3 shows why those 11 frames cannot be authored and must be a ramp.

## 5. What the pipeline CAN and CANNOT produce — stated honestly, because the answer shapes §7

**This is the section the REQ exists for.** Every existing art kind produces a **still raster** with a
sizing law. Spec item (i) asks for a *line* and an *effect*. Those are not stills, and pretending
otherwise would produce an unbuildable art request.

### 5.1 CAN — today, with zero new capability

| capability | evidence | what it buys |
|---|---|---|
| a still raster at any /16 size in [16, 16384] | `art_sizing.cjs:27,31-33` | the hit burst (§7.3), the ray tile (§7.2) |
| **a SEAMLESSLY TILEABLE still** | `art_route.py:104-109,210-211`; measured ratio 0.76–1.43, mean 1.00 (`art_pipeline.md` §2) | **the ray strip (§7.2) — this is the finding that makes (i) buildable** |
| tiling on a **non-bpskin** artwork, per render | `routes/art.cjs:282` — `!!b.tiling` | no new flag, no new plumbing |
| a machine seam check | `tiling.seam` kit, `tools/inspect_kits.json` | the ray's ONLY correctness property is measurable **by an existing kit** |
| alpha matte to transparency | `matte.coverage_band`; rembg `birefnet-general` (`art_pipeline.md` §5) | VFX composite over the field; they are never on white |
| shape conditioning | `shape_lock` (REQ-0186/0183) | **po-only** (`art_job.py:po_shape_mask` returns `None` for any other kind). Not available to VFX; not needed. |

### 5.2 CANNOT — and no amount of prompt engineering changes it

| asked-for thing | why it cannot be produced | evidence |
|---|---|---|
| **an animated hit effect (a sprite sheet)** | the graph has **no temporal node**. N frames = N independent txt2img calls. FLUX.2 klein at `seed=1`, `cfg=1.0`, no LoRAs has **no frame-to-frame coherence mechanism** — 8 "frames" are 8 unrelated bursts, and played back they strobe. | `art_pipeline.md` §2 (the whole graph); §0 ("no LoRAs", "no negative") |
| **a video / interpolated effect** | no video model is installed, and the box cannot hold one. FLUX.2 + the Qwen3-4B encoder **already do not co-reside in 8 GB** — ComfyUI swaps them per prompt at 30–170 s. | `art_pipeline.md` §2 ("The box"): RTX 2080, **8 GB VRAM** |
| **a directional ray that bends at bounces** | a bounce is a hard corner at constant speed (REQ-0262 §5.1); a raster cannot know where the corner is | REQ-0262 §5.3 — the trail is a **polyline**, and the renderer owns its vertices |
| **a stretched full-path ray** | the path is up to 28,964 px (§4) | §4 |

### 5.3 The new capability, if the user ever wants a true animation — its cost, stated once

**A sprite-sheet route is NOT specified here and MUST NOT be inferred.** If the user later wants a
genuinely animated hit, the honest cost is: a new model (AnimateDiff/SVD or equivalent), on an 8 GB
box whose measured cold load is **450–540 s** for the model it already has and which cannot
co-resident its own text encoder. That is **a new REQ, a new route, and a hardware conversation** —
not a parameter. **Recorded so it is not rediscovered as though it were cheap.**

**§7.3's still+ramp is not a workaround for a missing feature — it is the correct design anyway**, and
§7.3 argues that on its own merits, not on the pipeline's limits.

## 6. The kind decision — **USER RULING REQUIRED**

### 6.1 The two live precedents contradict each other

| REQ | state | what it ruled |
|---|---|---|
| **REQ-0175** (`artadmin-gacha-pack-artwork-kind`) | **draft/**, "CLEARED TO IMPLEMENT" | user, 2026-07-14: **「The art KIND itself — Add it — `artworks.kind = gacha_pack` is required, not optional.」** with a **locked 768×768**, *"exactly as `unit` is locked at 512"* |
| **REQ-0179** (`custom-art-kind`) | **built/** | user, 2026-07-15 — **one day later** — add `custom` *"so a custom artwork can be assigned 'just as a texture' to content that has no art-kind of its own (**e.g. `gacha_pack`** / bp_gacha)"* |

**Both name `gacha_pack`. One says it needs its own kind; the other says `custom` exists so it does
not.** REQ-0175 is still in `draft/`, un-superseded and un-withdrawn. **This is a live contradiction
in the board and it is reported, not resolved** (§16) — but it is also exactly the question this REQ
must answer for VFX, so it cannot be stepped around.

### 6.2 The discriminator this REQ extracts, and it is not a coin-flip

Reading both REQs together, a rule falls out that neither states but both obey:

> **A kind exists when the asset has a LAW. `custom` exists when it does not.**

- `si` is a kind because **256×256 is locked**. `unit` because **512×512 is locked**. `bpskin`
  because **1024×1024 is locked** *and* it has a blocking frame gate. `po`/`monster` because a
  **size is derived from a shape**. REQ-0175 wanted `gacha_pack` to be a kind **because 768×768 must
  be "a locked gate like every other kind's"** — its words.
- `custom` is the **absence** of a law: operator-typed resolution, operator-owned prompt with **no
  style template**, and — measured, `tools/inspect_kits.json` — **no kit at all**.

**Judged against that rule, VFX want a kind, and the reasons are concrete, not aesthetic:**

| property | does VFX have a law? | consequence under `custom` |
|---|---|---|
| **size** | **YES** — §8 locks 256×64 (ray) / 256×256 (hit). The ray's 4:1 aspect **is** its tiling contract. | an operator types 300×70; the strip mis-tiles; **nothing catches it** |
| **tiling** | **YES** — a ray strip that does not tile is **broken, not ugly**. | `routes/art.cjs:282` would need `!!b.tiling` passed by hand on every render; forget once and the seam ships |
| **a machine check** | **YES** — `tiling.seam` measures exactly the ray's only correctness property | **`custom` routes to ZERO kits** (measured). The one existing kit that would catch the one thing that can go wrong **cannot be reached**. This is the decisive argument. |
| **style coherence** | **YES** — G5 (roster coherence) applies: 2 assets today, up to 162 later, must look like one family | `custom`'s prompt is a **passthrough with no template** (`art_job.py:96-101`) — every VFX asset would carry its style by hand |
| **a fallback chain** | **YES** — §11's 3-step chain keys on a name convention | `custom` is a flat namespace shared with every texture; no convention is enforceable |

### 6.3 One kind or two? — ONE, with a role discriminator

The ray strip (4:1, tiled, flat) and the hit burst (1:1, still, ramped) are **different geometries**.
That argues for two kinds (`ray` + `hitfx`). **Rejected**, because they share everything that a
*kind* actually is: one prompt template, one authoring law (§10's no-baked-glow), one fallback chain,
one seam, one migration, one admin branch, one kit routing entry. Two kinds would double every one
of those to express **one boolean**.

**ADOPTED: one art kind `vfx`, whose `shape` carries a closed-vocabulary role.**

```
shape = { role: 'ray' | 'hit' }
```

**This is REQ-0211's `behavior` pattern, reused deliberately.** `gimic/1` carries a coarse,
closed-vocabulary discriminator (`trap|treasure|hidden_door`) whose *"map is the single place the
vocabulary is declared — **extensible**"*. `vfx.shape.role` is the same construct: two values today,
declared in one place, extensible to a third (a `beam` role, if REQ-0262 §8.4's link beams ever get
their REQ) without a new kind or a new migration.

**And it follows REQ-0211 ruling 3 where it fits, and departs where it does not.** Ruling 3 is
*"art kind `gimic` == art kind `monster`, configured identically"*. **It fits for the registry
plumbing** — `vfx` joins `KINDS`, gets a `shapeAndSize` branch, an artadmin shape editor, an ENUM
value, an export dir: all copied verbatim from an existing kind's shape. **It does NOT fit for the
sizing law.** A `gimic` genuinely IS a `monster` — both occupy a `w×h` cell footprint on the same
board, so sharing the 128 px/cell law is a *truth*, not a convenience. **A VFX occupies no cells at
all.** Giving it `{w,h}` would mean typing a cell footprint for a thing that has none — the
`shape` jsonb would carry a permanent lie, and §8.3 shows what that lie costs.

### 6.4 The alternatives, recorded so they are not rediscovered

- **Option A — new kind `vfx` + `shape.role` (RECOMMENDED, specified here).** Costs one ENUM
  migration + the REQ-0179 checklist. Buys the size law, the seam kit, the style template, the
  fallback convention. Follows REQ-0175's ruling.
- **Option B — reuse `custom`.** Zero migration; ships today. Costs: **no kit, no size law, no
  template** (§6.2). The ray's seam becomes unverifiable by machine. Defensible **only** if the
  user reads REQ-0179 as superseding REQ-0175.
- **Option C — two kinds (`ray` + `hitfx`).** Rejected, §6.3.
- **Option D — no registry at all; keep VFX procedural forever.** This is what ships today
  (`DefaultRayVfx`) and it is **a legitimate answer to "do we need this at all?"** — but the user
  asked, verbatim, for a REQ 「artworkに追加する為の」, so the ask is explicit. Recorded only for
  completeness.

## 7. The asset contract — designed around §5's reality

### 7.1 What the seam actually needs (from REQ-0262 §9.2, not invented here)

```ts
export interface RayVfxStyle {
  trailColor: number;  trailWidth: number;  trailDiagonals: number;
  headRadius: number;
  impactColor: number; impactGlowMs: number; impactGlowBlur: number;
}
```

**Every field is a NUMBER. There is no texture field.** So this REQ's first client change is to widen
`RayVfxStyle` with two optional texture handles — and **optional is the point**: a style with no
texture is exactly today's `DefaultRayVfx`, which is what must keep working when the registry is
empty (§11).

```ts
// REQ-0264 -- ADDITIVE. Both optional; null/absent == today's procedural draw.
export interface RayVfxStyle {
  /* ...every REQ-0262 field, unchanged... */
  rayTexture?: string | null;   // artwork system_name; tiled along the trail polyline (s7.2)
  hitTexture?: string | null;   // artwork system_name; ramped at the impact  (s7.3)
}
```

### 7.2 The ray — a TILEABLE SEGMENT, because the path length is unbounded

**The contract:**

```
asset      : one horizontal strip, 256 x 64, seamless in X          (s8)
tile length: ONE DIAGONAL. The renderer maps 1 tile -> 56.57 px of path (EXP_CELL * sqrt(2)).
             So a 6-diagonal trail (REQ-0262 s5.3) draws 6 tiles = 339.4 px, and a
             28-diagonal ray draws 28 tiles. Path length is a TILE COUNT, never a scale.
rendered   : as a TilingSprite along REQ-0262's trail polyline, in the ray's local space
             (+X = direction of travel), with REQ-0262's head->tail alpha ramp applied by the
             renderer on top. The art supplies TEXTURE; the renderer supplies LENGTH and FADE.
downscale  : 256 px source -> 56.57 px per diagonal = 4.5x headroom
caps       : NONE in v1. A head cap would be a 3rd role and a 3rd asset for an effect that is
             56 px long and moving at 25 cells/sec. REQ-0262 s5.2 already draws the head as a
             `headRadius` disc. Deferred, not forgotten -- s8.4's role vocabulary is extensible.
```

**Why tiled, not stretched — and the number is the argument.** §4: the median ray traverses 28.25
diagonals = 1,598 px; the retained budget is 512 diagonals = 28,964 px. Stretching one 256 px strip
over 1,598 px is a **6.2× smear**; over the budget it is **113×**. Tiling holds the texture at 4.5×
*downscale* at every length. **Tiling is not an optimisation here; it is the only thing that works.**

**Why this is buildable TODAY: `tiling=True` is a measured, shipped capability** (§3, §5.1) —
`CircularVAEDecode`, seam ratio mean **1.00**. The strip is generated exactly the way a `bpskin`
fill already is. **This REQ invents no capability; it routes an existing one to a new kind.**

**Seamless in BOTH axes is harmless.** `CircularVAEDecode` is circular in X *and* Y; the ray needs
only X. The strip is one tile tall, so Y-seamlessness is unused, not wrong. Stated because it looks
like a mismatch and is not.

**A ray does not bounce inside its texture.** REQ-0262 §5.3's polyline breaks at bounces into a V and
*"passes through it without smoothing"*. The tiling runs along the polyline, so a bounce is a
**seam between two tile runs**, drawn by the renderer, not baked. Any attempt to author a bend into
the strip is a FAIL (§10, V3).

### 7.3 The hit — a STILL + a RENDERER-DRIVEN RAMP, and this is right on the merits

**The contract:**

```
asset      : one square, 256 x 256, radially composed, centred, alpha-matted    (s8)
rendered   : a Sprite at the impact cell (REQ-0262 s7.1: the ray's own last ray_advance),
             driven over EXP_IMPACT_GLOW_MS = 180 ms by the RENDERER:
                 scale(t) : ease-out  from 0.35 -> 1.0     (the expansion)
                 alpha(t) : ease-out  from 1.0  -> 0.0     (the decay)
             This IS REQ-0262 s11.2's shockwave ring, with a Sprite in place of a Graphics.
downscale  : 256 px source -> ~120 px at peak = 2.1x headroom
```

**This is not a compromise forced by §5.2. It is the design that survives the measured content**, and
that argument stands even if a video model appeared tomorrow:

1. **REQ-0262 §4 measured 17 novas with a MEDIAN INTER-ARRIVAL of 0.08 s, and up to 14 inside one
   1.1 s window.** An authored 11-frame animation has a **fixed** duration. REQ-0262 §11.2 coalesces
   novas landing within `EXP_NOVA_COALESCE_MS = 180`; a coalesced group draws **one** effect. A ramp
   coalesces trivially (change `t`); a sprite sheet has a playhead per instance and 14 playheads is
   the strobe §11.2 exists to prevent.
2. **REQ-0260 §10 gives settled playback 0.5/1/2/4× and BACKWARD scrub.** A ramp is a **pure function
   of the clock** — REQ-0262 §5.2's whole architecture, and its gate 2. An authored sheet needs a
   playhead, which must be cancelled/rebuilt per seek, **backward**. REQ-0262 §5.2 rejected exactly
   this shape for the ray head, for exactly this reason.
3. **REQ-0262 §8 R2 CULLS the 4th simultaneous glow.** A culled impact still draws its non-glowing
   highlight. A ramp's glow is a renderer filter — droppable. **A baked animation's glow is pixels —
   not droppable.** §10.

**So the still+ramp is what the sim clock, the playback controls and the glow budget all
independently require.** The pipeline's inability to animate is, here, not a constraint at all.

## 8. The sizing law

### 8.1 The rule

```js
// server/services/art_sizing.cjs
const KINDS = ['po', 'si', 'unit', 'monster', 'gimic', 'bpskin', 'custom', 'vfx'];

case 'vfx': {
  const role = shape && shape.role;
  if (role === 'ray') return { width: 256, height: 64 };    // 4:1 strip, tiled along the path
  if (role === 'hit') return { width: 256, height: 256 };   // 1:1 still, renderer-ramped
  throw sizingError("vfx shape must be {role:'ray'|'hit'}");
}
```

**LOCKED, not derived — like `si`/`unit`/`bpskin`, and like REQ-0175's ruled `gacha_pack`.** Both are
/16-legal (256/16=16, 64/16=4), so `snap16` is a no-op and the law is exact rather than approximate.

### 8.2 Why these numbers — each derived, none picked

| number | derivation |
|---|---|
| **ray 256 wide** | 1 tile = 1 diagonal = **56.57 px** on screen (§4). 256/56.57 = **4.5× downscale headroom** — comfortably above the 2× a raster wants, and it is the same 256 the `po` law uses for one cell (`art_sizing.cjs:85`, `genSize(bb.w, bb.h, 256)`). **Not a new number in the system.** |
| **ray 64 tall (4:1)** | at 56.57 px/diagonal, a 4:1 strip renders **14.1 px** wide — a trail width that reads at `EXP_CELL=40` without swallowing the cell. **The aspect IS the contract**: it is what fixes `trailWidth` relative to path length, so a mis-shaped strip is a *mis-scaled ray*, which is why it must be locked and gated (§6.2) rather than typed. |
| **hit 256×256** | the nova peaks at **~120 px** (§4) = **2.1× headroom**; and 256×256 **is `si`'s locked size verbatim** (`art_sizing.cjs:88`). Reusing it means `si.subject_frame`'s geometry assumptions (single centred subject + margin, authored *"for 256×256 SIs"*) hold unchanged — §12.2. |

### 8.3 Why NOT the monster/gimic 128 px/cell law — the REQ-0211 departure, argued

REQ-0211 ruling 3 gave `gimic` the monster law verbatim. **The analogous move here would be
`shape = {w,h}` at 128 px/cell.** It is wrong, and not marginally:

- **A VFX occupies no cells.** `monster`'s law reads a **cell footprint** (`{w,h}`, each 1..12) —
  the thing's size *on the board*. REQ-0188 makes that footprint **authoritative**: *"the art is
  authoritative; fix the CELL SHAPE side"*, and `derive --write` propagates art shape -> def
  footprint. **A ray has no def and no footprint.** Feeding it `{w:1,h:1}` would enter a permanent
  falsehood into `shape` jsonb — and under REQ-0188's doctrine that falsehood is *authoritative*.
- **It cannot express 4:1 at the ray's real size.** `{w:4,h:1}` × 128 = 512×128. That is 2× the
  needed pixels (9.1× downscale) for an asset that will be tiled thousands of times per run, and it
  buys nothing.
- **The errata prove the hazard is live, not theoretical.** `frost_gnoll`'s def footprint is
  **`[1,1]`** (measured, `content/live/dungeon/enemies.json`) while its **art shape is `{w:3,h:4}`** —
  REQ-0188 was ratified and `derive --write` was **left unrun**, so a def and its art disagree by
  **12×** in area today. That drift is *possible* precisely because `monster.shape` claims to describe
  board geometry. **A kind whose shape describes nothing on the board cannot drift from the board.**
  §8.1's `{role}` is unfalsifiable by construction — a strictly better property than a law that is
  currently, measurably, violated.

## 9. The SEAM — REQ-0262's key, verbatim, and the sim field this REQ owns

### 9.1 The key is `skill`. This REQ does not re-decide it.

REQ-0262 §9.1 judged three candidates and **ADOPTED `skill` id**, rejecting `element` (*"Not a field
on a skill def at all"* — a live def is `{trigger, verb, attack_profile, modes}`) and `attack_profile`
(*"It is a struct, not an identity. Two unrelated skills sharing `pen:2` would be forced to share
art"*). **That analysis is sound and this REQ adopts it unchanged.** Independently confirmed here:
`content/live/dungeon/skills.json`'s 81 entries carry **no `element` field whatsoever** (measured,
§16), so `element` is not merely unwired — it does not exist.

`RayVfxKey` (REQ-0262 §9.2) is consumed **as written**: `{skill, cause, pen, aoe, field}`.
**This REQ adds no key field and defines no parallel vocabulary.**

### 9.2 `skill` on `ray_fire` — the sim change REQ-0262 assigned here

**Measured: `ray_fire` does not carry `skill`** (§3). REQ-0262 §13 assigns the field to this REQ.

```
ray_fire  {t, seq, ev, ray, src, field, entry, dir, pen, aoe,
           skill}   // NEW -- REQ-0264. The skill def id (`skills.json` entry id).
```

**It is one field, and the sim already has the value in hand.** REQ-0262 §9.3 measured that
`telegraph` **already carries `skill`**, and its `fires_at` is *the timestamp of the very fire this
field labels*. So the value is already computed and already serialised — on the event 0.6 s earlier.

**Do NOT join `telegraph` -> `ray_fire` client-side.** REQ-0262 measured **35 telegraphs for 36
`ray_fire`s** on golden-A: the join is **already incomplete on real data**, and a heuristic that
silently mislabels 1 ray in 36 is worse than no key. Put the field on the event that needs it.

> **The 35-vs-36 gap, inherited as a finding, and NOT chased here.** REQ-0262 recorded it for this
> REQ. One ray fires with no telegraph — plausibly a reactive/charge fire with nothing to telegraph.
> **It does not block this REQ**: putting `skill` on `ray_fire` at the emission site labels all 36
> regardless of whether a telegraph exists. §14 gate 6 asserts 36/36 precisely so the gap cannot hide
> inside this field. Chasing *why* the 36th has no telegraph belongs to REQ-0256/0257.

### 9.3 Cost

**Zero new events. One field on 36 existing events** (golden-A). Against REQ-0257 §10.2's
already-accepted **3.75×** log growth, this is unmeasurable — the same posture REQ-0263 §4.4 takes
for `hp_after`.

## 10. AUTHORING RULES — the VFX goldens. **USER RULING REQUIRED on V2.**

These bind the ART, not the code. They are stated as goldens because
`unit_icon_pipeline.md` §1's G1–G7 are the precedent for *"a rule the art itself must obey"*.

- **V1 — art_golden applies unchanged.** Aspect ratio inviolable (the ray's 4:1 **is** its tiling
  contract, §8.2); illustration-first; the asset is approved before it is wired.
- **V2 — NO BAKED GLOW. This is G2, applied to light.** An authored VFX asset must not contain outer
  glow, bloom, or a soft luminance halo. **Glow is a RENDERER overlay**, drawn with
  `EXP_IMPACT_GLOW_BLUR ≤ 8` and counted against `EXP_GLOW_BUDGET = 3` (REQ-0262 §8). §10.1 is the
  argument.
- **V3 — the renderer owns geometry.** No bend, no corner, no head, no tail, no directional arrow
  baked into a ray strip; no cell grid, no ring, no radius marks baked into a hit. The polyline, the
  bounce V, the expansion ramp and the impact cell are all REQ-0262's (§5.3, §7, §11.2). **A strip
  containing a bounce is a FAIL** — exactly as G2 fails an icon containing a beam.
- **V4 — one colour per element.** `styleguide.html:554`: 「1要素1色」. A two-colour ray strip
  violates it in the texture, where no renderer can fix it.
- **V5 — the ray strip must TILE.** Seam-checked by `tiling.seam` (§12.2) **and** by the mandatory
  half-shift eyeball the kit's own rule requires (`art_pipeline.md` §8: the seam metric *"reads high
  on low-contrast tiles"* and *"stays a FILTER, never a verdict"*).
- **V6 — roster coherence (G5's analogue).** The ray and the hit that ship together must read as one
  effect family. Trivial at 2 assets; **binding at 162** (§8.2's ceiling).

### 10.1 Why V2 is a hard rule and not a preference

**The task framing put this exactly right and the measurement confirms it: this is G2's structure,
applied to light.** G2 says *"connection shapes, charge progress, link rays… are renderer overlays.
An icon containing an arrow, gauge, or beam is a FAIL regardless of beauty"* — because **the renderer
must be able to control state per-frame, and a baked pixel cannot be controlled.**

**Glow is the same class of thing, and REQ-0262 proves it by measurement:**

- `styleguide.html:554` caps **simultaneous glow sources at ≤ 3/screen**.
- REQ-0262 §4 measured **19 rays in flight at t=1.98** — the budget exceeded **6.3×**.
- REQ-0262 §8 R1/R2 resolve it: **trails and heads do not glow at all**, and impact glows are
  **hard-capped at 3 with a priority cull** (nova > hit > aoe).

**A cull is a renderer operation.** Dropping a `GlowFilter` is one line. **Un-baking a halo from a
texture is impossible.** So:

> **If the ray strip ships with baked glow, then at 19 simultaneous rays there are 19 uncullable
> glow sources, the ≤3 budget is violated 6.3× with no mechanism to enforce it, and REQ-0262 §8's
> entire resolution — the thing the user is being asked to rule on — is silently defeated by an art
> asset.**

REQ-0262 §14.5's gate ("assert live glow sources never exceed `EXP_GLOW_BUDGET` on any frame") would
**still pass**, because it counts renderer glow objects and a baked halo is not one. **The art would
break the law through the gate's blind spot.** That is precisely why this must be an *authoring*
rule with its *own* machine check (§12.2's `vfx.flatness`), and not left to the renderer's gate.

**The ruling needed:** V2 forbids the most natural way to draw a magic ray. A flat, non-glowing
strip is a **deliberately** un-magical look, and it is what §6.1's four sanctioned moments actually
license — REQ-0262 §8 R1: *"a projectile in flight is not one of them"*. **The user should see a flat
ray before 162 assets are authored against V2.** Options:

- **(A) RECOMMENDED — V2 as written.** Art is flat; the renderer glows the impact only, ≤3, blur ≤8.
  Honours §6.0/§6.1 exactly. Cost: the ray does not shimmer.
- **(B) Allow baked glow on the HIT only** (never the ray — 19 concurrent trails is the hard case;
  impacts are already capped at 3 by R2). Weaker, but it fails soft: an over-budget *impact* is 3
  sources, not 19. **Still defeats R2's cull**, so the ≤3 becomes "≤3 renderer glows + up to 3 baked
  ones" = up to 6.
- **(C) Amend §6.0's glow law for `#/expedition`.** This is **REQ-0262 §8.3 Option B** and it is the
  SAME ruling. If the user raises the budget there, V2 relaxes here automatically. **These two must
  be answered together** — and that is the point: an art rule and a renderer budget are one decision.

## 11. Resolution and fallback — never blank, never crash

### 11.1 The naming law

VFX have **no content def**, so REQ-0174's `artwork_ref` column and the exact-name convention
(`system_name == def id`, `resolveItemArtNames`: *"def.artwork_ref adopted -> exact-name adopted ->
omitted"*) **have nothing to key on**. A composed name is therefore the convention:

```
vfx_<role>_default          # the shipped default. ROLE in {ray, hit}.  -> 2 assets, TODAY
vfx_<role>_<skill_id>       # an optional per-skill override.           -> up to 162, LATER
```

Measured, this is collision-free: the 81 skill ids are unique (§16), and the `vfx_` prefix cannot
collide with any content id because every existing artwork name is a bare def id.

### 11.2 The chain — three steps, and the last one cannot fail

```
styleFor(key: RayVfxKey) -> RayVfxStyle:
  1. key.skill && artwork('vfx_ray_' + key.skill) adopted   -> use it
  2. artwork('vfx_ray_default') adopted                     -> use it
  3. DefaultRayVfx's procedural style                       -> ALWAYS AVAILABLE (REQ-0262 s9.2)
```

**Step 3 is the guarantee, and it costs nothing to keep**, because REQ-0262 §9.2 already ships
`DefaultRayVfx` as a working procedural draw. This REQ **adds a provider; it does not replace one**:

```ts
// client/src/expedition/rayVfx.ts -- REQ-0264 adds ONE class. REQ-0262's file, unedited otherwise.
export class RegistryRayVfx implements RayVfxProvider {
  constructor(private artUrls: Record<string,string>, private fallback = new DefaultRayVfx()) {}
  styleFor(key: RayVfxKey): RayVfxStyle {
    const base = this.fallback.styleFor(key);          // every NUMBER comes from the default
    return { ...base,
      rayTexture: this.pick('ray', key.skill),          // null if absent -> procedural draw
      hitTexture: this.pick('hit', key.skill) };
  }
}
```

**This is REQ-0262 §9.2's own acceptance criterion 13 discharged** (*"swapping in a stub provider
changes the ray's look with no change to `ExpeditionRayLayer`"*) — and it is the `chargeRing.ts`
pattern REQ-0262 §9.2 names: **REQ-0264 registers a provider; nothing else moves.**

### 11.3 The four ways this can be empty, and each degrades

| condition | behaviour |
|---|---|
| **files backend** (`STORAGE_BACKEND !== 'pg'`) — `computeArtUrls` returns `{}` (`content.cjs:227`) | step 2 misses -> **procedural**. This is the **normal dev/e2e path**, not an error. Mirrors REQ-0263 §12.9. |
| no artwork adopted for a skill | step 1 misses -> step 2 -> the shipped default. **The user's "一旦すべて同一の線" IS this path**, and it is the path 81/81 skills take on day one. |
| `key.skill === null` (before §9.2's field lands) | step 1 is not attempted -> step 2. **The seam works with no sim change at all** — the sim change buys per-skill art, not correctness. |
| the PNG 404s / decodes badly | **procedural**, logged once, never retried per-frame. REQ-0262 §12.2's posture: *"a renderer must never be the thing that takes the page down"*. |

### 11.4 Do NOT preload

At most `2 + 2N` textures are live for a run (N = distinct skills on the field). **Resolve per-roster,
never the whole namespace.** At the ceiling, 162 × 256px PNGs is a multi-MB download for an 18 px
badge's worth of screen — the same discipline REQ-0265 §11 states for skill icons.

### 11.5 The Dex consequence: **NONE.**

**VFX are not content.** They have no `content_defs` row, no Dex tab, no `art_urls` entry:
`computeArtUrls()` (`server/lib/content.cjs:226-249`) joins `items`/`sis`/`tms`/`monsters` — **all
content-def id namespaces**. `vfx_ray_default` is not an id of anything. It is fetched directly at
`/api/art/vfx_ray_default.png` by the §11.1 convention.

**So `computeArtUrls` is NOT widened by this REQ** — a deliberate departure from REQ-0265, which
*does* widen it (because a skill **is** a content def). Stated explicitly because "add it to
art_urls" is the reflex, and here it would put a non-id into an id-keyed map.

## 12. The surfaces

### 12.1 Registry / admin — the REQ-0179 checklist, applied

REQ-0179 is the closest precedent (*"adding a NEW art kind"*) and its scope table is followed
point-for-point:

| REQ-0179's step | this REQ |
|---|---|
| **A. migration** | `server/migrations/0NN_artwork_kind_vfx.sql`: `ALTER TYPE artwork_kind ADD VALUE IF NOT EXISTS 'vfx';` — top-level (ADD VALUE cannot run in a txn), `IF NOT EXISTS` idempotent. **Number is NOT fixed here — see §16's collision finding.** |
| **B. sizing law** | `art_sizing.cjs`: `KINDS += 'vfx'`; the §8.1 `case`. Single source; the client mirrors. |
| **C. route** | `routes/art.cjs`: `shapeAndSize('vfx', shape)` validates `{role}` against the closed vocabulary and returns `{shape:{role}, size:deriveSize(...)}`. `defaultsForKind('vfx')` -> §12.3. **Plus one line at `:282`**: `const tiling = (art.kind === 'bpskin' \|\| (art.kind === 'vfx' && art.shape?.role === 'ray')) ? true : !!b.tiling;` — the ray is **always** tiled, exactly as a bpskin fill always is. Not an operator's choice; a law. |
| **D. python composer** | `tools/art_job.py`: `KIND_TO_STYLE += {"vfx": "vfx"}`; `tools/art_style.py`: `KIND_TEMPLATE += {"vfx": ...}` -> §12.3. |
| **E. artadmin** | `artShared.ts`: `Kind`/`KINDS` += `'vfx'`; `deriveSizeClient` mirrors §8.1; `defaultTemplate('vfx')`; `ArtDraft` gains `role`. `CreatePanel.tsx` / `Workspace.tsx` / `ArtAdminPage.tsx`: a **2-option role selector** (testid `art-vfx-role`) + the read-only `art-resolution` readout. `ShapeEditors.tsx`: a `vfx` branch (a radio pair — **the simplest shape editor in the file**, and deliberately: `{role}` is 1 bit). CSS `.aa-kind--vfx`. |
| **F. contentadmin picker** | **NOT widened.** `Workspace.tsx:56`'s `typeChips` exists so a *content def* can link an artwork; **no def links a vfx** (§11.5). Adding `vfx` there would offer an operator a link that means nothing. **A deliberate departure from REQ-0179 step F**, which widened it precisely because a `gacha_pack` def *does* link its art. |
| **G. tests** | §14. |

### 12.2 Kit registry — the argument for a kind, cashed in

```json
// tools/inspect_kits.json
{"kit_id":"tiling.seam","kit_version":"1","applies_to":["bpskin","vfx"],"blocking":false}
{"kit_id":"matte.coverage_band","kit_version":"1","applies_to":["po","si","unit","vfx"],"blocking":false}
{"kit_id":"vfx.flatness","kit_version":"1","applies_to":["vfx"],"blocking":false}   // NEW, s12.2.2
```

**12.2.1 — routing is kind-granular; the shape is not. Both facts matter.** `kitsFor(kind)` filters
on `applies_to.includes(kind)` (`kit_registry.cjs:19`) — **a kit cannot be routed by role.** So
`tiling.seam` will run on `hit` assets, which are not tiled, and would WARN spuriously.

**The fix needs no routing change, and the evidence is in `kit_registry.cjs` itself:**
`kitParams(artwork)` returns **`{kind, shape, gen_width, gen_height}`** (`:43-50`) — **the kit already
receives `shape`, hence `role`.** So `tiling.seam` reads `params.shape.role !== 'ray'` and returns
not-applicable, exactly as `content_checks.cjs` reports `applicable:false` for a dialect that does not
apply (REQ-0211's precedent). **Recorded as a finding**: shape-aware kits are possible today and
nothing in the tree uses that yet.

> **A real consequence, stated:** `shape` is part of `kitInputSha256` (`kit_registry.cjs:58-61`), so
> **flipping an artwork's `role` correctly invalidates its inspections** and flips the stale badge.
> That is the behaviour we want and it is free — but it means `role` is not a cosmetic label; it is
> part of a render's inspection identity.

**12.2.2 — `vfx.flatness` v1 [S7]: the machine check for V2.** V2 is an authoring rule; an authoring
rule with no measurement is a suggestion. A baked outer glow is a **wide band of intermediate
alpha** around the subject (a flat asset has only a thin antialiasing band). So:

```
soft_alpha_band = fraction of pixels with 8 < alpha < 200
verdict [S7]:  <= 0.12 -> PASS ;  else WARN + a mandatory eyeball
```

**Thresholds are marked [S7] and are NOT ratified** — the same posture `monster.render_sanity` and
`si.subject_frame` ship with (`art_pipeline.md` §8's roster table). The number is calibrated from the
first gallery, not guessed here. **Advisory, never blocking** (`inspect_kits.json`'s own rule: only
`bpskin.frame_gate` blocks, and only inside the recipe).

### 12.3 The style template — a design question, flagged, not inferred

`KIND_TEMPLATE` has three entries: `anime` (item, unit), `concept_art_fantasy` (monster). **Neither
fits.** The Anime template appends *"anime++, bold outline, cel-shaded coloring, shounen, seinen"* —
**"bold outline" is actively wrong for a VFX strip**, and the pipeline has already measured this
exact failure in a neighbouring case: *"The Anime template's 'bold outline' + cel-shading turn a fill
brief into a discrete bordered OBJECT: asked for a leather texture, it produced a stitched,
black-outlined leather patch"* (`art_pipeline.md` §3). **A ray strip asked for under the Anime
template will come back as an outlined object, not an energy beam.**

**`FILL_STYLE` is the closest existing thing** — it exists precisely because a fill must say
*"allover, edge to edge, no focal object, no border, no outline, no frame"*. A **ray strip** wants
exactly that grammar (tileable, no border, no focal object); a **hit burst** wants the opposite (one
centred focal object).

**So `vfx` needs its own template, and the two roles may need two.** **This is a DESIGN question and
an LLM must not invent the user's art direction** — the current direction was ratified 2026-07-13 *by
the user looking at results in InvokeAI*, and REQ-0175 recorded the identical gap for `gacha_pack`
(*"`gacha_pack` -> **???**, a design question, not an inference"*). **Recorded the same way here.**

**A concrete starting point, offered as a proposal only:** ray -> `FILL_STYLE`'s no-border grammar +
an energy noun; hit -> `concept_art_fantasy` (its *"glazed brushstrokes, otherworldly"* suits a burst
and carries no forced outline). **The user rules; §15 gates on it.**

## 13. Scope

**In:**

1. `server/migrations/0NN_artwork_kind_vfx.sql` — **NEW.** `artwork_kind` ENUM += `vfx`. (§16: the number.)
2. `server/services/art_sizing.cjs` — `KINDS += 'vfx'`; §8.1's `case`.
3. `server/routes/art.cjs` — `shapeAndSize`/`defaultsForKind` branches; the `:282` **forced-tiling**
   line for `role:'ray'`.
4. `tools/art_job.py` + `tools/art_style.py` — `KIND_TO_STYLE`/`KIND_TEMPLATE` += `vfx` (§12.3, **after
   the user's direction ruling**).
5. `tools/inspect_kits.json` — `tiling.seam` + `matte.coverage_band` gain `vfx`; **NEW** `vfx.flatness` v1.
   Plus the `tiling.seam` role no-op (§12.2.1). **No `kit_version` bump**: adding a kind to
   `applies_to` is neither *"a threshold nor an algorithm change"* (the manifest's own bump rule), so
   **existing bpskin/po/si/unit inspections must NOT go stale.** §14 gate 8 pins that.
6. `client/src/artadmin/*` — `artShared.ts`, `CreatePanel.tsx`, `Workspace.tsx`, `ArtAdminPage.tsx`,
   `ShapeEditors.tsx`, `artadmin.css` (§12.1 E).
7. `client/src/expedition/rayVfx.ts` — **REQ-0262's file.** `RayVfxStyle` gains two **optional**
   texture handles; **NEW** `RegistryRayVfx` (§11.2). `DefaultRayVfx` is **not edited**.
8. `client/src/expedition/ExpeditionRayLayer.ts` — **REQ-0262's file.** Draws a `TilingSprite`
   when `rayTexture` is set (§7.2) and a ramped `Sprite` when `hitTexture` is set (§7.3); the
   procedural draw stays as the `null` branch.
9. **Sim (additive):** `skill` on `ray_fire` (§9.2). **One field, zero new events.**
10. **Art request (for the user's pipeline, NOT run here): 2 assets** — `vfx_ray_default` (256×64,
    `tiling:true`), `vfx_hit_default` (256×256). §15.

**Out:**

- **The ray's motion / trail / impact / glow budget / nova / reduced-motion** — REQ-0262. This REQ
  changes **arguments**, not structure.
- **Skill icons** — REQ-0265.
- **Generating, matting, or adopting any image** — the user runs the art pipeline (PROJECT.md
  HANDS-OFF). This REQ never touches `ComfyUI/`, `monster_matte_variants/`, a `*-artsession`
  worktree, or any GPU output.
- **Commissioning per-skill VFX** (up to 162, §8.2). **Enabled ≠ commissioned.**
- **A sprite-sheet / video capability** — §5.3. A new REQ, a new route, a hardware conversation.
- **Head/tail caps** — §7.2. A 3rd role, deferred; the vocabulary is extensible.
- **Link beams** — REQ-0262 §8.4 declared them out of (g)/(h)/(i) and recommended not drawing them.
  If they ever return, they are a **3rd `role`**, not a new kind. Recorded as the seam's one designed-for extension.
- **Resolving REQ-0175 vs REQ-0179** (§6.1) — a board contradiction; reported (§16).
- **Running `derive --write`** for REQ-0188's `frost_gnoll` drift (§8.3) — reported; REQ-0188's.
- **`docs/user_managed/*`** — forbidden, and nothing here needs it.

## 14. Gates

**E2E ports (rule: `5000 + REQ*10 + index`): `7640` static / `7641` api / `7642` proxy.** Reserved by
the numbering rule and machine-enforced by `tools/check_e2e_ports.cjs`. **Per ruling Q2
(「e2eを通す必要はない」) E2E is NOT a gate for this program, so no harness is built and the decade is
left unused** — the same posture REQ-0262 §14 takes with 7620-7622 and REQ-0263 §11 with 7630-7632.

Gates that DO apply:

1. **The sizing law (REQ-0179's G2 test, extended).** `deriveSize('vfx',{role:'ray'})` === `{256,64}`;
   `{role:'hit'}` === `{256,256}`; `{role:'beam'}` / `{}` / `null` throw `BAD_SHAPE`. **A closed
   vocabulary that accepts an unknown value is not closed.**
2. **The ray is ALWAYS tiled.** Create a `vfx`/`ray`, generate **without** passing `b.tiling`, assert
   the render's recorded `params.tiling === true` (`art_jobs.cjs:159` stamps it). Then a `hit`
   without `b.tiling` -> `params.tiling === false`. **This is the gate that stops a non-tiling ray
   from ever being adopted.**
3. **Kits route, and the role no-op works.** `kitsFor('vfx')` returns `tiling.seam`,
   `matte.coverage_band`, `vfx.flatness`. On a `hit`, `tiling.seam` records **not-applicable**, not a
   WARN (§12.2.1).
4. **`role` is part of the inspection identity.** Flip an artwork's `role`; assert
   `kitInputSha256` changes and the stale badge flips (§12.2.1).
5. **The fallback chain cannot blank.** Replay golden-A with (a) every `vfx` artwork deleted, (b) only
   `vfx_ray_default` present, (c) `STORAGE_BACKEND=files` (`art_urls === {}`), (d) a 404ing PNG.
   **All four: rays draw procedurally, nothing throws, nothing is blank.** (c) is the **default e2e
   path**, so it is not an edge case.
6. **`skill` is on every `ray_fire`.** Golden-A: **36/36** carry a non-null `skill` that resolves in
   `skills.json`. **Pins §9.2 against the 35-telegraph gap**: the count must be 36, not 35.
7. **The seam is proven by exercise, not assertion.** Swap `DefaultRayVfx` -> `RegistryRayVfx` with a
   stub `artUrls`; the ray's look changes with **zero** edits to `ExpeditionRayLayer.ts`. (REQ-0262
   AC-13, discharged with a real provider.)
8. **No kit goes stale.** After §13.5's `applies_to` edit, assert every existing `bpskin`/`po`/`si`/
   `unit` render's `kit_input_sha256` is **unchanged**. A spurious mass-stale would invalidate the
   whole inspection history for a routing edit.
9. **V2 has teeth.** `vfx.flatness` on a deliberately bloomed fixture -> WARN; on a flat fixture ->
   PASS. Without this, §10's rule is prose.
10. **Migration is additive and idempotent.** Apply twice; `artwork_kind` = {po,si,unit,monster,
    bpskin,custom,gimic,vfx}. Old code never emits `vfx` (REQ-0179's migration-first argument).
11. `pnpm exec tsc --noEmit` + lint + `tools/ci.sh` GREEN.

## 15. Acceptance criteria

1. An operator can create a `vfx` artwork, pick `role` = ray|hit, see a **read-only** derived
   resolution (256×64 / 256×256), generate, inspect, adopt and export it to
   `content/art/vfx/<name>.png` — **through the machinery that exists**, with no VFX-special path.
2. **`vfx_ray_default` and `vfx_hit_default` exist and are adopted.** This is the user's
   「一旦すべて同一の線、ヒットエフェクトは同一エフェクト」 — **2 assets, not 162.**
3. A ray with `rayTexture` set draws the strip **tiled 1-tile-per-diagonal** along REQ-0262's trail
   polyline; a 28-diagonal ray draws **28 tiles**, not one 28× stretch (§7.2).
4. A hit with `hitTexture` set draws a **still** ramped scale 0.35->1.0 / alpha 1.0->0.0 over
   `EXP_IMPACT_GLOW_MS = 180`, and is **correct under 0.5/1/2/4× and backward scrub** — because it is
   a pure function of the clock, with no playhead (§7.3).
5. **Nothing is ever blank.** All four §14.5 conditions degrade to the procedural draw.
6. **The seam key is `skill`** — REQ-0262 §9.1's, not a parallel one. `grep` shows no `element`- or
   `attack_profile`-keyed VFX lookup anywhere (§9.1).
7. **`ray_fire` carries `skill`, 36/36 on golden-A** (§9.2), and **no client-side telegraph join
   exists**: `grep` returns zero joins on `fires_at` in `client/src/expedition/` (§9.2).
8. **No adopted `vfx` asset contains baked glow** (V2) — `vfx.flatness` PASS + the user's gallery eye.
9. **The ≤3 glow budget still holds with textures in play.** Re-run REQ-0262 §14.5's gate with
   `RegistryRayVfx` active: live **renderer** glow sources ≤ 3, and the art adds **zero** (§10.1).
10. `ExpeditionRayLayer` needed **no structural change** — only the two texture branches (§13.8).
11. **The user has ruled on: §6 (new kind `vfx` vs `custom` — and, implicitly, REQ-0175 vs REQ-0179),
    §10's V2 (no baked glow, jointly with REQ-0262 §8's budget ruling), and §12.3 (the VFX style
    direction).** Implementation does not start before then.

## 16. Corrections to the brief, the task framing, the code and the sibling REQs

| claim | reality | evidence |
|---|---|---|
| task: *"is this a new art kind (`vfx`? `ray`? `hitfx`?), two kinds, or a reuse of `custom`? Read REQ-0179's `custom` kind properly — **it may already be the intended home**"* | **It is not, and the decisive reason is measurable: `custom` routes to ZERO inspection kits.** No entry in `tools/inspect_kits.json` lists `custom` in `applies_to`, so `kitsFor('custom')` returns `[]`. A ray strip's **only** correctness property is that it tiles; `tiling.seam` measures exactly that and **cannot be reached from `custom`**. `custom` also has no size law and no style template. | §6.2, `tools/inspect_kits.json` |
| **REQ-0175 vs REQ-0179 CONTRADICT EACH OTHER, and both are live** (NEW finding) | REQ-0175 (**draft/**, "CLEARED TO IMPLEMENT", ruled 2026-07-14): *"**The art KIND itself — Add it** — `artworks.kind = gacha_pack` is **required, not optional**"*, locked 768×768. REQ-0179 (**built/**, requested 2026-07-15): add `custom` *"so a custom artwork can be assigned 'just as a texture' to content that has **no art-kind of its own** (e.g. **`gacha_pack`**/bp_gacha)"*. **Both name `gacha_pack`; one gives it a kind, the other says `custom` covers it.** REQ-0175 is neither withdrawn nor marked superseded. **The board cannot answer "does X get a kind?" until this is resolved** — and this REQ and REQ-0265 both ask it. | §6.1 |
| **MIGRATION NUMBER COLLISION at 020** (NEW finding) | `master`/this worktree has **`020_render_variant.sql`** (REQ-0223). The `req-0211-gimic-content-kind` branch has **`020_content_kind_gimic.sql`** + `021_artwork_kind_gimic.sql`. **REQ-0255 merges 0211 -> two different `020_*` files.** Not fatal (**precedent exists**: `016_content_artwork_ref.sql` and `016_content_kind_gacha_pack.sql` already coexist), but it means **the next free number is not derivable by `ls` before the merge**. This REQ therefore writes `0NN` and fixes the number **at implementation time, on the merged baseline** — post-merge the next free is **022**. Flagged to REQ-0255. | §12.1, §13.1 |
| task: *"a ray line is a *tiling/stretching* asset"* | **Tiling. Never stretching — and the number decides it.** The median ray traverses **1,598 px** of path and the retained budget is **28,964 px** (512 diagonals × 56.57). A 256 px strip stretched to the median is a **6.2× smear**; to the budget, **113×**. | §4, §7.2 |
| task: *"a hit effect is an *animated* burst … a sprite-sheet **or** a still + renderer-driven scale/alpha ramp"* | **The sprite sheet is not merely unavailable — it is the WRONG design here**, and three ratified constraints say so independently: novas coalesce at a measured **0.08 s median inter-arrival** (a sheet needs 14 playheads); playback runs **0.5/1/2/4× and BACKWARD** (a sheet needs per-seek teardown — the shape REQ-0262 §5.2 already rejected for the head); and REQ-0262 §8 R2 **culls** glow (a baked frame cannot be culled). **The still+ramp wins on merit, not on limits.** | §7.3 |
| task: *"State honestly what the current pipeline … CAN and CANNOT produce"* | **CAN, and this is the finding that makes (i) buildable at all: seamless tiling already ships, is measured (seam ratio mean 1.00), and `routes/art.cjs:282` already exposes `tiling` as a per-render flag for ANY kind.** The ray needs **no new capability whatsoever** — only a kind to route it to. **CANNOT: any animation.** The graph has no temporal node; klein at cfg 1.0 with no LoRAs has no frame coherence; and the box (**8 GB**) cannot co-resident FLUX + its own text encoder, let alone a video model. | §5.1, §5.2 |
| task: *"Follow REQ-0211 ruling 3's precedent ('configured IDENTICALLY to monster') where it fits"* | **It fits for the PLUMBING and fails for the LAW.** A `gimic` really is a `monster` — both occupy a `w×h` **board footprint**, so sharing 128 px/cell is a truth. **A VFX occupies no cells**; `{w,h}` would be a permanent lie in `shape` jsonb — and REQ-0188 makes `shape` **authoritative**, so it would be an *authoritative* lie. | §6.3, §8.3 |
| **REQ-0188's drift is real and this REQ measured the def side** | `frost_gnoll`'s def footprint is **`[1,1]`** (measured, `content/live/dungeon/enemies.json`) vs the errata's art shape `{w:3,h:4}` — a **12× area disagreement**, live, because REQ-0188 was ratified and **`derive --write` was left unrun**. Cited here as the *evidence* for §8.3: a shape that claims to describe the board **can** drift from it; `{role}` cannot. | §8.3 |
| brief §6 (silent) | **`ray_fire` carries no `skill`.** REQ-0262 §9.1 measured it and §13 assigned the field **to this REQ**. So (i)'s "swappable per-skill" is gated on **a sim change**, not on art — a fact neither the brief nor the task states. | §9.2 |
| REQ-0262 §9.1: *"`element` … Not a field on a skill def at all"* | **CONFIRMED by independent measurement.** All **81** entries of `content/live/dungeon/skills.json` carry exactly `{id, name_en, name_ja, trigger, verb, attack_profile, modes}` (+ an optional `note`). **There is no `element` field.** It is not unwired; it does not exist. | §9.1 |
| REQ-0262 §9.3's 35-vs-36 telegraph gap | **Inherited and NOT chased**, but **neutralised**: emitting `skill` at `ray_fire`'s own site labels all 36 regardless of telegraphs, and §14.6 gates on **36**, not 35 — so the gap cannot hide inside this field. | §9.2 |
| `tools/inspect_kits.json` — kit routing (NEW finding) | **Routing is kind-granular** (`kit_registry.cjs:19`), so a kit cannot be scoped to a `role`. **But `kitParams` already passes `shape` (`:43-50`)** — so a **shape-aware kit is possible today** and nothing in the tree does it yet. `tiling.seam` uses it to no-op on `hit`. | §12.2.1 |
| `art_pipeline.md` §3's measured Anime-template failure | *"asked for a leather texture, it produced a stitched, black-outlined leather patch"*. **The same failure will hit a ray strip**: "bold outline" makes an *object*, and a beam is not an object. **`vfx` cannot reuse the Anime template**, and the correct template is a **user design ruling** (REQ-0175 recorded the identical gap: *"`gacha_pack` -> ???, a design question, not an inference"*). | §12.3 |
| `unit_icon_pipeline.md` §0: *"`target_px` 256×256, **`gen_px` 1024×1024**"* for units | **Dead.** `art_sizing.cjs:96` locks `unit` at **512×512**. The file's own SUPERSEDED banner covers it (*"generation sizes … out of date"*), so this is not a contradiction — but it is a stale number a reader will lift. Reported, not fixed (its art half is superseded wholesale by `art_pipeline.md`). | §3 |
