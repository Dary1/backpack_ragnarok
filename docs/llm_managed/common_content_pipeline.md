> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# Common Content Pipeline — v1.1 (2026-07-14, REQ-0154)

> The SHARED layer for all content kinds. Per-kind deltas live in:
> `item_content_pipeline.md` (PO/SI) · `monster_content_pipeline.md` ·
> `tm_content_pipeline.md` · `unit_icon_pipeline.md` · `backpack_skin_pipeline.md`.
> Lineage: as-built refactor of `content_pipeline.md` v1.0 (REQ-0014 design;
> now a redirect stub; original text in git history). Stage numbering S0–S8
> is UNCHANGED. §2 integrates the former `art_golden.md` (abolished as a
> separate doc by user directive, 2026-07-12).
>
> **Registry era (REQ-0154, 2026-07-14):** §§6–9 are the CURRENT
> operating model — the two Postgres registries (artwork REQ-0151 / content-data
> REQ-0155), the advisory inspection layer (REQ-0152), the PO shape recipe
> (REQ-0153), the REQ dependency map, and the promotion path. §4’s S0–S8
> ladder is the tool sequence those registries wrap. Registry contracts
> (seed/variant policy, adoption, export, advisory-inspection) are stated ONCE in
> §7; per-kind docs reference it (G2).

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

- **BS-G5 exception (ratified 2026-07-12) — now MOOT in practice (REQ-0150).**
  It permitted 90° rotation/mirroring of backpack-skin autotile EDGE TILES. There
  is no longer a tile atlas to rotate: the welt is derived per-pixel from a
  distance transform of the polyomino, so straights, outer corners and inner
  corners fall out with the correct orientation by construction
  (`art_pipeline.md` §6). The exception stands on paper; nothing exercises it.
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
- **S5 Art.** See **`art_pipeline.md`** — ONE doc for ALL image generation
  (items, units, monsters, backpack skins). Route: **flux2** (FLUX.2 klein 4B);
  SDXL is retired and deleted. Style: the user's ratified InvokeAI-derived
  templates. **There is no negative prompt and there are no LoRAs on this route.**
  Generation size matches the CELL FOOTPRINT'S ASPECT RATIO (square-then-downscale
  is retired). The per-kind docs (`item_content_pipeline.md`,
  `unit_icon_pipeline.md`, `monster_content_pipeline.md`,
  `backpack_skin_pipeline.md`) are SUPERSEDED on art and carry a banner saying so;
  their schema/data content still stands. The legacy SVG sprite route
  (`content/sprite_all_v10.svg`, `icon-<id>` symbols) remains only for pre-raster
  content; live wiring of rasters is REQ-0133. All art obeys §2.
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
  (`requests`/`PIL`/`numpy`/`scipy`/`skimage`/`rembg`/`onnxruntime`).
- **The box is 8 GB VRAM (RTX 2080); the 23 GB is system RAM.** FLUX.2 and the
  Qwen3-4B text encoder do not co-reside, so ComfyUI swaps them per prompt:
  first generation of a run ~450–540 s (cold), later ones on the SAME prompt
  2–20 s, a PROMPT CHANGE 30–170 s. **Batch by prompt, not by seed**, and never
  judge throughput on the first image. Stop ComfyUI before any matte phase
  (rembg peaks at 12–13 GB RSS and OOMs beside a resident model).
- e2e only via `pnpm run e2e` / `tools/e2e_run.sh` (exclusive box lock);
  never raw playwright. Package manager is pnpm only.
- Language policy: all docs/code/comments English; `i18n.ja` data fields and
  quoted user coinage excepted. Docs are authored on the server (worktree →
  master); the FS keeps a read mirror.

## 6. Registry era — the operating model (REQ-0154)

Since **REQ-0151 / 0152 / 0153 / 0155 merged (2026-07-14)** content is produced
through **two Postgres-backed registries behind `storage.cjs`** — an **ARTWORK
registry** (REQ-0151) and a **CONTENT-DATA registry** (REQ-0155) — plus an
**advisory INSPECTION layer** (REQ-0152) and an **available shape-conditioning
recipe** (REQ-0153). This section is the CURRENT operating model. §4's S0–S8
ladder is unchanged and remains the underlying tool sequence the registries wrap
and automate (`tool_gen_data`, `tool_integrate`, `ci.sh`, the flux2 art route).
**Human adoption stays the only binding act (S7 doctrine); every machine or agent
verdict is advisory and recorded with its rationale.**

**Status (2026-07-14) — read every registry-era claim as "true of the MERGED
code," not "already in production."**
- **REQ-0150** (flux2 route) — **DONE, live.**
- **REQ-0151** (artwork registry) — **BUILT** (merged, machine gates G1–G5 green);
  S7 real-GPU acceptance OPEN.
- **REQ-0152** (inspection kits) — **BUILT**; S7 threshold ratification OPEN.
- **REQ-0153** (PO shape spike) — **BUILT**; verdict **GREEN-with-recipe**; the
  recipe is a spec addendum and is **NOT wired into the production route** (awaits
  a follow-up integration REQ).
- **REQ-0155** (content-data registry) — **BUILT**; S7 real-content acceptance OPEN.
- The admin screens are reachable by hash route only (no Nav entry yet); the web
  bundle rebuild + API restart + the git-branch export wiring are **deferred to the
  end of the chain**, and **no real batch has run through the registries yet**.

### 6.1 Canonical target flow (user, 2026-07-13 — the operating model the docs converge on)

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

### 6.2 Flow -> code map (what is built, what is future)

| flow step | owner | built? |
| --- | --- | --- |
| generate 5 artwork renders | REQ-0151 admin `generate next N seeds` -> `art_jobs.cjs` -> `tools/art_job.py` (imports `art_route`/`art_style`) | **built** |
| machine scoring | REQ-0152 kits auto-run on the same queue (LOW priority); REQ-0153 shape recipe | kits **built**; shape recipe **built-but-unwired** |
| separate-agent adopted-seed decision (artwork) | future batch orchestrator | **future** (artwork has no `agent_review` column; adoption is human-only in the admin today) |
| generate 5 content-data variants | REQ-0155 generic receiving API (agent-session driven; NO LLM key on the server) | **built** |
| machine validity checks (data) | REQ-0155 `content_checks.cjs`: `schema_vocab` / `engine_types` / `gen_data` / `integrate` dry-run | **built** |
| separate-agent validity review (data) | REQ-0155 `agent_review` column (Opus-class, mandatory rationale, advisory) | **built** (column + API; the loop that drives it is the orchestrator) |
| batch reviewer surface | future batch orchestrator + reviewer REQ | **future — not yet reserved** |
| user review / adopt / change seed-variant | REQ-0151 + REQ-0155 adoption UI | **built** |
| release / export into content/live | `art_export.cjs` / `content_export.cjs` + `tool_integrate` (git/live-merge behind `*_EXPORT_GIT=1`) | export STEP **built**; git/live-merge is the **deploy step** |

## 7. Registry contracts (single-source; per-kind docs REFERENCE, never restate)

> **G2 drift-proofing:** the batch-file conventions, seed/variant policy, adoption
> contract, export path and advisory-inspection doctrine are stated **here once**.
> Per-kind docs (`item_content_pipeline.md`, `monster_content_pipeline.md`,
> `unit_icon_pipeline.md`, `tm_content_pipeline.md`) point at this section and add
> only their own deltas.

### 7.1 Batch-file conventions
Unchanged from §3: staging in `content/batches/batch-NNN-slug/`, merged truth in
`content/live/`, the append-log `content/registry.json`. The registry era ADDS the
DB layer below; the file-side layout is untouched, and the CLI batch pipeline
(§4 S0–S8, the per-kind step lists) still works exactly as written.

### 7.2 Seed / variant policy — the recipe-vs-asset-of-record doctrine
- **Artwork.** Renders are keyed by **(kind, system_name, seed)**; `seed`
  auto-increments per artwork from 1 (`max(seed)+1`; explicit seed allowed;
  never renumbered). flux2 sampling is near-deterministic — 4 seeds are 4 CLOSE
  variants, not 4 alternatives — so **reroll by changing the PROMPT, not the seed**
  (`art_pipeline.md` §2).
- **Content-data.** Variants are keyed by **(system_name, variant_no)**;
  `variant_no` auto-increments per content and is **never renumbered**. LLMs give
  **no seed-reproducibility** (hosted APIs are not bit-stable even at temperature 0;
  the Anthropic API exposes no seed), so `variant_no` plays the seed's role and
  distinct variants come from **explicit per-slot variation instructions**, not
  seed roulette (REQ-0155 determinism ruling).
- **Unified doctrine (REQ-0151 ruling 4 == REQ-0155 determinism ruling).** The
  **stored bytes / JSON + its sha256 are the ASSET OF RECORD**; the seed/variant_no
  plus params/provenance (model filenames AND content hashes for art; model/
  prompt/params for data) are the **RECIPE — best-effort, with NO regeneration
  guarantee.** Regeneration may differ; the stored asset always wins.

### 7.3 Adoption contract (system_name -> adopted seed / adopted variant)
- **One `system_name` = one game entity, with two facets:** its **ARTWORK**
  (adopted render) and its **DATA** (adopted variant). The namespace is **SHARED**
  across `artworks` and `content_defs` (REQ-0155): the same bare name is the same
  entity in both tables; a matching row in the other table is the linked facet, not
  a collision.
- **Adoption is a HUMAN act** — exactly one render per artwork facet and one variant
  per data facet, **switchable any time, history immutable**. The adopted render/
  variant IS the live asset. **No machine or agent verdict gates adoption**
  (advisory doctrine, §7.5); a machine-FAIL content variant is adoptable only behind
  an explicit override confirm.
- **Adopted-undeletable:** the adopted render/variant cannot be deleted — enforced
  in `storage.cjs`, backstopped by a DB `RESTRICT` FK, and refused at the API layer.

### 7.4 Export path (hybrid: DB source-of-truth + content/ export)
- The **DB is the single source of truth**; on every adoption an export step ALSO
  writes the adopted asset into `content/` via the existing integrate conventions,
  so existing consumers keep working unchanged (REQ-0151 ruling 2).
- **Artwork** -> `content/art/<kind>/<system_name>.png` (`ART_EXPORT_ROOT`;
  `server/services/art_export.cjs`).
- **Content-data** -> `content/registry_exports/` (`CONTENT_EXPORT_ROOT`;
  `server/services/content_export.cjs`).
- The **git-branch commit + live-file merge / per-kind derivatives** via
  `tools/tool_integrate.cjs` is gated behind **`ART_EXPORT_GIT=1` /
  `CONTENT_EXPORT_GIT=1`** and is the **DEPLOY (S7) wiring step** — OFF in CI/e2e.
  The export STEP fires on adoption today; the git/live-merge half lands at deploy.
- **Candidates never enter git** (they live ONLY in the DB); only adopted/exported
  assets reach `content/` (REQ-0151 lesson: 185 MB of intermediate PNGs once
  bloated history).

### 7.5 Advisory-inspection doctrine
*(Detailed in Wave 2 below; stated here as the single source.)*
- **Every machine check and every agent review is ADVISORY and RECORDED with its
  rationale; NONE gates adoption.** Human adoption is the only binding act. The sole
  exception is the **bpskin FRAME-SOURCE gate**, which lives inside the generation
  recipe (compose consumes only PASS frames) and predates the inspection layer.
- **Artwork side** — per-kind inspection **kits** (REQ-0152) auto-run after each
  render on the same single-GPU-safe queue at **LOW priority**; **advisory kits top
  out at WARN (never FAIL)**; results persist in `render_inspections`; the UI shows
  verdict chips + a stale badge + a re-run button. Kit roster, metrics and
  thresholds live in `art_pipeline.md` §7; thresholds carry an **[S7]** flag until
  the user ratifies them on real renders.
- **Content-data side** — four machine validators (`schema_vocab` / `engine_types` /
  `gen_data` / `integrate` dry-run) run on every variant, plus a **separate-agent
  advisory review** (Opus-class default, mandatory rationale). Both recorded;
  neither binds.

## 8. REQ dependency map (G3 — current at 2026-07-14, this wave commit)

```
REQ-0150  flux2 route                         [DONE, live]
   |
   +--> REQ-0151  artwork registry admin      [BUILT; S7 real-GPU OPEN]
   |        |
   |        +--> REQ-0152  inspection kits (advisory)  [BUILT; S7 thresholds OPEN]
   |        +--> REQ-0153  PO shape-control spike       [BUILT; GREEN-with-recipe;
   |                        recipe NOT wired -> follow-up integration REQ]
   |
   +--> REQ-0155  content-data registry admin  [BUILT; S7 real-content OPEN]
            |
            +--> batch orchestrator + reviewer  [FUTURE REQ — not yet reserved]
                     |
                     +--> REQ-0154 wave 5 (batch reviewer flow doc)  [FUTURE]
                              |
                              +--> promotion -> docs/user_managed (user-only)  [FUTURE]
```

**Coordination (absorptions + cross-refs):**
- **REQ-0111** (monster-content-pipeline-doc) and **REQ-0130** (unit-def-content-
  pipeline) are **ABSORBED** into this REQ (Wave 4) with attribution and closed with
  supersession notes (one `git mv` -> `done/` per commit, per board policy).
- **REQ-0133** (item-raster-live-wiring, draft) — its wiring concern is now the
  **registry export contract** (§7.4). It stays in `draft/`, still blocked on
  REQ-0125a's resolution machinery; the "raster vs SVG" half is already ruled
  RASTER.

## 9. Promotion path & mechanics (G4 — the end goal)

The end goal of REQ-0154 is to refine EVERY content-pipeline doc to **contract-grade
quality**, after which **the USER promotes it to `docs/user_managed/` (frozen
golden)**. Mechanics:

1. **Gate.** A doc is promotable only when (a) its wave is complete, (b) it has
   **survived one REAL BATCH unchanged**, and (c) it carries **no llm_managed-only
   dangling cross-references** — a verbatim copy must not point at anything that
   lives only under `docs/llm_managed/` (G4).
2. **Stage.** Copy the doc VERBATIM to
   `docs/llm_managed/promotion_candidates/<name>_CANDIDATE.md`, and list it
   one-line-per-file in `user_managed_rename_suggestions.md` (the same note
   mechanism REQ-0123 used).
3. **Promote (user-only).** The USER moves candidates into `docs/user_managed/` and
   commits. **No LLM ever writes `docs/user_managed/`.**
4. **Volatile / contract split (freeze-then-rot mitigation).** Box timings, OOM
   lore, tool flags, `[S7]` thresholds and other operational detail STAY in the
   `llm_managed` companions; only ratified, contract-grade content goes into a
   candidate. Frozen docs carry no volatile detail, so they do not rot.

**Status (2026-07-14): NO candidates are staged.** No real batch has run through the
registries yet, so the promotion gate (1b) is not met for any doc. Candidates are
staged in **Wave 5**, after the batch orchestrator ships and the first real batch
completes. The `promotion_candidates/` directory is intentionally NOT created yet.
