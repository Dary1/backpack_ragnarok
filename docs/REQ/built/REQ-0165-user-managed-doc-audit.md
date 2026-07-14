# REQ-0165 — user_managed doc audit (source-as-truth)

**Status:** built — llm_managed deliverables written; no user_managed file touched.
Awaiting user acceptance of the correction proposals.
**Reserved:** 2026-07-14
**Slug:** user-managed-doc-audit
**Precedent:** REQ-0123 (unit/squad rename, docs), REQ-0124 (rename, sources)

## Trigger

User, 2026-07-14 chat: parts of `docs/user_managed/**` have gone stale — in particular
the doc-level equation of BP with "Unit", whose meaning changed with the 2026-07-12
world-model pivot (REQ-0123). Directive: **read the sources, treat the SOURCE as the
truth, and find the errors in the user_managed docs.** Follow-up directive: produce a
replacement for the user_managed correction proposals; `llm_managed` may be edited
directly.

## Method

Every claim in the four `docs/user_managed/*.md` files was re-derived from master's
sources — never from another doc:

- `mock-src/engine.js` (canvas/BP/PO/socket/beam model)
- `sim/lib/{geometry,ray,entry,field,formation,skills,encounter}.cjs` (combat)
- `server/services/{core,gacha,runs,rooms,market}.cjs`, `client/src/i18n/**`
- `content/live/**`, `content/vocab.json` v9

## Findings (summary — full detail + evidence in the deliverable)

**Root cause.** The pivot moved `Unit` from "canvas owner" to "character piece in one BP
cell", and `Linker` → `Unit`. On master a **BP and a Unit are 1:1** (gacha stamps one
Unit seat per BP, unconditionally). The golden docs still use the pre-pivot senses, so
their "Unit" sentences now read as the wrong statement rather than as an obviously
outdated one — `canvas_spec.md`'s "the unit does not have HP" being the worst case.

**Factual divergences from the sources (not mere renames):**

1. `canvas_spec.md` — "a BP may contain one Linker **or none**": no such BP exists.
2. `canvas_spec.md` — the Unit's cell rejects PO placement (`why:'Unit cell'`); the doc
   omits the rule and mislabels the layer.
3. `backpack_battle_spec.md` — `formation4`'s flagged data issue (`J11:Q19`, 9 rows,
   unlabeled boxes) is **resolved** in the sources: `J11:Q18`, explicit
   left_wing/center_top/right_wing/backline_center, with a load-time 8×8 assertion.
4. `backpack_battle_spec.md` — **all four** `open_items_still_unresolved` are resolved
   (penetration exhaust = stop, and a bounce never consumes pen; AOE = Chebyshev on
   shared-field cells; both formation4 items).
5. `backpack_battle_spec.md` — entry cells are centroid-projected + jittered, not free;
   and the diagonal is fixed only on the left/right edges (top/bottom fan two ways,
   picked from the ray RNG stream).
6. `backpack_battle_spec.md` — bounce-5 strikes **every live occupant** (enemies too),
   not "all BPs", and still applies its AOE splash.
7. `backpack_battle_spec.md` — the field is **two** independent A1:Z18 planes; the
   "single shared plane" holds only within one side.

**Verified still correct** (explicitly listed in the deliverable so they are not
"fixed" by mistake): 8-dir first-hit non-piercing link rays incl. mutual links; PO
confined to one BP; port directionality; the separate Socket-Type hierarchy; bounce
multipliers; A1:Z18 / 8×8 dimensions; Transmutator (LRDST) as the only currency;
asymmetric combat (enemies hold no canvas); Frozen Canvas.

**Errata against REQ-0123's own deliverable:** v1 of the suggestions file itself said "a
BP may contain one Unit or none" (wrong), and proposed renaming the `unit1..unit4`
formation KEYS (harmful — they are live persisted slot keys ledgered as legacy by
REQ-0124).

## Deliverables (this branch)

- `docs/llm_managed/user_managed_rename_suggestions.md` — **rewritten as v2**: filename
  kept for REQ-0123 traceability; now covers factual corrections, not just renames; each
  item carries its source evidence; adds "verified correct — do not touch" sections and
  an Errata section.
- `docs/llm_managed/terminology_unit_squad.md` — appended "The BP:Unit law", so the
  glossary of record states the 1:1 rule and kills the "or none" error at its source.

## Out of scope

- `docs/user_managed/**` — golden; **not touched**. All corrections are proposals.
- `formation.xlsx` — user-owned; the `J11:Q19` fix is proposed, not applied.
- Any source change. The sources are the truth here, not the patient.

## Gates

- Every finding re-verified against the source file it cites (done; two passes).
- No file under `docs/user_managed/` modified — `git show --stat` proves it.
- User accepts (or rejects) the v2 proposals before anything reaches the golden docs.
