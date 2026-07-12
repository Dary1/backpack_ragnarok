# REQ-0134 — pipeline-doc-refresh

**Status:** see folder (board law)
**Reserved:** 2026-07-12
**Slug:** pipeline-doc-refresh
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session. User verdict on the
review: **ALL GREEN**, plus two explicit user directives (2026-07-12):
(1) authority granted to refresh the stale content-pipeline / art_golden doc
layer and take this REQ to done; (2) mid-session: "art_golden を無くして、
コンテンツパイプラインに統合" — abolish `art_golden.md` as a separate doc and
integrate its binding rules into the content pipeline doc.

## Problem (staleness found in review)

- `item_content_pipeline.md`, `monster_content_pipeline.md`,
  `tm_content_pipeline.md`, REQ-0110/0111 all reference
  `common_content_pipeline.md` — which did not exist (dangling since the
  per-kind split).
- `content_pipeline.md` v1.0 was the pre-implementation design (REQ-0014):
  SVG-only S5, never-built tool names (`tools/validate.cjs`), stale
  "FS (docs only)" location note — yet still the only "common" doc.
- `item_content_pipeline.md` was Japanese, violating the language policy
  (user directive 2026-07-02: all docs English).
- `art_golden.md` v3.4 lacked the ratified BS-G5 exception (skin pipeline
  v1.0 calls it "a written art_golden exception") and had no scope map for
  the three rotation regimes (items / units / skin edge tiles).
- Pipeline docs' open-item lists were stale after the 2026-07-12 ALL GREEN
  ratifications (unit §3.1–3.3; skin §7.4 duplicated an already-ratified
  ruling; §7.5, §7.3-method now decided).
- `unit_icon_pipeline.md` G6 referenced `backpack_skin_pipeline_proposal.md`
  (renamed to `backpack_skin_pipeline.md`).

## Changes (all docs-only, `docs/llm_managed/`)

1. NEW `common_content_pipeline.md` — the shared layer as built: principles,
   **integrated Art Golden (binding) as §2** with ratified exceptions + scope
   map, canonical data model, stage ladder S0–S8 (numbering unchanged),
   infra & REQ workflow. Resolves all dangling references.
2. `art_golden.md` DELETED (user directive). Rule text carried into
   `common_content_pipeline.md` §2 VERBATIM with original dates. Historical
   citations ("art_golden v3.3/v3.4" in tools/*.py, mock-src/ui.js, done
   REQs) stay valid: §2 declares itself their resolution target; code
   comments intentionally untouched (doc-only REQ).
3. `content_pipeline.md` → superseded redirect stub (inbound refs from
   combat_spec §S1–S8, REQ-0050/0077 keep resolving; v1.0 text in git
   history).
4. `item_content_pipeline.md` → v2.1 English translation (content-identical;
   references updated).
5. `unit_icon_pipeline.md` → v1.1: §3 decision log (1 bust / 2 raster /
   3 ring-fill reserved as G7), G7 added, proposal-filename fix.
6. `backpack_skin_pipeline.md` → v1.1: BS-G5 stale "needs blessing" text and
   §7.4 duplicate removed (ratified in v1.0), §7.5 clip_mask = alpha DECIDED,
   §7.3 method decided (REQ-0143 harness), §7.1 gates → REQ-0144, S2 tiling
   risk note updated (REQ-0138).

## Non-goals

No code/tool changes; no golden RULE changes (verbatim carry + user-ratified
additions only); `docs/user_managed/` untouched; no REQ edits beyond this file.

## Gates (doc-only)

- G1: zero dangling references — every `common_content_pipeline.md` mention
  resolves; no living doc references `art_golden.md` as a file.
- G2: language policy — no Japanese prose in the edited llm_managed docs
  (i18n.ja data fields and quoted user coinage excepted).
- G3: every open-item status change carries a provenance line
  (2026-07-12 ALL GREEN / user directive).
- G4: art golden rule text in §2 is verbatim vs deleted file (diff-checked
  modulo headings/exceptions section).

## Outcome

(appended at completion — gate results + commit hashes)
