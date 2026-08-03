> ART SUPERSEDED (REQ-0150, 2026-07-13): every image-generation detail below is dead --
> route / style / tools live in `art_pipeline.md`. NON-art content (schema, data model,
> review flow) still stands. The full original banner and text: git history.

# Item Content Pipeline — v3.0 (2026-07-14, REQ-0154; registry era) — PO / SI

> **v3.0 (2026-07-14, REQ-0154; registry era):** §0 below makes the two
> registries (artwork REQ-0151 / content-data REQ-0155) the operating model and
> references the spine §7 for all shared contracts; PO/SI split stated per
> REQ-0151 ruling 8. The CLI Steps 1–8 are kept as the underlying tool sequence.
> Art content stays superseded by `art_pipeline.md` (banner above).
>
> **v2.1 (2026-07-12, REQ-0134):** translated to English per the language
> policy (user directive 2026-07-02); content identical to v2 except:
> references updated (`art_golden.md` → `common_content_pipeline.md` §2;
> `common_content_pipeline.md` now exists), and the route-location notes
> updated after REQ-0109's merge to master (2026-07-12). v2 (Japanese) lives
> in git history.
>
> **Scope**: PO (`content/live/live_items.json`, `po/2`) and SI
> (`content/live/live_sis.json`, `si/2`). Executing the steps top-to-bottom
> adds one batch of items. Shared principles, infra, REQ workflow, vocab,
> build (`tool_gen_data.cjs`) and quality gates (`ci.sh`):
> see `common_content_pipeline.md`.
> **Operator**: Opus executes all steps solo.
> **Icon stage** = the REQ-0073 AI-raster route, **verified end-to-end on V9,
> 2026-07-09** (see "Verification log" at the end). The route was recovered
> and merged to master by REQ-0109 (2026-07-12). NOTE: the batch-003 ART
> outcome was rejected by the user at S7 (2026-07-12, "NG"); candidate
> regeneration restarts on the refreshed pipeline — which now means the
> **REQ-0136 checkpoint outcome only**: REQ-0135 is settled (LayerDiffuse
> NO-GO, matte route unchanged) and is no longer a blocker. See REQ-0109 (todo).

## 0. Registry era — PO and SI as registry facets (REQ-0154)

Items are now produced through the **two registries** described in
`common_content_pipeline.md` §6–§9, not by hand-running the CLI steps below. The
CLI steps (§Prerequisites … Step 8) remain **valid and are the underlying tool
sequence** the registries wrap — read them for what each tool does; read this
section and the spine §7 for the operating model.

**PO / SI split (REQ-0151 ruling 8 — canvas_spec.md canon).** An item is one
`system_name` with two facets:

| facet | PO — Placement Object | SI — Socket Item |
| --- | --- | --- |
| artwork kind (`artworks.kind`) | `po` | `si` |
| shape input (admin) | **5×5 click grid** (active cells) | **none** |
| render resolution | **derived** from the active-cell bounding box: 256 px/cell, /16-snap (`server/services/art_sizing.cjs`) — e.g. sword 3 vertical cells → 256×768, shield 2×2 → 512×512, potion 1×2 → 256×512 | **locked 256×256** |
| data kind (`content_defs.kind`) | `po_def` | `si_def` |
| data schema | `po/2` (`content/live/live_items.json`): `shape`/`tags`/`effects`/`sockets`/`ports`/… (Step 2) | `si/2` (`content/live/live_sis.json`): `slot`/`reqTags`/`effects` — **no shape/sockets** |

**Seed / variant, adoption, export, advisory inspection: see the spine — do NOT
restate here.**
- Seed vs variant, recipe-vs-asset-of-record: `common_content_pipeline.md` §7.2.
- Adoption (one adopted render + one adopted variant per `system_name`; human-only;
  adopted-undeletable): §7.3.
- Export: the adopted PO/SI render exports to `content/art/po/<name>.png` /
  `content/art/si/<name>.png`; the adopted def variant exports via `tool_integrate`
  into `content/live/live_items.json` / `live_sis.json`. The git-branch/live-merge
  half is the deploy step (§7.4).
- Advisory inspection kits (§7.5; roster + thresholds in `art_pipeline.md` §8):
  a **PO** render auto-runs `matte.coverage_band` + `po.cell_packing`; an **SI**
  render auto-runs `matte.coverage_band` + `si.subject_frame`. All advisory (top
  out at WARN); results in `render_inspections`; never gate adoption.

- **REQ-0133 (item-raster-live-wiring, draft) coordination:** its live-render
  wiring concern is now the **registry export contract** (§7.4) — the adopted
  PO/SI render is what live/mock/client consume via the export. REQ-0133 stays
  in `draft/`, still blocked on REQ-0125a’s shared resolution machinery; the
  raster-vs-SVG half is already ruled RASTER.

**Where the CLI steps map onto the registries:** Step 5 (art) is now the **artwork
registry** — generate seeds, kits auto-run, human adopts (`art_pipeline.md`; REQ-0151).
Step 3–4 validators (static validate / engine integrate) are now the **content-data
registry**'s machine checks run on every variant (`schema_vocab` / `engine_types` /
`gen_data` / `integrate` dry-run; REQ-0155). Step 8 (merge) is now the **export**
step on adoption (§7.4). The manual steps still work unchanged for a one-off batch.


## 0.1 Shape conditioning (REQ-0153 recipe — LIVE since REQ-0183/0186)

REQ-0153 was a spike; its verdict is **GREEN-with-recipe**. Up-front silhouette
control for **non-rectangular PO shapes** (L, T, …) works on the fixed Flux.2 Klein
4B route, but the recipe is a **spec addendum handed to a follow-up integration REQ**
— **the production route (`art_route.build_txt2img`) is untouched and byte-identical**.
**Status 2026-07-17: LIVE.** REQ-0183 wired Arm C @ D=8 into the production route; REQ-0186 exposed it as po params **`shape_lock`** (`off|guide|strict|auto`, default `auto`) and **`shape_dilation_px`** (0-16, default 8), plus a one-shot generate override that never mutates the artwork. **`auto` = strict on every shape (REQ-0220).**

> **Why `auto` no longer splits by shape.** It used to mean “strict on an underfilled
> bbox (L, T), off on a full rectangle (1x3, 2x2)”, justified by the claim that strict
> flattens a rectangle’s subject — that a heater shield becomes a plain disc. **That
> claim is false.** REQ-0187’s S7 verification rendered a 2x2 `round shield` at both locks
> on this route: strict median fit **81.3** vs off **71.8** (worst-cell 0.21 vs 0.32,
> 3/3 PASS both), and strict kept the boss, riveted rim and plank texture — it flattened
> nothing; off merely drew heater silhouettes that leave the square’s corners empty. The
> awkward half of the rule HELD (L-tromino: strict 68.3 vs off 32.5, one off seed spilling
> 123 px of deep-overflow), so strict on a notched shape is not in question.
>
> Off’s only remaining argument was wall time, and REQ-0220 traced that to REQ-0153’s
> **spike** route (76-130 s conditioned vs 15-50 s plain). REQ-0187 V5 re-measured **this**
> route — which runs matting as a separate CPU inspection job rather than co-resident on
> the GPU — at warm conditioned 512x512 ~60–150 s vs plain off 512 ~90–120 s: no real gap.
> With neither the pictures nor the cost favouring off, the split was retired (user ruling
> 2026-07-17). An operator who wants off on a given item sets the lock explicitly or uses
> the one-shot override. Full write-up: `docs/REQ/*/REQ-0220-*.md`.

The historical spike spec below is preserved as-is; the authoring rules the lock does NOT cover are §0.2.

**Problem it solves.** Unconditioned t2i rarely lands an awkward silhouette inside its
cells; rerolling seeds until the shape happens to fit is futile. Measured baseline
identity-fit on the scored matrix was **28.6 %** (a `battle axe` overflows the L
quadrant; a `war hammer` renders a full warrior or a garbled logo banner).

**Winner — Arm C @ D=8:** **ReferenceLatent (gray scaffold) + SetLatentNoiseMask
(dilated shape, D=8, on a white-canvas latent).** Over the matrix: **100 % identity-fit
feasible, zero deep-overflow, pure-white backgrounds, best median best-fit** — clears
every ratified GREEN gate. The scaffold is a **mid-gray flat silhouette on white at
gen resolution** (aspect + /16 snap, 256 px/cell), driven directly by the REQ-0151 PO
**5×5 mask**. **Arm A** (ReferenceLatent alone, ~60 % containment) is the fallback if a
hard mask is undesirable. **Arm B** (scaffold img2img) was **REJECTED** (ghosts the
gray scaffold / distorts the subject).

**Recipe deltas (the hand-off; do NOT apply here):**
- `art_route.build_txt2img` gains OPTIONAL `reference_image` / `shape_mask_image` /
  `mask_init_image`, all defaulting to `None` (route byte-identical when unused). Arm A
  inserts `LoadImage → VAEEncode → ReferenceLatent` into the positive; Arm C also
  replaces `EmptyFlux2LatentImage` with `VAEEncode(white canvas) → SetLatentNoiseMask(mask)`.
- `art_style.edit_instruction(subject)` → Anime template applied to
  `"Turn the gray shape into <subject>. Keep the silhouette exactly. white background,
  bold outline"`.
- `tools/spikes/req0153_shape_scaffold.py` (cell mask → scaffold + dilated hard mask)
  becomes the production scaffold generator.

**Recommendation (per REQ-0153):** use **Arm C @ D=8 when a shape MUST be respected**
(non-rectangular PO). For shapes whose subject already fits under the aspect-sizing law
(single-column / square footprints with an aptly-oriented subject) shape-conditioning is
**optional** — the baseline already fills those. Because the hard lock **spends subject
legibility** on blocky shapes (the T hammer reads as an abstract cracked-metal T),
expose it as a **per-item toggle in the REQ-0151 admin** (already scoped there), never
force it globally, and keep the **post-hoc numeric fit as the final gate**.

**Ops cost to budget:** VRAM peaked **6.7–6.8 GB at 256/cell on the 8 GB card (no OOM)**,
but reference-latent jobs are **~2–3× slower** than plain t2i (~76–130 s each).

## 0.2 Shape & prompt authoring doctrine (REQ-0187 S7 findings, 2026-07-15)

REQ-0183/0186 made the lock live; REQ-0187's eyeball of real production renders
found the lock is **necessary but not sufficient**. Containment held on every
strict render (deep_overflow_px = 0) while the composition was still unusable.
These rules bind the AUTHORING step (choosing the mask + writing the prompt);
no lock rescues a violation of them after the fact. They were articulated by
the user against renders `req0187_l_axe` seeds 1 / 11-14 / 21-24 and verified
in-session.

**1. Imagine first.** Visualize the CONCRETE item, mentally axis-align it, and
only then derive mask and prompt — both from that one mental image. Never pick
a shape from a word association ("an axe is L-ish"): the concrete image decides
the topology (a double-edged axe puts the handle at the head's vertical center
— that is a T-object, whatever the word suggested). Evidence: the word-first
L-order produced four renders that all fit the T footprint by translation alone.

**2. Fit-feel is violation-based, not additive.** GOLDEN aggregation rule
(user, 2026-07-15): *"discomfort is decided by the WORST spot, not the average
-- one cell's grave violation is not diluted by the other cells' goodness."*
Never average violations across cells. Within a cell, violations OR-combine
(v = 1 - prod(1 - v_i): the largest dominates, co-occurring ones compound);
across cells, aggregate worst-dominated (max, or a high-p norm). Averaging is
only meaningful for additive experiences; fit-feel is negative-elimination.
Validated same day: the averaging meter ranked the user-best render 4th; the
worst-spot meter ranked it 1st and sank the border-skimming renders to the
bottom (tools/spikes/req0187_fit_meter.py v4, findings in REQ-0187).
 The backpack "snug fit" is
not a positive quantity to maximize; it is the ABSENCE of specific violations.
A blob-like subject with no long straight part raises no expectation and may
sit loosely without discomfort. The violations, in severity order:
- **Misaligned long part.** A long straight part (>= ~1 cell) that is not
  parallel to a grid axis. Sensitivity is highest for SMALL deviations of LONG
  parts (a handle at 10 degrees hurts more than a short edge at 30).
  Promptable: orientation wording took axis-alignment from 0/1 to 7/8 renders.
- **Border-skimming (center-line rule).** A part owns a cell only when it runs
  near the cell row/column CENTER-LINE. Content skimming a cell border is owned
  by no cell and the "fits" reading collapses. Metric shape: per-owned-cell
  centroid distance from cell center; medial-axis deviation from the row
  center-line.
- **Empty owned cells.** deep_overflow catches spill-OUT; nothing catches a
  near-empty owned cell (seed 1 passed containment at per-cell coverage
  0.53/0.09/0.17, composed diagonally). Low per-cell coverage on a tool-like
  subject is a re-generation signal.
- **Spill into unowned cells** — the existing deep_overflow gate (works).

**3. Topology-prompt consistency.** The footprint is the subject's part-
skeleton. L = TERMINAL attachment (arm meets bar at an end); T = MEDIAL
(arm meets bar mid-span). The prompt must state the attachment anatomy
("handle extending from the base of the head"), not just pose. Subjects whose
archetype already matches the footprint are far cheaper than fighting the
archetype (a war hammer / double-bit axe IS a T-object; a boot IS an L).

**4. Mask orientation is part of authoring.** In-game rotation makes all
orientations of a footprint equivalent in play, so CHOOSE the orientation that
matches the subject's natural axis-aligned pose. The axe's native L has its
notch at the BOTTOM-right (vertical handle, head atop, blade projecting
sideways); ordering the notch-top-right L forced the handle onto the row
boundary (a center-line violation) in every round-2 render, because axe
anatomy runs the handle through the head's centered eye.

**5. Aspect ratio is generation-owned.** The model's natural aspect is optimal;
anisotropic stretch degrades visibly past small corrections (user-verified on a
hand-fitted render). A misfit is a re-generation signal, never a transform fix.

**6. Legibility drift.** Pose words are taken literally ("blade upright" drifts
a battle axe into a spearhead). Re-anchor the archetype with anatomy words
(single-edged, bearded) alongside pose words.

**7. Instruments are optimizers, not gates** (extends the §7 "score filters,
human adopts" posture). Kits should emit STRUCTURED findings an LLM can act on
— per-cell coverage, centroid offset from cell center, long-part angle — not
just a scalar. Proposed revision loop (user design, this session):
instruction -> 3 seeds -> instruments -> revised instruction -> 3 seeds ->
instruments -> revised -> 4 seeds -> present all ~10 renders WITH findings as
artwork variations; the user may adopt from any round. The target is YIELD
(the problem is 1-in-10 usable at scale, not the existence of rejects).
Constraints measured: warm strict render 40-130 s / no OOM at ~6.7 GB;
ComfyUI cold start after idle-free (REQ-0158) cost ~508 s of model reload
(880 s first-render wall) — run a loop warm, never judge on the first render;
`renders.seed` is UNIQUE per artwork, so same-seed A/B across rounds needs
render deletion or distinct seeds.

**Revision discipline** (measured, scythe loop 2026-07-15): change ONE
geometric constraint per round and keep every clause that measurably worked
VERBATIM. Round 2 added "tip plunging steeply downward, reaching the middle
height" and the tip cell went v=0.96 -> 0.00 on two renders (fit 66.1 best).
Round 3 additionally asked the blade to run "level along the very top all the
way to the far right corner" -- the model obeyed the level clause and DROPPED
the plunge (two renders: five cells at v=0.00, tip cell back to v=1.00, fit
25.8). Competing geometric clauses are not merged by the model; one wins.
Corollary: a render failing ONLY one cell is also evidence the FOOTPRINT may
be wrong for the archetype (those round-3 renders are ~perfect for the
5-cell Gamma footprint without the tip-dip cell) -- reshaping the mask is
sometimes cheaper than re-prompting (rule 4).

Implementation of the loop + the new instruments is a follow-up REQ
(REQ-0187 observes; it does not modify the route).

**S7 eyeball outcome (2026-07-16, REQ-0187 GPU verification).** Real production renders
confirmed rules 1-4 and refined the lock economics:
- **Mask orientation (rule 4) CONFIRMED.** The battle axe's natural L (notch bottom-right)
  scored median fit 68.3 / 3-of-3 PASS vs the ordered notch-top-right L at 39.1 / 2-of-9;
  the wrong orientation forces the handle onto the row center-line on almost every render.
- **T-objects fit by translation (rules 1,3) CONFIRMED.** A war hammer (medial handle->head
  attachment) fills the T footprint with no coaxing (best render 95.89).
- **CORRECTION to the "strict = plain disc" economics.** REQ-0183/0186 framed the hard lock
  as spending subject legibility ("the 2x2 round shield becomes a plain disc"). The real
  renders do NOT support this: on the 2x2, strict OUT-FIT off (median 81.3 vs 71.8) AND kept
  full character (boss, riveted rim, planks, weathering). What the lock changes is the
  SILHOUETTE (a free heater/kite outline -> a bbox-filling round one), not the detail; and
  off's full-rectangle outline is prompt-dependent and can underfill the cell. So `auto`->`off`
  on a full rectangle traded silhouette shape (and a few points of fill), not character-for-
  blank -- a per-item operator judgement, not a rule justified by a "plain disc" that does
  not actually occur. (REQ-0187 itself observed only and changed no default.)
- **RESOLVED by REQ-0220 (2026-07-17).** The follow-up the paragraph above called for did
  re-word S0.1 -- and then went further, because the rule had nothing left to stand on. Off's
  last argument was cost, and it quoted REQ-0153's SPIKE route (76-130 s conditioned vs
  15-50 s plain); REQ-0187's own V5 had already re-measured THIS route (matting runs as a
  separate CPU job, not co-resident on the GPU) at conditioned 512x512 ~60-150 s vs plain off
  512 ~90-120 s -- no real gap. Beaten on the pictures and level on cost, `auto`->`off` was
  retired on the user's ruling: **`auto` is now strict on every shape.** Off on a full
  rectangle stays available as an explicit per-item choice or a one-shot override; it is
  simply no longer the default.

## Prerequisites

- Connected to the server. Work in worktree
  `~/backpack_ragnarok_worktrees/req-00NN-slug`, branch `req-00NN-slug`.
- Vocabulary is CLOSED to `content/vocab.json` (currently v7). New vocab is a
  design event = requires user approval.
- Every entry requires `i18n.ja`. **Nothing is written into `content/live/`
  until Step 7 is green.**

## Step 1 — Decide the brief

Theme / count (8–16) / shape distribution / rarity distribution
(`vocab.rarities`) / tag & socket budget / new-vocab allowance (default:
none). Write the intent at the top of `notes.md`.

Before drafting, pull a generation context pack per slot (REQ-0272):

```
python3 tools/gen_context.py --kind item --rarity <Tier> [--verb V] [--theme S] --format md
```

It bundles the schema dialect, allowed verbs/triggers for POs, DO-NOT tokens
(excluded_attested + deprecated), the rarity dps band (advisory,
provisional), genre exemplars from the reference corpus, and live neighbors.
Draft WITH the pack in context: it prevents closed-vocab violations and
off-curve numbers at the source.

## Step 2 — Write `draft.json`

Location: `content/batches/batch-NNN-slug/draft.json`, shape
`{ "items": [ /*PO*/ ], "sis": [ /*SI*/ ] }`.

**PO (po/2)**: `id` / `name` / `rarity` / `shape` (array of `[row,col]`) /
`icon` (`"icon-<id>"`) / `tags` (`tags[0]` = kind root, rest = attributes) /
`effects` / `sockets` (`[{t,tags,ax,ay}]`) / `ports` (`[{tiles,tag}]`) /
`part` (assembly items only) / `flavor` / `i18n.ja` / `align` / `stretch`.

**SI (si/2)**: `id` / `name` / `slot` (gem/edge/coat/bond) / `reqTags` /
`icon` / `rarity` / `effects` / `flavor` / `i18n.ja` (no shape/sockets).

**Effect AST**: trigger = `vocab.triggers` (`every_secs` takes `s:[lo,hi]`
seconds; `adjacent` takes `tagKind:"type"|"element"` + `tag`;
`battle_start`/`passive`/`OnHit` etc.), verb = `vocab.verbs` (numbers are
`n:[lo,hi]`, statuses from `vocab.statuses`). Examples:

```json
{"trigger":{"t":"every_secs","s":[1.8,2.2]},"verb":{"t":"strike","n":[22,38]}}
{"trigger":{"t":"adjacent","tagKind":"element","tag":"Oil"},"verb":{"t":"amp_status","status":"Burn","mult":2}}
```

## Step 3 — Static validation (semantic fields)

`shared/content_validate.cjs` (`validateBody(body, kind, vocab)`,
`kind`=`'item'|'si'`, semantic fields only). There is no standalone CLI, so
run a throwaway harness from the repo root:

```js
// tools/scratch_validate_batch.cjs
const V = require('../shared/content_validate.cjs');
const fs = require('fs');
const vocab = JSON.parse(fs.readFileSync('content/vocab.json','utf8'));
const batch = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const pick = (o,ks)=>Object.fromEntries(Object.keys(o).filter(k=>ks.has(k)).map(k=>[k,o[k]]));
let bad=0;
for (const e of batch.items||[]) { try{V.validateBody(pick(e,V.ITEM_ALLOWED_KEYS),'item',vocab);}catch(err){bad++;console.error('ITEM',e.id,err.message);} }
for (const e of batch.sis  ||[]) { try{V.validateBody(pick(e,V.SI_ALLOWED_KEYS ),'si',  vocab);}catch(err){bad++;console.error('SI',  e.id,err.message);} }
console.log(bad?`FAIL ${bad}`:'S2 OK'); process.exit(bad?1:0);
```

`node tools/scratch_validate_batch.cjs content/batches/batch-NNN-slug/draft.json`.
Structural fields (shape/ports/part/icon/align/id) are covered by Steps 4–5.
Additionally hand-check id/name collisions (including vs live).

## Step 3.5 — Balance gate (one door; REQ-0272)

For each candidate def (single JSON file), run the one-door gate before
engine integration:

```
node tools/candidate_gate.cjs <candidate.json>
```

VALIDATE (closed vocab + dialect) -> STATIC (`check_stat_bands` dps band,
advisory/provisional) -> DYNAMIC (`balance_sim` Monte-Carlo vs baseline).
Exit 0 pass / 1 flagged / 2 usage; the report lands next to the candidate
as `<name>.gate.json`. A flag is a STOP for that candidate: fix the numbers
and rerun. For a batch `draft.json`, gate each entry (extract to a temp
file per def).

## Step 4 — Engine integration check

```
node tools/tool_integrate.cjs content/vocab.json \
  content/live/live_items.json content/live/live_sis.json \
  content/batches/batch-NNN-slug/draft.json
```

Placement / 4 rotations / socket consistency against the real engine. Any red
→ back to Step 2.

## Step 5 -- Icon generation

Superseded V9/SDXL route removed (REQ-0358, 2026-08-02): follow `art_pipeline.md` s5 (Items). Original text: git history.

## Step 6 — Preview deploy

Apply `tools/build_batch003_report.py` to the batch →
`web/preview/batch-NNN/index.html` (self-contained, relative paths, dark
theme) → verify `https://backpack-dev.qtie.jp/preview/batch-NNN/`.

## Step 7 — USER REVIEW (STOP here)

Numbered gallery; verdicts per entry (green/fix/cut) or per rule. **Nothing
touches live until green.** (This is where illustration-first —
`common_content_pipeline.md` §2: no stats before approved art — is enforced.)

## Step 8 — Merge, build, register

1. Append approved entries to `content/live/live_items.json`
   (/`live_sis.json`) `entries[]`.
2. `node tools/tool_gen_data.cjs content/vocab.json content/live/live_items.json content/live/live_sis.json content/live/scenario.json mock-src/data.js`
3. Append id / counts / review outcome / provenance (drafting = opus) to
   `content/registry.json`.
4. `bash tools/ci.sh` (with `SKIP_PG=1`/`SKIP_CLIENT=1`/`SKIP_E2E=1` as
   needed) to green.
5. Commit (batch changes together). Rollback = git history.

---

## Verification log & ratified route (V9/SDXL era) -- removed

Superseded by REQ-0150 flux2; removed by REQ-0358. Text: git history. Current route: `art_pipeline.md`.
