# REQ-0180 — unit-skin-set-wiring

**Status:** todo — cleared to implement (user directive 2026-07-15: "one REQ,
implement everything").
**Reserved:** 2026-07-14 · specced 2026-07-15
**Slug:** unit-skin-set-wiring
**Related:** REQ-0126 (backpack-skin-system, done — compositor + resolveBpSkin),
REQ-0125a (unit-icon-render-base, built — resolveUnitIcon seam + unitIconKey),
REQ-0125b (unit-skin-resolution, draft — the icon half; this REQ supersedes its
render-wiring intent for the SET model), REQ-0170 (unit identity + icon as data).

## Goal

Wire a Unit to a **Unit Skin SET** so that, on both the inventory board and the
squad canvas, a Backpack renders its cell-shape silhouette with the SET`s
backpack skin (edge design + interior fill) and its Unit core with the SET`s
unit art. Skins are swappable per canvas placement; a Unit`s def names its
DEFAULT set.

## Model (ratified by user, 2026-07-15)

- **art kind `unit`** = an artwork (system_name) of kind `unit` (registry ENUM
  `artwork_kind`, migration 007). Same free reference `UnitDef.icon` already is.
- **art kind `bpskin`** = the backpack skin. In the shipped system this is a
  `bpskin/1` DEF id (content/live/live_bpskins.json): palette + geometry the
  REQ-0126 compositor renders from, optionally carrying kind=`bpskin` art
  rasters (none today — dev skins are palette-only, and the AI route is blocked
  behind the FLUX seamless spike, so procedural palette is the ONLY visible
  path and is exactly what makes this REQ shippable with no new art).
- **unit_skin** = a NEW content ledger kind `unit_skin/1`
  (content/live/live_unit_skins.json). Each entry has an EXPLICIT authored key
  (`id`) — the key is authored, never auto-derived — and pairs one
  `art_unit` (a `unit` artwork system_name) with one `bpskin` (a `bpskin/1`
  def id). Multiple sets are definable; two sets may reuse one artwork or one
  bpskin. A `unit_skin/1` entry is the "set" the design canon
  (`backpack_skin_pipeline.md` §0/§6) calls a paired Unit-Skin + Backpack-Skin.

### Wiring (the "配線")

1. **unit_def → default set.** `UnitDef` gains `unit_skin?: string` — the key of
   its DEFAULT `unit_skin/1` set. Absent = no set (falls back to legacy icon +
   plain silhouette, unchanged from today).
2. **placement → chosen set.** `BPUnit` gains `skin?: string` — the unit_skin
   key chosen for THIS placement. Overrides the def default. Cosmetic-only:
   the engine/sim never read it (verified: sim/lib/compile.cjs + mock-src/
   engine.js only read `bp.unit.id`), and it round-trips through the canvas
   document automatically (storage persists the whole BP).
3. **profile → availability.** The set of unit_skins a player may choose from is
   a profile-scoped read (`/api/me`), defaulting to ALL defined keys. No
   acquisition flow and no UI (user: "導線無しで、どれでも利用できるでOK"); the
   profile carries an optional allowlist slot for a future grant flow, absent =
   all.
4. **resolution (render time, client).** active key =
   `bp.unit.skin ?? UnitDef[bp.unit.id].unit_skin ?? null`. From the resolved
   `unit_skin/1`: `art_unit` feeds resolveUnitIcon`s `skinKey` rung (the Unit
   core art); `bpskin` feeds resolveBpSkin`s set rung (the silhouette skin).
   Missing/unresolvable at any rung falls through silently (never blocks the
   board) — the REQ-0125a/REQ-0126 discipline, unchanged.

## Scope

IN:
- `unit_skin/1` kind: `live_unit_skins.json`, schema + validator, served on
  `/api/content` (server already serves `bpskins`; add `unit_skins`).
- `UnitDef.unit_skin` + `BPUnit.skin` (types in shared/engine.d.ts + DTO).
- One `unit_skin/1` set per roster unit, pairing its existing `unit` art with
  the existing `devornate` dev bpskin (user pick), and `live_units.json` defs
  pointed at them. (Result: every roster BP visibly wears devornate on both
  boards.)
- Client: load bpskin defs + unit_skin defs at boot; resolve the set; composite
  the silhouette (RGBA→Pixi texture) and draw it on inventory + canvas; feed the
  Unit-core art through the existing resolveUnitIcon skin rung.
- Profile availability read surface (`/api/me`, default-all).
- Machine gates + unit tests + manual UI verification.

OUT (explicit, deferred to later REQs):
- Any UI to PICK a skin per placement (the per-placement `skin` field is wired
  and honored by the renderer; setting it is a later REQ).
- Any grant/acquisition flow or persistence WRITE of the profile allowlist
  (read surface + schema slot only).
- Real AI/UGC bpskin raster art (blocked behind the FLUX seamless spike;
  palette-only dev skins are the visible path here).
- Neutral-skin-on-every-BP: un-set BPs stay plain (no regression). Rendering a
  neutral procedural silhouette on every BP is a follow-up.

## Rendering notes

- Composition follows `backpack_skin_pipeline.md` §2: silhouette skin sits above
  the base grid, BELOW items/POs; renderer overlays (bp.color outline + label,
  usage tint, links, charge ring, direction dots, grab handles) stay on top and
  identical across skins (BS-G1). No gameplay signal moves into the skin.
- The composite is shape-dependent, so it is built per-BP at render time
  (compositeSkin is pure/deterministic; board-scale shapes are small) and turned
  into a texture via an offscreen canvas + putImageData, mirroring sprites.ts`s
  existing canvas→Texture path. Cached by (skin id × shape signature × cellPx).
- Aspect/scale rules and the "missing art never blocks" fall-through are
  inherited unchanged.

## Gates

- `tools/ci.sh` green; e2e ONLY via `tools/e2e_run.sh`; pnpm only.
- New/extended machine gates: validate `live_unit_skins.json`
  (kind/id/art_unit/bpskin, bpskin must name an existing bpskin/1 def);
  validate every `UnitDef.unit_skin` names an existing set; extend the bpskin
  resolution unit test with the set-key resolution.
- Fallback proof: a Unit with no set renders plain (legacy icon, no skin);
  a Unit with a set renders the set`s bpskin silhouette + art_unit core; an
  unresolvable art_unit falls through to the legacy glyph; an unresolvable
  bpskin falls through to plain — none throw, none blank the board.
- Manual UI pass on backpack-dev: canvas + inventory show the devornate
  silhouette on roster BPs; screenshots recorded.

## Risks

- Render-path change to BoardRenderer (the highest-churn client file). Mitigate:
  additive draw layer, gated on an EXPLICIT resolved set so un-set BPs are
  byte-identical; visual verification on backpack-dev before `built`.
- Per-BP composite cost: bounded by board-scale shape sizes and a texture cache.

---

## Implementation log (2026-07-15)

Built end-to-end; `tools/ci.sh` (SKIP_PG=1) GREEN incl. **178 e2e passed**.

**Data / server**
- `content/live/live_unit_skins.json` — new `unit_skin/1` SET ledger, 12 sets
  (`<unit>_default`), each pairing the unit's existing kind=`unit` artwork
  (`art_unit`) with the `devornate` bpskin/1 def (user pick).
- `content/live/live_units.json` — every roster def now carries
  `unit_skin: "<unit>_default"`.
- `server/lib/content.cjs` — loads `live_unit_skins.json` and serves it as the
  additive `unit_skins` payload field (mtime-tracked), beside the pre-existing
  `bpskins`.
- `server/routes/me.cjs` — `/api/me` now returns `unitSkins`: the profile-scoped
  availability list, defaulting to ALL defined sets (no acquisition flow;
  profile may carry an optional allowlist).

**Types**
- `shared/engine.d.ts` — `UnitDef.unit_skin?`, `BPUnit.skin?` (per-placement
  override; cosmetic — sim/engine never read it, verified), `UnitSkinDef` +
  `UnitSkinMap`.
- `shared/dto.ts` — `ApiUnitEntry.unit_skin?`, `ApiUnitSkinEntry`,
  `ApiContentPayload.{unit_skins,bpskins}`, `ApiMe.unitSkins?`.

**Client**
- `board/skin/unitSkinRegistry.ts` (new) — validator, loader, module registry,
  `resolveUnitSkinKey` (placement -> def default -> null), `unitSkinIconRasters`.
- `board/skin/skinTexture.ts` (new) — `skinTextureFor`: compositeSkin RGBA ->
  silhouette-alpha Pixi Texture, cached by (skin id x local shape sig x cellPx).
- `board/skin/skinRegistry.ts` — `setBpSkinDefs/getBpSkinDef/hasBpSkinDef`.
- `board/unitIcon.ts` — `unitSkinIconKey`, `getUnitDef`.
- `api/content.ts` — GameData `SKINS` + `UNIT_SKINS` (loadSkinDefs /
  loadUnitSkinDefs).
- `store/boot.ts` — `setBpSkinDefs` + `setUnitSkinDefs` before boards mount.
- `board/sprites.ts` — merges `unitSkinIconRasters()` into the board texture map.
- `board/BoardRenderer.ts` — resolves the active SET per BP and (a) composites
  the silhouette skin into gBase UNDER the outline/label/tint/items on BOTH
  boards, gated on an EXPLICIT set (un-set BPs unchanged; no regression),
  (b) feeds the SET's art_unit into the resolveUnitIcon skinKey rung.

**Gates**
- `shared/content_validate.cjs` — `unit_skin` added to UNIT_ALLOWED_KEYS + shape
  check. `tools/check_units.cjs` — cross-refs: every set.bpskin is a live
  bpskin/1 def; every unit.unit_skin is a live set. `client/scripts/
  check_unit_skin.mjs` (new, wired into ci.sh [5.9b2]) — resolver + live
  cross-refs, ALL GREEN. Existing check_bpskin / check_unit_icon / bpskin_harness
  still GREEN.
- NOT run: pg-backend suite (no DATABASE_URL in worktree). Low risk — no pg
  migration/storage-schema change; the same /api/me + content tests pass on the
  files backend.

**Visual verification**
- `client/scripts/preview_unit_skin.mjs` renders a BEFORE/AFTER board mock via
  the REAL compositeSkin + resolve chain + BoardRenderer placement formula:
  `web/preview/bpskins-req0180/board_before_after.png`. AFTER shows devornate
  (brown fill + fill2 checker + gold hatched welt + rounded corners) on all
  three roster BPs; BEFORE shows the flat tint. In-app render path exercised
  non-throwing across all 178 e2e specs (incl. workshop roster rolls).

**Deploy note (HANDS-OFF):** the `web/app` dist rebuild + backpack-dev deploy is
the usual separate, user-coordinated step and is NOT part of this REQ; lands here
at `built`.
