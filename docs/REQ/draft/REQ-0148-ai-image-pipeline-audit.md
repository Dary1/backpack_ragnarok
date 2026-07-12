# REQ-0148 — AI Image Pipeline Audit (every pipeline with an AI-raster art stage)

**Status:** Draft (awaiting user ratification)
**Reserved:** 2026-07-13
**Slug:** ai-image-pipeline-audit
**Branch / worktree:** `req-0148-ai-image-pipeline-audit`
**Reference docs:** `common_content_pipeline.md` §2 (Art Golden) + §4 (S0–S8);
`item_content_pipeline.md` v2.1 §Step 5; `unit_icon_pipeline.md` v1.1;
`backpack_skin_pipeline.md` v1.1; `monster_content_pipeline.md` (stub).
**Related REQs:** REQ-0073 / REQ-0109 (raster route), REQ-0111 (monster doc,
draft), REQ-0127 (unit icons, todo), REQ-0131 (skin spike, todo), REQ-0136
(checkpoint bakeoff, todo), REQ-0138 (skin tiling recipe, todo), REQ-0139
(ComfyUI service, todo), REQ-0147 (matte background clause, draft).

---

## 1. Problem

Four pipelines carry an AI-raster art stage (S5). Exactly ONE has ever been
walked end-to-end — items, on 2026-07-09, with V9. Since then batch-003's art
was rejected by the user at S7 ("NG"), LayerDiffuse was ruled NO-GO
(REQ-0135b), the checkpoint went under re-evaluation (REQ-0136), and the matte
prompt clause was reopened (REQ-0147).

The other three have **ratified goldens and written procedures that nobody has
ever executed.** They are not blocked on missing tools — this REQ's scoping pass
confirmed the opposite:

- `unit_icon_pipeline.md` §2 S3 states the implementation outright: *"a thin
  `gen_unit_icons` wrapper (or a `--defs` pointing at Unit defs) over
  `tools/gen_item_icons.py`"*. `gen_item_icons.py --defs` exists and accepts an
  arbitrary defs JSON. **Unit icons are runnable today.** What does NOT exist is
  a single Unit def anywhere in the tree.
- `backpack_skin_pipeline.md` S2 + REQ-0138 name the exact ComfyUI node pack for
  seamless `fill_texture` (`spinagon/ComfyUI-seamless-tiling`; Seamless Tile
  model patch + Make Circular VAE; Offset Image to verify). That pack **is
  already installed** at `~/ComfyUI/custom_nodes/ComfyUI-seamless-tiling`, and
  `JuggernautXL_RunDiffusionPhoto2_V9_Final` is present. **The fill_texture
  recipe is runnable today.**
- `monster_content_pipeline.md` is a five-line stub, yet `tools/gen_monster_art.py`
  exists and is the parent of the item tool.

So the question is not "is it built". It is: **hand these documents to someone
who knows nothing, and does an image come out?** The document is the product. If
a cold operator cannot follow it top-to-bottom without improvising, the pipeline
does not exist — there is only a story about a pipeline.

**This REQ fixes nothing. It measures, and reports honestly.**

## 2. Binding user decisions (2026-07-13)

- **D1 — Scope:** every pipeline with an AI image-generation stage.
- **D2 — Depth:** real generation. The user granted the **"explicit, fresh user
  go-ahead"** that PROJECT.md §"Server home" requires before touching the
  HANDS-OFF art assets (`ComfyUI/`, GPU outputs). Scoped to this REQ; does not
  generalise.
- **D3 — Judge:** a **cold subagent**, given the docs and nothing else. The
  orchestrator does not fill gaps. Every guess, question, or improvisation is
  logged as a documentation defect. The orchestrator's own knowledge is
  disqualified as evidence.

## 3. Subjects under test

| # | Pipeline | Doc | Tool per the doc | Runnable today? | Never run |
|---|---|---|---|---|---|
| P1 | Item (PO / SI) icons | `item_content_pipeline.md` v2.1 §5 | `gen_item_icons.py` | yes | ran once (2026-07-09, V9); art NG at S7 |
| P2 | Unit icons | `unit_icon_pipeline.md` v1.1 §2 | `gen_item_icons.py --defs <unit defs>` | **yes — but zero Unit defs exist** | never |
| P3 | BP Skin — `fill_texture` | `backpack_skin_pipeline.md` §5 S2 + REQ-0138 | ComfyUI seamless-tiling nodes (installed) | **yes** | never |
| P4 | BP Skin — edge tiles + `clip_mask` | `backpack_skin_pipeline.md` §1, §5 S2–S3 | **none named** (motif-sheet cut + clip-mask autotrace) | **unknown — the doc names no tool** | never |
| P5 | Monster art | **5-line stub** (REQ-0111 draft) | `tools/gen_monster_art.py` | tool yes, doc no | doc never written |

**TM is explicitly OUT.** `tm_content_pipeline.md` Step 5 is headed *"Icon (SVG
sprite route — NOT the AI raster route)"*: TM icons are hand-authored
`<symbol>`s in `content/sprite_all_vN.svg`, and raster adoption for TMs is *"not
ratified"*. TMs have no AI image stage; auditing them here would be theatre.

## 4. Method

Ordered P1 → P2 → P3 → P4 → P5. P1 first: if the one "verified" route is broken,
every downstream verdict is noise.

1. **Cold run.** Fresh subagent per pipeline. Given: the pipeline doc, the common
   doc, PROJECT.md, server access. NOT given: this REQ, related REQs,
   orchestrator commentary, or any hint of the expected answer. It executes the
   art stage against a fixed input and **stops the moment the document stops
   telling it what to do.**
2. **Log every improvisation.** Each inference, each command not in the doc, each
   path that did not exist, each question it wanted to ask. *This log is the
   deliverable; the images are the by-product.*
3. **Image or wall.** Either a PNG survives the machine gates, or the run hits a
   wall recorded against **the exact doc line that failed.** Both are results.

### Fixed inputs

- **P1** — 2 live item ids, one 1×1 and one 1×2 (the ✓verified `gen_render`
  rows). 4 candidates, seeds 101/202/303/404.
- **P2** — 2 Units from the roster seed list in the doc (elf, dwarf, …). The
  subagent must author the scratch defs from doc §2 S1–S2; **whether it can
  work out how to do that from the doc alone is precisely the test.** Bust
  framing (open item 1: DECIDED bust). Same 4 seeds.
- **P3** — 2 contrasting motifs (elven / barbarian), 512–1024 px, per REQ-0138.
  Gate = the Offset Image half-shift check: zero visible seam.
- **P4** — the same 2 motifs: motif sheet → cut master edge tiles (straight /
  outer corner / inner corner) → derive `clip_mask`s. Gate = the S3 assembly
  harness on the validation shape suite (1×1, I, L, T, S/Z, inner-corner, holed).
- **P5** — 1 monster. The subagent is handed the stub and `gen_monster_art.py`.

### Rules of engagement (binding)

- **The box is 23 GB; the GPU is an RTX 2080 (8 GB).** ComfyUI (~11 GB RSS with
  SDXL resident) and birefnet (~12 GB) **cannot be co-resident** — they OOM
  (REQ-0135b). Generate with `--no-matte`, stop ComfyUI, then `--rematte-only`.
  A subagent that cannot derive this from the doc is a FINDING — but the
  orchestrator MUST NOT let it thrash the box.
- **ComfyUI is not a service** (REQ-0139, todo); it is started by hand at
  `127.0.0.1:8188`. **Check the GPU is idle before every start. The user runs art
  sessions on this same box: this REQ waits, and never evicts.**
- **Checkpoint: V9, as documented — not as improved.** REQ-0136 may replace it
  later. Testing V9 is the point, because V9 is what the doc says.
- **Read and run only.** Nothing is installed into `~/ComfyUI`, no node added, no
  weight moved, no art worktree or `monster_matte_variants/` touched. If a
  pipeline turns out to need a node that is absent, that is a FINDING — it is not
  an invitation to install it.
- Scratch Unit/skin defs are throwaways under the worktree's `tmp/`. **Nothing
  this REQ produces goes near `content/live/`.**

## 5. Pass criteria

A pipeline PASSES only if the cold subagent, on the document alone:

- **C1 — Reaches an image** at the documented path.
- **C2 — Zero improvisation on the happy path.** Every command is written in the
  doc, or is a direct unambiguous instantiation of a documented template.
  Inventing a flag, a path, or a step = FAIL.
- **C3 — The artefact is legal by machine gate.** Per-cell coverage ≥ 20%
  (`tool_fit_check.py`), aspect preserved, matte band 2–90%. For P3: zero-seam
  offset check. For P4: the S3 harness clean (no seams, no fill leakage past a
  `clip_mask`).
  *Aesthetics are NOT judged here.* That is S7, and S7 belongs to the user.
- **C4 — Reproducible.** Same seeds → same winner on a second run.

FAIL is always recorded **with a named cause and the doc line at fault.** A
verdict of "the doc describes a step no tool performs" (the live hypothesis for
P4) is a legitimate, valuable result — not a failure of this REQ.

## 6. Deliverables

1. `docs/llm_managed/ai_image_pipeline_audit_2026-07.md` — per pipeline: verdict,
   the wall, the exact doc line at fault, the full improvisation log.
2. **A ranked defect list, split by owner**, because the three rots differ:
   - *doc-vs-reality drift* — the doc lies about what exists (fix: edit the doc);
   - *doc-vs-doc drift* — common doc and per-kind doc disagree;
   - *a step with no tool* — the doc describes a future (fix: needs a REQ).
3. Gallery at `web/preview/req-0148-audit/` showing what each pipeline actually
   produced — **including the empty frames**, which are the honest result for a
   pipeline that cannot generate.
4. A reserved follow-up REQ per defect that an edit cannot fix. **This REQ
   implements none of them.** That abstinence is what makes the audit worth
   trusting.

## 7. Out of scope

- Quality improvement, checkpoint change (REQ-0136), matte re-litigation
  (REQ-0135b settled; REQ-0147 owns its question).
- Implementing P2/P3/P4 for real (REQ-0127 / REQ-0131 / REQ-0138 own those) or
  writing the monster doc (REQ-0111). This REQ records what is missing and what
  it costs.
- TM icons (SVG route — no AI stage).
- S7 aesthetic judgement. Not ours.

## 8. Risks

- **Art-session contention.** The user's own art shares this GPU. Idle-check
  before every start; wait, never evict; release promptly.
- **OOM on the 23 GB box.** The two-pass rule above, enforced by the orchestrator
  even where the doc omits it.
- **P1 — the only "verified" route — may also be broken.** Plausible, given the
  batch-003 NG and REQ-0136's reopening. It will be reported plainly, not
  softened.
- **The audit may conclude that a RATIFIED golden is unbuildable as written**
  (P4 is the candidate). Ratification was of the design, not of an executed run;
  saying so is the entire point of this REQ.

## 9. Gate results

_(to be filled during execution)_

## 10. Outcome

_(to be filled at close)_
