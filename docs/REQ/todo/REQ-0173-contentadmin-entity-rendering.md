# REQ-0173 — contentadmin-entity-rendering: judge entities, not JSON (dex-grade adjudication)

**Ratified:** 2026-07-14 (user, chat) — direct user critique of the REQ-0164 result:
(1) "アートと紐づけして表示してほしい" — show the linked artwork; (2) "セル形状が存在する
ものはそれらも表示してほしい" — render cell shapes where they exist; (3) the page should
have noticed what is "普通にあるべき" for its purpose; (4) "現状に対して満足してしまって
いて、UI修正をしただけで、UXレベルで考えられていない"; (5) "dex の Edit モードを陳腐化
させる感じで" — supersede #/dex Edit mode.
**Requested by:** user, 2026-07-14 (chat). Spec authored by orchestrator (Fable).

## Zero-base restatement (the UX-level correction)
The page is an adjudication desk for GAME ENTITIES. REQ-0157/0164 made the WORKFLOW legible
but left the page domain-blind: the operator judges raw JSON. A judge must see the entity
the way the game presents it — its shape on the grid, its icon, its art, its name in both
languages, its rarity color, its effects in the vocab grammar — and must be able to edit it
with the same structured form the Dex Edit mode already has, but on top of the registry
semantics (variant-as-record, lineage, checks, adopt+export) instead of Dex Edit's direct
live PUT. This REQ makes contentadmin strictly superior to Dex Edit for content work.

**Depends on / coordination:**
- REQ-0164 (built, deployed) — this REQ builds on its console. REQ-0155 registry semantics
  UNCHANGED. CLIENT-ONLY: no server/API/schema changes.
- Dex components are REUSED BY IMPORT, never forked: client/src/dex/ShapeGrid.tsx,
  client/src/dex/dexIcons.ts (sprite_all_v12 data-URL loader), client/src/dex/adminForm.ts
  (EffectRow/effectToRow/rowToEffect/defaultEffectRow). NO edits inside client/src/dex/
  are expected; if an export is missing, add the minimal export only.
- Artwork thumbnails reuse the artadmin URL helpers (client/src/api/admin.ts artAdoptedUrl/
  artRenderUrl) + the /api/art/artworks list (aggregates incl. adopted_render_id,
  adopted_seed, latest_ok_seed — REQ-0156 shapes).
- client/src/styles/artadmin.css stays byte-untouched; new styling is ca-* in
  contentadmin.css only.

## Deficiencies being fixed (user-named + derived from the same critique)
1. No artwork linkage DISPLAY: the art facet is a text line; no thumbnail in the rail,
   header, or cards (user-named).
2. No cell-shape rendering: po_def shapes (and si/tm icons) never render as grids —
   in a backpack-puzzle game the shape IS the entity's identity (user-named).
3. Variants are adjudicated as raw JSON: no name (EN/JA), rarity color, tags, flavor,
   effects rendering ("普通にあるべきもの").
4. Edit-as-new is a bare JSON textarea while Dex Edit has a vocab-driven structured form —
   the registry's edit path is WEAKER than the legacy live-PUT path it should replace.
5. A/B compare is a positional line diff only; no entity-level comparison.
6. The adopt confirm shows checks but not WHAT is being adopted (sight-unseen adoption).
7. Facet cross-links land on bare #/artadmin, not the entity.
8. Rail rows have no visual identity (name text only).

## Scope (all client)

### A. EntityPreview — kind-aware rendering of variant.data
New `client/src/contentadmin/EntityPreview.tsx` (+ helpers in contentShared), rendered
INSIDE each VariantCard by default (replacing dead space, not the JSON toggle — View JSON
stays as-is), with a `compact` mode for confirm/diff/header use:
- po_def: ShapeGrid (shape cells, icon via iconDataUrl/iconDims, stretch/align fit math —
  the exact DexAdmin list-thumb recipe, cellPx 28), EN name + JA name (i18n.ja), rarity
  chip using the house `r-<rarity>` classes, tags, flavor, effects: localized eff text
  when the entry carries it + a compact per-effect AST line (trigger · verb.t n[lo–hi]
  · cond/stat) — read-only, vocab-agnostic.
- si_def: same minus shape (synthetic [[0,0]] anchor, the Dex precedent), slot shown.
- tm_def: icon + name(s) + rarity + flavor.
- monster_def (enemy/1 dialect): name(s), hp range chip, rarity, skills id list, remaining
  scalar fields as chips.
- skill_def (skill/1): name/id, effects AST lines.
- GENERIC FALLBACK in every kind: top-level fields the renderer did not consume appear in
  a compact key:value grid — nothing silently hidden; unknown kinds render fallback-only.
- Missing icon id → placeholder glyph (iconDataUrl null path), never a broken img.

### B. Artwork linkage (art facet made visible)
- ContentAdminPage fetches /api/art/artworks (once + 30 s poll, failures non-fatal) and
  maps by system_name.
- Rail rows with has_artwork_facet: small thumb (adopted render → latest_ok → glyph),
  testid `cd-thumb-<name>`, reusing the artadmin thumbUrl decision logic (adopted first,
  cache-busted by seed).
- Workspace header: larger thumb (`cd-header-thumb`) beside the def name when the facet
  exists; clicking it (and the existing facet links) deep-links to the entity:
  `#/artadmin/<system_name>`.
- New artadmin deep link: ARTADMIN_HASH_RE + one-shot `artAdminFocusName` in store/core.ts
  + routing.ts (exact mirror of REQ-0164 D / REQ-0052); ArtAdminPage consumes it (select
  that artwork once the list is loaded, then clear) — the ONLY artadmin touch, additive,
  its e2e must stay green. ArtAdminPage selecting also rewrites its hash (parity with
  contentadmin; keep minimal if risky — consuming without rewriting is acceptable,
  document the choice).
- Adopt confirm dialog: compact EntityPreview + thumb — adoption is never sight-unseen.

### C. Structured edit form (the Dex-Edit superseder)
The edit-as-new modal gains two tabs: **Form** (default for po_def/si_def) and **JSON**
(current editor, all kinds):
- Form fields (DexAdmin parity via adminForm.ts + vocab dropdowns): name, flavor, JA
  name/flavor (i18n.ja.*), rarity select (vocab.rarities), tags multi (trees.po roots +
  ancestry list as DexAdmin does), stretch checkbox (po only), effects rows with ADD
  (defaultEffectRow(vocab)) / DELETE and per-row trigger/verb/param dropdowns+inputs
  (EffectRow grammar).
- Vocab/trees come from the cached /api/content payload (client/src/lib/contentCache —
  the Dex path); fetch once on modal open, non-fatal fallback = JSON tab only.
- Form state serializes over the ORIGINAL variant data (untouched fields pass through
  verbatim — shape/align/part/icon etc. are NOT lost); the JSON tab always shows the
  serialized result; switching tabs keeps them in sync; submit uses the existing
  editVariant path (new human_edit variant, lineage preserved).
- Kinds without form support (monster/skill/tm/unit) open on JSON with the Form tab
  disabled + note.
- This gives the registry path everything Dex Edit has (minus the dev grant button),
  making Dex Edit obsolete for content work; REMOVING Dex Edit is explicitly OUT of
  scope (follow-up REQ after user confirms supersession).

### D. Entity-level compare
DiffView gains, ABOVE the existing line diff (kept as exact truth):
- side-by-side compact EntityPreviews of A and B;
- a changed-fields summary: top-level keys whose pretty-JSON differs, as chips
  (`diff-fields-summary`).

## Contract preservation
- All existing testids preserved; NEW testids documented in the log (at minimum:
  entity-preview-<no>, cd-thumb-<name>, cd-header-thumb, edit-tab-form-<no>,
  edit-tab-json-<no>, diff-fields-summary + the form field set).
- Registry semantics, api modules, server: untouched. EN-only admin surface.
- Dex views (catalog/detail/Edit) behaviorally untouched.
- artadmin.css byte-untouched; ArtAdminPage.tsx gains only the focus-consume effect.

## Out of scope
- Removing/hiding Dex Edit mode; shape/align/part editing UI (JSON tab covers it);
  server changes; artwork generation from this page (artadmin owns it); admin i18n.

## Gates
- G1: client `pnpm exec tsc -b` + `pnpm run build` EXIT 0.
- G2: contentadmin e2e extended + green via tools/content_admin_e2e.sh: entity preview
  renders (ingested po variant shows name/rarity/shape grid; si anchor fallback),
  fallback key:value grid for unconsumed fields, form-mode edit (change rarity + add
  effect → JSON tab reflects it → submit → new human_edit variant → its preview shows
  the change), JSON-only kinds gate the Form tab, diff shows entity headers + changed-
  field chips, adopt confirm carries the preview, artadmin deep link consumes
  (#/artadmin/<name> selects that artwork), thumb render (art facet present — if the
  isolated harness has no artwork rows, CREATE one via the art API in the spec setup or
  document why not feasible). PLUS artadmin.spec.ts re-run green.
- G3 hygiene: no dist/lockfile/PNG/content-data commits; pnpm only; diffs composed
  off-mount per the mount-truncation policy.
- S7 user acceptance on the live screen (deploy approval to be confirmed in chat at
  gates-green).

## Risks
- sprite_all_v12.svg ?raw import is already in the app bundle via Dex — no new weight.
- /api/art/artworks polling from contentadmin doubles a cheap list read — 30 s cadence.
- adminForm's EffectRow grammar targets po/si effect ASTs; guard against non-object
  effects arrays (fallback to JSON tab with note rather than crash).
- The e2e harness pg namespace has no artworks by default; the spec must seed one for
  the thumb/deep-link assertions (art API POST + a render may be heavy — acceptable to
  assert the no-thumb glyph branch + deep-link consumption with an EMPTY artwork... no:
  deep link needs an artwork row; creating a def-only artwork row via POST /api/art/
  artworks is cheap and render-less; thumb IMG assertion can use the placeholder branch).

## Implementation log
(to be filled by the implementing engineer)
