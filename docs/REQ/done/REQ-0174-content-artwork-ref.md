# REQ-0174 — content-artwork-ref: def-level SELECTABLE artwork reference (content-wide spec)

**Ratified:** 2026-07-14 (user, chat) — binding design ruling superseding REQ-0173's
display-layer suffix matching:
1. "アート紐づけは、タイトルで一致しないことは、これからもある" — name matching will keep
   diverging; the linkage must be 選択式 (operator-selected), not inferred.
2. "Variant単位ではなく、Registry情報として、同タイプのArtのインスタンスを参照し、表示"
   — the reference lives on the CONTENT DEF (registry row), pointing at an artwork
   instance of the matching type.
3. "Variantは、親Registryを参照し、アートを取得する。これはコンテンツ全般での仕様" —
   variants NEVER carry their own art; they resolve through their parent def. This is
   content-wide canon (candidate for PROJECT.md design canon — user pastes it; LLMs
   cannot edit PROJECT.md).
**Requested by:** user, 2026-07-14 (chat). Spec authored by orchestrator (Fable).

**Depends on / coordination:**
- REQ-0173 (built+deployed) — its buildArtworkIndex batch-suffix fallback is REMOVED by
  this REQ (explicit ref replaces inference; exact-name match stays as the one-name-one-
  entity canonical fallback and as the picker's suggested default).
- REQ-0155 registry semantics otherwise unchanged; artwork registry (REQ-0151/0156)
  untouched server-side.
- artadmin.css byte-untouched; dex/* untouched.

## Scope

### A. Schema (server/migrations/016_content_artwork_ref.sql)
- `ALTER TABLE content_defs ADD COLUMN IF NOT EXISTS artwork_ref text NULL;`
- Soft reference to artworks.system_name (no FK: the two registries stay independently
  managed ledgers; validation lives at the write seam). Idempotent, style of 009-015.
- The e2e harness / tests must get the column too — follow however 009_content_defs
  reaches the isolated pg namespace (bootstrap or migration application) and extend it.

### B. Storage (server/storage_content.cjs — the chokepoint)
- `updateContentDef` accepts `artwork_ref` (string | null; null clears).
- `listContentDefs` rows + `getContentDef` include `artwork_ref`.
- Facet resolution becomes REF-FIRST: resolved artwork name = artwork_ref (when the row
  exists) else exact-name match else none. Expose it explicitly:
  `artwork_facet_name` (string|null) on the detail response, and in the list rows either
  reuse has_artwork_facet (true when resolution succeeds) + `artwork_ref` so the client
  can render — keep the REQ-0157 row shape otherwise (additive only).

### C. Routes (server/routes/content.cjs)
- PATCH /api/content/defs/<name> gains `artwork_ref`: null clears; a non-null value must
  name an EXISTING artwork (cross-registry read via the storage helper) else 400
  `{ error: 'artwork_ref: no such artwork <name>' }`. Type mismatch is NOT blocked
  server-side (the picker filters; the ledger stays permissive) — documented.
- Def-shaped responses carry artwork_ref / artwork_facet_name.

### D. Server tests
- Extend content/contentagg tests: patch sets ref; list/detail carry it; ref-first
  resolution precedence (ref beats exact-name); invalid ref 400; null clears; api_test
  regression both backends.

### E. Client (contentadmin)
- REMOVE the suffix fallback from buildArtworkIndex (exact-name index stays).
- Resolution helper: def → artwork = artworksByName[def.artwork_ref] ?? artworksByName
  [def.system_name] ?? null (mirrors the server's canon; server's artwork_facet_name is
  the authority on the detail view).
- **Artwork picker** (the 選択式): in the workspace def header, an "artwork" row shows
  the currently linked artwork (thumb + full namespaced name + how it's linked:
  'selected' | 'name match' | 'none') and a Select button (testid `cd-art-pick-open`)
  opening a picker overlay: search box, artworks of the MATCHING type first
  (po_def→po, si_def→si, monster_def→monster, unit_def→unit; tm_def/skill_def → all,
  with a type-filter chip row), thumbs + names + adopted badge, exact-name match
  pinned/suggested on top, current ref highlighted, `cd-art-pick-<system_name-safe>`
  rows, Clear-link action (testid `cd-art-clear`). Picking PATCHes artwork_ref,
  refreshes, reports.
- Display via the ref everywhere: rail thumb (list rows use artwork_ref field),
  header thumb, adopt-confirm thumb, and the VariantCard entity preview shows the
  def-resolved artwork thumb (small; variants obtain art ONLY through the parent def —
  the ruling's point 3 made visible).
- Deep links carry the resolved artwork's real system_name (as REQ-0173 already does).
- e2e: replace the suffix-mock test with the picker flow (seed 2 render-less artworks of
  the def's type + 1 of another type via the art API; open picker: same-type listed
  first, select one → PATCH lands, rail+header light, links target the ref'd name;
  clear → back to none; invalid state impossible via picker; direct PATCH with a bogus
  ref returns 400 (request-level assertion)). Keep the rest of the 21-test suite green
  (adjust any assertions that depended on suffix matching).

## Contract preservation
- REQ-0155/0157/0164/0173 testids preserved except the suffix-specific ones this spec
  replaces; delta documented in the log.
- Registry immutability/adoption/export semantics untouched. artadmin surface untouched.
- EN-only admin; pnpm only; ca-* CSS only.

## Out of scope
- Migrating/renaming the two ledgers' namespaces (true unification stays a future REQ).
- Auto-linking heuristics beyond the exact-name canonical fallback.
- Artwork-side back-references (art → content) and Dex changes.

## Gates
- G1: client tsc+build EXIT 0; server tests: content_test 13/13(+new), contentagg 4/4
  (+new), backfill tests unaffected, api_test 155+/155+ BOTH backends (files + pg).
- G2: tools/content_admin_e2e.sh green (updated suite incl. picker flow);
  tools/artadmin_e2e.sh green (4/4).
- G3: hygiene (no dist/lockfile/data churn; migration file numbered 016; off-mount diffs).
- Deploy (orchestrator, post-approval): apply migration 016 to the LIVE pg, merge,
  rebuild dist, RESTART backpack-api (server change), live verify, S7.

## Risks
- The harness pg namespace must receive the new column before the api boots — mirror
  whatever bootstrap path 009 uses; a missing column fails loudly in listContentDefs.
- Ref'd artwork deleted later (art registry has no delete today; soft ref just resolves
  to none) — display degrades gracefully, documented.
- Live deploy ordering: migration BEFORE api restart; the old api ignores the column, so
  migration-first is safe.

## Implementation log

### Session 2026-07-14 (implementing engineer, opus)

Implemented scope A–E on branch `req-0174-content-artwork-ref` off master. All
gates green. artadmin.css byte-untouched; dex/* / ArtAdminPage untouched;
storage.cjs/storage_content.cjs remains the sole persistence seam; ca-* CSS only.

**Key decisions**
- `artwork_ref` is stored as the BARE artwork system_name (the same bare-name
  currency the whole admin uses); no namespace prefix, no FK (soft ref across
  two independent ledgers). Resolution/validation nsName() it internally.
- REF-FIRST resolution lives in storage_content (`resolveArtworkFacetName`):
  ref artwork exists → else exact-name match → none. Exposed as
  `artwork_facet_name` on every def-shaped response; `has_artwork_facet`
  (list rows) is now ref-first `(ref artwork EXISTS) OR (exact-name EXISTS)`.
  REQ-0155/0157 row shape otherwise additive-only.
- Route PATCH validation extracted to exported `_resolveArtworkRefPatch(body)`
  so the 400 path is unit-testable; type mismatch deliberately NOT blocked
  server-side (picker filters; ledger stays permissive) — documented in code.
- Client resolution mirrors the server: `resolveDefArtwork(def, byName) =
  byName[artwork_ref] ?? byName[system_name] ?? null`; `artLinkMode` →
  'selected' | 'name match' | 'none'. buildArtworkIndex DROPPED the REQ-0173
  batch-suffix fallback (exact-name index stays as canonical fallback + picker
  default). Every art surface (rail thumb, header thumb, adopt-confirm thumb,
  per-variant thumb) resolves through the def — variants carry no art of their
  own (ruling point 3 made visible).

**Testid delta** (all REQ-0155/0157/0164/0173 testids PRESERVED)
- Reused, unchanged id, changed content: `cd-artwork-facet` no longer says
  "linked by batch name (…)"; it now shows `<artwork name> (link: selected|
  name match|none)` or `none (…)`. `cd-header-thumb` / `cd-artadmin-goto` /
  `cd-dex-link` / `cd-thumb-<name>` / `cd-facet-<name>` unchanged.
- ADDED: `cd-artwork-row`, `cd-art-pick-open`, `cd-art-picker`,
  `cd-art-pick-close`, `cd-art-search`, `cd-art-type-<type>`, `cd-art-clear`,
  `cd-art-picklist`, `cd-art-pick-<safe>`, `cd-variant-art-<no>`.
- Picker row testid scheme (documented): `cd-art-pick-<system_name>` with every
  ':' replaced by '__' (artPickTestid); all other allowed name chars
  ([A-Za-z0-9_]) pass through unchanged. (The art API rejects ':' names, so
  e2e-seeded names never contain ':'; the scheme covers live batch-namespaced
  rows.)
- e2e: the REQ-0173 suffix-mock test was REPLACED by the real picker-flow test
  (select → ref lands, rail+header light, links target the ref name; clear →
  none; bogus ref direct PATCH → 400 request-level). Remaining suite kept green.

**Gate results**
- G1: client `pnpm exec tsc -b` EXIT 0 (/tmp/req0174_tsc.log); `pnpm run build`
  EXIT 0 (/tmp/req0174_build.log). Server pg: content_test 18/18
  (13 REQ-0155/0157 + 5 REQ-0174), contentagg_test 5/5 (4 + 1 REQ-0174).
  api_test 176/176 files backend (/tmp/req0174_api_files.log) AND pg backend
  (/tmp/req0174_api_pg.log).
- G2: `tools/content_admin_e2e.sh` 21/21 (/tmp/req0174_content_e2e2.log);
  `tools/artadmin_e2e.sh` 4/4 (/tmp/req0174_artadmin_e2e.log). web/ restored
  (git checkout -- web/ && git clean -fd web/).
- G3: `git diff master...HEAD --stat` = only intended files (migration, storage,
  routes, server tests, contentadmin client files, contentadmin.css, e2e spec,
  REQ doc). No dist/lockfile/data churn; working tree clean.

**Commits**
- server: `1038680` — mig 016 + REF-FIRST facet resolution + PATCH validation + pg tests
- client: `bcb3abc` — artwork picker + REF-FIRST resolution + e2e picker flow + ca-* CSS
- (this log commit follows)

**Deviations / notes**
- Migration 016 was applied to the shared local supabase-db pg via the
  documented path (`docker exec -i supabase-db psql -U postgres <
  server/migrations/016_content_artwork_ref.sql`). This was REQUIRED for the
  pg-backed server tests and the e2e harness (both connect to that same DB,
  namespace-isolated; listContentDefs now references the column). The migration
  is idempotent + additive (ADD COLUMN IF NOT EXISTS … NULL), so the
  orchestrator re-running it on live is a safe no-op. No production
  merge/restart/cutover was performed.
- Ref'd-artwork-deleted degrades gracefully (ref → exact-name → none), covered
  by a content_test case.

**Expected live-deploy steps (orchestrator, post-approval)**
1. Apply migration to the LIVE pg BEFORE the api restart (migration-first is
   safe — the old api ignores the new column):
   `docker exec -i supabase-db psql -U postgres < server/migrations/016_content_artwork_ref.sql`
   (already idempotently applied to the shared dev pg; re-run = no-op).
2. Merge `req-0174-content-artwork-ref` → master.
3. Rebuild client dist (`pnpm --dir client run build`) and publish web/ statics.
4. RESTART `backpack-api` (server change: storage_content.cjs + routes/content.cjs).
5. Live verify: open contentadmin, open a def, Select artwork → confirm the
   PATCH lands and rail/header light with the ref'd artwork; Clear → none.

### Deployment record (orchestrator, 2026-07-14)
- Live pg migration 016 verified applied (content_defs.artwork_ref present; the engineer's
  shared-dev-DB application covered the live namespace; idempotent re-run safe).
- Merged to master 9d7e6e6 (impl 1038680/bcb3abc/c8608bc + state moves; contentadmin.css
  merge conflict with REQ-0171's ca-ep-* section resolved by keeping both blocks);
  dist rebuild committed; backpack-api RESTARTED (storage/routes change); /api/content/defs
  200 with artwork_ref in rows.
- Live verification (Chrome): #/contentadmin/blade — "Select artwork" opens the picker
  (search, po-first type chips, adopted badges, clear-link); selecting
  batch-004-item-icons-flux2:blade PATCHed the ref: header row shows the full name
  "(link: selected)" + thumb, rail row thumb + facet glyph lit, and the v1 variant card
  displays the def-resolved art thumb (variants obtain art ONLY via the parent def, per
  the ruling). blade's link was left in place as the first real usage.
- The REQ-0173 batch-suffix inference is gone from the deployed client (blade showed
  link: none before selection, as intended).
- User ruling recorded in this REQ's header is CONTENT-WIDE canon (registry-level art
  reference; variants resolve through the parent def) — candidate for PROJECT.md's
  design canon (user-managed; paste at will).
- Status: stays in built/ awaiting S7 user acceptance.
