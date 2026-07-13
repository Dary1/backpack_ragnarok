# REQ-0154 — content-pipeline-registry-reconcile: pipeline docs rewritten for the registry era, on a path to user_managed

**Ratified:** 2026-07-13 (user, chat) — including rulings on Q1/Q2 below. The REQ folder is
the sole status record.
**Requested by:** user, 2026-07-13 (chat): once the adopted-seed registry (REQ-0151/0155) becomes
the standard, the content pipeline changes; file a REQ to update the pipeline docs with the REQ
dependency graph included. **End goal: refine ALL content-pipeline docs to the quality where the
user promotes them to docs/user_managed (frozen golden).**

**A DOCS REQ.** No production code changes. It lands in waves, one wave per upstream merge.

## Canonical target flow (user, 2026-07-13 — the operating model the docs must converge on)
```
user commissions a content batch from the LLM
  -> foreach content in batch {
       generate 5 artwork renders            (REQ-0151 registry, flux2 route)
       -> machine scoring                    (REQ-0152 kits; REQ-0153 shape recipe if GREEN)
       -> separate-agent provisional adopted-seed decision   (advisory, recorded)
       -> generate 5 content-data variants   (REQ-0155 content registry, LLM x5)
       -> machine validity checks            (tool_gen_data / self_test_vocab /
                                              check_engine_types / tool_integrate dry-run)
       -> separate-agent validity review     (advisory, recorded)
     }
  -> batch reviewer surface
  -> user reviews: check off / edit content / change seed-variant
  -> ALL contents checked -> release (export via integrate into content/live)
```
Human adoption remains the only binding act (S7 doctrine); every agent verdict is advisory and
recorded with its rationale.

## Scope
1. **Rewrite/reconcile the pipeline docs** in docs/llm_managed/ to describe the registry-era
   flow above as THE pipeline: `common_content_pipeline.md` (the spine),
   `item_content_pipeline.md` (PO/SI split per REQ-0151 ruling 8),
   `monster_content_pipeline.md` (currently a stub), `unit_icon_pipeline.md`,
   `tm_content_pipeline.md`, plus registry cross-references in `art_pipeline.md`.
   Batch-file conventions, seed policy, adoption contract (system_name -> adopted seed/variant),
   export path, and the advisory-inspection doctrine all stated once in the spine and referenced
   by the per-kind docs.
2. **Absorb / supersede the pending doc REQs**: REQ-0111 (monster-content-pipeline-doc, draft)
   and REQ-0130 (unit-def-content-pipeline, draft) — their content lands as this REQ's monster
   and unit waves; move them per REQ-board policy (one `git mv` per commit) with a supersession
   note rather than leaving parallel doc REQs open. Coordinate REQ-0133 (item raster live
   wiring, draft) — its wiring becomes the registry export contract.
3. **REQ dependency map** (maintained IN the spine doc, updated each wave):
   REQ-0150 (flux2 route, done-when-merged) -> REQ-0151 (artwork registry admin)
   -> REQ-0152 (inspection kits, advisory) and REQ-0153 (PO shape spike; recipe folds into the
   item wave if GREEN) -> REQ-0155 (content-data registry) -> batch orchestrator + reviewer
   (future REQ, reserved when 0151/0155 are built) -> final doc wave -> promotion.
4. **Promotion path** (the end goal): when a doc's wave is complete and it has survived one
   real batch unchanged, stage a verbatim candidate copy as
   `docs/llm_managed/promotion_candidates/<name>_CANDIDATE.md`, listed in a one-line-per-file
   note (the `user_managed_rename_suggestions.md` mechanism). **The user moves candidates into
   docs/user_managed/ and commits; no LLM ever writes user_managed.** Volatile operational
   detail (box timings, OOM lore, tool flags) stays in llm_managed companions — frozen docs
   carry only ratified contract-grade content, so they do not rot.

## Wave plan (docs land after the code they describe merges — never before)
- Wave 0 (now ratifiable): spine skeleton + dependency map + this flow diagram + promotion
  mechanics.
- Wave 1 (after REQ-0151 merges): registry contract, PO/SI, adoption/export, item doc rewrite.
- Wave 2 (after REQ-0152): advisory-inspection doctrine + kit references.
- Wave 3 (after REQ-0153 verdict): PO shape-conditioning recipe (or its recorded rejection).
- Wave 4 (after REQ-0155): content-data variants, validator wiring, monster/unit/tm rewrites
  (absorbing REQ-0111/0130).
- Wave 5 (after batch orchestrator): batch reviewer flow; then promotion candidates staged.
Multi-phase policy: keep one REQ file while all waves share a status; split
(REQ-0154a…) only if waves need independent statuses.

## Gates
- G1 doc-vs-code: every statement in a rewritten doc is true of MERGED code (the REQ-0150 audit
  lesson: never freeze a doc describing uncommitted behavior); spot-verified per wave.
- G2 single-source: batch conventions / seed policy / adoption contract each stated in exactly
  one place; per-kind docs reference, never restate (drift-proofing for the freeze).
- G3 dependency map current at every wave commit.
- G4 promotion candidates are verbatim-copyable (no llm_managed-only cross-references that would
  dangle inside user_managed).
- S7 per wave: user reads the wave's docs; final S7 = user executes the promotion.

## Out of scope
- Any production code (registries, kits, orchestrator are their own REQs).
- The batch orchestrator + reviewer implementation (future REQ; only mapped here).
- The promotion act itself (user-only, by design).

## Risks
- Docs racing code: mitigated by the wave rule (docs land only after merges).
- REQ-0111/0130 authors' intent lost in absorption: their draft content is read and folded in,
  with attribution notes, before their files are moved.
- Freeze-then-rot: mitigated by G2/G4 and the volatile/contract split.

## Resolved questions (user rulings, 2026-07-13)
- Q1 ABSORB BOTH: REQ-0111 and REQ-0130 content folds into the waves with attribution;
  their files close with supersession notes (one `git mv` per commit, per board policy).
- Q2 ONE FILE: keep ONE REQ file for all waves; split (REQ-0154a…) only if waves need
independent statuses. Applied: this REQ is one file; waves 0–4 share the `built`
status. (This line restores the ruling text that the source truncated at
"- Q2 ONE FILE:"; no new decision introduced.)

## Implementation log

### Session 2026-07-14 (implementing writer, worktree req-0154; waves 0–4 — all upstream code MERGED)

A DOCS REQ. No production code touched. All statements verified against the MERGED
code on this branch (master merged in: REQ-0150 done + REQ-0151/0152/0153/0155 built).
Where a capability is merged but not deployed/S7-accepted, the docs SAY SO in status
lines rather than describing it as live.

**Waves landed (one commit per wave; per-kind docs REFERENCE the spine, never restate — G2):**
- **Wave 0** `62ed361` — spine `common_content_pipeline.md` → v1.1: new §6 (registry-era
  operating model + the canonical target flow verbatim + flow→code map), §7 (registry
  contracts: batch-file conv, seed/variant, adoption, export, advisory doctrine —
  single-source), §8 (REQ dependency map, G3), §9 (promotion path & mechanics, G4).
  §§1–5 (incl. §2 Art Golden, §4 S0–S8) preserved verbatim so existing cross-refs
  stay valid.
- **Wave 1** `28be28f` — `item_content_pipeline.md` → v3.0 §0: PO/SI facet split
  (REQ-0151 ruling 8), sizing law, adoption/export → references spine §7.
- **Wave 2** `89ead05` — advisory-inspection doctrine detail: `art_pipeline.md` §8
  (artwork registry as system-of-record + REQ-0152 kit roster v1 + metric-naming
  disambiguation + deprecations + REQ-0153 cross-ref); spine §7.5 → §8; item doc names
  the PO/SI kits. `art_pipeline.md` §§0–7 (REQ-0150 content) NOT rewritten, only §8
  appended as a reconcile/cross-reference.
- **Wave 3** `32b13a8` — `item_content_pipeline.md` §0.1: the REQ-0153 GREEN-with-recipe
  PO shape-conditioning recipe (Arm C @ D=8) as an AVAILABLE hand-off, production route
  untouched, per-item-toggle recommended, post-hoc fit stays the final gate.
- **Wave 4** `46687fb` (+ moves `4e9d840`, `36f06a1`) — content-data facets +
  monster/unit/tm rewrites: `monster_content_pipeline.md` v1.0 (stub → full doc,
  absorbs REQ-0111), `unit_icon_pipeline.md` v1.2 §4 (absorbs REQ-0130 def sketch,
  provisional), `tm_content_pipeline.md` v1.1 (tm_def facet, no artwork kind);
  REQ-0133 coordination note (item doc §0 + appended to REQ-0133, which stays draft).

**Docs written/rewritten (final line counts):** common_content_pipeline.md 359 ·
item_content_pipeline.md 436 · monster_content_pipeline.md 114 (was an ~40-line stub) ·
unit_icon_pipeline.md 252 · tm_content_pipeline.md 211 · art_pipeline.md 336
(§8 appended; §§0–7 untouched).

**REQ-0111 / REQ-0130 disposition (Q1 ABSORB BOTH):** both read first, folded with
attribution (monster doc / unit §4), closed with a supersession note recorded IN each
file, then `git mv draft → done` one move per commit (`4e9d840`, `36f06a1`).
Disposition recorded: "superseded by REQ-0154, content absorbed."

**Gate results**
- **G1 doc-vs-code (spot-verified, claim → code):**
  - "artwork kinds are `po|si|unit|monster|bpskin`, no `tm` kind" →
    `server/migrations/007_artwork.sql:21` `CREATE TYPE artwork_kind AS ENUM (...)`
    (drives the tm-doc "no artwork facet" claim and the monster/unit facet claims).
  - "content variants are immutable, keyed `UNIQUE(content_id, variant_no)`, kinds
    `po_def|si_def|monster_def|unit_def|tm_def`" → `server/migrations/009_content_defs.sql`
    (enum L25, UNIQUE L53, immutability trigger L88–106) + `server/storage_content.cjs`.
  - "sizing law: si 256×256 locked; monster 128 px/cell (goblin 3×4→384×512, chimera
    6×4→768×512, ancient dragon 10×10→1280×1280); po 256 px/cell" →
    `server/services/art_sizing.cjs` (`deriveSize`, examples in the header comment),
    matching REQ-0151 gate G2.
  - "enemies are `enemy/1` defs under `content/live/dungeon/`, loaded by core.cjs; NO
    dedicated enemy validator" → `content/live/dungeon/enemies.json` (`"schema":"enemy/1"`),
    `server/services/core.cjs:30/89/116`, `shared/content_validate.cjs:145`
    (`kind === 'item' ? ITEM_ALLOWED_KEYS : SI_ALLOWED_KEYS` — item|si only).
  - "advisory inspection kits persist to `render_inspections`, re-run route, all advisory
    except the bpskin frame gate" → `server/migrations/008_render_inspections.sql`,
    `server/routes/art.cjs:278` (`RE_INSPECT`), REQ-0152 kit manifest `tools/inspect_kits.json`.
  - "REQ-0153 recipe NOT wired; production route byte-identical" → `tools/art_route.py`
    carries no reference/mask inputs (recipe is a spec addendum in REQ-0153).
- **G2 single-source:** conventions stated once in spine §7; per-kind docs reference
  §7.x / art_pipeline §8; no restatement. Verified anchors all resolve.
- **G3 dependency map:** spine §8 current, marks DONE vs BUILT-S7-open vs FUTURE; the
  map was correct at every wave commit (statuses stable across waves).
- **G4 (adapted, no dangling refs):** every cross-reference resolves to a real section
  (spine §§6–9/§7.1–7.5, art_pipeline §8, item §0/§0.1 "Shape conditioning"); the
  `promotion_candidates/` directory is intentionally NOT created and nothing references
  a file inside it. NO candidates staged (per spec: "survived one real batch unchanged"
  is unmet — no real batch has run).
- **S7 per wave: OPEN** (user reads each wave's docs). Final S7 = user executes the
  promotion.

**Remaining (wave 5 + promotion — future):**
- Wave 5: the batch-reviewer flow doc, authored AFTER the batch orchestrator + reviewer
  REQ ships (not yet reserved; mapped in spine §8).
- Promotion: stage `*_CANDIDATE.md` copies + list them in
  `user_managed_rename_suggestions.md` only AFTER the first real batch runs a doc through
  unchanged; the user then moves candidates into `docs/user_managed/`. No LLM writes
  user_managed.
- S7 acceptance on all four upstream REQs (0151/0152/0153/0155) also remains open; the
  docs reflect BUILT-not-live status accordingly.

**This REQ:** waves 0–4 complete and green → `todo → built`. Wave 5 + promotion remain,
so this lands in `built/`, NOT `done/`.
