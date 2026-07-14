# REQ-0179 — Custom Art Kind: operator-set resolution + operator-owned prompt, texture-linkable to no-art-kind content

**Requested by:** user, 2026-07-15 (chat): add a new artwork "kind" called `custom`
that lets the operator set the resolution on top of their own prompt instructions,
so a custom artwork can be assigned "just as a texture" to content that has no
art-kind of its own (e.g. `gacha_pack` / bp_gacha).

**Design decisions (user, 2026-07-15 chat, via clarifying questions):**
1. **Prompt** — custom uses the operator's prompt AS-IS. NO forced per-kind style
   template (anime/monster/…) is appended. `style_override` still wins when present;
   otherwise the composed subject (main_object + prompt_template) IS the final prompt.
   Rationale: a texture wants none of the "item, white background, bold outline"
   injection the entity kinds carry.
2. **Resolution** — operator-set width × height, bounded by what ComfyUI actually
   accepts for the flux2 latent: `EmptyFlux2LatentImage` declares width/height
   `min=16, max=16384 (nodes.MAX_RESOLUTION), step=16` and builds
   `latent[..., height//16, width//16]`. So custom resolution = integer, /16-snapped
   (reusing the existing snap16), clamped to [16, 16384]. Stored in the artwork's
   `shape` jsonb as `{width, height}` — custom's "shape" IS its resolution, keeping
   the existing shape→size derivation law intact (po mask / monster w,h → custom w,h).
3. **Process** — full REQ workflow: reserve → implement → ci.sh green.

## Depends on / coordination
- Artwork registry REQ-0151 (schema, sizing law), REQ-0156 (create/edit UX, queue).
- Content-artwork-ref REQ-0174 (the picker + artwork_ref column) — custom becomes a
  selectable type in that picker so no-art-kind defs can link it. Server already
  permits cross-type refs (routes/content.cjs: "TYPE mismatch is deliberately NOT
  blocked here"); this REQ only makes custom visible/selectable in the picker chips.
- Shared DB `supabase-db` (PG 17.6): the `artwork_kind` ENUM gains a value. Additive,
  migration-first-safe on the live deploy (old code never emits 'custom'; new code does).

## Scope

### A. Schema — server/migrations/017_artwork_kind_custom.sql (NEW)
- `ALTER TYPE artwork_kind ADD VALUE IF NOT EXISTS 'custom';`
- Top-level statement (ADD VALUE cannot run in a txn/DO block); IF NOT EXISTS makes it
  idempotent (PG 12+). Apply to the dev DB via the 007-style docker exec psql invocation.

### B. Sizing law — server/services/art_sizing.cjs
- `KINDS` gains `'custom'`. Add `MAX_RESOLUTION = 16384` (mirror of ComfyUI).
- `deriveSize('custom', {width,height})`: require integers ≥ 1; snap16 each; clamp to
  [16, MAX_RESOLUTION]; throw BAD_SHAPE on missing/non-integer. This is the single
  source of truth; the client mirrors it.

### C. Route — server/routes/art.cjs
- `shapeAndSize('custom', shape)`: require `{width,height}`, return
  `{shape:{width,height}, size:deriveSize('custom',shape)}` (so create + patch both
  recompute gen_width/gen_height from the shape, exactly like po/monster).
- `defaultsForKind('custom')` → `{ prompt_template: '{main_object}' }` (a passthrough:
  final subject == main_object when the operator leaves the template alone).
- No change to hPatch/updateArtwork needed: shape patch already recomputes size, and
  updateArtwork already supports gen_width/gen_height + shape.

### D. Python prompt composer — tools/art_job.py
- `compose_prompt`: after the existing bpskin + style_override branches, add
  `if kind == 'custom': return subject, subject` BEFORE the `KIND_TO_STYLE[kind]`
  lookup (custom has no KIND_TEMPLATE and must not KeyError). style_override still
  takes precedence via the branch above it.

### E. Client artadmin — client/src/artadmin/*
- `artShared.ts`: `Kind` + `KINDS` gain `'custom'`; `MAX_RES=16384`; extend
  `deriveSizeClient` to accept custom width/height and return the snapped/clamped size;
  `defaultTemplate('custom')` → `'{main_object}'`; `ArtDraft` gains `cw,ch`;
  `draftFromArtwork` reads `shape.{width,height}` (default 1024×1024) for custom.
- `CreatePanel.tsx`: custom shows editable width/height number inputs (testids
  `art-res-w` / `art-res-h`) and the snapped `art-resolution` readout; body.shape =
  `{width,height}` for custom.
- `Workspace.tsx`: custom shows editable resolution inputs in the edit form; the
  derived-size readout reflects the draft; shapeDirty for custom = cw/ch changed.
- `ArtAdminPage.tsx`: shapeDirty + doSave handle custom (body.shape = {width,height}).
- CSS `.aa-kind--custom` (artadmin.css).

### F. Client contentadmin — client/src/contentadmin/Workspace.tsx
- The artwork picker's `typeChips` gains `'custom'` (both the matching-type branch and
  the no-match branch), so a `gacha_pack` / `tm_def` / `skill_def` def can filter to and
  link a custom artwork. CSS `.ca-kind--custom` (contentadmin.css). No server change.

### G. Tests / gates
- server/tests/artwork_test.cjs (G2 sizing): custom snap + clamp cases; a create+preview
  flow asserting custom's final prompt is the operator subject verbatim (no style tail).
- e2e client/e2e/artadmin.spec.ts: create a custom artwork with an explicit resolution,
  assert the readout is the snapped size and the row appears.
- Full `tools/ci.sh` must print CI GREEN.

## Gate results (2026-07-15)
- Migration 017 applied to dev supabase-db (PG 17.6): artwork_kind is now
  {po, si, unit, monster, bpskin, custom}.
- `tools/ci.sh` => CI GREEN (CI_EXIT=0). Highlights:
  - [5.1] artwork_test (pg): 8/0 -- adds G2 custom snap (1000x700 -> 1008x704),
    clamp (20000x16 -> 16384x16), reject (0 / non-int), and a custom preview
    flow asserting the verbatim prompt (no per-kind style tail).
  - [6.5] admin e2e harnesses: artadmin 5/0 (incl. new "custom kind" spec),
    artinspect 1/0, contentadmin 22/0.
  - [7] default client e2e suite: 178/0.
- Implementation commit: 0402ce8.
- Test-hygiene notes learned building this:
  - artwork_test's custom AT calls jobs.runPython(preview), which spawns a
    python OUTSIDE the pump's serialization. It is placed LAST in runG3andFlow
    so it never steals CPU from an in-flight inspection during another test's
    render wait.
  - Run ci.sh WITHOUT a global ART_KIT_PYTHON (ci sets it inline only where
    needed). Exporting it globally forces REAL rembg inspections into [5.1]
    (whose kitPython() otherwise falls back to python3 via the remapped
    os.homedir) and can flake the pre-existing flow render-timeout.

## Not done here (needs user go-ahead per PROJECT.md HANDS-OFF)
- Merge to master + deploy (backpack-api / backpack-web) -- left for user
  acceptance; live services are HANDS-OFF without a fresh go-ahead.
- The migration was applied to the shared DEV DB (additive, safe). Any other
  environment must also apply server/migrations/017_artwork_kind_custom.sql.
