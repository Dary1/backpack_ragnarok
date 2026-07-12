> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# Common Content Pipeline — v1.0 (2026-07-12, REQ-0134)

> The SHARED layer for all content kinds. Per-kind deltas live in:
> `item_content_pipeline.md` (PO/SI) · `monster_content_pipeline.md` ·
> `tm_content_pipeline.md` · `unit_icon_pipeline.md` · `backpack_skin_pipeline.md`.
> Lineage: as-built refactor of `content_pipeline.md` v1.0 (REQ-0014 design;
> now a redirect stub; original text in git history). Stage numbering S0–S8
> is UNCHANGED. §2 integrates the former `art_golden.md` (abolished as a
> separate doc by user directive, 2026-07-12).

## 1. Principles (carried from v1.0; binding)

1. **Everything is data.** Content lives as schema-validated JSON; code
   interprets it. No content logic is ever hard-coded.
2. **Laws are machine-checkable.** Ratified laws become validators, not
   review checklists.
3. **LLMs draft; scripts judge.** Creative generation is delegated to
   subagents; every gate after drafting is a deterministic script. No LLM
   ever "approves" content.
4. **The user reviews samples and rules, not rows.** Every batch ships a
   numbered gallery on backpack-dev; verdicts refine rules; rules scale.
5. **Model economy (user directive).** Orchestrator = Fable (coordination
   only). Subagents: Opus 4.8 for creative/design-heavy work, Sonnet 5.0 for
   structured/technical work, Haiku for trivia. Never Fable.

## 2. Art Golden (binding) — integrated from `art_golden.md`

> `art_golden.md` was abolished as a separate doc by user directive
> (2026-07-12, REQ-0134). Its rules are carried here VERBATIM with their
> original dates. Any reference anywhere to "art_golden" (the doc or the
> rule set, any version v3.x) resolves to THIS section; historical citations
> like "art_golden v3.3" in tool comments and done REQs stay valid version
> references. Lineage note: v2 was removed entirely by the user 2026-07-03;
> the lighting rule was explicitly ruled unnecessary (2026-07-03).

### Coverage floor (binding)

Every owned cell of an icon must have **≥ 20% draw coverage** (content pixels / cell
pixels, measured by `tools/tool_fit_check.py` CHECK at 100 px/cell). Below 20% = FAIL;
resolution is a redraw or an explicit per-case user waiver — never a silent pass.
(v3 set this at 30%; lowered to 20% by user directive, 2026-07-03.)

### Aspect ratio is inviolable (binding, user directive 2026-07-04)

An icon's aspect ratio must NEVER be changed — by any tool, fixer, build step, or
renderer. There is no situation where anisotropic scaling is acceptable.
- Fit fixes may translate, uniformly scale, rotate (90° steps), or flip — never distort.
- Renderers (mock, client, preview) must contain-fit art uniformly; `stretch`-style
  fills and independent width/height are forbidden.
- A symbol whose viewBox aspect does not match its shape's bbox aspect is a structural
  FAIL (rendering it would distort) — never fix by squeezing.

### Original design is respected (binding, user directive 2026-07-04)

When art orientation and cell shape disagree (the 90° scale-tie case), the art is NOT
rotated. The ART is authoritative: fix the cell shape (or the shape-reading code) to
match the original design. Fixer rotation prescriptions for aspect-mismatch cases are
ESCALATIONS ("shape/art mismatch — fix the shape or redraw"), never auto-applied.

### Illustration-first (binding, user directive 2026-07-05)

Art comes BEFORE data, for ALL content (monsters, items, entities, currencies):
1. Create the illustration/icon FIRST; footprints/cell shapes/aspect ratios are
   DERIVED FROM the approved art afterwards (irregular footprints allowed — same
   BP-style collision, no need for neat rectangles).
2. Use plain, simple names and concepts when generating art (gorgeous names do not
   yield better art); the USER evaluates quality via NUMBERED proposal galleries
   and returns the accepted numbers.
3. No content entity ships stats/placement before its art is approved.

### Ratified exceptions & scope map (2026-07-12)

- **BS-G5 exception (ratified with Backpack Skin golden v1.0, 2026-07-12):**
  backpack-skin autotile EDGE TILES only may be 90°-rotated/mirrored by the
  renderer or build step — they are pattern art, not character art
  (`backpack_skin_pipeline.md` §4). This is the only rotation exception.
- **Rotation scope map:** item icons — fit-fix 90°/flip allowed, but NEVER to
  resolve an aspect mismatch ("Original design is respected"); Unit icons —
  never rotated, upright forever (`unit_icon_pipeline.md` G3); skins — edge
  tiles per BS-G5 only; fill textures never rotate.

## 3. Canonical data model (as built)

- **`content/vocab.json`** (v7 at time of writing) — the CLOSED vocabularies
  (types, elements, socket types/tags, triggers, verbs, statuses, rarities).
  Growing a vocabulary is a DESIGN EVENT requiring user approval, never a
  batch detail.
- **Effect AST** — machine grammar for effects; renderers generate tooltip
  text from the AST (`tools/eff_render.cjs`); prose in defs is flavor-only.
- **Kinds**: `po/2` (`content/live/live_items.json`), `si/2`
  (`content/live/live_sis.json`), enemies, and future kinds (e.g. `bpskin/1`)
  each with additive schema versions.
- **`i18n.ja` is REQUIRED on every entry** (chat is Japanese; data ships both).
- **`content/live/`** = merged, approved truth the build consumes;
  **`content/batches/batch-NNN-slug/`** = staging (draft.json, notes.md,
  candidates, scores, report); **`content/registry.json`** = id/count/review
  outcome/provenance append-log. Provenance today records the drafting agent;
  art-side workflow JSON + model hash is planned under REQ-0139.
- live/ is snapshotted per merge for one-step rollback; batches never touch
  live/ before S7 green.

## 4. Stage ladder S0–S8 (numbering unchanged from v1.0)

- **S0 Brief** (orchestrator): theme/family, count, shape & rarity
  distribution, tag/socket budget, new-vocab allowance (usually none).
- **S1 Draft** (Content Designer subagent): schema-shaped candidates + design
  notes; closed vocab stated explicitly.
- **S2 Static validation** (script): as built via
  `shared/content_validate.cjs` (`validateBody`) driven by a scratch harness
  (see `item_content_pipeline.md` Step 3) + id/name collision check vs live.
  (v1.0's `tools/validate.cjs` was never built under that name.)
- **S3 Engine integration** (script `tools/tool_integrate.cjs`): placement,
  4-rotation legality, socket seat/reject against the real engine.
- **S4 Balance sim — RESERVED**; REQ-0050 builds it. Until then: static
  heuristic bounds at S2.
- **S5 Art.** CANONICAL route = AI raster (ComfyUI; per-entry `gen_*` fields):
  items `item_content_pipeline.md` §5; units `unit_icon_pipeline.md`; skins
  `backpack_skin_pipeline.md`. The legacy SVG sprite route
  (`content/sprite_all_v10.svg`, `icon-<id>` symbols) remains only for
  pre-raster content; live wiring of rasters is REQ-0133. All art obeys §2.
- **S6 Preview deploy**: self-contained numbered gallery →
  `web/preview/<batch>/` on backpack-dev.
- **S7 Review gate — USER STOP.** Numbered gallery; verdicts per entry
  (green/fix/cut) or per rule; rule verdicts get encoded back into
  validators/briefs. Nothing touches live/ before green.
- **S8 Merge & registry**: approved entries → `content/live/`;
  `node tools/tool_gen_data.cjs content/vocab.json content/live/live_items.json
  content/live/live_sis.json content/live/scenario.json mock-src/data.js`;
  registry append; `bash tools/ci.sh` green; one commit per batch.

## 5. Infrastructure & REQ workflow

- Work happens in `~/backpack_ragnarok_worktrees/req-NNNN-slug` on branch
  `req-NNNN-slug`; REQ lifecycle is folder-is-status per PROJECT.md; one
  `git mv` per transition commit.
- ComfyUI runs at `127.0.0.1:8188`, manually started (service-ification
  planned: REQ-0139); generation clients use the main checkout `.venv`
  (`requests`/`PIL`/`numpy`/`scipy`/`rembg`/`onnxruntime`).
- e2e only via `pnpm run e2e` / `tools/e2e_run.sh` (exclusive box lock);
  never raw playwright. Package manager is pnpm only.
- Language policy: all docs/code/comments English; `i18n.ja` data fields and
  quoted user coinage excepted. Docs are authored on the server (worktree →
  master); the FS keeps a read mirror.
