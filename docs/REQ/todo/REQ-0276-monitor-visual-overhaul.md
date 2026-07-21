# REQ-0276 — /schedule monitor battle-visualization overhaul (in-place)

## Origin & binding decision (user directive, 2026-07-22)
The user, pointing at a live screenshot of `/app/#/schedule`, directed: fix the
"shabby battle screen" — monster art unused, player squads show neither items
nor use-effects — and fix EVERYTHING enumerated in the visualization audit.
Explicitly delegated: internal-spec decisions are the implementer's, no user
consultation.

**Placement decision.** The `req-expedition-spec` program (REQ-0255..0265)
already specs this scope, but REQ-0260 targets a NEW `#/expedition` route and
leaves the small monitor untouched (per the older 「今ある画面は放置して」
directive). Today's directive points at the existing screen and is newer and
specific: **this REQ retargets the program's rendering/VFX/data content
IN-PLACE onto the `/schedule` Monitor** (`client/src/schedule/Monitor.tsx`,
`MonitorRenderer.ts`, `monitor/*`). REQ-0257..0265 drafts remain authoritative
for CONTENT and are absorbed by reference; REQ-0260's route split is
superseded for now and those drafts will need a revision pass afterwards.

## Spec sources (authoritative content, read them before implementing)
- `~/backpack_ragnarok_worktrees/req-expedition-spec/docs/REQ/draft/REQ-0257-ray-flight-entity.md` (ray as entity, hit attribution)
- `.../todo/REQ-0258-formation-map-padding.md` (field geometry, ready)
- `.../draft/REQ-0259-battle-mode-verb-gating.md` (gimic ids in monster_pack.members)
- `.../draft/REQ-0261-expedition-formation-render.md` (formation/enemy plane render; §3 = the squad-box JOIN root cause; §8 = server fields instanceId/at/fieldCells/masked)
- `.../draft/REQ-0262-expedition-ray-vfx.md` (ray VFX; styleguide §6 reconciliation)
- `.../draft/REQ-0263-expedition-instance-hud.md` (HP bars, cooldown, charge, badges; §6-7 server fields)
- MJÖLNIR styleguide: `web/redesign/styleguide.html` + `web/redesign/assets/fx.js` (RayMonitor reference impl). Discipline: night-iron bg, bone text, gold = structure only, ember×frost = world voice, glow only at 4 sanctioned moments, blur<=8px, <=3 concurrent glow sources, reduced-motion honored.
- Visualization audit (chat, 2026-07-22) — the (a)-(e) checklist mirrored below.

## Scope — phases (each lands as its own commit series on this branch)
A. **Data & joins.**
   A1. Fix the formation-box JOIN: `Monitor.tsx` builds `canvases["squad"+n]`
       but formations carry `unit1..unit4` keys (REQ-0261 §3, REQ-0169 M3
       fallback masks it). Verify against live formations payload.
   A2. Server/sim data gaps (REQ-0240 §Data-gap follow-ups), minimal honest
       versions, determinism gate + goldens stay green (rebaseline via the
       documented process only if the sim log must change; PREFER serve-time
       enrichment merged onto event copies, the REQ-0240 pacing pattern):
       roster static enemy positions (per 0261 §8), ray_hit -> roster enemy
       attribution (per 0257), gimicId on att_* (per 0259), slot-attributable
       unit_charge_* (per 0263 §6-7). Wire shapes documented in shared/dto.ts.
B. **Client structural rendering** (MonitorRenderer/Monitor + monitor/*):
   enemy plane with adopted monster art (art_urls/getItemArtUrl chain,
   lazy-loaded Pixi textures; rune-placeholder fallback, never broken-image),
   footprint-sized placement from roster positions, nameJa labels, per-enemy
   HP bars, masked "?" -> reveal, defeat/removal, pack grouping; player plane
   with unit art, PO icons (works post-A1), status icons (apply_status/
   status_tick), charge pips (unit_charge_*), KO stamps; heal_ally/
   lifesteal_heal handled (green numbers); damage numbers at the actual hit
   cell; encounter_start roster spawn-in; run_end settle; feed/dock stay
   consistent.
C. **VFX/aesthetic pass** per MJÖLNIR (fx.js RayMonitor as reference): ray
   projectile + trail, bounce sparks (gold), impact flash, AoE, nova,
   telegraph, fizzle/abort, link_pulse chain at real cells, reveal/KO
   stamps, palette + glow-budget discipline, prefers-reduced-motion.
D. **Gates & verification**: `./ci.sh` green in this worktree; e2e via
   derived ports (REQ-0276 -> 7760..7769); update/extend e2e specs touched by
   renderer seams (getLastMountedSquads etc. stay); before/after screenshots.

## Non-goals
- `#/expedition` full-screen route (REQ-0260) — deferred, drafts to be revised.
- REQ-0264 (VFX art-kind registry seam) and REQ-0265 (monster skill icons) —
  only if trivially available; class-glyph fallbacks otherwise.
- Dex/balance surfaces (REQ-0227/0228/0275). Live deploy (user coordinates).

## Dependencies / conflict surfaces
- REQ-0256 battle-tick-core: merged to master = our baseline.
- req-expedition-spec branch: spec-only, no code conflicts today; content
  absorbed here, placement decision superseded (documented above).
- REQ-0273 merged (board primitives baseline).

## Status log
- 2026-07-22 reserved -> todo: scope ratified by user directive (fix all,
  no consultation); implementation starting on this branch.

## Phase A evidence (2026-07-22)

**Commits (branch `req-0276-monitor-visual-overhaul`):**
- `138b062` A1: formation-box JOIN fix + `parseBoxToPixelRect` hardening.
- `09e1f62` A2: serve-time data enrichment (roster positions/instanceId/masked; ray_hit→enemyIdx; att_*→gimicId; unit_charge_*→slot).
- `f8b9b21` A3: focused tests for all four gaps.
- (this) A4: evidence.

**A1 root cause (verified empirically).** Formation `canvases` keys are `unit1..unit4`
(`content/live/dungeon/formations.json` + `server/services/core.cjs` pass-through);
`Monitor.tsx` looked up `canvases['squad'+n]` → always `undefined`, so every squad fell to
the placeholder `` `squad${idx+1}` ``, parsed to a negative-width rect, and hit the REQ-0169 M3
degenerate-box fallback (no BP fills, no PO icons). Fix: both sites now use `` `unit${n}` ``
(`Monitor.tsx:174` placeholder + `:180` lookup). `parseBoxToPixelRect` now returns an explicit
`{w:0,h:0}` for any non-`"TL:BR"` string (renderer still takes its fallback for genuinely
missing data).

**A2 — new wire fields (all ADDITIVE + OPTIONAL in `shared/dto.ts`).**

*Roster (`ApiRunRoster.enemies[]`, built in `server/services/pacing.cjs buildRoster`):*
- `instanceId: string` — the SIM entity id, `` `${enemyId}#${index-in-pack-members}` `` (e.g. `glacier_wisp#2`); mirrors `sim/lib/packs.cjs compileEnemyPack`.
- `at: string | null` — the A1 top-left anchor verbatim from the pack member (e.g. `"B2"`).
- `fieldCells: [number,number][]` — absolute `[row,col]` cells, DERIVED via `shared/content_validate.cjs cellsFor` (same authority the sim placer uses → transpose-safe, `[fh,fw]`).
- `masked: boolean` — `false` for monsters (future-proof for masked instances).

*Events (`ApiRunEvent`, merged onto event COPIES at SERVE time in `pacing.cjs decorateVisible`; the stored `run.events` is byte-identical):*
- `ray_hit`: `+ enemyIdx?: number` — index into `roster.enemies`, resolved from the UNMASKED `dst`. A masked strike (`dst:'?'`) matches nothing → stays anonymous (reveal semantics preserved).
- `ray_aoe` / `ray_hit_all`: each `hits[]` member gains `+ enemyIdx?: number` (nested array rebuilt as copies; stored event untouched).
- `att_fire` / `att_reveal` / `att_disarm` / `att_open` / `att_lost`: `+ gimicId?: string` — source gimic content id (e.g. `trap_frost_deadfall`); glyph fallback by `kind` otherwise.
- `unit_charge_*` (`spend/stack/transform/strike/onhit/lifesteal/reflect/transfer/shieldbreak`): `+ slot?: number` — squad slot 0..3 of the charging BP (bpId rides `id` on spend/stack/transform, `src` on the rest — REQ-0263 §5.3).

*Supporting plumbing:*
- `sim/dungeon_roll.cjs buildAttachment` now keeps the source `gimicId` on each rolled attachment DEF (trap/chest/door). The sim IGNORES this field (no event change); two same-seed rolls stay byte-identical (`dungeon_roll_test`).
- `server/services/runs.cjs startRun` builds a `gimics` map `{ attInstanceId → gimicId }` from the rolled def and stores it on the run doc; `decorateVisible` reads `run.gimics`.

**Sim log changed? NO. Goldens NOT rebaselined.** All enrichment is serve-time onto COPIES, plus a
rolled-DEF-only additive field the sim never reads. `run.events` stays byte-for-byte the sim output.

**Gates run (worktree, node v24.18.0):**
- `sim/tests/goldens.cjs` → **goldens OK (12 cases) — UNMOVED** (proves `run.events` byte-identical).
- `sim/tests/forecast_parity.cjs` → **18 passed, 0 failed.**
- `sim/tests/dungeon_roll_test.cjs` → **6 passed** (incl. new gimicId-resolves test; determinism byte-identical).
- `sim/tests/unit_charge_test.cjs` → **13 passed**; `unit_charge_encounter_test.cjs` → **24 passed.**
- `server/tests/pacing_test.cjs` → **15 passed** (incl. 3 new: buildRoster placement/instanceId/transpose, decorateVisible attribution-on-copies, no-roster legacy-safe).
- `server/tests/api_test.cjs` (files backend) → **194 passed, 0 failed** — includes the determinism gate (`deepStrictEqual(replay.events, runRaw.events)`) and the REQ-0240 roster/pacing test, both green.
- `schedule_serving_test.cjs` → SKIP (pg-only, no `DATABASE_URL`).
- Did NOT run full `ci.sh` (Phase D owns it).

**Notes for Phase B (client rendering):**
- `ray_hit.enemyIdx` / `hits[].enemyIdx` index `roster.enemies` — use for per-enemy HP depletion + defeat greying. Absent ⇒ masked or a non-enemy (gimic) target.
- Draw the WHOLE enemy formation at `encounter_start` from `roster.enemies[].fieldCells`; masked ones (none today) as footprint silhouette until discovery. `footprint` stays DISPLAY-only — never derive geometry from it (use `fieldCells`).
- `att_*.gimicId` is present for art binding, BUT gimic ids do NOT yet join `art_urls` (REQ-0259/0211's job) — use the ratified class-glyph fallback (ᚦ trap / ᚷ chest / ᛞ door) until then.
- `unit_charge_*.slot` (0..3) lights dock/stage charge pips.
- Only `rollDungeon` (live procedural) content emits `att_*`. The pre-generated `dungeon.json` `entityDef` path emits NO `att_*`; there the gimic identity flows via `ray_hit.dst` (= entity id once unmasked).
- `frost_gnoll` footprint drift ([1,1] def vs 3×4 art) is still open (REQ-0188 unrun `derive --write`): contain-fit art into the DEF footprint box; do not prefer the art's shape.

## Phase B evidence (2026-07-22)

**Commits (branch `req-0276-monitor-visual-overhaul`):**
- `fb39aae` B1: new client modules — `monitorTheme.ts` (MJÖLNIR palette numbers +
  `hpColor`/`packTint`), `monitorArt.ts` (async Pixi monster-texture cache),
  `monitorGlyphs.ts` (gimic/status glyphs), `monitorActors.ts` (`EnemyPlane`).
- `06400f6` B2/B3: wire `EnemyPlane` + player-plane overlays + all new event
  handling into `MonitorRenderer.ts` + `Monitor.tsx`.

### What renders now vs before

**Enemy plane (was: one lazy red blob at the first-seen ray cell, id/`?` label).**
Now: at `setRoster`, one ACTOR per roster enemy placed at its absolute
`fieldCells` (bounding-box footprint; geometry never derived from the DISPLAY
`footprint`, per REQ-0261 §8). Monster art resolves through the SAME chain the
Dex uses — `board/itemArt.getItemArtUrl(id)` (the payload `art_urls` map) — loaded
as a Pixi texture (`Assets.load({loadParser:'loadTextures'})`) with an in-module
id→Texture|null cache; contain-fit into the footprint box (uniform scale, never
stretched; REQ-0188). While loading / when absent: a bone rune (`ᛦ`) on a
panel-dark rounded cell block — never a broken image, never a bare red blob when
roster data exists. Masked instances render as a dark silhouette + `?` and flip to
art+name on first `ray_hit.enemyIdx` (monsters are `masked:false`, visible from
spawn). Per-enemy thin HP bar under each actor (fraction fill + frost→ember→blood
state colour + 25% notches), depleting on `ray_hit`/`ray_aoe`/`ray_hit_all`
`enemyIdx` (`hp_after` when present, else `amount`), clamped ≥0. Defeat (`hp≤0`):
actor dims to a low-alpha corpse ghost, art desaturates (bone-3 tint), HP bar
drops. Subtle pack-grouping edge (thin left border tinted by `packId`). Nameplates
(locale `nameJa` under `ja`) reuse the de-overlap lane + truncation machinery.
Wave grouping by `packId` (roster order == pack/boss encounter order): only the
active wave is visible; `encounter_start(pack|boss)` advances it so later packs
never overlap the current fight.

**Player plane (was: BP colour fills + PO icons only; no unit art, no
use-effects, no charge/KO).** Now: PO icons still render (post-A1 JOIN), each now
carrying its `itemId`; unit-art hook draws `unit:<id>` raster contain-fit over the
BP colour fill at reduced alpha (no-op today — `unitIconRasters()` is still `[]` —
renders with no renderer change once art lands). `ray_fire` (player-origin;
`src`=item def id) flashes the SOURCE item's cell(s) in every squad box that
placed it. `unit_charge_*` `slot` lights 4 charge pips on the squad plate.
`encounter_end`/`run_end` `troop_bp_hp` stamp per-slot KO (dim + label, same
per-slot reduction the DOM dock uses). Damage numbers moved from a field-centre
spread to the ACTUAL hit location (enemyIdx footprint centroid; entry/field-centre
fallback). Formation frame + labels moved onto the MJÖLNIR palette (gold frame,
bone text) and the player grid is now preserved (was cleared by `mountSquads`).

### Events now handled that were previously IGNORED
`heal_ally`, `lifesteal_heal` → green `(+n)` at the healed target (enemy-actor
centroid when `dst` resolves to an instanceId, else field centre). `apply_status`
/ `status_tick` → status-glyph chips on the resolved enemy actor (`status_tick`
`hp_after` also keeps the actor HP honest). `encounter_start` / `encounter_end`
→ wave advance + KO settle. `run_end` → KO settle.

### Texture-resolution chains used (exact functions)
- Monster art: `board/itemArt.getItemArtUrl(enemyId)` → URL, then
  `monitorArt.loadMonsterTexture(id)` (`pixi Assets.load`, cache) — same
  `art_urls` source as `dex/MonsterCatalog.MonsterPortrait`.
- Unit art (hook): `this.textures.get('unit:'+bp.unitId)` from the shared
  `board/sprites.loadBoardTextures()` map (`board/unitIcon.unitIconKey`).
- PO icons: `this.textures.get(def.icon)` via `render/itemCard.computeFootprintCells`.

### Seams added / changed (exact names)
- ADDED `MonitorRenderer.getEnemyActors()` → `EnemyPlane.getActors()`
  (`{id,instanceId,hp,hpMax,revealed,dead,artLoaded,wave,cells}[]`); exposed on
  `window.__monitorDebug[roomId].enemyActors()`.
- ADDED `MonitorRenderer.setLocale(locale)` (nameJa + KO copy); called from a new
  `Monitor.tsx` locale-sync effect.
- CHANGED `MonitorRenderer.getEnemyMarkerBounds()` — delegates to
  `EnemyPlane.getMarkerBounds()` (actor nameplates, honest `x+width≤FIELD_W`) when
  a roster is present; legacy `enemyMarkers` path otherwise. Return shape
  unchanged (`{x,labelWidth,labelText,hidden,lane}`).
- UNCHANGED (verified): `getLastMountedSquads()` shape; `getPulseVisualCounts()` /
  `getAttachmentVisualCounts()` counters (all `link_pulse`/`pulse_*`/`att_*`
  increments preserved); `applyTestEvents` seam.
- `MonitorSquadBP` gained optional `unitId`; `MonitorSquadIcon` gained optional
  `itemId` (both populated in `Monitor.tsx` from `bp.unit.id` / `po.id`).

### Gates
- `corepack pnpm exec tsc -b --force` (client) → **EXITCODE=0** (clean).
- `corepack pnpm exec oxlint` on all six touched files → **0 warnings, 0 errors**.
- e2e: NOT run here (Phase D owns the fleet gate). No e2e spec required editing —
  the three renderer seams the specs read (`squads()`, `enemyBounds()`,
  `pulseCounts()`/`attachmentCounts()`) keep their contracts; `enemyBounds()` still
  yields `x+labelWidth≤468` for the actor nameplates.

### PHASE-C restyle hooks (function names + file areas — structural-ugly ON PURPOSE)
- `client/src/schedule/monitorTheme.ts` — `hpColor()` stops, `packTint()` cycle:
  the ONE place to re-tune palette state colours.
- `monitorActors.ts` `EnemyPlane`: `resolveArt`/`placeArt` (art intro/fade),
  `applyDeathVisual` (desaturate/corpse-ghost styling), `redrawHp` (HP-bar notch
  emphasis / segmentation), `applyStatusByInstance` (chip styling + real duration
  fade — currently a fixed `ttl` placeholder), `paintBg` (cell-block frame),
  `relayoutLabels` (nameplate treatment).
- `MonitorRenderer.ts`: `floatNumberAt` (damage/heal number styling),
  `flashSourceItem` (muzzle flash), `refreshChargePips` (pip light/spend anim),
  `refreshKoStamp` (Yuji-Shūku KO stamp), `updateGimicBadge` (badge art + state
  transitions), plus the still-placeholder ray VFX `flashCell`/`pulseCell`/
  `animateStep`/`telegraphGlow` (already on MJÖLNIR tokens, ready to restyle).

### Honest limitations left for Phase C / later
- Player-side status chips: `apply_status` `dst` that does NOT resolve to an enemy
  instanceId (player targets) draws no chip yet — needs a `dst`→slot map (Phase C
  squad-box chips).
- Gimic badges: only `att_reveal` carries a cell, so a badge whose first event is
  `att_fire/open/lost/disarm` tracks state without drawing (no position). Class
  glyph derives from `gimicId` prefix → event kind (art_urls does not yet cover
  gimic ids).
- Multi-encounter waves are joined by `packId` order (roster order == pack/boss
  encounter order); there is no per-enemy `enc` field on the wire, so a dungeon
  that reuses one `packId` across two encounters would share a wave.
