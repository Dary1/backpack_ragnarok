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
### Session 2026-07-14 (implementing engineer, opus)

**Outcome:** REQ-0173 A–D implemented CLIENT-ONLY on branch
`req-0173-contentadmin-entity-rendering`. All gates green. Registry semantics,
server, api-modules untouched; `client/src/dex/*` untouched (no missing export);
`client/src/styles/artadmin.css` byte-untouched; `ArtAdminPage.tsx` gained ONLY
the focus-consume effect.

**Architecture decisions**
- **EntityPreview** (`client/src/contentadmin/EntityPreview.tsx`): one kind-aware
  component (po_def / si_def / tm_def / monster_def[enemy/1] / skill_def / unknown).
  Dex reused BY IMPORT: `ShapeGrid` + `dexIcons` (iconDataUrl/iconDims) via the exact
  DexAdmin list-thumb recipe (entityShape fallback `[[0,0]]`, cellPx 28 / 18 compact,
  stretch/align passthrough). A per-kind `consumed` Set drives a GENERIC fallback
  key:value grid so no top-level field is ever silently hidden; unknown kinds render
  fallback-only. Missing icon -> ShapeGrid placeholder (no overlay), never a broken img.
  A single `idBase` prop yields `entity-preview-<idBase>` / `entity-fallback-<idBase>`
  so the one component serves card (`<no>`), adopt-confirm (`confirm`), and diff
  (`diff-a`/`diff-b`).
- **contentShared helpers**: `rarityClass` (house `.rarity.r-<R>`; normalizes enemy/1
  LOWERCASE rarity first-letter -> class; unknown rarity = color-less, graceful),
  `entityShape`, `jaField` (i18n.ja + legacy name_ja fallback), `effectLine`
  (compact `trigger[lo-hi] . verb n[lo-hi] status xmult . cond/stat`, guards non-object
  entries), `artworkThumbUrl` (mirrors artadmin RegistryRail thumbUrl verbatim),
  `changedTopFields` (diff chips).
- **Structured edit form** (`client/src/contentadmin/EditModal.tsx`): Form|JSON tabs.
  `jsonText` is the SINGLE serialized truth -- form field edits push into it live, JSON
  edits modify it directly, submit = `JSON.parse(jsonText)` (existing editVariant path).
  `serialize()` spreads `{...original}` FIRST then overwrites name/flavor/i18n.ja/rarity/
  effects (+tags/stretch for po), so shape/icon/align/part/sockets/ports pass through
  VERBATIM (proven in e2e: submitted variant keeps `shape`+`icon`). adminForm reused BY
  IMPORT (effectToRow/rowToEffect/defaultEffectRow/EffectRow). Vocab/trees via
  `cachedFetchContent` (non-fatal -> JSON-only fallback). po_def/si_def default to Form
  once vocab loads; monster/skill/tm/unit -- and any po/si whose effects array is not
  all-objects -- open on JSON with the Form tab DISABLED + a note (`edit-form-note-<no>`).
- **Art linkage** (B): ContentAdminPage fetches `/api/art/artworks` once + 30 s poll,
  failures NON-FATAL; maps by system_name -> DefRail rail thumb (`cd-thumb-<name>`,
  placeholder branch when no adopted/ok render), Workspace header thumb
  (`cd-header-thumb`), adopt-confirm thumb + compact preview. Facet links (rail glyph,
  header links, thumb) now deep-link to `#/artadmin/<system_name>`.
- **artadmin deep link** (B): `ARTADMIN_HASH_RE` + one-shot `artAdminFocusName` in
  store/core.ts + routing.ts as an EXACT mirror of the REQ-0164 CONTENTADMIN pattern;
  `clearArtAdminFocusName()` in routing.ts; ArtAdminPage consumes once the list loads.
- **DiffView** (D): compact side-by-side EntityPreviews of A|B + `diff-fields-summary`
  changed-field chips, ABOVE the existing (verbatim) positional line diff.

**Testid delta (NEW; all existing testids preserved)**
- `entity-preview-<no>` (VariantCard, default-on), `entity-preview-confirm` (adopt
  dialog), `entity-preview-diff-a` / `entity-preview-diff-b` (DiffView).
- `entity-fallback-<idBase>` (generic field grid).
- `diff-fields-summary`.
- `cd-thumb-<name>` (rail), `cd-header-thumb` (workspace header).
- `edit-tab-form-<no>`, `edit-tab-json-<no>`, `edit-form-note-<no>`.
- Form fields: `edit-form-name-<no>`, `edit-form-ja-name-<no>`, `edit-form-flavor-<no>`,
  `edit-form-ja-flavor-<no>`, `edit-form-rarity-<no>`, `edit-form-stretch-<no>`,
  `edit-form-tag-root-<no>`, `edit-form-tags-<no>`, `edit-form-effect-add-<no>`,
  `edit-form-eff-{trigger,verb,nlo,nhi,status,del}-<no>-<i>`.
- Preserved verbatim on the JSON tab: `edit-json-<no>`, `edit-valid-<no>`,
  `edit-format-<no>`, `edit-submit-<no>`, `edit-close`.

**Gate results**
- **G1**: `pnpm exec tsc -b` EXIT=0 (/tmp/req0173_tsc.log); `pnpm run build` EXIT=0,
  built in 328 ms (/tmp/req0173_build.log).
- **G2**: `tools/content_admin_e2e.sh` -> **20 passed (36.4 s)** (/tmp/req0173_ca_e2e2.log);
  `tools/artadmin_e2e.sh` -> **4 passed (53.0 s)**, the original 3 intact + the new
  deep-link test (/tmp/req0173_art_e2e.log). New contentadmin coverage: entity preview
  name/rarity/shape (po), si anchor fallback, fallback field grid, form edit
  (rarity + add effect -> JSON reflects -> submit -> shape/icon passthrough proven both in
  the JSON tab and via the server detail GET), JSON-only kind gates the Form tab, diff
  entity headers + changed-field chips, adopt-confirm preview, rail art-facet thumb
  placeholder branch (render-less artwork seeded via POST /api/art/artworks). web/
  restored after e2e (`git checkout -- web/ && git clean -fd web/`).
- **G3**: `git diff master...HEAD --stat` = only intended client/ files + this REQ doc;
  NO artadmin.css / web/ / dist / lockfile / package.json churn.

**Commits**
- `3b96fbd` -- B: artadmin `#/artadmin/<name>` deep link + ArtAdminPage consume + spec.
- `911e36b` -- A/B/C/D: EntityPreview + art-facet thumbs + Form|JSON edit modal +
  entity-level diff + contentadmin.spec extended.
- (this log commit).

**Deviations / notes**
1. **Env fix (not a code change):** the worktree had ONLY client deps installed; the
   e2e harness (`node server/api.cjs`) died with `Cannot find module 'pg'` -> every
   create 400'd. Fixed by symlinking `<worktree>/server/node_modules` ->
   `~/backpack_ragnarok/server/node_modules` (node_modules is gitignored, read-only use,
   never committed; main checkout untouched). Orchestrator: any fresh worktree here needs
   server deps present before G2.
2. **artadmin deep link consumes WITHOUT rewriting the hash** (contentadmin rewrites via
   history.replaceState). Chosen as the minimal/additive path the spec explicitly permits,
   to protect the existing 3 artadmin tests. Documented in ArtAdminPage.
3. **Pre-existing contentadmin test-1 edit leg updated** in the same commit as the
   behavior: po_def now DEFAULTS to the Form tab, so the JSON-editor leg first waits for
   the Form to load then clicks `edit-tab-json-1` (the `edit-json-1` testid is unchanged,
   just tab-scoped now).

**Left for orchestrator:** deploy + S7 live user acceptance (REQ stays in docs/REQ/todo/).


### Follow-up 2026-07-14 (orchestrator): display-layer artwork name reconciliation
Live verification found the art linkage lit ZERO facets: the artwork backfill named rows
'batch:name' (e.g. batch-004-item-icons-flux2:blade) while the content backfill used bare
ids ('blade') -- the namespaces never intersect, so exact matching (server
has_artwork_facet AND the client map) never fires on live data.
Fix (client-only): contentShared.buildArtworkIndex() indexes artworks by exact name PLUS
batch-stripped suffix (exact never shadowed; adopted-render wins suffix collisions); rail
thumb / header thumb / facet links light on suffix matches too and carry the artwork's
REAL namespaced system_name so the #/artadmin/<name> deep link resolves; the facet line
says "linked by batch name (<full name>)" to keep the provenance honest. The server's
exact-match has_artwork_facet is untouched -- TRUE name reconciliation of the two ledgers
(one-name-one-entity canon) remains a future registry REQ needing a user ruling.
e2e: +1 test (route-mocked namespaced artwork -- the art API itself refuses ':' names,
which are backfill-only) => contentadmin.spec.ts 21/21; tsc -b green. Live: 8 po_defs
(blade, hilt, dagger, ...) now show batch-004 item-icon thumbs.
