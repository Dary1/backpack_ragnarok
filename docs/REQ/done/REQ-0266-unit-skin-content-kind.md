# REQ-0266 — unit_skin content kind, per-profile skin selection, and the BP raster skin binding

**Status:** todo — ratified by the user 2026-07-19, cleared to implement.
**Reserved:** 2026-07-19
**Slug:** unit-skin-content-kind
**Ports (derived, PROJECT.md rule):** static 7660 / api 7661 / proxy 7662; e2e fleet 7664-7669.
**Supersedes / closes:** REQ-0125b (unit-skin-resolution, draft) — this REQ answers all
three of its open questions. REQ-0126's DEFERRED "PixiJS renderer binding" is claimed here.
**Related, NOT claimed:** REQ-0226 (unit ids join art_urls) stays open; this REQ keys
art_urls by SKIN id instead, which is a different and narrower change (see D3).

---

## 1. Goal

Make cosmetic skins a first-class content kind, give every profile a skin selection that
defaults by absence, and make every UI that draws a Unit or a Backpack render through that
one chain — including, for the first time, real raster art on the BP body.

Three things ship together because none of them is observable alone:
- `unit_skin` content defs (the data),
- a per-profile skin preference store + route (the selection),
- the resolution chains + the PixiJS binding (the display).

---

## 2. Ratified decisions (user, 2026-07-19)

- **D1 — ONE content kind.** `unit_skin`. The artwork it references discriminates its
  meaning: an art of kind `unit` makes it a unit portrait skin; an art of kind `bpskin`
  makes it a backpack skin. There is no separate `unit_bpskin` kind. (The user's initial
  wording carried both names; this is the resolution.)
- **D2 — full raster rendering.** The BP must actually paint the bpskin raster. That
  means a raster path in `composite.ts` and a real PixiJS binding in `BoardRenderer.ts`.
  The `bpskin_harness.mjs` golden hash WILL move and is updated deliberately.
- **D3 — `units[]` is an array.** One skin may serve several units. No wildcard.
- **D4 — art generation is a 5-unit pilot first.** Generate, present for review, then
  fan out to the remaining 49 only after the user accepts the pilot.
- **D5 — absence IS the default.** No migration writes a skin row for any existing
  profile. This follows the cited house convention (REQ-0141 `state.guide`,
  REQ-0126 decision 5, REQ-0042 `inv.pages[].tms`, REQ-0037 `dev_mode`,
  REQ-0118c `authId`): a new persisted field is defaulted at READ time, never
  backfilled. The user explicitly allowed this ("もしくは割り当てられていない事を
  defaultとして").

---

## 3. The data model

### 3.1 Schema `unit_skin/1`

Live file: `content/live/live_unit_skins.json`, header `{ "schema": "unit_skin/1", "entries": [...] }`.
(Note: `content/live/live_bpskins.json` has NO `schema` header and is invisible to the
backfill inventory — see L5. This REQ does NOT fix that; it does not make it worse.)

Entry:

```json
{
  "id": "uskin_bp_elf",
  "name": "Elf — Verdant Weave",
  "slot": "bpskin",
  "art_ref": "bpskin_unit_elf",
  "units": ["elf"],
  "default": true,
  "set": "elf",
  "i18n": { "ja": { "name": "エルフ — 翠の編み" } }
}
```

| field | type | rule |
|---|---|---|
| `id` | string | UNIQUE ACROSS EVERY KIND (see L3). Convention: `uskin_<unit>` for `slot:"unit"`, `uskin_bp_<unit>` for `slot:"bpskin"`. |
| `name` | string | required, non-empty |
| `slot` | `"unit" \| "bpskin"` | **the discriminator of D1.** MUST equal the referenced artwork's `kind`. |
| `art_ref` | string | an artwork `system_name`. A FREE reference — two skins may share one artwork (same law as `unit_def.icon`, REQ-0170). |
| `units` | string[] | non-empty; every element must be a live `unit_def` id. Duplicates rejected. |
| `default` | boolean? | optional. When true, this skin is the fall-back for every unit in `units[]` **for its `slot`**. At most ONE default per (unit, slot) — a second is a validation FAIL. |
| `set` | string? | optional grouping key. Ratified golden G6 pairs a unit skin with a BP skin as a SET (elf unit + elven bag); `set` is how that pairing is expressed. Not resolved by this REQ — reserved so G6 has a home. |
| `i18n` | object | `i18n.ja.name` MANDATORY, exactly as `unit_def` requires (`validateI18n` default locale set is `{ja}` — do NOT widen `SUPPORTED_LOCALES`, see L13). |

`slot` is stored explicitly and NOT derived from a registry lookup. This is load-bearing:
`runChecks()` is pure and DB-free, which is what makes `content_checks_dialect_test.cjs`
a cheap gate. The file tier validates `slot` structurally; the DB tier
(`server/routes/content.cjs` ingest) additionally asserts `slot === artwork.kind` when the
artwork registry is reachable, and records `applicable:false` with a reason when it is not.

### 3.2 The two defs every unit gets

For each of the 54 live `unit_def` entries:

- `uskin_<unit>` — `slot:"unit"`, `art_ref` = that unit's existing `def.icon`, `default:true`.
  This makes today's behaviour explicit data instead of an implicit code path. It is a
  pure re-expression: the resolved URL is byte-identical to what `unitArtUrl(def.icon)`
  builds today.
- `uskin_bp_<unit>` — `slot:"bpskin"`, `art_ref` = a NEW artwork `bpskin_unit_<unit>`,
  `default:true`.

`littleprincess` and `princess` share the artwork `units-002-roster-flux2:unit-princess`;
their `uskin_*` defs therefore share one `art_ref`. That is legal and is exactly what the
free-reference rule exists for. Do NOT collapse them into one def with `units:["littleprincess","princess"]`
— the BP skins differ.

---

## 4. Architecture — the three decisions that matter

### D-A. art_urls is keyed by SKIN id, not by unit id and not by `<unit>@<skin>`

`/api/content` is **public, unauthenticated, and mtime/warm-cached** (`public.cjs:19`,
`content.cjs:222-224`, 15 s TTL). It therefore cannot carry per-player state — that is a
hard constraint, not a preference.

The resolution: a `unit_skin` def is GLOBAL content. Its art resolves server-side exactly
like every other registry kind, and joins the sparse `art_urls` map keyed by the SKIN's own
id. The per-player part is only *which skin id is active* — a few bytes on the profile,
served on an authenticated route.

```
art_urls["uskin_bp_elf"]  -> "/api/art/bpskin_unit_elf.png"
art_urls["uskin_elf"]     -> "/api/art/units-002-roster-flux2%3Aunit-elf.png"
```

Consequences:
- `computeArtUrls()` (`server/lib/content.cjs:229-248`) gains unit_skin ids in its batch.
  Units themselves are STILL absent from the map — REQ-0226 stays open and untouched.
- Resolution reuses `resolveItemArtNames`'s existing two rungs unchanged: set the def's
  `content_defs.artwork_ref` column to `art_ref` and rung 1 resolves it. No new SQL shape.
- The public payload stays cacheable, and no per-player value ever enters it.

### D-B. The profile preference lives in its OWN storage root, never in the canvas

`writeProfile()` replaces `canvas` **wholesale on every PUT** (`server/storage/profiles.cjs:44-51`,
78-87). That is precisely why `bpskin_slot.cjs` and `bio.cjs` exist as sibling roots. A skin
preference in the canvas would be destroyed by any client that PUTs a canvas built from a
slightly older payload.

New store `server/storage/skin_prefs.cjs`, modelled line-for-line on
`server/storage/starter.cjs` + `server/migrations/012_starter_claims.sql` (the per-PLAYER
doc template; `bpskin_slot.cjs`/`014_bp_skin.sql` is the per-INSTANCE template and is the
wrong shape here).

```
files: data/skin_prefs/<playerId>.json      pg: skin_prefs(player_id text PK, doc jsonb, updated_at timestamptz)
doc:   { player_id, unit: { <unitId>: <skinId> }, bpskin: { <unitId>: <skinId> }, updated_at }
```

Absence at EVERY level resolves to the def-declared default: a missing file, a missing
`unit`/`bpskin` object, a missing unit key, or a `null` value all mean "use the default".
`skin_id` values that no longer exist in content resolve as absent — a deleted skin must
never blank a unit.

Route `server/routes/skins.cjs`, modelled on `server/routes/bio.cjs`:
- `GET  /api/profile/:id/skins` → `{ok, skins:{unit:{},bpskin:{}}}`
- `PUT  /api/profile/:id/skins` → body `{unit?:{}, bpskin?:{}}`, MERGE semantics (a key set
  to `null` clears it back to default), 64 KB cap, validates every skin id exists and that
  the unit is in that skin's `units[]` and that `slot` matches the map it was written to.
Auth goes through `admin.resolveAuthFromRequest()` and the same `isDefaultAlias` /
`viaDevFallback` handling `server/routes/profile.cjs:33-34` uses, so the REQ-0214 e2e
identity (`x-bpk-e2e-profile` → `e2e_<suffix>`) keeps working.

### D-C. The resolution chains

**Unit portrait** — `client/src/board/unitIcon.ts`. The `skin` rung already exists and is
already unit-tested; it is fed `null` at its single call site
(`BoardRenderer.ts:947-958`). Feed it for real:

```
skin (profile selection ?? def default)  ->  default (unit:<id>)  ->  legacy glyph  ->  placeholder
```

Rung count stays 4, so `check_unit_icon.mjs`'s rung assertions survive; the assertion at
`check_unit_icon.mjs:107` (`unitIconRasters().length === 0`) and the header comment at
`:102-105` ("When REQ-0125b/0127 land, this assertion is the one that should be updated,
deliberately") are updated deliberately, as that comment instructs.

**Backpack** — `client/src/board/skin/bpSkinResolve.ts`. Today: `instance → set → neutral → plain`.
Insert an explicit `profile` rung:

```
instance (bp_skin slot)  ->  profile (player's pick for this BP's unit)
                         ->  set (def default for this BP's unit)  ->  neutral  ->  plain
```

5 rungs. `check_bpskin.mjs:42-47` pins the old 4 and is updated deliberately. The rung name
must remain observable in the return value — the whole point of these resolvers is that a
harness can prove WHICH rung fired.

A BP with no `unit` has no unit to key on and lands on `neutral`, exactly as today.

---

## 5. Ships — file by file

### A. Schema / DB
1. `server/migrations/023_content_kind_unit_skin.sql` — `ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'unit_skin';` bare top-level (ADD VALUE cannot run in a txn/DO block). Next free number is 023 (016 and 020 are already doubled — L9).
2. `server/migrations/024_skin_prefs.sql` — the per-player table, copied from `012_starter_claims.sql` including the `GRANT ... TO backpack`.
   **Both are hand-applied at deploy**, not on boot. Note that `020_content_kind_gimic`,
   `021_artwork_kind_gimic` and `022_content_kind_dungeon` are NOT applied to the dev DB;
   do not apply them as a side effect of this REQ.
   No new `artwork_kind` value is needed — `bpskin` and `unit` both already exist.

### B. Shared validation (ONE executable definition, reused by check and runtime)
3. `shared/content_validate.cjs` — `validateUnitSkinEntry(entry, { unitIds, skinIds })` + `UNIT_SKIN_SLOTS = ['unit','bpskin']` + export. Enforces §3.1 including the at-most-one-default-per-(unit,slot) rule, which needs the whole corpus and therefore takes the roster as an argument, exactly as `validatePackEntry(pack, unitIds, contentIds)` does.

### C. Content checks
4. `server/services/content_checks.cjs` — `unit_skin/1` dialect row in `DIALECTS`; `schemaVocabCheck` branch that loads `live_units.json` for the id roster and REUSES the validator; `engineTypesCheck` / `genDataCheck` return honest `applicable:false` **with a reason string** (never a free PASS); `integrateCheck` needs no edit (it already early-returns for anything that is not po_def/si_def).

### D. Server registry + serving
5. `server/routes/content.cjs:24` — `unit_skin` joins `KINDS`.
6. `server/services/core.cjs:232-244` — joins `REGISTRY_KINDS`, `REGISTRY_MAP_BY_KIND` (`unitSkinDefsById`), and gets its `overlayMap` line in `applyRegistryOverlay`. **Both lists** — `monster_pack` is in `KINDS` but not `REGISTRY_KINDS`, so its adoptions never reach serving (L1). Do not repeat that bug.
7. `server/lib/content.cjs` — loader + mtime entry + `unitSkinsFromCore()` display slice on `/api/content`; unit_skin ids join the `computeArtUrls` batch (D-A).
8. `shared/dto.ts` — `ApiUnitSkinEntry` + the payload field. While here, also declare the **already-served-but-untyped** `bpskins` field (`content.cjs:164` serves it; `ApiContentPayload` never declared it, so the client drops it in `gameDataFromApiContent`). The BP binding needs it.

### E. Profile preference
9. `server/storage/skin_prefs.cjs` (new) + re-export from `server/storage.cjs`'s single `module.exports`. Do not let any consumer require the submodule directly — storage.cjs is the only chokepoint.
10. `server/routes/skins.cjs` (new) + registration at the tail of `server/router.cjs:36-51`.

### F. Content data
11. `content/live/live_unit_skins.json` — 108 entries (54 units × 2 slots).
12. `tools/backfill_content_registry.cjs` — new `SOURCES` row `{kind:'unit_skin', file:'live_unit_skins.json'}`.
13. `sim/tests/req0207_wildlands_test.cjs:130` and `req0219_deepstone_test.cjs:130` — add `live_unit_skins.json` to `CROSS_KIND_FILES` so the cross-kind id-uniqueness sweep covers it. **This is mandatory** — the deploy backfill FATALs on a duplicate `system_name` (L3).
14. `tools/verify_content_registry_parity.cjs:41-50` — add `unit_skin` to `COVERED`. Its own header says a kind the serving path resolves but this tool does not check is a kind whose drift reaches the game unseen; `monster_pack`/`gimic`/`dungeon` already sit in that gap (L2) — do not widen it.

### G. Client — content admin
15. `client/src/contentadmin/contentShared.ts:13-14, 26-44` — `Kind` union, `KINDS`, and `SCHEMA_REF_DEFAULTS` (typed `Record<Kind,string>`, so omitting it is a compile error).
16. `client/src/contentadmin/EntityPreview.tsx` — a `unit_skin` branch showing slot, art thumb, and the units[] chips. Falls back to the unknown-kind grid if omitted, but every precedent shipped one.
17. `client/src/contentadmin/Workspace.tsx:33,56` — the artwork picker cannot currently select a `bpskin` (`typeChips` omits it and `MATCH_TYPE` has no entry). Add `bpskin` to `typeChips` so a `unit_skin` def can actually pick its artwork in the UI. `MATCH_TYPE` stays unset for `unit_skin` because its art kind is per-entry, not per-kind.

### H. Client — resolution + rendering (D2, the heavy half)
18. `client/src/board/skin/composite.ts` — a raster fill path. `compositeSkin()` must stay a **pure function usable from Node** (three offline harnesses import it and there is no DOM there), so the decoded raster arrives as an argument, `{width, height, rgba: Uint8ClampedArray}`, NOT as an `HTMLImageElement`. When `def.art.fill_texture` is present and a raster was supplied, tile it across the silhouette interior and keep the welt/edge treatment; when either is absent, take today's palette-procedural path unchanged.
19. `client/src/board/skin/bpSkinResolve.ts` — the 5-rung chain of D-C.
20. `client/src/board/skin/skinRegistry.ts` — `loadSkinDefs()` gains the unit_skin-derived defs. `BpSkinArt.fill_texture` is a declared-but-never-read type today; this REQ is what starts reading it.
21. `client/src/board/unitIcon.ts` — `setUnitSkins(map)` module-global alongside `setUnitDefs`/`setItemArtUrls` (`boot.ts:177,181`). This is the established "art arrives as DATA, the renderer is untouched" idiom and avoids threading a payload through three independent board components.
22. `client/src/board/sprites.ts` — `unitIconRasters()` must emit the skinned key form `unit:<id>@<skinId>` (`unitIconKey` already supports it and is unit-tested; nothing has ever emitted it). **`sprites.ts:222` caches `boardLoadPromise` forever for the session** — a runtime skin swap needs an invalidation hook, which does not exist. Add one; do not eagerly load all 108 variants.
23. `client/src/board/BoardRenderer.ts` — feed `skinKey` at `:954` (delete the `null` literal), and add the BP composite binding. Non-negotiable invariants: the unit core disc stays the BP drag handle and stays hit-testable; `gUnits` is still added after `gItems`; every decorative sprite keeps `eventMode='none'` (`:972`, `:987`). `bp-rotate.spec.ts` and `bp-transfer.spec.ts` grab BPs *through* the unit cell and will fail loudly if this slips.
24. `client/src/store/boot.ts` — fetch `/api/profile/:id/skins` alongside the canvas; call `setUnitSkins`. A 404 or a failure must degrade to defaults, never block boot.
25. The DOM surfaces. REQ-0125a promised a DOM adapter over the same resolver and it was never built, so five surfaces each fork the chain. Build it (`client/src/dex/dexIcons.ts` is the item precedent) and route through it: `UnitCatalog.tsx:54-75`, `WorkshopPage.tsx:471`, `WorkshopPage.tsx:557`, `SquadMiniCard.tsx:85-88`, `SquadBoardTile.tsx:94,109`.
   - `SquadMiniCard` and `SquadBoardTile` call `getItemArtUrl(bp.unit?.id)`, which is a **permanently dead branch** — unit ids and item ids have zero overlap (verified). They have never rendered a unit image. They will start.
   - `client/src/market/marketShared.tsx:93-101` (`MarketThumb kind==='unit'`) passes an artwork system_name to `iconDataUrl()`, which only knows SVG sprite symbol ids → always null → an empty cell. **This is a live bug.** Fix it via the same adapter.
26. `client/src/dex/ShapeGrid.tsx` / `BpDiagram.tsx` — **explicitly OUT OF SCOPE.** REQ-0125a deliberately left the unit cell art-free to hold the no-diff contract; REQ-0125b then claimed "no new call site", which contradicts it. This REQ resolves the contradiction by leaving ShapeGrid alone. `dex.spec.ts:379` (`.dex-md .shape-grid` count === 0) and `workshop.spec.ts:195` (`shape-grid-cell-unit` count === 1) therefore stay green unmodified.

### I. Art
27. 54 new `bpskin` artworks named `bpskin_unit_<unit>`, created + generated + adopted through the artadmin HTTP API (§6). Delivered in two waves per D4.

### J. Gates
28. `server/tests/backfill_content_registry_test.cjs` — the `SOURCES` list at L25-56, the per-kind counts at L129-164, and the total-sum reconciliation at L139 all enumerate kinds by name. `SKIPPED_FILES.length === 4` at L219 must stay 4 (we add a SOURCES row, not a skip).
29. `server/tests/content_checks_dialect_test.cjs` — positive cases over the whole live corpus, negative cases per rule, and a dialect non-leakage case.
30. `server/tests/api/*` — `/api/content` carries a `unit_skins` section and `art_urls` carries a skin id whose artwork is adopted and omits one whose artwork is not.
31. New `server/tests/skin_prefs_test.cjs` (files + pg) — round-trip, merge semantics, null-clears-to-default, unknown skin id rejected, slot mismatch rejected, absence reads as `{}`.
32. `client/scripts/check_unit_icon.mjs` — the deliberate update of `:107` and the skinned-key assertions.
33. `client/scripts/check_bpskin.mjs` — the 5-rung update.
34. `client/scripts/bpskin_harness.mjs` — **the golden `gridHash 6b024c07…` moves.** Regenerate, eyeball the 48 composites in `web/preview/bpskins-req0126/`, and record the new hash IN THIS FILE before committing it.
35. `client/e2e/` — a spec proving: a unit with a default skin renders it; a profile that has picked a different skin renders that; a unit with no skin at all still renders (legacy glyph) and a BP with no skin still renders (neutral).

---

## 6. Art generation procedure

Interface is the artadmin HTTP API at `http://127.0.0.1:8802` (there is no CLI). The live
box is dev_mode with no `dev_mode` key in `data/config/dev_user.json`, so a localhost
request is already `item_admin`; send `X-Auth-Token` anyway if that ever changes.

Preconditions, checked and reported before any job is queued:
- `curl -s http://127.0.0.1:8188/system_stats` returns — ComfyUI is up.
- `GET /api/art/queue` is empty or its contents are understood. The queue is **in-memory**:
  if `backpack-api` has been restarted, stale `queued`/`running` rows are orphans and must
  be swept (DELETE + re-generate at the same seed) before new work is added.
- **Do NOT restart `backpack-api`, `backpack-web`, `backpack-tunnel` or `comfyui.service`.**
  Do not touch `~/ComfyUI`, the `*-artsession` worktree, `monster_matte_variants/`, or any
  GPU output dir. Do not run `tools/ci.sh` while a generation batch is in flight — that
  combination swap-thrashed the box for ~16 minutes on 2026-07-17.

Per artwork:
```
POST /api/art/artworks            {system_name:"bpskin_unit_<u>", kind:"bpskin", main_object:"<material clause>", prompt_template:""}
POST /api/art/artworks/<n>/preview {}            # confirm the composed prompt, no GPU
POST /api/art/artworks/<n>/generate {count:4}
POST /api/art/artworks/<n>/adopt   {seed:<pick>} # only after the user picks
```

`kind:"bpskin"` locks 1024×1024 and forces `tiling:true` server-side (`art.cjs:282`), which
swaps in `CircularVAEDecode`. Leave `prompt_template` EMPTY: the bpskin branch of
`compose_prompt` discards `subject` and uses `main_object` alone, appending `FILL_STYLE`.
So `main_object` is ONLY the material clause. Verified house form:

> `brown leather texture, worn grain and fine creases` → `… , seamless repeating allover texture fill, tileable pattern, flat even lighting, uniform density edge to edge, filling the entire frame, no focal object, no single object, no border, no frame, no outline, no vignette, no shadow, cel-shaded coloring, flat colors, anime game texture, high detail, sharp focus`

Batching law: group by PROMPT, not by seed. Same prompt repeat costs 2-20 s; a prompt change
costs 30-170 s (Qwen encoder swap); the first job of a run costs 450-540 s (cold load).
Use `POST /api/art/queue/hold {held:true}` → enqueue everything → `POST /api/art/queue/execute`.

**Expected, benign:** the `bpskin.frame_gate` inspection kit will report FAIL on every one of
these renders. That kit is designed for a bordered FRAME SOURCE (it checks for a margin and
a sub-unity silhouette coverage); a fill is full-bleed by construction, so margin=0 and
coverage=1.0. Empirically confirmed on the three existing `bpskin-flux2-0150:elven` renders.
It is advisory and never blocks adoption. `tiling.seam` (band 0.83-1.10) is the kit that
actually carries information here.

### Pilot (D4) — 5 units

| unit | artwork | `main_object` |
|---|---|---|
| elf | `bpskin_unit_elf` | `woven living vine and pale birchbark texture, delicate leaf filigree, soft moss green and silver` |
| dwarf | `bpskin_unit_dwarf` | `hammered dark iron plate texture, riveted seams, deep carved angular runes, ember warm bronze accents` |
| knight | `bpskin_unit_knight` | `polished steel scale mail texture, overlapping lames, crisp heraldic rivets, cool blue grey` |
| vampire | `bpskin_unit_vampire` | `deep crimson damask velvet texture, black baroque scrollwork, faint tarnished gold thread` |
| icequeen | `bpskin_unit_icequeen` | `frosted crystal facet texture, pale blue ice shards, fine frost fern etching, cold white glow` |

Chosen for maximum spread across the roster's visual registers (organic / forged /
heraldic / gothic / crystalline), so a prompt-strategy failure shows up in the first wave
rather than on unit 50. 4 seeds each = 20 renders.

The subject rules that matter for a FILL (from `tools/art_style.py:53-97`, measured):
say positively that it is an allover fill — no focal object, no border, no outline — which
`FILL_STYLE` already does, so the operator writes only the material. Circular padding makes
a tile *joinable*, not *tileable-looking*; the allover-pattern discipline is still required.
There is NO negative prompt available, so anything unwanted must be excluded by saying what
the thing positively IS.

---

## 7. Gates

Run with `HOME` pointed at the worktree (a `/tmp/<home>/backpack_ragnarok` symlink to the
worktree). Three separate code paths anchor on `os.homedir()` — `storage_content.cjs:28`
(the pg NAMESPACE), `content_export.cjs:26`, and `tools/promote_dungeon_batch.cjs` — so a
branch verified without the remap silently reads the MAIN checkout's content and fails
confusingly, or worse, writes to it.

- `SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh` green (the DB-free sweep).
- Full `tools/ci.sh` → `CI GREEN`, **not** concurrent with an art batch.
- Scoped e2e from `client/`, REQ-0266 decade:
  ```
  E2E_FLEET_ROOT=/tmp/bp_e2e_workers_req0266 E2E_PROXY_PORT=7662 \
  E2E_FLEET_BASE_PORT=7664 PLAYWRIGHT_BASE_URL=http://127.0.0.1:7662 \
  E2E_PARALLEL=4 pnpm exec playwright test
  ```
- pnpm only, `--frozen-lockfile`. Never npm.
- Fallback proof, stated as three renders that must all still work: a unit with no skin
  (legacy glyph), a unit with a default skin (the default), a unit with a picked skin (the pick).
- `web/app` is a COMMITTED build artifact — rebuild and commit the bundle, or the deploy
  ships a stale one (this has happened before).

## 8. Landmines (verified, carried forward from the survey)

- **L1** `monster_pack` is in `KINDS` but not `REGISTRY_KINDS` — its adoptions never reach
  serving. `unit_skin` must be in both.
- **L2** `verify_content_registry_parity.cjs COVERED` already omits monster_pack/gimic/dungeon.
- **L3** `content_defs.system_name` is UNIQUE ACROSS KINDS; the deploy backfill FATALs on a
  collision. `uskin_*` prefixes keep clear of the 54 unit ids and everything else live.
- **L4** `backfill_content_registry_test.cjs` asserts `SKIPPED_FILES.length === 4` exactly and
  sums every kind by name.
- **L6** `tools/art_job.py:15 KIND_TO_STYLE` has no `gimic` entry and line 103 would KeyError.
  Not ours — `bpskin` has its own early-return branch at line 78 and never reaches the lookup.
- **L9** migration numbers are hand-claimed and already collide twice; 023/024 are next free.
- **L10** `web/app` is committed build output.
- **L14** `tools/e2e_fleet.cjs` now `cpSync`s the whole worktree `content/live`; the old
  per-file overlay idiom is retired — do not re-add it.
- Live dev DB has NOT had 020/021/022 applied. Apply only 023/024.

## 9. Out of scope

- REQ-0226 (unit ids join `art_urls`) — orthogonal, stays draft.
- `ShapeGrid`/`BpDiagram` unit-cell art (§5 item 26).
- The `set` field's G6 pairing behaviour — the field ships, the pairing logic does not.
- Edge-strip bpskin art (REQ-0146, reserved, disproved route).
- `live_bpskins.json`'s missing `schema` header / backfill invisibility (L5).
- A player-facing skin PICKER UI. This REQ ships the store, the route, the chain and the
  rendering; choosing a non-default skin is possible through the API and is proved by e2e,
  but no chrome is added to `Settings.tsx`.

## 10. State log
- 2026-07-19 reserved (stub).
- 2026-07-19 reserved → todo: spec written; D1-D5 ratified by the user in the same session.
- 2026-07-19 SERVER half implemented (Ships A-F + the server half of J), on branch
  `req-0266-unit-skin-content-kind`. Client half (G, H, item 25) and art (I) are not
  in this pass.
- **MIGRATIONS 023 + 024 ARE PENDING.** Both files are written and committed; NEITHER
  has been applied to any database. They are hand-applied at deploy, as the spec
  requires, in this order:
  ```
  docker exec -i supabase-db psql -U postgres < server/migrations/023_content_kind_unit_skin.sql
  docker exec -i supabase-db psql -U postgres < server/migrations/024_skin_prefs.sql
  ```
  Until 023 is applied, `storage.resolveAdoptedContentData('unit_skin', ...)` throws
  `invalid input value for enum content_kind` -- which is CONTAINED: services/core.cjs
  isolates that per kind (the REQ-0211 guard) and unit_skin simply degrades to
  file-served. Until 024 is applied, ci.sh's `[5.455/7]` pg step fails with
  `relation "skin_prefs" does not exist`. That step is deliberately NOT skip-guarded:
  it is a pending migration, not a defect, and a gate that quietly passes against a
  missing table proves nothing (REQ-0159). The files-backend twin `[4.685/7]` is green.
  020/021/022 stay unapplied on the dev DB, exactly as section 8 says.
- Deploy note: the backfill must run AFTER 023 (`tools/backfill_content_registry.cjs`
  now carries the `unit_skin` SOURCES row -- 108 new defs, verified collision-free
  against all 10 other kinds at 349 total). `content_defs.artwork_ref` is NOT set by
  the backfill for any kind; until an operator PATCHes it (or the exact-name artwork
  is adopted), `art_urls` simply OMITS each skin id and the client falls back --
  never an error. That is the D-A chain behaving as specified, not a gap.

- 2026-07-21 ART (I) fan-out adoption COMPLETE -- 48/49 bpskin_unit_* seeds adopted,
  1 flagged. DEVIATION from D4/§6 ("user picks"): the user delegated seed selection to
  agent visual review, authorized via the orchestrator session 2026-07-21. Review split
  per user direction: Opus judged the first 10, a Fable-class agent the remaining 39
  (contact sheets + seam metric + 2x2 wrap checks; sheets retained in the session
  outputs for spot-check). Seam = inspect_seam ratio_x/ratio_y, band 0.83-1.10 advisory.
  Adoptions (unit seed rx/ry):
  alchemist 1 0.80/0.69 | ancient_grimoire 1 0.67/0.66 | angel 1 1.10/1.04 |
  bard 1 0.98/1.04 | battle_pickaxe 1 1.18/1.16 | battle_standard 4 0.83/1.10 |
  berserker 2 1.00/0.99 | cleric 3 0.93/1.01 | cursed_doll 1 1.02/1.08 |
  darkelf 2 0.94/1.14 | darkknight 2 0.92/0.99 | dragonknight 2 0.44/1.39 |
  druid 2 0.86/0.97 | enchanted_lantern 8 0.90/0.96 | fairy 3 0.80/0.92 |
  giant_shuriken 6 1.69/0.89 | gladiator 1 0.90/1.06 | golden_apple 2 0.86/1.03 |
  hero 3 1.15/1.49 | hourglass 1 0.59/0.71 | jester 2 0.95/1.19 | king 1 1.01/1.01 |
  lightcavalry 1 0.90/1.07 | littleprincess 1 0.74/0.80 | living_anvil 1 0.77/0.80 |
  mana_crystal 1 0.89/0.97 | miko 5 1.07/1.18 | monk 2 0.93/0.99 | ninja 1 0.92/1.02 |
  orc 4 0.92/0.97 | paladin 5 1.94/0.52 | plaguedoctor 2 0.89/1.03 |
  powder_keg 5 1.26/0.82 | priest 2 1.24/0.97 | princess 2 0.83/1.05 |
  ranger 1 1.04/1.15 | samurai 1 0.83/1.14 | shaman 1 0.94/1.02 |
  shieldmaiden 3 0.79/1.31 | sorceress 1 0.57/0.82 | squire 1 0.99/1.05 |
  thief 1 0.83/1.04 | valkyrie 1 0.91/0.87 | war_horn 4 2.66/1.60 |
  watcher 4 0.80/1.24 | werewolf 1 0.80/1.02 | witch 1 0.95/1.15 | wizard 3 0.87/1.02.
  Regenerated ONCE (all 4 first-pass seeds failed; count:4, prompt untouched):
  enchanted_lantern, giant_shuriken, miko, paladin, pirate, powder_keg -- five of six
  yielded an adoptable seed (5-8 range above).
  FLAGGED unadopted: pirate -- both passes (8/8 renders) produced stitched patch/frame
  motifs or corner-blotch fields; the "patched stitching" clause keeps composing framed
  patches. Needs prompt surgery under a follow-up; falls back per the D-A chain.
  Incident: ComfyUI crashed once mid-batch (early, during ancient_grimoire seed 4) and
  self-recovered; that render was lost and the unit was judged on its remaining seeds.
  No service was restarted. Queue drained clean: 54/54 artworks terminal, 53 adopted
  (5 pilots + 48 fan-out), 1 flagged.

- 2026-07-21 DEPLOY-PREP 2 -- deferred gates run, cross-REQ migrations applied (user
  decision), backfill landed, pirate resolved. (1) FULL `tools/ci.sh` (HOME=/tmp/h0266
  remap, DATABASE_URL exported; GPU queue verified drained first): 63 steps, everything
  through `[6.6/8]` GREEN -- `[5.455/7]` pg skin_prefs parity GREEN now that 023/024
  are in. `[7/7]` scoped e2e, final lines verbatim: `2 failed` / `1 skipped` /
  `190 passed (3.5m)`. Both reds are the documented pre-existing pair, tolerated per
  §11.4-D: forecast.spec.ts:206 (same first assertion, slot-pressure locator timeout;
  reproduces on master) and schedule.spec.ts:1451 (409 at apiAssignSlot :1456;
  re-verified THIS pass: passes alone on this branch, 29.4s). REQ-0266 specs all green:
  unit-skin-fallback 4/4, bp-rotate, bp-transfer, dex.spec.ts:366, workshop.spec.ts:166,
  contentadmin (via `[6.5/8]`). Nothing else red; the `[3.8/7]`/`[4.71/7]` internal
  SKIPs and the art_jobs numpy noise are the documented behaviours.
  (2) MIGRATIONS 020/021/022 APPLIED -- REQ-0211/REQ-0185 migrations, applied here
  under EXPLICIT user authorization (2026-07-21) to clear the §11.6.3 block; recorded
  as a user decision. All three read first: each is a single bare
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, additive-only. psql printed `ALTER TYPE`
  rc=0 for each (020 at 06:14:41Z, 021/022 at 06:14:46Z). content_kind 9 -> 11 labels
  (gimic@10, dungeon@11); artwork_kind 6 -> 7 (gimic@7).
  (3) BACKFILL COMPLETE into live namespace 88d662ca20e5289b, WITHOUT the remap
  (§11.6.2). Dry-run reproduced §11.6.3 exactly (349/349, unit_skin=108). Apply rc=0:
  115 defs created (188 ours pre-existing no-ops, 46 foreign skipped), 115 variants,
  115 adopted on creation; machine checks unit_skin PASS 108/0, gimic 4/0, dungeon 3/0.
  Live ns 238 defs / 241 variants before (re-verified) -> 353 / 356 after; per-kind now
  carries unit_skin=108, gimic=4, dungeon=3. Spot-check: uskin_* artwork_ref NULL --
  the D-A chain's designed degradation until artwork adoption resolves it.
  (4) ART pirate RESOLVED -- 54/54 bpskin_unit_* adopted. User-approved main_object
  replacement: OLD "weathered sailcloth canvas texture, salt-faded continuous weave,
  patched stitching allover, oat white and dusty navy" -> NEW "weathered dark navy
  sailcloth texture, salt-faded canvas weave, tarred rope fiber accents" (PATCH via
  artadmin; prompt_template stays empty; preview carried the clause verbatim).
  count:4 -> seeds 9-12, all ok. s9 seam 0.98/1.06 IN BAND, 2x2 wrap-tile clean (no
  frame, no seam rule, repeat unobtrusive), reads as weathered navy sailcloth at
  thumbnail, calm enough for the 3px outline, matte register matching the other 53.
  s10 floral stamp motifs (off-brief), s11 blotch clusters w/ visible repeat cadence,
  s12 gold rope squiggles in columns (1.43/1.96). ADOPTED seed 9 (render 9029).
  Deploy remainder is §11.6.6 items 3-5 only: merge to master, live_unit_skins.json
  reaching the main checkout via that merge, backpack-api restart after it.

- 2026-07-21 DEPLOYED (user directive "merge and deploy", 2026-07-21 chat). §11.6.6 items 3-5
  completed:
  - Merged to master `5da7883` (--no-ff; sole auto-merge tools/ci.sh, no conflicts; REQ-0270/
    0271/0272 had landed since divergence). Pre-merge master `18ba8dd` kept as branch
    `backup-pre-req0266`.
  - `42238f8` rebuilt web/app in the MAIN checkout: the worktree-built bundle lacked the
    untracked `client/.env.local` VITE_SUPABASE_* injection (worktrees have no .env.local, so
    a worktree-committed bundle ships without auth env). Fresh main-checkout build is the
    serving artifact; the second CI pass reproduced it byte-stable.
  - Master CI: [0]-[5.46] green (twice), including [5.455/7] skin_prefs pg parity GREEN
    (migration 024 proven live). [6/7] build green. [6.5/8] artinspect 1/1, contentadmin
    28/28, [6.6/8] registry-first 4/4 green. artadmin 6/8: `:124`/`:273` page.goto
    load-timeouts = the documented REQ-0222 goto-under-load harness family (snapshots show
    the page fully rendered; trace shows every docroot resource < 250 ms; A/B same hour:
    byte-identical client code in the worktree 8/8 — the delta is the env-carrying bundle's
    extra boot latency under the harness's own render-job load, pre-existing on main-checkout
    trees per REQ-0222's Jul-16 measurements). [7/7] full fleet, quiet serial confirmation
    run: 190 passed / 1 skipped / 2 failed — exactly the two documented pre-existing reds
    `forecast.spec.ts:206` + `schedule.spec.ts:1451`, failure signatures identical to the
    branch-CI run (logs /tmp/req0266_fleet.log, /tmp/req0266_flake_rerun.log).
  - backpack-api restarted 2026-07-21 08:46:16 UTC (art queue verified EMPTY immediately
    before). Post-restart: /api/content 200, `unit_skins` section = 108.
  - artwork_ref backfill per D-A/§11.5 via the sanctioned REQ-0174 route
    (`PATCH /api/content/defs/<id>` with the dev item_admin token), art_ref taken from
    live_unit_skins.json: 108/108 ok. art_urls 86 -> 194 = +108 uskin_* exactly (54
    uskin_bp_* -> bpskin_unit_*, 54 unit-slot uskin_* -> adopted unit artworks); zero keys
    removed, zero non-uskin changes. (Unrelated: `beastreach_wilds` joined art_urls at
    restart from pre-merge registry state the old process's warm cache never picked up.)
  - Live verification, local AND https://backpack-dev.qtie.jp: art_urls 194 with 108 uskin_*,
    unit_skins 108; end-to-end art fetches 200 (bpskin_unit_elf.png 2 534 816 B via tunnel,
    bpskin_unit_alchemist.png, units003_alchemist.png). Art queue still empty after restart.

---

## 11. Outcome — verification pass, 2026-07-19

### 11.1 Commits (oldest first)

| hash | subject |
|---|---|
| `e10aee8` | REQ-0266: reserve unit-skin-content-kind |
| `3fe7ec6` | REQ-0266: reserved -> todo |
| `268fbf7` | REQ-0266: spec -- unit_skin content kind, per-profile skin prefs, BP raster binding |
| `83db3db` | REQ-0266 (A): migrations 023 unit_skin content_kind + 024 skin_prefs table |
| `34dd920` | REQ-0266 (B): shared validateUnitSkinEntry + UNIT_SKIN_SLOTS |
| `c65ae3c` | REQ-0266 (C): unit_skin/1 dialect + schema_vocab branch in content_checks |
| `48e290c` | REQ-0266 (F): live_unit_skins.json (108 defs) + backfill/parity/cross-kind wiring |
| `06354fa` | REQ-0266 (D): unit_skin joins KINDS, REGISTRY_KINDS, the overlay and /api/content |
| `a8cdb07` | REQ-0266 (E): per-PLAYER skin_prefs store + /api/profile/:id/skins route |
| `930d293` | REQ-0266 (J, server half): gates for the new kind + the new store |
| `f42333e` | REQ-0266: DB-tier art_slot check on ingest/recheck + REQ state log |
| `3ab0b1a` | REQ-0266: route-level coverage for /api/profile/:id/skins in skin_prefs_test |
| `818830a` | REQ-0266 (H, items 18-21+24): raster fill path, the 5-rung BP chain, unit_skin-derived skin defs, setUnitSkins, and the boot fetch |
| `92058f6` | REQ-0266 (H, item 23b, PARTIAL): the compositor-to-PixiJS bridge (not yet wired) |
| `4e5a399` | REQ-0266 (G, items 15-17): unit_skin joins the contentadmin |
| `a8b3d85` | REQ-0266 (H, item 25): the DOM unit-art adapter + its six surfaces |
| `814d2bf` | REQ-0266 (H, items 23 + 32-34): BoardRenderer wears the skins, and the harnesses that prove it |
| `99b3bf7` | REQ-0266 (H): rebuild web/app -- the committed bundle carries items 23 + 25 |
| `fe679ac` | **REQ-0266 (fix): only a skin with REAL ART paints -- neutral must never cover the per-BP colour tint** |
| `a77d471` | REQ-0266 (item 35): e2e proof of the four skin fallback states |
| `195f9ad` | REQ-0266: rebuild web/app -- the committed bundle carries the neutral paint guard |
| `8501117` | REQ-0266: tab-switch-stability counts the boot profile fetches SEPARATELY |

### 11.2 The `bpskin_harness` golden moved, deliberately (item 34)

```
6b024c0722319cc900b7ef59dc97a2521957bd992299ba99ab8604d5b8d3e048   (48 composites, palette only)
0944dbd9cefc866f7ebec1cd3f8710a8c26a95bf65de9c4d64517ecd888855a0   (72 composites, palette + raster)
```

The suite gained a third skin, `devraster` — `devornate` with a `fill_texture`, composited
against a raster the harness builds procedurally — so `composite.ts`'s raster path gets the
same 8 shapes x 3 backgrounds the palette path gets. Both hashes are recorded in
`client/scripts/bpskin_harness.mjs`'s header and in `bpskin_harness.golden.json`'s note.
The verification pass's own change to `composite.ts` (extracting `declaresFillTexture()`)
is a pure refactor and did **not** move it again — `[5.9c/7]` prints
`golden match: 0944dbd9…`.

### 11.3 The neutral regression, and the fix (`fe679ac`)

**What shipped broken.** `814d2bf` wired the 5-rung chain into `BoardRenderer.render()` and
painted `bpSkinSprite()` for whatever the chain returned. `neutral` is always registered, so
the chain resolves to a def for **every** BP on both boards; every `unit_skin`-derived def
inherits neutral's palette; and a composite body is opaque and parented in `gSkins`, which is
above `gBase`. Result: a flat `#2b3240` slab over every BP's colour grid tint and over the
inner two thirds of its 3px coloured outline. Every BP looked identical. That contradicts
`content/live/live_bpskins.json` ("renders identical to plain") and
`server/storage/bpskin_slot.cjs` ("absence never blocks rendering"), and no gate covered it
because nothing in the suite looked at the board's appearance.

**The rule now.** Only a skin with REAL ART paints: `bpSkinSprite()` returns `null` unless the
def declares `art.fill_texture` **and** that raster is decoded and in hand.

**Where the guard is, and why there.** In `client/src/board/skin/bpSkinTexture.ts`'s
`bpSkinSprite()` — the single PixiJS paint entry point, which already owned the
"nothing to draw -> null" contract. NOT in `resolveBpSkin()`: the resolver's whole purpose is
to report WHICH rung fired, and a resolver that lied about landing on `neutral` would make
`check_bpskin.mjs`'s rung assertions meaningless. It still reports `neutral` (or `set`); it
just no longer causes a paint. NOT at the BoardRenderer call site either, so the invariant
holds for every future caller of the bridge, not just this one. The predicate itself,
`declaresFillTexture()`, is exported from the pure `composite.ts` so the compositor's raster
path, the renderer's guard, the gates and the offline preview cannot disagree about what
"has art" means.

**Scope of the guard, stated plainly.** It is broader than `neutral`. Under ruling D5 no
skin artwork is adopted yet, so `art_urls` carries no skin ids at all and EVERY
`uskin_bp_<unit>` derived def has `fill_texture: null` — those BPs were landing on rung `set`,
not `neutral`, and were painted just as flatly. A guard keyed only on `isNeutral()` would have
fixed one BP in fifty. The cost of the broader rule: an authored palette-only skin
(`devornate`) no longer paints procedurally on the board. Nothing reaches that state today
(the `instance` rung is always `null` and authored ids are unreachable from the two unit-keyed
rungs), the offline compositor is untouched, and if a future REQ wants procedural authored
skins on the board it is one predicate in one place.

**Decode timing.** Previously a skinned BP painted palette-procedural first and swapped the
raster in on the next frame. It now paints NOTHING on the frame that starts the decode — it is
pixel-identical to an unskinned BP — and `onReady()` re-renders once the pixels are in. That
removes an opaque one-frame flash of exactly the colour this fix exists to eliminate. A 404 or
a decode failure is cached as a permanent miss and the BP simply stays unskinned.

**Sibling question — does a REAL textured skin occlude the per-BP colour tint?**
Yes, and that is INTENDED and recorded here as a decision: the skin IS the bag's surface, so
it replaces the grid tint inside the footprint. Identity survives outside the composite —
the 3px `bp.color` outline is centred on the footprint boundary so its outer half always
reads, and the `bp.color` label sits above the BP. Verified visually (see 11.4).

**One thing that must NOT be occluded, and was.** REQ-0033's usage wash on the BP's own
footprint is a STATE signal ("this bag is committed to a squad"), not decoration, and it was
drawn into `gBase` — under the skin. It now draws into `gSkins`, immediately after that BP's
own composite. Zero visual difference while nothing paints. The PO/SI usage tints needed no
move: they already draw into `gItems`, which is above `gSkins`.

**Anti-regression coverage.** `client/scripts/check_bpskin.mjs` (ci.sh `[5.9b/7]`) gained five
assertions pinning the predicate: `neutral` and an authored palette-only skin declare no fill
texture; a derived skin whose artwork is NOT adopted declares none either; one whose artwork
IS adopted declares it; and an art-less def still composites at full size OFFLINE, because a
PNG wants a solid body and only the board suppresses it. `client/e2e/unit-skin-fallback.spec.ts`
test 4 is a PIXEL test on both boards — the first gate in this repo that looks at board
appearance at all.

**New tool.** `client/scripts/board_skin_preview.mjs` (a preview tool, NOT a gate; not wired
into `ci.sh`) renders the `gBase` -> `gSkins` stack offline to PNG in the renderer's own draw
order, with the guard on and off, using the real modules via vite `ssrLoadModule`. Output is
committed at `web/preview/req0266-board/`.

### 11.4 Gate results

**A. DB-free sweep** — `HOME=/tmp/h0266 SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh`

```
CI GREEN
```
exit 0. 38 steps, every one green.

**B. Full `tools/ci.sh`** — `HOME=/tmp/h0266 DATABASE_URL=… tools/ci.sh`

Stops at the one EXPECTED red and therefore never prints `CI GREEN`:

```
==== [5.455/7] per-profile skin selection store parity (pg backend, REQ-0266) ====
FAIL: absence reads as {unit:{},bpskin:{}} -- a player who never picked has no row (D5) - relation "skin_prefs" does not exist
…
skin_prefs_test (pg backend): 12 FAILED
```

All 12 failures are the same cause: `relation "skin_prefs" does not exist`. `024_skin_prefs.sql`
is a PENDING MIGRATION (see DEPLOY STEPS), not a defect. The 9 assertions in that file that do
not touch the table still pass. The files-backend twin is green:

```
==== [4.685/7] per-profile skin selection store (files backend, REQ-0266) ====
skin_prefs_test (files backend): ALL GREEN
```

**C. Everything after `[5.455/7]`** — the same script with only that one command elided
(a `/tmp` copy; `tools/ci.sh` itself is unmodified beyond `818830a`'s two step additions).
Every step `[0/8]` through `[6.6/8]` GREEN, including:

```
==== [0/8] e2e harness port rule (REQ-0172) ====
check_e2e_ports: 4 harnesses, all ports derived from their REQ number, no collisions
==== [5.9b/7] client bp-skin resolver/registry/composite chain (REQ-0126) ====
check_bpskin: ALL GREEN
==== [5.9c/7] bp-skin S3 validation harness … ====
golden match: 0944dbd9cefc866f7ebec1cd3f8710a8c26a95bf65de9c4d64517ecd888855a0
harness: 8 shapes x 3 skins x 3 bgs = 72 composites; grid 2220x1974
bpskin_harness: ALL GREEN
==== [6/7] client typecheck + build ====   (and `git status` clean afterwards: the committed
                                            web/app bundle is byte-identical to a fresh build)
==== [6.5/8] admin e2e harnesses (artadmin + artinspect + contentadmin) ====   all green
==== [6.6/8] registry-first serving e2e (pg, seeded adopted def, REQ-0221) ====  green
```

**D. `[7/7]` scoped hermetic e2e**, REQ-0266 decade (proxy 7662, fleet 7664+), 4 workers:

```
3 failed
  forecast.spec.ts:206      REQ-0057 formation picker ranks the four slots by expected pressure
  reference-model.spec.ts:125  3. same blade placed into squad2 -> canvas shows canvasYellow
  schedule.spec.ts:1451     REQ-0240 monitor six zones, feed filters, roster/pacing
1 skipped
189 passed (3.5m)
```

None is REQ-0266's, each checked individually rather than assumed:
- `forecast.spec.ts:206` — reproduces on a clean `git archive master` export, same fleet, same
  env. PRE-EXISTING.
- `schedule.spec.ts:1451` — passes alone on this branch; fails on MASTER when the whole
  `schedule.spec.ts` runs in order. PRE-EXISTING intra-file state dependency.
- `reference-model.spec.ts:125` — green in the previous full run and green for the whole file
  in isolation (8/8); fails at a saved-state assertion (line 159), never reaching its tint
  assertion. Intermittent, load-dependent.

The four REQ-0266 fallback tests pass:
```
✓ unit-skin-fallback.spec.ts:88   1. a unit with NO skin still renders -- the legacy glyph …
✓ unit-skin-fallback.spec.ts:107  2. a unit with a DEFAULT skin renders the default
✓ unit-skin-fallback.spec.ts:120  3. a profile that PICKED a different skin renders the pick …
✓ unit-skin-fallback.spec.ts:143  4. a BP with NO skin still renders -- neutral paints nothing …
```
The specs the survey flagged as highest risk are all green: `bp-rotate.spec.ts` (5/5),
`bp-transfer.spec.ts` (6/6), `dex.spec.ts:366` (which carries the `:379`
`.dex-md .shape-grid === 0` assertion), `workshop.spec.ts:166` (which carries the `:195`
`shape-grid-cell-unit === 1` assertion), `schedule.spec.ts:1378`/`:1426`, and
`contentadmin.spec.ts:419` + `:438` (via the `[6.5/8]` harness).

**E. Renderer note.** `ci.sh`'s `[7/7]` sets `E2E_GPU=1` by default. Running the same scoped
command with `E2E_GPU` unset (CPU/SwiftShader) is NOT a viable configuration on this box at
`E2E_PARALLEL=4`: the run takes 9.2m instead of 3.5m and 16 tests fail, nearly all at
32.5-32.8s against the 30s per-test timeout, spread across the drag-heavy specs
(`reference-model` entirely, `bp-transfer:164`, `baseline-smoke:27`, `nav-routing:124`,
`tab-switch-stability`, `warehouse-mjolnir:91`, …). Box load average was ~29 during that run.
All four REQ-0266 fallback tests — including the pixel probe — pass on BOTH renderers, so the
pixel assertions are not renderer-dependent. Re-running the drag-heavy risk set on the CPU
renderer at `E2E_PARALLEL=1` (`bp-transfer` + `bp-rotate` + `reference-model`) gives
`18 passed (2.9m)`, exit 0 — i.e. the CPU-run reds are contention timeouts, not behaviour.

**F. Visual proof of the fix** — `web/preview/req0266-board/`, regenerated by
`node client/scripts/board_skin_preview.mjs`:
- `req0266_board_noskin.png` — three BPs (orange / yellow / purple) with no skin.
  BEFORE: all three are the same flat `#2b3240` slab, only a hairline of each outline left.
  AFTER: each BP shows its own colour wash and its full 3px outline; they are distinguishable
  at a glance, exactly as on master.
- `req0266_board_skinned.png` — BPs wearing a real fill texture. BOTH panels show the texture
  tiled continuously across the footprint and across internal cell borders, so the guard does
  not break real art. The right-hand BP carries a usage wash: BEFORE it is invisible under the
  composite, AFTER it reads over the texture.

### 11.5 DEPLOY STEPS

**1. Apply the two hand-applied migrations, in this order.** Both are written and committed;
NEITHER has been applied to any database.

```bash
cd ~/backpack_ragnarok
docker exec -i supabase-db psql -U postgres < server/migrations/023_content_kind_unit_skin.sql
docker exec -i supabase-db psql -U postgres < server/migrations/024_skin_prefs.sql
```

`023` is a bare top-level `ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'unit_skin'`
(`ADD VALUE` cannot run inside a transaction or a `DO` block). `024` creates
`skin_prefs(player_id text PK, doc jsonb, updated_at timestamptz)` plus its
`GRANT … TO backpack`, copied from `012_starter_claims.sql`.

**Do NOT apply `020_content_kind_gimic`, `021_artwork_kind_gimic` or `022_content_kind_dungeon`
as a side effect.** They are not applied on this box and are not this REQ's to apply.

**2. `ci.sh` step `[5.455/7]` is RED until `024` is applied.** That is a pending migration, not
a defect, and the step is deliberately NOT skip-guarded: a gate that quietly passes against a
missing table proves nothing (REQ-0159). Once `024` lands it must go green, and it is the
check that the migration actually took. Until `023` lands,
`storage.resolveAdoptedContentData('unit_skin', …)` throws
`invalid input value for enum content_kind`, which is CONTAINED — `services/core.cjs` isolates
that per kind (the REQ-0211 guard) and `unit_skin` degrades to file-served.

**3. Run the content backfill AFTER `023`.**

```bash
node tools/backfill_content_registry.cjs
```

It now carries the `unit_skin` SOURCES row: 108 new defs, verified collision-free against all
10 other kinds at 349 total. `content_defs.artwork_ref` is NOT set by the backfill for any
kind; until an operator PATCHes it (or the exact-name artwork is adopted), `art_urls` simply
OMITS each skin id, the client falls through, and — with the verification pass's guard — the
board renders exactly as it does today. That is the D-A chain behaving as specified.

**4. `web/app` is a committed build artifact** and is current as of `195f9ad`; a fresh
`pnpm run build` reproduces it byte for byte. No rebuild is needed at deploy.

**5. Nothing else.** No service restart is required by this REQ; the skin data is file-served
until an operator adopts artwork.

### 11.6 DEPLOY-PREP PASS — 2026-07-20 (migrations applied, backfill BLOCKED, CI green)

Run on the box, in the worktree `req-0266-unit-skin-content-kind`, while the 196-render
`bpskin` GPU batch was still draining. Nothing was restarted by this pass.

#### 11.6.1 Migrations 023 + 024 are APPLIED

`content_kind` **before** (8 labels — note `gimic` and `dungeon` are absent too, because
`020`/`021`/`022` are unapplied on this box and belong to other REQs):

```
po_def, si_def, monster_def, unit_def, tm_def, skill_def, gacha_pack, monster_pack
```

`unit_skin` was confirmed genuinely ABSENT before the add — `ALTER TYPE … ADD VALUE` is not
reversible in Postgres, so this was checked against `pg_enum` first rather than trusted to
`IF NOT EXISTS`.

| migration | applied at (UTC) | psql output |
|---|---|---|
| `023_content_kind_unit_skin.sql` | `2026-07-20T20:09:07Z` | `ALTER TYPE` |
| `024_skin_prefs.sql` | `2026-07-20T20:09:11Z` | `CREATE TABLE` + `GRANT` |

`content_kind` **after** (9 labels; `unit_skin` at `enumsortorder` 9):

```
po_def, si_def, monster_def, unit_def, tm_def, skill_def, gacha_pack, monster_pack, unit_skin
```

`skin_prefs` exists with exactly the declared shape — `player_id text NOT NULL` (PK,
`skin_prefs_pkey` btree), `doc jsonb NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`
— and the `backpack` role holds `SELECT, INSERT, UPDATE, DELETE`. (`anon`/`authenticated`/
`service_role` also appear in `role_table_grants`; that is Supabase's default-privilege
posture for `public`, not something this migration granted.)

`020`/`021`/`022` were deliberately NOT applied. Verified after the fact: `gimic` and
`dungeon` are still absent from the enum.

#### 11.6.2 The namespace question, resolved: run the backfill WITHOUT the HOME remap

The remap `HOME=/tmp/h0266` (with `/tmp/h0266/backpack_ragnarok -> <worktree>`) was carried
over from the verification pass, where its stated purpose was to stop the tool reading the
MAIN checkout's `content/live`.

**That purpose is void for this tool.** `tools/backfill_content_registry.cjs:65` sets
`REPO_ROOT = path.join(__dirname, '..')` and `collectAll(REPO_ROOT, …)` reads every source
file from there. The tool therefore reads the WORKTREE's `content/live` under any `HOME`;
`os.homedir()` plays no part in which files it opens. The remap's ONLY effect on this tool is
`server/storage_content.cjs:28`, which derives the pg namespace from `os.homedir()`:

| HOME | `REPO_ROOT` hashed | namespace |
|---|---|---|
| `/home/qtie` (live) | `/home/qtie/backpack_ragnarok` | `88d662ca20e5289b` |
| `/tmp/h0266` (remap) | `/tmp/h0266/backpack_ragnarok` | `baf134688a90b54d` |

Writing 108 `unit_skin` defs into `baf134688a90b54d` would be a sandbox artifact that nothing
serves. **Decision: the backfill must run WITHOUT the remap**, so it writes into the live
namespace `88d662ca20e5289b` — the one holding the real registry. There is no trade-off to
weigh, because the remap never protected the file reads in the first place.

CI (§11.6.4) still runs WITH the remap: there the isolated namespace is the point.

#### 11.6.3 The backfill is BLOCKED by the unapplied `gimic`/`dungeon` migrations

`--dry-run` (which provably opens no DB — the `require` of `storage.cjs` sits past the
dry-run gate) reports the expected plan:

```
  unit_skin   108 entries  <- content/live/live_unit_skins.json
  per-kind totals: po_def=22 si_def=6 tm_def=5 monster_def=44 unit_def=54 skill_def=81
                   gimic=4 dungeon=3 gacha_pack=8 monster_pack=14 unit_skin=108
  TOTAL: 349 defs / 349 variants (one adopted variant_no 1 per def)
```

108 `unit_skin`, 349 total, collision-free (`collectAll` FATALs on a clash and did not).

Diffed against the live namespace: of the 349 planned defs, **234 already exist** (from an
earlier run made before `gimic`/`dungeon` were added to `SOURCES`) and **115 are missing —
3 `dungeon`, 4 `gimic`, 108 `unit_skin`**.

**The apply run cannot reach the `unit_skin` rows.** `SOURCES` is processed in order:
`gimic` starts at entry index 222, `dungeon` at 226, `unit_skin` at 229. The main loop has NO
per-entry try/catch around `storage.createContentDef`, so the first `gimic` insert aborts the
whole tool. Confirmed by running it (insert-only and idempotent, so entries 0–221 were
pre-existing no-ops and nothing was written):

```
FATAL error: invalid input value for enum content_kind: "gimic"
    at async Object.createContentDef (server/storage_content.cjs:179:17)
    at async main (tools/backfill_content_registry.cjs:270:15)
```

Verified afterwards: the live namespace still holds **238 defs / 241 variants**, unchanged —
the failed run wrote nothing.

**This was NOT worked around.** Applying `020`/`021`/`022` is forbidden (other REQs); editing
the live `content/live/*.json` sources, patching the shipped tool to swallow enum errors, or
hand-rolling a duplicate write path into the live registry were all rejected as either
out-of-scope or unsafe against a live DB. The `unit_skin` backfill therefore REMAINS TO BE
RUN, and is blocked on a decision that is above this pass (see §11.6.6).

This is a different symptom from the `core.cjs` `REGISTRY_KINDS` degradation already noted at
the end of §11.5: that one is contained per-kind and degrades to file-served; this one is an
uncaught abort in a one-shot tool.

#### 11.6.4 CI is GREEN

```
HOME=/tmp/h0266 SKIP_E2E=1 tools/ci.sh     (with DATABASE_URL exported from server/.env)
```

Final line, verbatim: `CI GREEN` (exit 0). 63 steps ran.

`[5.455/7] per-profile skin selection store parity (pg backend, REQ-0266)` — the previously
documented red, failing on `relation "skin_prefs" does not exist` — is now **GREEN**, all 12
checks ok, including absence-as-default (D5), merge semantics, slot-mismatch rejection and
per-player isolation. `024` fixed it; nothing was skipped to get there.

Steps not green, in full:

| step | status | diagnosis |
|---|---|---|
| `[6.5/8]` admin e2e harnesses | SKIPPED | `SKIP_E2E=1`, as instructed — concurrent GPU batch |
| `[7/7]` client e2e | SKIPPED | same |
| `[3.8/7]` art-existence check | internal SKIP | no `content/art/unit` in a worktree; adopted art lives in the artwork registry. Documented behaviour, prints its own reason |
| `[4.71/7]` real-model smoke | internal SKIP | model/`onnxruntime` absent on this box. Pre-existing |
| `[4.72/7]` pg moderation tests | internal SKIP | ci.sh runs this step with `DATABASE_URL=` deliberately (DB-free half). The pg half runs at `[5.46/7]`, which passed |

Nothing else was skipped and no step failed. One first attempt aborted at `[5/7]` with
`DATABASE_URL: SKIP_PG=1 or set DATABASE_URL` — `ci.sh` does not source `server/.env`, and the
worktree has none; re-run with the env exported from the main checkout. Not a defect.

Non-fatal noise inside PASSING steps: `[5.1/7]`/`[5.15/7]` log
`[art_jobs] inspection … failed: No module named 'numpy'` for mock renders. Not attributable
to the remap — `numpy 2.4.6` imports fine through the exact remapped interpreter path
(`/tmp/h0266/backpack_ragnarok/.venv/bin/python`, `sys.prefix` resolving into the venv). Those
steps report `16 passed, 0 failed` / `5 passed, 0 failed`. Left alone.

Environment bridges from the verification pass all still existed and were reused unchanged:
`/tmp/h0266/{.local,.nvm,.config,.ssh,.gitconfig}` symlinks, `.cache/ms-playwright`, and the
gitignored `.venv/` symlink farm in the worktree.

#### 11.6.5 The GPU batch was not disturbed

RAM/swap, taken before and throughout the CI run:

| moment | available | swap used |
|---|---|---|
| before CI | 8929 MB | 2442 MB |
| during CI (8 samples) | 19379–20482 MB | 2195–2214 MB |

Never near the abort thresholds. The large mid-run improvement was ComfyUI's ~11 GB RSS being
returned: `comfyui.service` restarted at `20:15:26Z`, fired by the LIVE api's own REQ-0233
generation→matte family barrier (the queue carries `inspectDepth: 14`). **Not caused by CI** —
`server/tests/artfamily_test.cjs:22` sets `ART_FAMILY_BARRIER='0'` precisely so the test counts
barrier fires without ever restarting comfyui.

After CI, `GET /api/art/queue` reports **1 running (`8669`, `bpskin_unit_ancient_grimoire`) and
188 pending**, still draining. `backpack-api`, `backpack-web` and `backpack-tunnel` all still
show their `Sat 2026-07-18 08:44` start times — the in-memory generation queue was never at
risk. e2e was deferred for this reason and MUST be re-run once the batch drains.

#### 11.6.6 What still remains before `done/`

1. **Run the `unit_skin` backfill** into namespace `88d662ca20e5289b`, without the HOME remap.
   Blocked on how to get past `gimic`/`dungeon` — either apply `020`/`021`/`022` (a decision
   for those REQs, not this one) or give the tool a kind/skip filter. 108 defs still missing.
2. **Re-run the e2e fleet** (`[6.5/8]` + `[7/7]`) once the GPU batch drains. Two reds,
   `forecast.spec.ts:206` and `schedule.spec.ts:1451`, are pre-existing and reproduce on
   master; they are out of scope here.
3. **Merge to master** (not done by this pass).
4. **`live_unit_skins.json` must reach the main checkout** — the file exists only in the
   worktree today, and the live api serves from `~/backpack_ragnarok`.
5. **Restart `backpack-api`** — required for the api to pick up the new content, and it MUST
   NOT happen before the batch finishes (~04:30 UTC); a restart destroys the in-memory queue.
