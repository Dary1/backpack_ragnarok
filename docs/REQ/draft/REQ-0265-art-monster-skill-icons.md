# REQ-0265 — art-monster-skill-icons: 81 skills, zero art — the batch, the law, and the 18-pixel problem

**Status:** draft — spec written, BLOCKED on user review. Three things need the user before work may
start: (1) §7 — **the badge is 18 px, and ratified golden G4's readability floor is 64 px.** The
badge is **3.6× below the floor of the law that governs every icon this program has ever shipped**;
the ratified Anime style layer makes illustrations, not 18-px pictograms, so either the direction
gains a `skill` template (a user design ruling — the direction was ratified by the user *looking at
results*) or the art will not read where the user asked to put it. (2) §6 — **new art kind `skill`
vs `custom`**, on which the two live precedents (REQ-0175 / REQ-0179) contradict each other, exactly
as in REQ-0264 §6. (3) §5.4 — the **batch is 81 assets** and the measured GPU cost is **~51 min to
~4.4 h**; a batch that size is a commissioning decision, not an implementation detail.
**Reserved:** 2026-07-18
**Slug:** art-monster-skill-icons
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — spec item (l), verbatim: 「モンスターの場合は、〇の中にスキル
アイコン(**存在しないので、要art向けのreq**)を書き…」.
**Depends on:** **REQ-0263** (expedition-instance-hud) — HARD, and twice: its **§8.2 layout rule** is
the only thing that fixes this art's target size (§7), and its **§8.3 placeholder** (the verb rune)
is this REQ's landing surface. **REQ-0151** (registry + sizing law), **REQ-0152** (kits), **REQ-0179**
(the `custom` kind — §6's alternative), **REQ-0211** (ruling 3's "configure it identically"
precedent, and the `gimic` defs that own 2 of the 81 skills).
**Relates to:** **REQ-0228** (dex-monster-skill-effects, `draft/`) — the natural consumer. §13 shows
they are complementary, and that **this REQ has a stake in REQ-0228's open (a)/(b) decision**.
**Blocks:** nothing. This REQ makes skill art POSSIBLE and specifies its batch.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §6.

## 1. Goal

Spec item (l) draws, per monster/gimic instance, one badge per skill: 「〇の中にスキルアイコン」 — a
skill icon inside a circle. **The icon does not exist.** REQ-0263 §8.3 verified it and shipped a
placeholder; this REQ creates the real thing as **registry art**.

**The deliverable is an ART REQUEST, so the only question that matters is: how many assets, at what
size, to what rule, checked how.** §5 answers the first (**81**), §7 the second (**256×256, consumed
at 18 px**), §8/§9 the third, §12 the fourth.

**Out of scope, explicitly:** the badge's circle, wedge, layout, overflow and frame-flash — **all
REQ-0263 §8**. Ray/hit VFX — **REQ-0264**. Skill *mechanics* in the Dex — **REQ-0228** (§13).
Generating any art — the user runs the art pipeline (PROJECT.md HANDS-OFF); this REQ never touches
`ComfyUI/`, `monster_matte_variants/`, a `*-artsession` worktree, or any GPU output.

## 2. The ruling that authorizes this

Brief §6, verbatim:

> Monster skill charge (l): a circle + skill icon, clockwise translucent-black charge, laid out
> top-right of the drawn art, one per skill, passives included. **Skill icons DO NOT EXIST** — art
> kinds today are `['po','si','unit','monster','bpskin','custom']`
> (`server/services/art_sizing.cjs` KINDS) (+`gimic` after REQ-0255's merge). -> art REQ-0265.

REQ-0263 §10 ("Out") assigns it here by name: *"**Real skill art / a `skill` art kind** — REQ-0265.
§8.3 ships the placeholder."*

## 3. Verified current state — every row measured, not assumed

| fact | source | evidence |
|---|---|---|
| there is **no `skill` art kind** | `server/services/art_sizing.cjs:24` | `const KINDS = ['po', 'si', 'unit', 'monster', 'bpskin', 'custom'];` (+`gimic` after REQ-0255) |
| **81 live skills, 81 unique ids** | measured, `content/live/dungeon/skills.json` | `schema: "skill/1"`; 81 entries; `len(set(ids)) == 81` |
| …and **`skills.json` is BYTE-IDENTICAL on the 0211 branch** | measured | `git diff HEAD req-0211-gimic-content-kind -- content/live/dungeon/skills.json` -> **empty**. **The batch size does not move when REQ-0255 merges REQ-0211.** §5.3 |
| **all 81 carry `name_en` AND `name_ja`** | measured | `missing name_en: 0`, `missing name_ja: 0` — §12 |
| …flat, **not** an `i18n` block | measured | `has i18n block: 0` of 81. Contrast `packs.json`, whose entries carry `i18n:{en:{name},ja:{name}}` — **two i18n dialects in one tree** (§16) |
| **all 81 triggers are `every_secs`** | measured | `{'every_secs': 81}` — **zero passives.** Confirms REQ-0263 §8.4 |
| the verb taxonomy is **closed at 6** | measured | `strike:30, apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2` = 81. **Confirms REQ-0263 §8.3 exactly** |
| **there is no `element` field** | measured | a live entry is `{id, name_en, name_ja, trigger, verb, attack_profile, modes}` (+ optional `note`). Confirms REQ-0262 §9.1 |
| `modes` is **80 battle + 1 unlock** | measured | the outlier is **`door_keeper_strike`** (`modes:["unlock"]`) — a gimic door skill. §5.2 |
| 44 live enemies; skills-per-enemy `{1:10, 2:33, 3:1}` | measured, `enemies.json` | **max 3 = `hrimgrimnir`**, footprint `[3,3]`. Confirms REQ-0263 §8.2 |
| 4 live gimics; skills-per-gimic `{0:2, 1:2}` | measured, `git show req-0211…:content/live/dungeon/gimics.json` | `trap_frost_deadfall`(1), `door_rimefast_stage1`(**0**), `door_rimefast_stage2`(1), `chest_frostbound_cache`(**0**) |
| **`packs.json` references ZERO skills** | measured | `monster_pack/1`, 14 entries; a member is `{"enemy":"frost_gnoll","at":"B2"}`. **Packs reference ENEMIES, not skills.** §5.2 |
| every enemy IS placed by some pack | measured | 44 of 44; **0 orphans** — §5.3 |
| `si` is locked **256×256** | `art_sizing.cjs:87-88` | `case 'si': return { width: 256, height: 256 };` — §7.2 |
| `si.subject_frame` is authored **for 256×256** | `tools/inspect_kits.json`; `art_pipeline.md` §8 | *"single-centered-subject + margin for 256×256 SIs"*; [S7]: content 0.03–0.92, largest_component ≥ 0.80, centroid_offset ≤ 0.25, margin ≥ 0.02 |
| `custom` routes to **ZERO** kits | measured, `tools/inspect_kits.json` | no kit lists `custom` in `applies_to` — §6.2 |
| **G4 — readability floor is 64 px** | `docs/llm_managed/unit_icon_pipeline.md` §1 | *"The silhouette must be identifiable at **64 px** (one board cell). … unreadable at 64 px = **FAIL**."* — §7.3 |
| **G2 — no gameplay state in art** | same | *"Connection shapes, **charge progress**, link rays, team/enemy tint are renderer overlays. An icon containing an arrow, **gauge**, or beam is a **FAIL regardless of beauty**."* — §8 |
| **G7 — the charge overlay is RESERVED to the renderer** | same | *"The Unit charge-state overlay is a ring fill…, renderer-drawn per G2… **Reserved here so no icon bakes in ring-like framing that would collide with it**"* — §8 |
| the Anime template forces an **outline** | `tools/art_style.py`; `art_pipeline.md` §3 | `{prompt} anime++, bold outline, cel-shaded coloring, shounen, seinen`; `KIND_TEMPLATE = {"item":"anime","unit":"anime","monster":"concept_art_fantasy"}` |
| the style map is closed at 4 art kinds | `tools/art_job.py:15` | `KIND_TO_STYLE = {"po":"item","si":"item","unit":"unit","monster":"monster"}` — `custom` deliberately absent |
| export path is `content/art/<kind>/<system_name>.png` | `server/services/art_export.cjs:39-41` | `path.join(exportRoot(), adopted.kind)` + `system_name + '.png'` |
| art resolution is **kind-generic** and exact-name capable | `server/lib/content.cjs:230-240` | *"`resolveItemArtNames` is kind-generic (def.artwork_ref adopted -> exact-name adopted -> omitted) and monster artworks follow the exact-name convention (artwork system_name == enemy id)"* — §10 |
| `computeArtUrls` joins items/sis/tms/**monsters** — **not skills, not gimics** | `server/lib/content.cjs:226-249` | the one-line widening §10 owns; the gimic half is REQ-0259's (REQ-0261 §8.6) |
| the badge is **18 px** at `EXP_CELL=40` | REQ-0263 §8.2 | `EXP_BADGE_D = clamp(cellPx * 0.45, 12, 20)` — §7.1 does the arithmetic |
| the GPU box swaps per prompt | `art_pipeline.md` §2 | RTX 2080, **8 GB**: cold **450–540 s**; **prompt change 30–170 s**; same prompt 2–20 s. **"group work by prompt"** — §5.4 |

## 4. THE MEASUREMENT — the batch size, and how it was counted

**An art REQ that does not say how many assets it needs is not actionable.** So this was counted, not
estimated, across every source the task names.

**Method.** Parsed `content/live/dungeon/skills.json` (the def source, `skill/1`), then took the
union of every skill id referenced by `enemies.json` (`enemy/1`), the gimic defs
(`git show req-0211-gimic-content-kind:content/live/dungeon/gimics.json`, `gimic/1` — **the real
file, not the `entities.json` proxy**), and `packs.json` (`monster_pack/1`).

```
skills.json (skill/1)                                   81 entries, 81 unique ids
  referenced by enemies.json    (44 enemies)            79 distinct skill ids
  referenced by gimics.json     (4 gimics, 0211 branch)  2 distinct skill ids
  referenced by packs.json      (14 packs)               0   <-- packs reference ENEMIES, not skills
  ------------------------------------------------------------
  UNION                                                 81
  skills.json ids NEVER referenced                       0
  referenced but absent from skills.json (dangling)      0
```

**The surface closes exactly.** 79 + 2 = 81 = every entry in `skills.json`. **There is no dead
content to skip and no dangling reference to chase.**

### 4.1 THE ART BATCH SIZE IS **81**

```
81 skill icons.  One per skill id.  1:1, no variants, no rarity frames, no per-monster reskins.
```

**Every one is needed, and that is a measured claim, not an assumption:**
- **0 unreferenced skills** — nothing in `skills.json` is dead weight.
- **0 orphaned enemies** — all 44 live enemies are placed by the 14 live packs, so **all 79
  enemy-side skills are reachable in play**.
- **2 gimic-side skills** (`trap_deadfall_volley`, `door_keeper_strike`) are reachable only through
  gimics, which is why §5.2 matters.

### 4.2 The 2 skills you only find by reading the gimic defs

**`packs.json` contributes ZERO skill ids** — a member is `{"enemy": "frost_gnoll", "at": "B2"}`.
**Packs reference enemies; enemies reference skills.** So packs are a *reachability* check (they prove
all 44 enemies are live), never a *source* of skill ids. **The task's premise — "referenced by
`enemies.json` + the gimic defs + `packs.json`" — is right to look, and `packs.json` yields nothing;
the correction is that its real contribution is reachability** (§16).

**The 2 skills that exist ONLY because gimics exist:**

| skill | owner | why it is easy to miss |
|---|---|---|
| `trap_deadfall_volley` | `trap_frost_deadfall` (`behavior:trap`, `masked:true`) | reachable only via a **masked** gimic; **no enemy references it** |
| `door_keeper_strike` | `door_rimefast_stage2` (`behavior:hidden_door`, `mode:unlock`) | **the only skill in the tree with `modes:["unlock"]`** — 80/81 are `["battle"]`. Its own `note` says it is *"Included for completeness/symmetry"* |

**Counting from `enemies.json` alone gives 79 and silently drops both.** REQ-0259 unifies monsters and
gimics as `IBattleInstance`; **the art batch must be unified too, or 2 of 4 live gimics badge with a
placeholder forever** — and one of them is a *trap*, i.e. the thing a player most needs to read.

### 4.3 The batch is stable across the merge — verified

`git diff HEAD req-0211-gimic-content-kind -- content/live/dungeon/skills.json` is **empty**. REQ-0211
was a *rename + one added field* on the gimic side and it says so (*"the 12 replay goldens are
UNMOVED"*). **So 81 is 81 before and after REQ-0255 merges 0211**, and this batch can be commissioned
without waiting for the merge. **That is a real scheduling fact** and it is the reason §5.4's cost can
be quoted now.

### 4.4 What 81 costs on the box — measured, because "81 icons" is not a plan

`art_pipeline.md` §2 is explicit: **"group work by prompt"**, because a prompt change reloads the
Qwen3-4B text encoder on an 8 GB card. **81 skills = 81 distinct prompts = 80 unavoidable prompt
changes**, and that term dominates:

| N candidates/skill | renders | GPU time (measured bounds) |
|---|---|---|
| 2 | 162 | **51 min – 4.4 h** |
| 3 | 243 | **54 min – 4.8 h** |
| 4 | 324 | **56 min – 5.3 h** |

`= cold(450–540 s) + 80 × prompt_change(30–170 s) + 81×(N−1) × same_prompt(2–20 s)`

**Two consequences the operator needs before starting, not after:**

1. **Candidates are nearly free; skills are not.** Going from N=2 to N=4 adds **~5 min** at the low
   bound. **The marginal cost of a 4th candidate is ~2–20 s; the marginal cost of one more skill is
   30–170 s.** So: **generate generously per skill** — the gallery verdict (§7 S7) is the bottleneck,
   not the GPU.
2. **The matte phase must be separate.** `art_pipeline.md` §2: rembg `alpha_matting` peaks at
   **12–13 GB RSS** and *"will not fit beside a resident model. … This OOM has killed three runs."*
   So: `--no-matte`, **stop ComfyUI**, `--rematte-only`. **81 icons is exactly the batch size where
   forgetting this wastes hours.**

## 5. The kind decision — **USER RULING REQUIRED**

### 5.1 The same board contradiction REQ-0264 §6.1 hits

| REQ | state | ruling |
|---|---|---|
| **REQ-0175** | `draft/`, "CLEARED TO IMPLEMENT" | user, 2026-07-14: **「The art KIND itself — Add it — required, not optional」**, locked 768×768, *"exactly as `unit` is locked at 512"* |
| **REQ-0179** | `built/` | user, 2026-07-15: add `custom` *"so a custom artwork can be assigned 'just as a texture' to content that has no art-kind of its own"* — and REQ-0179 step F names **`skill_def`** explicitly as a picker target |

**REQ-0179 step F is the sharpest evidence available and it cuts both ways.** Verbatim: *"The artwork
picker's `typeChips` gains `'custom'` … so a `gacha_pack` / `tm_def` / **`skill_def`** def can filter
to and link a custom artwork."* **A skill def linking a `custom` artwork is already an anticipated,
shipped, working path** (`client/src/contentadmin/Workspace.tsx:56`). So `custom` is not a hack here —
**it is the documented intent, and it works today.** But REQ-0175 ruled that when an asset class has a
law, it gets a kind anyway. **Both are live. An LLM may not pick between two user rulings** (§16).

### 5.2 The discriminator, and how `skill` scores on it

REQ-0264 §6.2 extracts the rule both precedents obey: **a kind exists when the asset has a LAW;
`custom` exists when it does not.** Applied:

| property | law? | consequence under `custom` |
|---|---|---|
| **size** | **YES** — one locked square for all 81 (§7.2) | 81 artworks, each with an operator-typed resolution. **81 chances to type 250 instead of 256.** The registry is the system of record for a *batch*; a batch with 81 hand-typed sizes has no law |
| **a machine check** | **YES** — `si.subject_frame` (single centred subject + margin, **authored for 256×256**) and `matte.coverage_band` are *exactly* this asset's checks, and they exist | **`custom` routes to ZERO kits** (measured). 81 assets ship with **no** machine inspection of any kind |
| **style coherence (G5)** | **YES, and it is the binding one at this scale** — 81 icons must read as ONE set | `custom`'s prompt is a **passthrough with no template** (`art_job.py:96-101`). **81 hand-carried styles is how a roster drifts.** G5: *"A character that does not sit in the roster lineup is a FAIL even if beautiful alone"* |
| **an authoring golden** | **YES** — §8's G2/G7 rule is *specific to this asset class* | nowhere to hang it |

**The scale is what settles it.** For **one** texture, `custom` is right — that is REQ-0179's case and
its reasoning is sound. For **81 assets that must share a size, a style, a kit and a golden**,
`custom` means *"the law exists but nothing enforces it, 81 times"*.

### 5.3 ADOPTED: art kind **`skill`**, configured **identically to `si`** — REQ-0211 ruling 3's move

> **Art kind `skill` == art kind `si`, configured identically.**

Directly modelled on REQ-0211 ruling 3 (*"Art kind `gimic` == art kind `monster`… same sizing law,
same prompt default, same shape editor — configured identically"*), implemented the same way: a
**stacked case** in `art_sizing.cjs` (`case 'skill': case 'si':`), not a copied constant.

**Name.** The art kind is the bare noun; the content kind is `<noun>_def`. `po` art ↔ `po_def`
content; `si` art ↔ `si_def`; **`skill` art ↔ `skill_def`** (migration `010_content_kind_skill_def.sql`).
**Perfectly in-pattern, and no ENUM collision** — `artwork_kind` and `content_kind` are different types.

### 5.4 Is a monster skill icon the same asset class as a PLAYER PO icon? — **Argued: NO for content, YES for law**

The task asks this directly, and it has two halves with different answers.

**As CONTENT: no, and the difference is structural, not thematic.**

| | **PO — Placement Object** (`item_content_pipeline.md` §0.1) | **skill icon** |
|---|---|---|
| what it is | a **thing the player owns and places** on an 8×8 canvas | a **symbol for an ability** an instance fires |
| geometry | **has a cell footprint.** `po`'s size *derives from* a 5×5 shape mask at 256 px/cell (`art_sizing.cjs:84-86`) | **occupies no cells.** It has no footprint and never touches a board |
| authority | REQ-0188: **the art is authoritative** for the def's cell shape; `derive --write` propagates art -> def | **there is nothing to derive.** A skill has no shape field to be authoritative over |
| conditioning | `shape_lock` (REQ-0183/0186) conditions generation on the mask — **po-only** (`art_job.py:po_shape_mask` returns `None` for any other kind) | **not applicable, and could not be** |
| sprite sheet | POs/SIs also live as `<symbol>`s in `content/sprite_all_v12.svg` | **no symbol exists, and none should** — §11 |

**So: a skill icon is NOT a PO.** Giving it the `po` law would mean drawing a 5×5 cell mask for a
thing with no cells — the same category error REQ-0264 §8.3 rejects for VFX, and with the same
consequence: `shape` jsonb would carry a permanent falsehood that REQ-0188's doctrine then treats as
*authoritative*.

**As LAW: yes — it is an `si`, and that is exactly why `si` is the right template.**

| | `si` — Socket Item | `skill` |
|---|---|---|
| geometry | **no shape.** `deriveSize('si', null)` — locked 256×256 (user ruling 8, REQ-0151) | **no shape.** Identical |
| composition | one centred subject with margin — `si.subject_frame` | one centred symbol with margin — **identical** |
| consumed at | a socket chip | an 18 px badge / a Dex chip |
| matte | `matte.coverage_band` | identical |

**`si` is the one existing kind whose LAW is "a locked square with no geometry".** That is precisely
what a skill icon is. **So: reuse `si`'s law verbatim; do not reuse `po`'s.** The player's POs having
icons is true but is **not** the relevant precedent — the relevant precedent is the kind that already
solved *"a small centred square with nothing to derive"*.

### 5.5 The alternatives

- **(A) RECOMMENDED — kind `skill`, configured identically to `si`.** Costs one ENUM migration + the
  REQ-0179 checklist. Buys the locked size, two existing kits, a style template hook, and a place to
  hang §8's golden. Follows REQ-0175 **and** REQ-0211 ruling 3.
- **(B) `custom`.** Ships today, zero migration, and **REQ-0179 step F already anticipated
  `skill_def` linking a custom artwork.** Costs: no kit, no size law, no template — **81 times**
  (§5.2). Defensible if the user reads REQ-0179 as superseding REQ-0175.
- **(C) `si` itself, with no new kind.** Rejected: it would make 81 non-items into "Socket Items" in
  every filter, every Dex query and every `content/art/si/` export dir. **The law is right; the
  identity is not.** This is the distinction REQ-0211 drew when it gave `gimic` its own kind *while*
  giving it `monster`'s law verbatim — the exact precedent.

## 6. Sizing — the law, and the arithmetic REQ-0263 forces

### 6.1 What the badge actually is — the arithmetic, done

REQ-0263 §8.2's ratified rule, verbatim: `EXP_BADGE_D = clamp(cellPx * 0.45, 12, 20)`, at REQ-0260's
`EXP_CELL = 40`:

```
EXP_BADGE_D = clamp(40 * 0.45, 12, 20) = clamp(18.0, 12, 20) = 18 px      <-- the circle
icon inscribed in that circle        = 18 / sqrt(2)          = 12.7 px    <-- the ART
  DPR 1 -> circle 18 device px, icon 13 device px
  DPR 2 -> circle 36 device px, icon 25 device px
  DPR 3 -> circle 54 device px, icon 38 device px
```

**The art is consumed at 12.7–18 logical px** (25–38 device px on a typical 2–3× display). And REQ-0263
§8.2 draws a **clockwise translucent-black wedge over it** — so at any moment an arbitrary fraction of
those 13 px is **covered in black at α=0.55** (`EXP_CD_OVERLAY_ALPHA`, REQ-0263 §6.1).

### 6.2 The law: **locked 256×256 — `si`'s, verbatim**

```js
// server/services/art_sizing.cjs
const KINDS = ['po', 'si', 'unit', 'monster', 'gimic', 'bpskin', 'custom', 'skill'];

case 'skill':
case 'si':
  return { width: 256, height: 256 };     // REQ-0211 ruling-3 style: a STACKED case, not a copy
```

| decision | derivation |
|---|---|
| **locked, not derived** | a skill has no shape (§5.4). Like `si`/`unit`/`bpskin`, and like REQ-0175's ruled `gacha_pack` |
| **256** | **it is `si`'s existing number** — no new constant enters the law, and `si.subject_frame`'s [S7] thresholds (*authored "for 256×256 SIs"*) transfer with **zero re-calibration** (§10). 256/18 = **14.2× downscale headroom** for the badge, and it still serves a Dex chip (§13) at 4–8× |
| **/16-legal** | 256/16 = 16. `snap16` is a no-op; the law is exact |

### 6.3 Why the 128 px/cell monster/gimic law is WRONG here — as the task suspected

The task's suspicion is correct, and the reason is the same one REQ-0264 §8.3 gives for VFX:

- **`monster`'s law reads a CELL FOOTPRINT** (`{w,h}`, each 1..12, ×128 px/cell — `art_sizing.cjs:90-95`).
  **A skill occupies no cells.** `{w:1,h:1}` -> 128×128 would enter a **lie** into `shape` jsonb, and
  under REQ-0188 (*"the art is authoritative"*) that lie becomes **authoritative** for a footprint the
  skill does not have.
- **128×128 is also just too small**: 128/18 = 7.1× headroom for the badge, and **only 2.7–5.3× for a
  Dex chip** (§13). `si`'s 256 costs nothing extra (the GPU cost is dominated by the **prompt change**,
  not the pixel count — §4.4) and leaves room for every future consumer.
- **The drift hazard is live, not theoretical.** `frost_gnoll`'s def footprint is **`[1,1]`**
  (measured) while its art shape is **`{w:3,h:4}`** (errata) — a **12× area disagreement**, shipping
  today, because REQ-0188 was ratified and **`derive --write` was left unrun**. **A kind with no shape
  cannot drift from a board it never touches.**

## 7. THE 18-PIXEL PROBLEM — **USER RULING REQUIRED**

**This is the finding that decides whether this REQ's art is worth generating**, and it is arithmetic,
not taste.

### 7.1 The badge is 3.6× below the floor of the law that governs every icon we ship

**G4**, `unit_icon_pipeline.md` §1 (ratified 2026-07-12, ALL GREEN), verbatim:

> **G4 — Cell-size readability.** The silhouette must be identifiable at **64 px** (one board cell).
> Proposal galleries show every candidate at 256 px AND 64 px side by side; **unreadable at 64 px =
> FAIL.**

```
G4's floor        : 64 px
this badge        : 18 px       ->  3.6x BELOW the floor
the art within it : 12.7 px     ->  5.0x BELOW the floor
```

**G4 is not a stylistic preference; it is a FAIL condition, and it was ratified against 64 px because
that is one board cell.** The expedition badge is **a fifth of a board cell.** No golden in the
program has ever asked art to survive that.

### 7.2 The ratified style layer does not make things that read at 18 px

- `KIND_TO_STYLE` maps `si`/`po` -> the **Anime** template: `{prompt} anime++, **bold outline**,
  cel-shaded coloring, shounen, seinen`.
- **The pipeline has already measured this template producing the wrong class of object** in a
  neighbouring case: *"The Anime template's 'bold outline' + cel-shading turn a fill brief into a
  discrete bordered OBJECT: asked for a leather texture, it produced a stitched, black-outlined
  leather patch"* (`art_pipeline.md` §3).
- An anime icon at 256 px carries interior detail — cel shading, a bold outline, a rendered subject.
  **Downsampled 14.2× to 18 px, interior detail is noise and the bold outline is most of the
  remaining pixels.** The result is a coloured blob with a dark rim. At 12.7 px, under a black wedge
  at α=0.55, it is a smudge.

**What reads at 18 px is a PICTOGRAM**: one shape, one colour, high contrast, no interior detail —
heraldry, not illustration. **The ratified direction does not produce that**, and the direction was
ratified 2026-07-13 **by the user looking at results in InvokeAI**. **An LLM may not re-direct the
art.** REQ-0175 recorded the identical gap for `gacha_pack` and left it open in the same words:
*"`gacha_pack` -> **???**, a design question, not an inference."*

### 7.3 The uncomfortable corollary: **at 18 px, REQ-0263's placeholder may beat this REQ's art**

REQ-0263 §8.3 ships a **verb-class rune** (`ᛊ` strike / `ᛁ` apply_status / `ᛉ` bonus_vs_status /
`ᚢ` lifesteal / `ᚺ` multi_strike / `ᛒ` heal_ally), drawn in `--f-rune`, and claims this REQ *"closes
exactly that gap by replacing glyph -> art per skill id, one map, no layout change."*

**At 18 px, that claim deserves challenge, and this REQ makes it rather than quietly inheriting it.**
A rune is a **font glyph**: hinted, pure-vector, one colour, maximal stroke contrast — **engineered to
be legible at small sizes.** A 14.2×-downsampled illustration is not. **So REQ-0263's placeholder is
probably MORE legible at 18 px than any raster this REQ can commission** — while carrying far less
information (30 of 81 skills share `ᛊ`, as REQ-0263 §8.3 honestly states).

**That is the trade the user must actually rule on**: *identity at low legibility* (81 distinct icons,
each a blob at 18 px) versus *class at high legibility* (6 runes, each crisp, 30 skills sharing one).

**Options:**

- **(A) RECOMMENDED — a `skill` style template in the PICTOGRAM direction, and commission the 81.**
  A new `KIND_TEMPLATE` entry (§10.3): flat, single-colour, high-contrast, no interior detail, no
  outline — a **heraldic/glyph** grammar, closer to `FILL_STYLE`'s "say what it is positively" posture
  than to Anime's. Then art wins at every size and the rune retires. **Cost: a new art direction the
  user must see and ratify (S7), and §12's legibility gate must pass at 18 px.**
- **(B) Icons for the DEX; runes on the BADGE.** Commission the 81 for REQ-0228's Dex surface (where
  they are shown at 4–8× and an illustration is *right*), and **keep REQ-0263's rune at badge size.**
  Honest, cheap, and it makes 18 px the rune's job — which it is good at. **Cost: (l)'s
  「〇の中にスキルアイコン」 is served by a *rune*, not an *icon*, so the user's literal ask is not met
  at the place they asked for it.**
- **(C) Commission the 81 under the existing Anime template and put them on the badge anyway.**
  **NOT RECOMMENDED, and named so it is not arrived at by default:** it spends **51 min – 4.4 h** of
  GPU and an 81-image S7 review to put blobs where a crisp rune already is, and it **fails G4 by 3.6×
  with no golden amended to permit it**.
- **(D) Raise `EXP_BADGE_D`.** Rejected — **it does not fit.** REQ-0263 §8.2 measured `rime_shaman`
  (`[1,1]`, 2 skills) fitting *"by 2px"*: `2×20−2 = 38 ≤ 40`. `EXP_BADGE_D` is already at its
  `clamp(...,12,20)` ceiling's practical limit; enlarging it clips a live enemy's second badge.
  **Recorded because "just make it bigger" is the first thing anyone will say, and the content says no.**

**§7 is the ruling this REQ most needs**, because it decides whether the batch in §4.1 is commissioned
at all. **(A) and (B) are both honest; (C) is not.**

## 8. G2 / G7 DISCIPLINE — the hard authoring rule, and why it is not pedantry

### 8.1 The rule

> **S2 — NO GAMEPLAY STATE IN A SKILL ICON.** No ring. No circle. No arc. No gauge. No frame. No
> border. No countdown. No cooldown sweep. No charge indicator. **An icon that bakes in ring-like or
> frame-like framing is a FAIL regardless of beauty.**

This is **G2 verbatim** (*"Connection shapes, **charge progress**, link rays… are renderer overlays.
An icon containing an arrow, **gauge**, or beam is a FAIL regardless of beauty"*) plus **G7's
reservation**, applied to a new asset class.

### 8.2 Why — the collision is mechanical, and REQ-0263 built the thing it collides with

**G7's purpose, verbatim:** *"**Reserved here so no icon bakes in ring-like framing that would collide
with it**; implementation belongs to REQ-0125."*

**G7 reserved a ring around a Unit icon. REQ-0263 §8.1 now draws exactly that around a SKILL icon:**

- **a circle** (「〇の中にスキルアイコン」 — the circle is the badge, and it is **the renderer's**), plus
- **a clockwise translucent-black charge wedge** (`EXP_CD_OVERLAY_FILL=0x000000`,
  `EXP_CD_OVERLAY_ALPHA=0.55`, swept from `RING_START_ANGLE=-PI/2`), plus
- **a frame that lights on fire** (`EXP_FIRE_FLASH_MS=150`).

**So the renderer draws a circle, a sweeping arc, and a flashing frame — on top of an 18 px disc.**

**An icon that bakes in a ring collides three ways, and each is a real bug:**

1. **Double ring.** A baked rim + the badge circle = two concentric rings ~1 px apart at 18 px. That
   does not read as "framed"; it reads as **aliasing**.
2. **The charge wedge becomes unreadable — the load-bearing failure.** The wedge's *entire* job is to
   show *how much* time remains, by **how far around it has swept**. It is black at α=0.55 over the
   icon. **If the icon already has a dark ring, the wedge's leading edge has nothing to contrast
   against and the sweep's position — the only information it carries — is lost.** REQ-0263 §6.1's
   control degrades to noise, and it degrades *silently*: the badge still looks fine in a static
   screenshot.
3. **The fire-flash frame has nothing to brighten.** REQ-0263 §7.2 brightens *the frame* for 150 ms.
   A baked frame cannot be brightened — those are pixels. The user's 「ちゃんと発動したら光る」 —
   *confirmation that it fired* — **silently does not happen**.

**This is why S2 is a FAIL and not a preference: a baked ring does not make the badge ugly, it makes
the badge LIE.** It shows a control that is not tracking anything. That is exactly the class of harm
G2 exists to prevent, and G7 anticipated the mechanism **six days before REQ-0263 built the collision**.

### 8.3 The other authoring rules

- **S1 — art_golden applies unchanged.** Aspect inviolable (1:1); illustration-first; approved before
  wired.
- **S3 — one centred subject, with margin.** Machine-checked by `si.subject_frame` (§10). A skill icon
  is **not** a scene: no background, no ground plane, no character holding the thing.
- **S4 — legible at 18 px** — **G4's floor, lowered to this badge's reality** (§7.1). The gallery
  **must** show every candidate at **256 px AND 64 px AND 18 px**, side by side — G4's own
  "256 AND 64" rule, extended to the size this art is actually used at. **A candidate that dies at
  18 px is a FAIL**, however good it looks at 256.
- **S5 — roster coherence (G5).** **81 icons must read as one set.** At this batch size, G5 is the
  binding golden, not a nicety: *"A character that does not sit in the roster lineup is a FAIL even if
  beautiful alone."*
- **S6 — no text, no numbers, no letters.** 81 icons at 18 px; a baked glyph is illegible **and** it
  would need 81 × 2 localisations (§12). The name is `name_ja`/`name_en`, and it lives in the tooltip.

## 9. The placeholder and the fallback — REQ-0263's choice, cited, not re-litigated

### 9.1 What ships BEFORE this art lands: REQ-0263 §8.3's verb-class rune

**REQ-0263 §8.3 chose it and this REQ adopts its choice**, per the task's instruction:

```
strike           (30/81) -> ᛊ     apply_status  (27/81) -> ᛁ
bonus_vs_status   (9/81) -> ᛉ     lifesteal      (7/81) -> ᚢ
multi_strike      (6/81) -> ᚺ     heal_ally      (2/81) -> ᛒ
```

Drawn in `--f-rune` (`styleguide.html:36`), collision-checked by REQ-0263 against both the nav set
(`ᚨ`表題 `ᛗ`編成 `ᚱ`遠征 `ᚷ`倉庫 `ᚲ`図鑑 `ᛈ`工房 `ᚠ`市場 `ᛏ`殿堂) and REQ-0240 M4's class glyphs
(`ᚦ`/`ᚷ`/`ᛞ`). **Independently confirmed here:** the verb distribution is **exactly** `{strike:30,
apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2}` = 81 (measured, §3), so
REQ-0263 §8.3's map is complete and total over the live surface — **there is no 7th verb and no skill
without a glyph.**

**The seam is `client/src/expedition/skillGlyph.ts`** — REQ-0263 §10.2 built it as *"The single seam
REQ-0265 replaces"*, and its AC-8 is *"Swapping `skillGlyph.ts` for a stub changes every icon with
**no** change to `ExpeditionHudLayer`"*. **This REQ registers a resolver; nothing else moves** — the
same `chargeRing.ts` posture REQ-0262 §9.2 names.

**§7.3 challenges whether the rune should ever retire at badge size. That is §7's ruling, not a
re-litigation of §8.3's choice** — the rune is the right placeholder either way.

### 9.2 The fallback chain — never blank, never crash

```
iconFor(skillId):
  1. art_urls[skillId]  (adopted artwork, exact-name -- s10)   -> the raster
  2. skillGlyph(verb)   (REQ-0263 s8.3's rune)                 -> ALWAYS RESOLVES (s9.1: total over 6 verbs)
  3. the badge with no glyph                                   -> still correct
```

**Step 2 cannot miss**, because the verb map is total over the live surface (§9.1) and `verb.t` is on
every def. **Step 3 is still not blank**, and REQ-0263 §8.3 says why: *"the badge is not blank even
without the glyph: it still carries a live countdown wedge, so it already communicates 'something
fires in N seconds'; the glyph adds what kind."*

**Four ways it can be empty, each degrading:**

| condition | behaviour |
|---|---|
| **files backend** (`STORAGE_BACKEND !== 'pg'`) -> `computeArtUrls` returns `{}` (`content.cjs:227`) | step 1 misses -> **the rune**. This is the **normal dev/e2e path** (REQ-0263 AC-9), not an error |
| no artwork adopted for a skill | the rune. **This is the state of 81/81 skills on day one**, and of any skill authored after the batch |
| a 404 / bad decode | the rune; logged once, never retried per-frame (REQ-0262 §12.2's posture) |
| a **new** 7th verb is authored | **step 2 breaks.** §12 gate 7 fires at content-check time so it is caught in CI, not on screen |

## 10. Resolution: one line, and it is measured safe

**The exact-name convention already exists and is kind-generic.** `server/lib/content.cjs:230-240`,
verbatim: *"`resolveItemArtNames` is kind-generic (**def.artwork_ref adopted -> exact-name adopted ->
omitted**) and monster artworks follow the exact-name convention (**artwork system_name == enemy id**
— REQ-0184/0188), so no new resolver is needed."*

**So: `artwork.system_name == skill.id`.** `gnoll_claw` the artwork ↔ `gnoll_claw` the skill. **No new
resolver, no naming scheme, no `icon` field on `skill/1`.** (Contrast REQ-0264 §11.1, where VFX have
no def and *must* invent a composed name. A skill **has** a def, so it inherits the convention.)

**The one-line widening:**

```js
// server/lib/content.cjs computeArtUrls() -- the name set gains skill ids.
Object.keys(monstersFromCore().monsters || {}),
Object.keys(skillDefsById || {})            // REQ-0265: 81 skill ids join the resolved map
```

**This is the same one-line move REQ-0259 owns for gimics** (REQ-0261 §8.6 found `computeArtUrls`
joins `monstersFromCore().monsters` only, so gimic ids never join `art_urls`). **Recorded as a
parallel, not duplicated** — REQ-0259 owns the gimic line; this REQ owns the skill line.

### 10.1 The collision risk — measured, and it is ZERO

`art_urls` is **ONE FLAT MAP keyed by bare id**. Adding 81 ids to a map shared with items/sis/tms/
monsters is only safe if no id collides — **a silent overwrite would swap a monster's portrait for a
skill icon.** So it was measured, not assumed:

| namespace | ids | collisions with the 81 skill ids |
|---|---|---|
| `enemies.json` | 44 | **0** |
| gimics / `entities.json` | 4 | **0** |
| `dungeon/items.json` | 2 | **0** |
| `live_items.json` (po) | 8 | **0** |
| `live_sis.json` (si) | 6 | **0** |
| `live_units.json` | 54 | **0** |
| **union of every other id namespace** | **118** | **0** |

**Zero collisions across all 118 ids. The widening is safe, and now it is safe *by evidence*.**
§12 gate 6 pins it against future content drift.

## 11. Scope

**In:**

1. `server/migrations/0NN_artwork_kind_skill.sql` — **NEW.** `ALTER TYPE artwork_kind ADD VALUE IF
   NOT EXISTS 'skill';` (top-level; `IF NOT EXISTS`; REQ-0179/0211's precedent). **Number fixed at
   implementation time — see §14's collision finding.**
2. `server/services/art_sizing.cjs` — `KINDS += 'skill'`; the **stacked** `case 'skill': case 'si':`.
3. `server/routes/art.cjs` — `shapeAndSize`: `skill` falls to the shapeless branch (`return {shape:
   null, size: deriveSize(kind, null)}`) — **no edit needed, it is already the default path**;
   `defaultsForKind('skill')` -> §7's ruled template.
4. `tools/art_job.py` + `tools/art_style.py` — `KIND_TO_STYLE += {"skill": ...}` and, **iff §7 rules
   (A)**, a new pictogram `KIND_TEMPLATE` entry.
5. `tools/inspect_kits.json` — `matte.coverage_band` and `si.subject_frame` gain `skill`; **NEW**
   `skill.badge_legibility` v1 [S7] (§12.5). **No `kit_version` bump** — adding a kind to `applies_to`
   is neither *"a threshold nor an algorithm change"* (the manifest's own rule), so existing `si`
   inspections must **not** go stale. §12 gate 8.
6. `client/src/artadmin/*` — `artShared.ts` (`Kind`/`KINDS`/`deriveSizeClient`/`defaultTemplate`),
   `CreatePanel.tsx`, `Workspace.tsx`, `ArtAdminPage.tsx`, `artadmin.css` (`.aa-kind--skill`).
   **`ShapeEditors.tsx` needs NO branch** — `skill` is shapeless, like `si`.
7. `client/src/contentadmin/Workspace.tsx:56` — `typeChips` gains `'skill'`, so a **`skill_def`** can
   link its artwork explicitly via REQ-0174's `artwork_ref` (the belt to exact-name's braces).
   **REQ-0179 step F already anticipated `skill_def` in this picker** (§5.1).
8. `server/lib/content.cjs` — §10's one-line widening of `computeArtUrls()`'s name set.
9. `client/src/expedition/skillGlyph.ts` — **REQ-0263's file.** Gains §9.2's step 1 (raster) ahead of
   its rune. **The rune is not deleted** — it is the fallback, and (per §7 (B)) possibly the permanent
   badge.
10. **Art request (for the user's pipeline, NOT run here): 81 icons**, 256×256, one per skill id,
    named `<skill_id>`. §4.4 is the operator's cost sheet.

**Out:**

- **The badge's circle / wedge / layout / overflow / `+N` collapse / frame-flash** — REQ-0263 §8.
- **Ray + hit VFX** — REQ-0264.
- **Skill MECHANICS in the Dex** — REQ-0228 (§13). This REQ ships **art**; that REQ ships **facts**.
- **A `skill_def` catalog tab in the Dex** — REQ-0228's option (b) territory (§13).
- **Widening `computeArtUrls` for GIMIC ids** — REQ-0259 (REQ-0261 §8.6). §10's line is the **skill**
  line only.
- **A `<symbol>` in `content/sprite_all_v12.svg`.** Skill icons are **registry rasters**, like
  monsters (`itemIconRasters()` -> `item:<id>`), not sprite-sheet symbols. The SVG sheet is the
  legacy PO/SI/unit route. **Stated because "add it to the sprite sheet" is the reflex** and it
  would fork the resolution path.
- **Generating / matting / adopting any image** — the user runs the art pipeline (HANDS-OFF).
- **Per-monster skill reskins / rarity frames** — 81 is **1:1 with skill ids**. Not commissioned.
- **Resolving REQ-0175 vs REQ-0179** (§5.1) — a board contradiction; reported (§14).
- **Amending G4** (§7.1) — a ratified golden; the user's.
- **Running `derive --write`** for REQ-0188's `frost_gnoll` drift (§6.3) — reported; REQ-0188's.
- **`docs/user_managed/*`** — forbidden, and nothing here needs it.

## 12. Gates

**E2E ports (rule: `5000 + REQ*10 + index`): `7650` static / `7651` api / `7652` proxy.** Reserved by
the numbering rule and machine-enforced by `tools/check_e2e_ports.cjs`. **Per ruling Q2
(「e2eを通す必要はない」) E2E is NOT a gate for this program, so no harness is built and the decade is
left unused** — the same posture REQ-0262 §14, REQ-0263 §11 and REQ-0264 §14 take.

Gates that DO apply:

1. **The sizing law (REQ-0179's G2 test, extended).** `deriveSize('skill', null)` === `{256,256}`;
   `deriveSize('skill', {w:1,h:1})` **still** === `{256,256}` — **a shape must be IGNORED, not
   honoured**. That asymmetry is the gate: it pins §6.3's ruling that a skill has no geometry, so no
   future edit can quietly give it one.
2. **THE BATCH IS COMPLETE — the gate this REQ exists for.** For **every** id in `skills.json`, an
   artwork named `<skill_id>` exists and is adopted: **81/81**. And the reverse: no `skill` artwork
   exists whose name is not a live skill id. **A batch REQ whose completeness is not machine-checked
   is a spreadsheet.**
3. **The union is still 81.** Recompute `union(enemies.skills, gimics.skills, packs)` vs
   `skills.json` ids; assert **0 unreferenced, 0 dangling, 81 total**. **Fires the moment content
   drifts** — a 82nd skill, or a skill nobody fires. This is §4's measurement, frozen as a check.
4. **The 2 gimic skills are in the batch.** Explicitly assert `trap_deadfall_volley` and
   `door_keeper_strike` have adopted art. **Pins §4.2 against the 79-vs-81 mistake**, which is the
   easy one to make.
5. **The fallback chain cannot blank.** (a) no artwork at all, (b) 40 of 81, (c)
   `STORAGE_BACKEND=files` (`art_urls === {}`), (d) a 404ing PNG. **All four: the rune renders,
   nothing throws, no badge is empty.** (c) is the **default e2e path**.
6. **No id collision.** Assert `skills.json` ids are disjoint from every other id in `art_urls`'s
   name set (items ∪ sis ∪ tms ∪ monsters ∪ gimics). **Passes today with 0/118** (§10.1) — **must
   fail** on a synthetic fixture where a skill and a monster share an id. Pin the failing case: a
   silent overwrite in a flat map is invisible until a portrait becomes an icon.
7. **The verb->rune map is TOTAL.** For every skill in `skills.json`, `skillGlyph(verb.t)` resolves.
   **Fails on a 7th verb** — i.e. §9.2's step 2 is machine-guaranteed, not hoped for.
8. **No kit goes stale.** After §11.5's `applies_to` edit, every existing `si`/`po`/`unit` render's
   `kit_input_sha256` is **unchanged**. A mass-stale would invalidate the inspection history for a
   routing edit.
9. **Legibility has teeth (`skill.badge_legibility` v1 [S7]).** §7/§8's S4 is prose without a
   measurement. Downsample the adopted 256 px render to **18×18** and measure:
   ```
   silhouette_components  : connected components of alpha>8  == 1        (one shape, not confetti)
   badge_contrast         : stddev(luma) of the 18px downsample >= [S7]  (a mush flattens to a blob)
   soft_alpha_band        : fraction with 8 < alpha < 200      <= [S7]   (a crisp silhouette, not a haze)
   ```
   **Thresholds are [S7] and are calibrated from the FIRST gallery, not guessed here** — the same
   posture `monster.render_sanity` and `si.subject_frame` shipped with (`art_pipeline.md` §8).
   **Advisory, never blocking** (`inspect_kits.json`'s own rule: only `bpskin.frame_gate` blocks).
10. **S2 has teeth (G2/G7).** A deliberately ring-framed fixture is caught: `si.subject_frame`'s
    `margin >= 0.02` and `centroid_offset <= 0.25` already fail a rim-to-edge composition, and
    `soft_alpha_band` catches a soft rim. **Named as a gate because §8's failure is silent** — a
    ring-framed icon looks fine in a screenshot and only lies in motion.
11. **Migration is additive and idempotent.** Apply twice; `artwork_kind` = {po,si,unit,monster,
    bpskin,custom,gimic,skill}. Old code never emits `skill` (REQ-0179's migration-first argument).
12. `pnpm exec tsc --noEmit` + lint + `tools/ci.sh` GREEN.

## 13. The i18n and Dex consequences

### 13.1 i18n: **NO new i18n. Verified, as the task asked.**

**Measured: all 81 skills carry `name_en` AND `name_ja`, with zero missing** — e.g.
`{"id":"gnoll_claw","name_en":"Gnoll Claw","name_ja":"ノールの爪"}`. So:

- **The icon needs no localisation** — it carries **no text** (§8.3's S6), which is *why* S6 is a rule.
- **The badge's tooltip / `aria-label` uses the existing `name_ja`/`name_en`** per locale. **Nothing
  is added.**
- **The artwork's `main_object` is an English art brief, not user-facing.** It is prompt input. It
  must **not** be confused with `name_en` — a good brief for `gnoll_claw` may be *"three curved claw
  slashes"*, not *"Gnoll Claw"*. `art_golden`'s rule (*"gorgeous names do not yield better art"*)
  applies: **the brief describes the PICTURE, the name names the SKILL.**

> **Finding — TWO i18n dialects live in one content tree.** `skill/1` uses **flat**
> `name_en`/`name_ja` (measured: 81/81, and **zero** entries carry an `i18n` block). `monster_pack/1`
> uses a **nested** block: `{"name":"Frost Scouts","i18n":{"en":{"name":…},"ja":{"name":…}}}`
> (measured, `packs.json`). `gimic/1` uses `name` + `i18n.ja` (REQ-0211's schema table). **Three
> shapes across three kinds.** Harmless for this REQ (it adds no i18n), but **any future "localise
> the Dex" work will hit it**, and it is the kind of thing that is invisible until someone writes one
> reader for all three. **Reported, not fixed.**

### 13.2 Dex: REQ-0228 is the natural consumer, and **this REQ has a stake in its open decision**

**REQ-0228** (`draft/`, *"needs a design decision (payload shape + spoiler posture) before work
starts"*) proposes showing what a skill **DOES**. Its open decision, verbatim:

> - **(a)** widen `monster_skills` entries with a display-safe mechanics slice … one map, no new section
> - **(b)** a separate **`skills` payload section keyed by id** … heavier but reusable by a future
>   skill_def catalog tab

**They are complementary, not duplicative — and the split is clean:**

| | REQ-0265 (this) | REQ-0228 |
|---|---|---|
| ships | **art** — 81 rasters | **facts** — cadence, verb + damage band, edge/direction/pen/aoe |
| surface | the expedition badge (18 px) **and** the Dex chip | the Dex detail line |
| payload | **`art_urls[skill_id]`** — §10's one line | a mechanics slice |

**Neither blocks the other and neither duplicates the other. But this REQ has a stake in (a) vs (b),
and it argues for (b):**

- **Under (a)**, the mechanics ride on `monster_skills` — a **monster-only** map. **REQ-0211 serves
  gimic skills through a SEPARATE `gimic_skills` section** (its Ships list: *"`gimicsFromCore()`
  serves the Dex `gimics` + `gimic_skills` sections"*). So (a) means **two id-keyed skill maps that
  must be kept in step**, and `door_keeper_strike`/`trap_deadfall_volley` — **2 of this REQ's 81** —
  are reachable only through the second one.
- **Under (b)**, one `skills` section keyed by id serves **monster and gimic skills identically** —
  which is exactly what **REQ-0259's `IBattleInstance` unification** already asserts about the runtime.
  **The Dex payload would then match the model.**
- **This REQ's art is keyed by skill id, for all 81, regardless of owner.** §10's `art_urls` widening
  is owner-agnostic by construction, so **it works under either (a) or (b)** — this REQ is not
  blocked. **But (b) is the shape that lets one consumer render icon + mechanics for both families
  from one map**, and under (a) a gimic skill's icon has no natural home in the Dex.

**Recorded as input to REQ-0228's pending decision, not as a demand.** REQ-0228 owns it; this is the
evidence it did not have when it was written — **REQ-0211's `gimic_skills` section postdates it**.

## 14. Corrections to the brief, the task framing, the code and the sibling REQs

| claim | reality | evidence |
|---|---|---|
| task: *"**Count the real surface yourself**: how many distinct skill ids … referenced by `enemies.json` + the gimic defs + `packs.json`?"* | **81.** `skills.json` has 81 entries / 81 unique ids; enemies reference **79**, gimics reference **2**, **packs reference ZERO**; union **= 81**, with **0 unreferenced and 0 dangling**. The surface closes exactly. **`packs.json` contributes no skill ids at all** — a member is `{"enemy":…,"at":…}`; packs reference **enemies**, which reference skills. Its real value is a **reachability** proof: all 44 enemies are placed, so all 79 enemy-side skills are live. | §4 |
| task: *"REQ-0263 draws these … at CELL=40 logical scale (so each badge is SMALL — do the arithmetic … and state the target px)"* | **18 px circle; 12.7 px of art inside it** (`clamp(40×0.45,12,20)=18`; `18/√2=12.7`). **That is 3.6× below ratified golden G4's 64 px FAIL floor, and 5.0× below it for the art itself.** No golden in the program has asked art to survive a fifth of a board cell — and **the ratified Anime template cannot** (`art_pipeline.md` §3 already measured "bold outline" turning a texture brief into an outlined object). **This is the REQ's central finding and needs a user ruling.** | §6.1, §7 |
| task: *"A 128px/cell law (the monster/gimic law) is likely **wrong** here"* | **Correct, and for a structural reason, not a resolution one:** `monster`'s law reads a **cell footprint**, and a skill **has no footprint**. `{w:1,h:1}` would write a lie into `shape` jsonb that **REQ-0188 then treats as authoritative**. Also too small: 128 gives only 2.7–5.3× headroom for a Dex chip. **The right law is `si`'s: locked 256×256, no shape.** | §5.4, §6.2, §6.3 |
| task: *"Note PLAYER POs/SIs already have icons … state whether a monster skill icon is the same asset class as a PO icon"* | **Two different answers, and conflating them is the trap.** **As CONTENT: NO** — a PO is a thing the player **owns and places**, whose size **derives from a 5×5 cell mask** at 256 px/cell and whose art is **authoritative for that mask** (REQ-0188); a skill occupies no cells and has no mask. **As LAW: it is an `si`** — the one existing kind whose law is *"a locked square with no geometry"*, which is exactly what a skill icon is. **So: reuse `si`'s law; never `po`'s.** | §5.4 |
| **REQ-0175 vs REQ-0179 CONTRADICT EACH OTHER** (finding, shared with REQ-0264 §16) | REQ-0175 (`draft/`, "CLEARED TO IMPLEMENT", 2026-07-14): *"**The art KIND itself — Add it — required, not optional**"*. REQ-0179 (`built/`, 2026-07-15) shipped `custom` *"for content that has no art-kind of its own"* — and **its step F names `skill_def` by name** as a picker target, i.e. **REQ-0179 explicitly anticipated a skill def linking a `custom` artwork.** REQ-0175 is neither withdrawn nor superseded. **The board cannot answer "does X get a kind?" until this is resolved**, and both this REQ and REQ-0264 must ask it. | §5.1 |
| **MIGRATION NUMBER COLLISION at 020** (finding, shared with REQ-0264) | `master` has `020_render_variant.sql` (REQ-0223); the `req-0211` branch has `020_content_kind_gimic.sql` + `021_artwork_kind_gimic.sql`. REQ-0255 merges 0211 -> **two `020_*` files**. Not fatal (`016_content_artwork_ref.sql` and `016_content_kind_gacha_pack.sql` already coexist), but **the next free number is not derivable by `ls` pre-merge**. Post-merge the next free is **022**; REQ-0264 and this REQ need **one each**. Flagged to REQ-0255. | §11.1 |
| **REQ-0263 §8.3's claim that this REQ "closes the gap … one map, no layout change"** | **True mechanically, and CHALLENGED at 18 px.** A rune is a **hinted vector font glyph** engineered for small sizes; a 14.2×-downsampled raster is not. **REQ-0263's placeholder is probably MORE legible on the badge than any art this REQ can commission** — while carrying less information (30/81 share `ᛊ`). So "art replaces rune" may be true for the **Dex** and false for the **badge**. §7 (B) is that option, and it is honest. | §7.3 |
| task: *"skills belong to BOTH monsters and gimics (REQ-0259 unifies them as `IBattleInstance`)"* | **CONFIRMED, and it is worth exactly 2 assets — which is the point.** `trap_deadfall_volley` and `door_keeper_strike` are referenced by **no enemy**. **Counting from `enemies.json` alone gives 79 and silently drops both** — including the **trap**, the thing a player most needs to read. `door_keeper_strike` is also **the only skill in the tree with `modes:["unlock"]`** (80/81 are `["battle"]`). | §4.2 |
| REQ-0263 §8.2's *"N ∈ [0,3]"* and §8.4's *"all 81 are `every_secs`"* | **BOTH INDEPENDENTLY CONFIRMED.** Enemies `{1:10, 2:33, 3:1}`, max **3** (`hrimgrimnir`, `[3,3]`); gimics `{0:2, 1:2}`. Triggers: `{'every_secs': 81}` — **zero passives**, so (l)'s *"passives included"* ships unexercised, exactly as REQ-0263 §8.4 says. REQ-0263's verb table is exact: `{strike:30, apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2}` = 81. | §3 |
| brief §6: *"`board/sprites.ts` (**sprite_all_v11.svg** symbols -> Pixi textures)"* | **WRONG — it is v12.** `client/src/board/sprites.ts:50`: `import spriteSheetSource from '../../../content/sprite_all_v12.svg?raw';`. The errata is right. **And the file contradicts ITSELF**: its own comments at `:2` and `:47` still say `sprite_all_v11.svg` while the import says v12. `content/` holds v7..v12. **Reported** — a stale comment two lines from the truth. | §11 (Out) |
| **`custom` routes to ZERO inspection kits** (finding) | No entry in `tools/inspect_kits.json` lists `custom` in `applies_to`, so `kitsFor('custom')` returns `[]`. For **one** texture (REQ-0179's case) that is fine. For **81 assets sharing a size, a style, a kit and a golden**, it means the law exists and nothing enforces it, 81 times. **This is the decisive argument for a kind** — the same one REQ-0264 §6.2 makes. | §5.2 |
| **TWO i18n dialects in one content tree** (finding) | `skill/1` = **flat** `name_en`/`name_ja` (81/81, **zero** `i18n` blocks). `monster_pack/1` = **nested** `i18n:{en:{name},ja:{name}}`. `gimic/1` = `name` + `i18n.ja`. **Three shapes, three kinds, one tree.** Harmless here (this REQ adds no i18n) but it will bite the first reader written for all three. **Reported, not fixed.** | §13.1 |
| **REQ-0228's (a) vs (b) has a stake it does not know about** (finding) | REQ-0228 predates **REQ-0211**, which serves gimic skills through a **separate `gimic_skills` Dex section**. So its option **(a)** (widen the **monster-only** `monster_skills`) leaves **2 of this REQ's 81 icons** — both gimic-owned — with no natural Dex home, and creates two id-keyed skill maps to keep in step. **(b)** (one id-keyed `skills` section) matches REQ-0259's `IBattleInstance` unification. **Input to REQ-0228's pending decision; this REQ works under either.** | §13.2 |
| **REQ-0188's drift is live** (measured here) | `frost_gnoll`'s def footprint is **`[1,1]`** (measured, `enemies.json`) vs art shape `{w:3,h:4}` — a **12× area disagreement**, shipping, because REQ-0188 was ratified and **`derive --write` was left unrun**. Cited as the **evidence** for §6.3: a shape that claims to describe the board **can** drift from it; a kind with no shape cannot. **Reported; REQ-0188's to fix.** | §6.3 |
