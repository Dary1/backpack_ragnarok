# REQ-0187 — po-shape-conditioning-s7-verification: eyeball REQ-0183 + REQ-0186 on real renders

**Ratified:** 2026-07-15 (user, chat) — "確認を別のREQにやらせるので、確認ジョブ用のREQを立てて".
REQ-0183 and REQ-0186 were accepted and moved to `done/` on the user's ruling WITHOUT the
S7 eyeball; this REQ owns that eyeball as a separate job. Accepting the code and verifying
the pictures are deliberately split — the split is the point of this REQ, not an oversight.

## Why this exists

REQ-0183 wired REQ-0153's GREEN recipe into po generation; REQ-0186 made it tunable and
defaulted it to `auto`. Both are merged, deployed, and live-verified **at the API level**:
prompts, locks, graphs, provenance, validation, 400s. Every gate is green
(ci.sh CI GREEN, artwork_test 11/11, artadmin e2e 5/5, art_inspect 1/1).

**Not one real image has been looked at.** ComfyUI was busy with another session's job for
the entire duration of both REQs, and per the standing GPU etiquette (serialize, coordinate,
no retry storms) no demo render was queued. Everything asserted about IMAGE QUALITY so far
is inherited from REQ-0153's spike matrix, not observed on the production route.

The distinction matters. REQ-0153 measured its own spike scripts. REQ-0183/0186 reproduce
that recipe through `art_route`/`art_job`, and the graph was proved node-for-node identical
to the spike's validated `wf_armC` — but "the graph is identical" is an argument, not a
picture. This REQ closes that gap.

## Blocking precondition — there is nothing awkward to test on

**Every po artwork in the live registry today is a FULL RECTANGLE** (verified 2026-07-15
across all 22: iron_sword 1x3, iron_shield 2x2, large_iron_shield 2x3, healing_potion 1x2,
blade / flame_tablet / oil_flask 1x2, hilt 1x1, ...). So `auto` resolves to `off` for the
entire registry, and the shape-conditioning path is currently DORMANT in production.

Nothing can be verified until an awkward footprint exists. This REQ must therefore create
its own test artworks (L-tromino, T-tetromino) — the exact shapes REQ-0153 measured the
baseline missing on. They are test data in the LIVE registry: name them so they are
obviously disposable (e.g. `req0187_l_axe`, `req0187_t_hammer`) and delete them when done.
Alternatively the owner draws a real awkward item and this REQ verifies against that; the
owner's own item is better evidence than a synthetic one.

## What to verify

**V1 — strict actually fits the cells (the headline claim).**
L-tromino `battle axe` + T-tetromino `war hammer`, `lock=strict` @ D=8, seeds {1,2,3,4}.
Score the matted alpha with the same identity-fit machinery REQ-0153 used
(`tool_icon_score` / the `po.cell_packing` kit). REQ-0153 claims 100% identity-fit feasible
with zero deep-overflow against a 28.6% baseline. Does the PRODUCTION route reproduce that?

**V2 — the auto rule earns its default.**
Same two shapes at `lock=off` (what auto would do if the rule were wrong) vs `strict`.
Then a full rectangle (2x2 `round shield`) at `off` (= auto's answer) vs `strict`.
The claim to test is REQ-0186's whole basis: strict rescues the awkward shapes, and off
keeps the heater-shield character on the square that strict flattens into a plain disc.
**If the 2x2 at `off` does NOT visibly beat `strict` on subject character, auto's default
is wrong and REQ-0186 needs revisiting** — that is a real possible outcome of this REQ, not
a formality.

**V3 — guide is honestly described.**
`lock=guide` on the L. REQ-0186's docs claim guide buys CONTAINMENT (~60%), NOT legibility,
because REQ-0153 saw the war hammer go abstract under A *and* C. Confirm guide does not
secretly read better than strict — if it does, the docs and the lock descriptions are
misleading operators and must be corrected.

**V4 — the compare workflow.**
Through the live artadmin UI: same seed, generate at two locks via the one-shot override,
compare in the lightbox, confirm `params.shape_lock` distinguishes them, PATCH the winner
onto the artwork, confirm the artwork default changed and the override did not mutate it.

**V5 — ops.**
Wall time per conditioned render (REQ-0153 measured 76-130 s vs 15-50 s plain) and VRAM
peak (6.7-6.8 GB on the 8 GB card, no OOM). Confirm on the production route. A regression
here is a real finding: REQ-0183 made every po render pay this.

## GREEN criteria
- V1: strict is identity-fit feasible with zero deep-overflow on a clear majority of the
  L/T renders, and visibly beats `off` on the same seeds in the gallery.
- V2: the 2x2 at `off` keeps subject character that `strict` loses, at no fit cost.
- V3: guide's behaviour matches its stated description (containment, not legibility).
- V4: the override/compare/save loop works end to end and is attributable.
- V5: no OOM; timings within the REQ-0153 envelope.

An AMBER/RED outcome is a legitimate result and must be recorded as such, with the follow-up
REQ it implies (e.g. change auto's rule, re-word the lock descriptions, or revert a default).

## Deliverable
- A gallery for the eyeball, published **`web/preview/req0187-shape-conditioning/`** so it is
  reachable at `https://backpack-dev.qtie.jp/preview/req0187-shape-conditioning/`.
  This is the standing convention (REQ-0136 `preview/bakeoff-0136`, REQ-0138
  `preview/bpskin-tiling-0138`, `overlay-a11y-req0143`, `batch-001/003/004`, `units-001`).
  **REQ-0153 skipped this step and its gallery sat unreachable in `content/batches/` until
  the user asked why — do not repeat that.** Publishing to the main checkout's docroot needs
  a fresh user go-ahead (PROJECT.md HANDS-OFF).
- `findings.json` + the verdict recorded in this REQ file, either way.
- Keep the committed image set SMALL (winning/illustrative renders only; the full matrix
  lives in gitignored `data/`) — the REQ-0150 history bloat lesson.
- Delete the `req0187_*` test artworks from the live registry when done.

## Constraints
- **GPU etiquette is binding.** The owner runs art sessions on the same 8 GB card;
  ComfyUI serializes its own queue, so submit and wait. Do not queue against a busy GPU
  without coordinating, never retry-storm, and reuse the `--no-matte` -> `--rematte-only`
  sequencing (REQ-0153: 8 OOM kills came from co-resident matting).
- Budget ~76-130 s per conditioned render: the full matrix is hours, not minutes.
- Do NOT modify the production route/admin. This REQ observes; if it finds a defect it
  writes a follow-up REQ.
- e2e ports, if any harness is needed: **1870-1879** (derived, `tools/e2e_ports.sh 0187`).

## Out of scope
- Monster/si/unit shapes; any new arm or mechanism; re-running REQ-0153's spike matrix.
- Changing defaults — that is the follow-up REQ this one may recommend.

## Session log — 2026-07-15 (S7 eyeball in progress; user in the loop)

Route sanity (V1 partial; production route; test artwork `req0187_l_axe` id 2062,
L-tromino, created via the admin API):
- create/preview/generate resolve `auto -> strict @ D=8`; `params.shape_lock`
  records the resolved lock; containment REPRODUCES: `deep_overflow_px = 0`,
  `identity_feasible = true` on the scored strict render (REQ-0153 machinery:
  birefnet matte -> identity metrics, run one-off in /tmp).
- Ops (V5 partial): warm strict render 40-130 s, VRAM ~6.7 GB, no OOM. ComfyUI
  cold start (REQ-0158 idle-free) paid ~508 s of model reload inside an 880 s
  first-render wall.

**Headline S7 finding: containment is NOT fit.** Seed 1 (default template)
passed every V1 gate (deep_overflow 0) yet composed the axe DIAGONALLY across
the L's bounding box (per-cell coverage 0.53/0.09/0.17) — unusable in the
backpack grid. User-articulated and verified across seeds 11-14 (orientation
prompt) and 21-24 (anatomy prompt): fit-feel is violation-based; axis-alignment
is promptable (0/1 -> 7/8 across rounds); the L/T distinction is ATTACHMENT
TOPOLOGY (a symmetric-headed axe is a T-object — round 1's four renders all fit
the T by translation alone); mask ORIENTATION must match the subject's natural
pose (the axe's native L is notch-bottom-right, not the notch-top-right L this
REQ ordered). Full doctrine: `item_content_pipeline.md` §0.2 (written this
session, user directive: edit existing docs, no new files).

Consequences for this REQ's spec:
- V1-V3 GREEN criteria are necessary-but-insufficient; the honest verdict must
  weigh the §0.2 violations, not identity-fit alone.
- Deliverable changed by user ruling (chat, 2026-07-15): NO preview gallery —
  renders are reviewed in the live artadmin (`req0187_l_axe`). Findings land
  here + §0.2.
- Proposed follow-up (user design): instrument-driven revision loop —
  instruction -> 3 seeds -> structured findings -> revised instruction -> ... ->
  present ~10 renders + findings as artwork variations. Instruments as
  OPTIMIZERS, not gates. Constraint: `renders.seed` UNIQUE per artwork, so
  same-seed A/B across rounds needs render deletion or distinct seeds.

Open: natural-orientation L test; T-tetromino subject (war hammer IS a T-object
— expected easy case); V2 (auto's default) / V3 (guide) / V4 (UI compare loop);
delete `req0187_*` artworks when done.

## Revision-loop live run — 2026-07-15 (user + LLM, req0187_scythe)

The user-designed loop (instruction -> 3 seeds -> meter -> revised instruction
-> 3 seeds -> revised -> 4 seeds -> present all 10 with scores) executed live
on a complex 6-cell footprint (3x3 bbox: shaft column + blade top row + a
dipped tip cell (1,2)); auto -> strict @ D=8 on every render; po.cell_fit
scored each render automatically in artadmin.

Scores (fit / worst cell): R1 24.2, 26.3, 20.4 (tip cell missed everywhere);
R2 (added plunge wording + thick shaft + grip) 25.9, 26.4, **66.1 best**
(seed 43; tip cell 0.96 -> 0.00 on 42/43); R3 (added "level along the very
top all the way to the corner") 25.8, 40.4, 25.8, 31.0 — REGRESSION: the
model obeyed the new level clause and dropped the proven plunge (seeds 51/53:
five cells v=0.00, tip cell v=1.00). Lessons written to S0.2 (revision
discipline; footprint-reshape corollary). Meter-to-revision causality
demonstrated both ways: a targeted clause fixed the measured worst cell, and
an interfering clause un-fixed it.

Deliverable state: 10 renders + po.cell_fit rows on req0187_scythe (live
artadmin); winner by meter and eyeball candidate = seed 43. Adoption is the
user's call. po.cell_fit kit + inspect_job stdout fix merged to master and
deployed mid-REQ at user direction. REQ-0191 (cell-shape backdrop) filed to
todo/. Test artworks req0187_l_axe / req0187_scythe still to delete at close.

## S7 verdict — 2026-07-16 (GPU eyeball completed)

**User GPU go-ahead GRANTED 2026-07-16.** ComfyUI queue empty; a single serialized
render stream, no retry storms, no co-resident matting (GPU etiquette honored). 19 renders
on the LIVE production route (auto default + one-shot lock overrides), each scored by the
production `po.cell_fit` meter (fit-meter v5, auto-run in artadmin). The wrong-orientation
`req0187_l_axe` (prior session) was re-scored with `po.cell_fit` as the mask-orientation
baseline. Every render was eyeballed (raw generation) in addition to the meter, per the
standing "containment is not fit" caution.

Evidence: `content/batches/req0187-shape-conditioning/` — `findings.json` + 6 illustrative
renders (committed, small). Full 19-render matrix + all cell_fit scores in gitignored
`data/req0187/`. Test artworks: `req0187_l_axe_nat` (natural-orientation L, notch
bottom-right), `req0187_t_hammer` (T-tetromino), `req0187_round_shield` (2x2).

Fit table (`po.cell_fit`; PASS = worst_cell_violation ≤ 0.5 [S7]; deep = deep_overflow_px):

| test | lock | n | median fit | median worst | PASS | max deep |
| --- | --- | --- | --- | --- | --- | --- |
| natural-L (notch BR) | strict | 3 | 68.3 | 0.38 | 3/3 | 0 |
| natural-L (notch BR) | off | 2 | 32.5 | 0.70 | 1/2 | 123 |
| natural-L (notch BR) | guide | 3 | 53.4 | 0.54 | 1/3 | 0 |
| **wrong-orient L (notch TR)** | strict | 9 | 39.1 | 0.71 | 2/9 | 0 |
| T-hammer | strict | 3 | 67.5 | 0.35 | 2/3 | 0 |
| T-hammer | off | 2 | 50.2 | 0.57 | 1/2 | 0 |
| round shield 2×2 | off | 3 | 71.8 | 0.32 | 3/3 | 0 |
| round shield 2×2 | strict | 3 | 81.3 | 0.21 | 3/3 | 0 |

**Per-V verdicts** (grading weighs §0.2 violations, not identity-fit alone):

- **V1 — strict fits the cells: GREEN.** Natural-L strict 3/3 PASS (median fit 68.3),
  T-hammer strict 2/3 PASS (median 67.5; seed 603 = 95.89, worst 0.0 — near-perfect T).
  Containment reproduced on the production route on 6/6 conditioned renders
  (deep_overflow_px = 0), and the composition is usable on a clear majority (5/6 PASS).
  The seed-1 "containment-not-fit" failure is now both caught (worst-cell gate) and
  avoided (correct mask orientation).

- **Mask-orientation (Open item): GREEN — confirms §0.2 rule 4.** Natural orientation
  (notch bottom-right): median fit 68.3, 3/3 PASS, median worst 0.38. Wrong orientation
  (notch top-right): median fit 39.1, 2/9 PASS, median worst 0.71. Correct orientation
  nearly doubles median fit and lifts PASS from 22% → 100%: the notch-top-right mask forced
  the axe handle onto the row center-line on almost every render, exactly as §0.2 predicted.

- **T-tetromino (Open item): GREEN — "T-objects fit by translation".** The war hammer (a
  genuine T-object, medial handle→head attachment) fills the T footprint by translation
  (603 = 95.89, 601 = 67.5). Heads read a touch abstract but legible as hammers.

- **V2 — auto's default earns it: AMBER.** The awkward-shape half HOLDS (L strict 68.3 vs
  off 32.5, off seed 511 = 4.88 with 123 px spill; T strict 67.5 vs off 50.2 — strict
  rescues awkward footprints). The **2×2 shield half REFUTES REQ-0186's stated rationale**:
  strict median fit **81.3 (3/3 PASS) BEAT** off median 71.8, and strict did **not** flatten
  the shield "into a plain disc" — it produced a characterful ROUND shield (boss, riveted
  rim, plank texture, weathering) that fills the square, while off produced dynamic HEATER
  shields that leave the square's corners emptier (the ~9-pt fit gap). REQ-0186's V2 GREEN
  criterion ("off keeps character strict LOSES, at no fit cost") fails on both clauses.
  auto→off is not catastrophic — off renders are attractive and more dynamic — but its
  documented justification is inaccurate, and off's full-rectangle silhouette is
  prompt-dependent (a detailed prompt drove off to a heater outline that underfills the cell).

- **V3 — guide is honestly described: GREEN.** Guide on the natural-L: median fit 53.4,
  1/3 PASS, high variance (20.96 diagonal / 53.42 centered / 94.86 lucky) — between off
  (32.5) and strict (68.3), matching the docs ("containment ~60%, not legibility"). Guide
  does NOT reliably read better than strict (1/3 vs 3/3 PASS; its floor is a diagonal
  legibility failure). One lucky render beat strict, but that is the lottery guide is
  documented to be. Lock descriptions are honest.

- **V4 — the compare workflow: GREEN (API-level).** Exercised the exact endpoints the
  artadmin UI calls: the shield was generated at `off` (701–703) and `strict` (711–713) via
  the one-shot generate override; `params.shape_lock` records off vs strict (attributable);
  the artwork default stayed `auto` through both overrides (override did not mutate). PATCH
  `{shape_lock:"strict"}` changed the artwork default; existing render params were untouched.
  Not driven through a browser (cannot) — the operator's one-click lightbox compare + Save
  remains to eyeball in the live artadmin.

- **V5 — ops: GREEN.** No OOM across 19 renders. VRAM peak observed ~5.5 GB (768×512
  conditioned) — LOWER than REQ-0153's 6.7–6.8 GB, because the production route runs matting
  as a separate CPU inspection job (not co-resident on the GPU as the spike did). Cold-start
  first render ~700–880 s wall (~508 s model reload after REQ-0158 idle-free); warm
  conditioned 512×512 ~60–150 s, 768×512 ~180 s, plain off 512 ~90–120 s. (768×512 at ~180 s
  is above REQ-0153's 76–130 s envelope — expected for the larger canvas, not a regression.)

**Overall: GREEN on V1 / V3 / V4 / V5 + mask-orientation + T-hammer; AMBER on V2.**

**Recommended follow-up REQ** (observation only — this REQ changes no defaults): correct the
lock/`auto` wording in REQ-0186 / `item_content_pipeline.md` §0.1 — `strict` does NOT
"flatten the shield into a plain disc"; on the 2×2 it out-fit `off` (81.3 vs 71.8) while
keeping character — and reconsider the `auto`→`off` premise for full rectangles: `off`'s
bbox fill is prompt-dependent and can underfill, so "off on every full rectangle" is a
per-item judgement best left to the operator via the (now verified working) override, not
sold on a picture-level claim the pictures do not support.

**Cleanup:** all `req0187_*` test artworks deleted from the live registry after evidence was
preserved — `req0187_l_axe` (2062), `req0187_l_axe_nat` (2764), `req0187_t_hammer` (2765),
`req0187_round_shield` (2766), `req0187_scythe` (2238).
