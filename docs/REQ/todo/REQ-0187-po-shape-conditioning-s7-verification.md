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
