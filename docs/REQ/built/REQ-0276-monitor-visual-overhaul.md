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

## Phase C evidence (VFX/aesthetic pass — commits c0ab7ee, 9bab433, 13eefc5)

### What each effect looks like now (before → after, one line each)
- **Ray** — cyan dot marching cells → elongated luminous head (white-hot tip, additive while budget allows) dragging a ≤6-segment fading trail in the ray's element colour, drawn in the TARGET field's space (enemy-field rays no longer paint over the player pane in column layout); ~240ms afterglow.
- **Bounce** — yellow cell rectangle → brief GOLD 5-sliver spark burst + gold-hi core flash at the bounce cell (structure's voice, fx.js's ring feel).
- **Hit** — nothing but a number → fx.js-timed 0.7s expand+fade burst in the attack's colour with a 1-frame bright additive core at the enemy's centroid.
- **AoE** — single fallback pulse → simultaneous small (0.7×) bursts over each hit cell, each with its own tiered number.
- **ray_hit_all (nova)** — mid-field circle → fast radial wash sweeping from field centre to corner, masked to the field, ≤0.32 alpha ring + ≤0.1 body — deliberately not a flashbang.
- **reflect_damage** — red circle at N9 → blood ring CONVERGING on the player field (harm returning to us).
- **Telegraph** — 8px flat ember slab → 2px gold hairline on the threatened edge that breathes in over ~520ms (smoothstep) and releases in 200ms.
- **Muzzle** — solid ember cell fill → frost rim + soft frost fill on the firing item, 200ms ease-out, continuous with the outgoing frost ray.
- **Damage numbers** — uniform bold text sliding up → tiered 13/17/22px, scale-pop at birth (bigger pops harder: 1.45/1.8/2.2×→1 in 140ms), 20px ease-out rise, late fade, thin void outline for legibility (never glow); blood when we take it, ember-hi when they do; killing blow adds one tiny gold 4-point star.
- **Heals** — same as damage but green → soft green, 12px gentle drift over 800ms, no pop, no spark.
- **Reveal** — instant label swap → bone-white rim swells ~2px and dies in 180ms around the actor box, then settles.
- **Death** — instant alpha 0.28 → short blood flash over the box, then ~400ms fade to the bone-3-tinted corpse ghost (state applies up front; only alpha animates).
- **Art arrival** — hard pop-in → 150ms alpha settle + one bone rim (manifestation moment), only when the actor is currently visible.
- **KO stamp** — plain red "KO" text → blood plate + bone Yuji-Syuku label rotated ~-8°, slammed in with the styleguide stampin overshoot (2.4→0.94→1) on a LIVE ko; silent scrubs place it without theatrics.
- **Charge pips** — appear/disappear → gold when lit (unchanged), spend now drains the previously-lit pips in a 240ms gold-hi sweep.
- **Status chips** — frost-only, never fading → class-tinted (ember burns / frost chills / bone-2 other), fade with remaining ttl to a 0.35 floor (recede, never guess-vanish).
- **Gimic badges** — gold-framed always → state-tinted frame+glyph: armed ember-lo frame with readable ember glyph, disarmed bone-3, opened gold-lo, lost bone-3 + strikethrough bar, fired blood; open/fire burst at the badge cell instead of mid-field.
- **Field dressing** — washed-out grid → void-deep backdrop (0.9), side tints at 5% (≤6% rule), grid at 0.14, formation outlines gold-lo 1px hairlines, enemy nameplates bone on a small panel plate with a 1px border-lo edge. Nothing idle glows or loops.

### Glow-budget audit (styleguide §6.0: ≤3 concurrent, ≤8px, one colour each)
Glow = additive-blend bright core only (no blur filters anywhere). Ledger enforced in `MonitorFx.tryGlow()` with `GLOW_BUDGET = 3`; over-budget effects render normal-blend automatically. Holders:
1. **Ray head** (LIVE beam moment) — held while the head flies, released the frame it lands.
2. **Impact burst core** (instant-of-a-hit moment; link pulses ride the same path) — held only for the first 25% (~175ms) of the 0.7s burst.
3. **(same pool)** any concurrent second/third ray or burst.
Bounce sparks, kill spark, telegraph, muzzle, washes, numbers: normal blend, alpha-only — they spend no glow. `reset()` calls `fx.resetBudget()` because cancelled tickers cannot release holds.

### Colour semantics implemented (fx.js canon)
| colour | voice | used for |
|---|---|---|
| frost / frost-hi | player attack | player-origin rays, muzzle, their hit bursts |
| ember / ember-hi | enemy attack | enemy-origin rays, their bursts; ember-hi = damage numbers we deal |
| gold / gold-hi / gold-lo | structure | pulse-payload rays, bounce sparks, kill flourish, telegraph hairline, pips, formation hairlines, opened chests |
| blood | player harmed | our damage numbers, reflect pulse, death flash, KO plate, fired traps |
| bone / bone-2 / bone-3 | matter | reveal rim, nameplates, corpse tint, lost/disarmed states |
| green 0x76C48A | heal (app convention) | heal numbers only, kept soft |

### Reduced-motion / webdriver / silent (C7)
- `monitorFx.computeFxMode()` at module scope (landing/particles.ts pattern): `navigator.webdriver` → **off** (zero transient VFX in E2E), `prefers-reduced-motion` → **reduced** (damage/heal numbers appear STATIC for 600ms — information, not decoration — everything decorative skipped), else **full**. State changes (KO, corpse, badges, pips, chips) always apply instantly in non-full modes.
- The `silent` apply path never reaches monitorFx at all (callers gate first), and now also suppresses the KO slam, pip drain, reveal rim and death fade via threaded `silent` params.
- Seams untouched: `pulseCounts()`/`attachmentCounts()` increment before/independent of any VFX branch; `squads()`, `enemyBounds()` (x+labelWidth≤468 invariant), `enemyActors()` unchanged. Bonus: numbers now live in rayLayer, so `reset()` purges them (fixes an orphaned-Text leak on backward seek).

### Gates
- `corepack pnpm exec tsc -b --force` (client) → EXITCODE=0.
- `oxlint` on monitorFx/MonitorRenderer/monitorActors/monitorTheme/monitorGlyphs → 0 warnings, 0 errors.

### Deliberately NOT done (taste + scope)
- No telegraph→first-ray-step timing handshake (telegraph and ray are separate wire events; syncing would need a pending-ray queue for one subtle beat — Phase D can judge from screenshots whether it is missed).
- No ambient/idle motion of any kind (shimmer, breathing frames): this is a monitoring panel; the styleguide's ambient loops belong to landing/ritual screens.
- No 5th-bounce nova detection client-side: the wire has no bounce-count on hits; `ray_hit_all` already carries the "everything got struck" semantics and takes the wash.
- HP-bar notches left as-is (B-phase geometry is honest; extra emphasis would add idle noise).
- Player-side status chips still unaddressed (needs a dst→slot map; documented Phase B limitation stands).
- Armed-badge glyph kept ember (not ember-lo) over the ember-lo frame — pure ember-lo at 11px sank into the raised panel; the frame carries the canonical token instead.

## Phase D evidence (gatekeeper: full gates + screenshots + built move)

2026-07-22. Ran on the box under nohup; scoped e2e on the REQ-0276 decade.
DATABASE_URL/SUPABASE_JWT_SECRET sourced from the live server/.env (STORAGE_BACKEND
left UNSET so files-mode stages stay files-mode). pg stages use homedir-remapped
isolated namespaces — the live pg namespace is never touched.

### D1. tools/ci.sh — full gate (clean uncontended run, log /tmp/req0276_ci2.log)
Every stage GREEN through [6.6/8]; labels are ci.sh's own:
- [0/8] e2e harness port rule (REQ-0172) — PASS
- [1/7] sim tests; [2/7] replay goldens; [2.5–2.96] S4 / forecast-parity / dungeon-roll
  (REQ-0276-touched dungeon_roll_test) / grave-legion / wildlands / deepstone /
  unit-charge / balance-sim / candidate-gate — ALL PASS
- [3/7] mock-src engine; [3.5] tsc (server+shared checkJs); [3.6] engine type-drift;
  [3.7–3.99] vocab / units / units003 / corpus / stat-band / enemy-bands — ALL PASS
- [4/7] api tests (files); [4.05] REQ-0240 pacing gates (REQ-0276-touched pacing_test) —
  PASS; [4.5–4.72] pg_sync / backfill / moderation / bpskin / skin-prefs / e2e-redirect —
  ALL PASS; [4.7] inspection golden + moderation (art-kit venv) — PASS
- [5/7] api tests (pg); [5.1–5.46] artwork / artqueue / artfamily / inspection / content /
  contentagg / seed-derive / content-serving / schedule-serving / bio / bpskin /
  skin-prefs / moderation (pg) — ALL PASS
- [5.6–5.9f] client node gates: unit-icon+G7 ring / link-trace / pack-board (x4) /
  chime / supabase-auth / bpskin (x3) / overlay-a11y / claim-placement / po-outline — ALL PASS
- [6/7] client typecheck + build — PASS
- [6.5/8] admin e2e harnesses — artadmin 8 / artinspect 1 / contentadmin 28 PASS
- [6.6/8] registry-first serving e2e (pg, seeded adopted def) — 4 PASS
- [7/7] client e2e (SCOPED hermetic, REQ-0276 decade): **192 passed / 1 skipped / 4 failed**.

### D2. [7/7] e2e reds — signature-verified against master's accepted ledger
The e2e stage IS the scoped client suite (D2 is covered by [7/7]). Every failure was
diagnosed by isolation re-runs and cross-checked against master
(docs/REQ/done/REQ-0273-*.md's documented-reds record). **NONE is a REQ-0276 regression** —
every monitor spec passes on every run (REQ-0045 d/f/g, REQ-0048 pulses, REQ-0049
attachment badges, REQ-0099 replay transport, REQ-0041 freeze-guard, monitor events;
schedule.spec.ts:1451's own monitor/roster assertions pass when the test is reached):
- **forecast.spec.ts:206** (slot-pressure toBeVisible timeout) — PRE-EXISTING documented red.
  `master:client/e2e/forecast.spec.ts:206` is byte-identical (still navigates to
  `#/schedule`); `SlotPressureSummary` now mounts only in `src/sortie/DungeonDossier.tsx`
  (#/sortie). Stale test from the REQ-0239 page split. REQ-0276 touches none of
  forecast.spec.ts / SchedulePage / DungeonDossier / SlotPressureSummary.
- **schedule.spec.ts:1451** (apiAssignSlot 409-vs-200) — PRE-EXISTING documented flake.
  PASSES in isolation; full-file 409 is the REQ-0239 sortie test (1378) leaving squads 0-3
  deployed under a deferred-cancel room. REQ-0276's pacing/runs changes are additive
  serve-time enrichment only (no durationSecs / occupancy / settle / deploy-gate change;
  archived fleet api logs show no startRun/buildRoster exception).
- **workshop.spec.ts:361** (LRDST reward undefined) — PRE-EXISTING documented red owned by
  REQ-0256's combat rebaseline (run.result=wipe → rewards-zero-by-design; user ruled
  balance out of scope 2026-07-22, fixture re-tune REQ filed). Fails in isolation too.
- **grid-8x8.spec.ts:28** (canvas 8x8 dims, this run only) — transient load flake; PASSES on
  low-parallel re-run. (Earlier contended run flaked tab-reorder-trash:169 / workshop:361
  instead — both recovered on re-run; different set each run == load margins, retries=0.)
Verdict: my branch's e2e reds ⊆ {master's 3 documented user-accepted reds} + transient
load flakes. Same posture under which REQ-0273/0277 merged: "green modulo documented reds".

### D5. Production build (standalone, log /tmp/req0276_build.log)
`corepack pnpm run build` (client) — **EXITCODE=0**, "built in 438ms". One benign warning:
main chunk `index-*.js` 1,548 kB (gzip 434 kB) > 500 kB — the pre-existing single-chunk
size warning (build succeeds; not REQ-0276-specific). Worktree web/ NOT committed (repo
convention: worktree builds lack client/.env.local supabase env; deploy rebuilds on main).

### D3. Verification screenshots (scoped harness, REQ-0276 ports 7762 proxy / 7764 fleet)
Seeded a niflheim_depths L1 run exactly as the schedule e2e specs do (guest via
server/cli_invite.cjs, PUT canvas fixture, create room, assign squads 0-3 -> active,
expand monitor canvas), then drove __monitorDebug.applyTestEvents to reveal/wound the
5-actor roster + status chips + charge pips. Both capture tests passed. PNGs in the
gatekeeper sandbox at /tmp/req0276_shots/:
- 01_structure_panel.png — monitor expanded (VFX off under webdriver): 4 player squad
  plates (BP colour fills + unit icons + dagger PO icons + gold formation frames) | enemy
  field with Frost Gnoll / Ice Archer nameplates + HP bars | humanized feed (All/Damage/
  Spoils/Devices) | per-slot HP dock | LIVE transport.
- 02_structure_canvas.png — the Pixi field alone (same, VFX off).
- 03_vfx_full_frame00–17.png + 03_vfx_full_panel.png — navigator.webdriver MASKED via
  addInitScript (verified wd-false) so monitorFx runs FULL: golden impact bursts + tiered
  "40" damage numbers on the enemy actors (numbers/bursts are suppressed in webdriver/off
  mode — proof FULL fired), masked boss "Hrímgrímnir, the Frost-Masked" revealed.
- 04_player_field_closeup.png — player-field crop: BP fills + PO item icons + squad plates.
Note: the hermetic fleet ships no monster-art rasters, so enemies render as structural
markers (nameplate + HP bar + rune silhouette); the art hook (loadMonsterTexture via
art_urls) is wired and fills once art_urls are populated (production / adopted art).

### Gates summary
sim/mock/typecheck/type-drift/vocab/units/corpus/pacing/dungeon-roll: GREEN.
api (files + pg, isolated ns): GREEN. client node gates + tsc + vite build: GREEN.
admin + registry-first e2e: GREEN. Scoped client e2e [7/7]: GREEN modulo the 3
pre-existing user-accepted documented reds (forecast:206, schedule:1451, workshop:361) —
ZERO REQ-0276 regressions. Production build: GREEN.

### Commit list (branch req-0276-monitor-visual-overhaul, 14 pre-D commits)
0b2c17c reserve · d426d7f spec · 6b3ea1e reserved->todo ·
138b062 A1 · 09e1f62 A2 · f8b9b21 A3 · 1988435 A4 ·
fb39aae B1 · 06400f6 B2/B3 · 8f7c2f1 B5 ·
c0ab7ee C1 · 9bab433 C2 · 13eefc5 C3 · d3905ca C4 ·
(+ this Phase-D evidence commit, + the todo->built move commit).

### Worktree state
git status CLEAN (throwaway screenshot spec removed; worktree web/ build reverted to the
committed REQ-0273 artifacts per convention). No merge, no deploy — user coordinates those.

## Deploy log
- 2026-07-22 built -> MERGED to master + DEPLOYED (deploy agent, owner-authorized 2026-07-22).
  Merge `3852fa4` (--no-ff, base master@a5f83bd, 16 commits, ZERO conflicts). web/app rebuilt in
  the main checkout (env-carrying bundle) `5160a91` -> live bundle `index-D0--QoC6.js` (old
  `index-Bk5vjz_m.js` gone). backpack-api restarted 06:19Z (active, NRestarts=0, ExecMainStatus=0,
  clean journal). Master gate (ci.sh, DATABASE_URL from server/.env, ART_FAMILY_BARRIER=0): all
  deterministic + pg gates GREEN (sim, tsc, client build, [5.x] pg incl. content_serving 9/0,
  schedule_serving 13/0), [6.6] registry-first 4/4; [6.5] aborted ci.sh under `set -e` on ONLY the
  documented artadmin goto-under-load family (artadmin.spec :124/:273, REQ-0222 lineage, tolerated
  per REQ-0266/0273/0278/0279) -- no NEW reds. The 3 documented client reds
  (forecast:206/workshop:361/schedule:1451) are pre-existing/unchanged. Live verify: /app/ serves
  the new bundle, /api/health ok, /api/schedule/dungeons formations carry unit1..unit4 (A1 join fix).
