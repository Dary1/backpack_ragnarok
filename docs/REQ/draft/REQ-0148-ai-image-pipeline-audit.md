# REQ-0148 — AI Image Pipeline Audit (all image-generating content pipelines)

**Status:** Draft (awaiting user ratification)
**Reserved:** 2026-07-13
**Slug:** ai-image-pipeline-audit
**Branch / worktree:** `req-0148-ai-image-pipeline-audit`
**Depends on / touches:** REQ-0073 (raster route), REQ-0109 (route recovery),
REQ-0111 (monster doc, draft), REQ-0127 (unit icon gen, todo), REQ-0131 /
REQ-0138 (bpskin, todo), REQ-0133 (raster live wiring, draft), REQ-0136
(checkpoint bakeoff, todo), REQ-0139 (ComfyUI service, todo), REQ-0147 (matte
background clause, draft).

---

## 1. Problem

Five content pipelines claim an AI image-generation stage (S5 Art), but only
ONE — the item (PO/SI) raster route — has ever been walked end-to-end, and that
was on 2026-07-09 with V9. Since then: batch-003 art was rejected by the user
at S7 ("NG"), LayerDiffuse was ruled NO-GO (REQ-0135b), the checkpoint itself
went under re-evaluation (REQ-0136), and the matte prompt clause was reopened
(REQ-0147). Three of the five pipelines have a RATIFIED golden but **no
implementation at all**; one (monster) has no document beyond a stub.

Nobody knows whether an operator handed these documents can actually produce an
image. The documents are the product here: if a cold operator cannot follow them
top-to-bottom without improvising, the pipeline does not exist — it is a story
about a pipeline.

**This REQ does not fix any pipeline. It measures them, honestly, and reports.**

## 2. Binding user decisions (2026-07-13)

- **D1 — Scope:** every pipeline that contains an AI image-generation stage.
  All five. No exemptions for "not implemented yet" — a pipeline that cannot
  generate IS a finding, and must be recorded as one, not skipped.
- **D2 — Depth:** real generation. **The user has granted explicit, fresh
  go-ahead to use the art ComfyUI / GPU for this REQ** (this is the standing
  HANDS-OFF exception required by PROJECT.md "Server home" §HANDS-OFF; it is
  scoped to this REQ and does not generalise).
- **D3 — Judge:** a **cold subagent**, given the documents and nothing else,
  re-runs each pipeline from scratch. The orchestrator does NOT fill in the
  gaps. Every place the subagent has to guess, ask, or improvise is logged as a
  documentation defect. The orchestrator's own knowledge is disqualified as
  evidence.

## 3. Subjects under test

| # | Pipeline | Doc (authoritative) | Impl | Prior E2E evidence |
|---|---|---|---|---|
| P1 | Item (PO / SI) icons | `item_content_pipeline.md` v2.1 §Step 5 | `tools/gen_item_icons.py` | 2026-07-09, V9 — the only one |
| P2 | TM icons | `tm_content_pipeline.md` v1.0 §3 | (claims reuse of P1) | none |
| P3 | Unit icons | `unit_icon_pipeline.md` v1.1 (RATIFIED) | none (REQ-0127 todo) | none |
| P4 | Backpack Skins | `backpack_skin_pipeline.md` v1.1 (RATIFIED) | none (REQ-0131/0138 todo) | none |
| P5 | Monster art | **stub only** (REQ-0111 draft) | `tools/gen_monster_art.py` | none |

Shared layer under test with all five: `common_content_pipeline.md` §2 (Art
Golden) and §4 (S0–S8 ladder).

## 4. Method

For each pipeline P1–P5, in this order (P1 first: if the only verified route is
broken, every downstream verdict is noise):

1. **Cold run.** Spawn a fresh subagent with: the pipeline doc, the common doc,
   PROJECT.md, server access. NOT with: this REQ, prior REQs, orchestrator
   commentary, or any hint of the expected answer. Instruct it to execute the
   document's art stage top-to-bottom against a small fixed input (below) and to
   **stop and report the moment the document stops telling it what to do**.
2. **Log every improvisation.** Each guess, each "I inferred that…", each
   command not written in the doc, each path that did not exist. This log is the
   deliverable; the images are the by-product.
3. **Reach an image or a wall.** Either the run produces a PNG that survives
   `tool_icon_score.py`, or it hits a wall. Both outcomes are valid results.
   A wall is recorded with the exact line of the doc that failed.

**Fixed inputs** (identical geometry across pipelines so the results compare):
one 1×1 subject and one 1×2 subject per pipeline, 4 candidates each, seeds
101/202/303/404 — the already-verified rows of the `gen_render` table.

### Rules of engagement (host constraints — binding, from REQ-0135b)

- **The box is 23 GB and the GPU is an RTX 2080 (8 GB).** ComfyUI (~11 GB RSS
  with SDXL resident) and birefnet (~12 GB) **cannot be co-resident**; they OOM.
  Generation and matting are SEPARATE passes: `--no-matte` → stop ComfyUI →
  `--rematte-only`. A subagent that does not discover this from the doc is a
  finding, but the orchestrator MUST NOT let it thrash the box.
- **ComfyUI is not a service** (REQ-0139 is todo). It is started by hand at
  `127.0.0.1:8188`. Before starting it, confirm the GPU is idle — the user runs
  art sessions on this same box, and this REQ must never evict one. If the GPU
  is busy, the run **waits**; it does not kill.
- Checkpoint: `JuggernautXL_RunDiffusionPhoto2_V9_Final` — **as documented, not
  as improved.** REQ-0136 may change it later; testing V9 is the point, because
  V9 is what the doc says.
- Do not touch `~/ComfyUI` contents, art worktrees, or `monster_matte_variants/`.
  Read and run only. Nothing is installed, no node is added, no weight is moved.

## 5. Pass criteria

A pipeline **PASSES** only if the cold subagent, using the document alone:

- **C1 — Reaches an image.** A candidate PNG exists at the documented path.
- **C2 — Zero improvisation on the happy path.** Every command it ran is either
  written in the doc or a direct, unambiguous instantiation of a documented
  template. Inventing a flag, a path, or a step = FAIL.
- **C3 — The artefact is legal.** It clears the Art Golden as machine-checked:
  per-cell coverage ≥ 20% (`tool_fit_check.py` CHECK), aspect preserved, matte
  band 2–90%. (Aesthetics are NOT judged here — that is S7, and S7 is the
  user's, not this REQ's.)
- **C4 — Reproducible.** A second run at the same seeds yields the same winner.

Anything less is a FAIL **with a named cause**. "Not implemented" is a legitimate,
expected verdict for P3/P4 and is not a failure of this REQ — it is the finding.

## 6. Deliverables

1. `docs/llm_managed/ai_image_pipeline_audit_2026-07.md` — the report. Per
   pipeline: verdict (PASS / FAIL / NOT-IMPLEMENTED), the wall it hit, the exact
   doc line at fault, and the improvisation log.
2. **A defect list, ranked**, distinguishing three kinds of rot, because they
   have different owners:
   - *doc-vs-reality drift* (the doc lies about what exists) — fixable by editing docs;
   - *doc-vs-doc drift* (the common doc and a per-kind doc disagree);
   - *genuinely absent implementation* (the doc describes a future) — needs a REQ.
3. A numbered gallery under `web/preview/req-0148-audit/` showing whatever each
   pipeline actually produced — including the empty frames, which are the honest
   result for a pipeline that cannot generate.
4. Follow-up REQs reserved for each defect that cannot be fixed by an edit.
   **This REQ fixes nothing itself** — that discipline is what keeps the audit
   trustworthy.

## 7. Out of scope

- Improving image quality, changing the checkpoint (REQ-0136), or re-litigating
  the matte route (REQ-0135b: settled; REQ-0147: has its own REQ).
- Implementing P3 / P4 (REQ-0127 / REQ-0131 / REQ-0138 own those).
- Writing the monster pipeline doc (REQ-0111 owns it) — this REQ only records
  that it is missing and what that costs.
- S7 aesthetic judgement. Not ours.

## 8. Risks

- **Art-session contention.** The user's own art work shares the GPU. Mitigation:
  idle check before every start; wait, never evict; release promptly.
- **OOM on the 23 GB box.** Mitigation: the two-pass rule above, enforced by the
  orchestrator even when the doc fails to state it.
- **The audit finds that P1 — the one "verified" route — is also broken.** This
  is a plausible outcome given the batch-003 NG and the REQ-0136 reopening, and
  it must be reported plainly rather than softened.

## 9. Gate results

_(to be filled during execution)_

## 10. Outcome

_(to be filled at close)_
