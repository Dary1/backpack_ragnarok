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
