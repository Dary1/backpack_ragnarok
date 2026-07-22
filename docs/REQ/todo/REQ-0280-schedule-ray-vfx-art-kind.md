# REQ-0280 — per-skill ray/hit VFX art kind for the /schedule monitor

## Origin & ratification (user directive, 2026-07-22)
User: the ray must not be a generic projectile — each SKILL should fly its own
trajectory art, designed through artadmin/contentadmin. Proposal (chat,
2026-07-22) approved with "prioritize your judgment, integrate the ideas,
orchestrate and implement". Decisions ratified by that delegation:
- Phase 1+2 of the proposal: `vfx` art kind + defaults + /schedule client seam,
  AND per-skill keying via `skill` on ray_fire (accepting the 4th replay-golden
  rebaseline). Phase 3 (signature projectile heads + skill_vfx content kind)
  is OUT of scope — noted as future work.
- New art kind `vfx` (NOT `custom` reuse): inspection kits require a kind.
- VFX stay OUT of content defs (REQ-0264 §11.5 ruling upheld): registry
  exact-name convention `vfx_<role>_<skill_id>` / `vfx_<role>_default`,
  served directly at /api/art/<name>.png, NOT joined into art_urls.
- Art direction (template wording, no-baked-glow rule) is delegated to the
  Fable aesthetic pass and must be documented in this file when ruled.
- Asset production beyond defaults + a small signature set is deliberately
  left to the owner's own art sessions; absent ids fall back cleanly.

## Spec source (absorbed)
~/backpack_ragnarok_worktrees/req-expedition-spec/docs/REQ/draft/
REQ-0264-art-ray-hit-vfx-kind.md — its REGISTRY half is absorbed as-is
(kind `vfx`, shape={role:'ray'|'hit'}, sizing law ray 256x64 forced-tiling
via CircularVAEDecode / hit 256x256, vfx.flatness + tiling.seam kits,
composed-name adoption, 3-step fallback that can never blank). Its CLIENT
half targets the #/expedition renderer and is NOT implemented here; this REQ
lands the client seam in client/src/schedule/monitorFx.ts (REQ-0276 stack)
instead. REQ-0264 remains open for the expedition route later.

## Scope
P1. Registry/server: `vfx` kind end-to-end — art_sizing law (BAD_SHAPE on
    missing/unknown role), artadmin create/render/inspect/adopt with role
    selector + tiling forced for role:'ray', inspection kits per 0264 §12,
    export/serving (direct name fetch), tests.
P2. Sim/wire: `ray_fire` gains `skill` (from s.effect at emission; no RNG
    change). Rebaseline the 12 replay goldens per the REQ-0256 process;
    forecast parity + determinism gates green. dto.ts additive.
P3. Client (/schedule): vfxTexture cache module (loadMonsterTexture pattern,
    direct /api/art fetch); rayProjectile uses a TilingSprite along the cell
    path when vfx_ray_<skill> or vfx_ray_default resolves (1 tile = 1
    diagonal, never stretch; head + fade remain renderer-owned); impactBurst
    blits vfx_hit_* sprite under the renderer ramp (scale .35->1, alpha
    1->0). Fallback = current procedural visuals. silent/off/reduced modes
    unchanged; glow budget respected; e2e seams untouched.
P4. Art: Fable pass rules the vfx prompt template + no-baked-glow, then
    generates + adopts vfx_ray_default, vfx_hit_default and ~6 signature
    skill strips via the artadmin route ONLY if ComfyUI is reachable and
    idle (never disturb owner art sessions; REQ-0158 idle-free respected).
    If GPU unavailable: ship seam-complete with zero adopted assets.
P5. Gates: ci.sh green in this worktree; e2e on the REQ-0280 decade
    (7800..7809); screenshots; todo -> built.

## Dependencies
Branch base = req-0276-monitor-visual-overhaul @ f59a54e (REQ-0276 built,
unmerged). Merge order: 0276 then 0280 (or together). REQ-0264 draft
partially absorbed (registry half) — needs a revision note if expedition
work resumes. Goldens move here (4th rebaseline; 0256 precedent).

## Status log
- 2026-07-22 reserved -> todo: ratified via delegated user approval.

## P1/P2 evidence (2026-07-22, implementer)

### Commits (branch req-0280-schedule-ray-vfx-art-kind, base f59a54e)
- `a878511` P1 server-side: art_sizing law, migration 025 enum, forced tiling, defaults, inspect kits, python composer.
- `38cf394` P1 artadmin: role selector, deriveSizeClient role mirror, KINDS/defaultTemplate/ArtDraft.role, .aa-kind--vfx.
- `0d5fbe6` P1 tests (artwork_test / inspection_test / public.cjs) + `forcedTiling` exported single-source helper.
- `c050218` P2 sim: `skill` on ray_fire + the 12-golden rebaseline + dto.ts.
- (this commit) P3 evidence.

### Kind registration points touched (files)
- `server/services/art_sizing.cjs` — `KINDS += 'vfx'`; deriveSize vfx case: ray `{256,64}` / hit `{256,256}`; missing/unknown role → `BAD_SHAPE`.
- `server/migrations/025_artwork_kind_vfx.sql` — `ALTER TYPE artwork_kind ADD VALUE 'vfx'`. APPLIED to `supabase-db` (enum now: po,si,unit,monster,bpskin,custom,gimic,vfx).
- `server/routes/art.cjs` — shapeAndSize vfx branch (BAD_SHAPE on bad role), defaultsForKind vfx, `forcedTiling()` exported helper (bpskin OR vfx-ray → `tiling:true`), `module.exports += { forcedTiling, shapeAndSize }`.
- `server/services/art_export.cjs` — unchanged; kind-agnostic export to `content/art/vfx/<name>.png` (verified by test).
- serving — unchanged; `hServeAdopted` is kind-agnostic (`RE_PUB_ADOPTED = /^\/api\/art\/([^/]+?)(?:\.png)?$/`).
- `server/lib/content.cjs` — unchanged; `artUrlNameBatch()` never lists a `vfx_` name → cannot leak into `art_urls`.
- `tools/inspect_kits.json` — `tiling.seam` += vfx, `matte.coverage_band` += vfx, NEW `vfx.flatness` (kit_version 1, advisory). No version bumps (no mass-stale).
- `tools/inspect_kits.py` — `kit_vfx_flatness` (soft_alpha_band = frac of 8<alpha<200; ≤0.12 PASS else WARN [S7]); `tiling.seam` role no-op (vfx non-ray → verdict `SKIP`, `applicable:false`).
- `tools/art_job.py` / `tools/art_style.py` — `KIND_TO_STYLE += vfx`, compose_prompt vfx branch (ray→FILL_STYLE grammar, hit→concept_art). **PROVISIONAL — Fable pass owns final wording + V2.**
- `client/src/artadmin/{artShared.ts,CreatePanel.tsx,Workspace.tsx,ArtAdminPage.tsx}` + `client/src/styles/artadmin.css`.

### Shape / sizing / kit specifics
- `shape = {role:'ray'|'hit'}`; ray → 256×64 (4:1 strip, **forced** `tiling:true`), hit → 256×256. LOCKED, /16-legal (snap16 no-op).
- Kits for vfx: `matte.coverage_band`, `tiling.seam` (SKIP on hit-role), `vfx.flatness`. `role` is part of `kit_input_sha256` — flipping role invalidates inspections (proven).

### Serving URL for an adopted vfx asset
- `/api/art/<system_name>.png` (also without `.png`). Direct `getAdoptedRender` by system_name; NOT joined into `computeArtUrls`/`art_urls`.
- Naming convention: `vfx_<role>_<skill_id>` (per-skill override) / `vfx_<role>_default`. role ∈ {ray, hit}.
- `system_name` validation rule: `/^[A-Za-z0-9_]+$/` AND not in {artworks, dev, meta, renders, queue}. (No `:` — vfx_ names never collide with content ids.)

### Admin UI capability
- Create panel: kind=vfx → role `<select data-testid="art-vfx-role">` (ray|hit) writing `shape={role}`; `art-resolution` readout is read-only (256×64 / 256×256).
- Edit form: role `<select data-testid="art-edit-vfx-role">`; changing role is shapeDirty → PATCH `shape={role}`.

### Render-route params for a 256×64 tiling ray render (for P4)
- Create: `POST /api/art/artworks` `{system_name:'vfx_ray_default', kind:'vfx', shape:{role:'ray'}, main_object:'<subject>'}`.
- Generate: `POST /api/art/artworks/vfx_ray_default/generate` body `{}` — no `tiling` needed; `forcedTiling` forces `tiling:true` for role:'ray' (recorded `params.tiling===true`). Hit with `{}` → `tiling:false`.

### Per-site `skill` decisions (9 fireSkillRay sites)
Rule: `skill` = skills.json skill-def id, emitted ONLY where a genuine skills.json def fires. Player-item effects have no skills.json id (identity is `src` = item id); charge/synth verbs have none. Absent → client keys by `src` / falls back.
1. charge-strike (`encounter.cjs` ~L64): synthesized `{verb}`, cause='charge' — **NO** skill.
2. charge-fire (~L81): player item effect, cause='charge' — **NO** skill.
3. attFireVolley trap/attachment (~L356): `att.skills[0]` skills.json def → `skill = att.skillIds[0]`. ✓
4. emitPulse (~L481): player item effect — **NO** skill.
5. dispatchPlayerDefensive reactive (~L550): player item effect — **NO** skill.
6. player main offensive (~L612): player item effect — **NO** skill (client keys by `src`=item id).
7. enemy reactive OnSquadBeenHit (~L633): `sk` from `ent.raw.skills` → `skill = ent.raw.skillIds[idx]`. ✓
8. enemy/entity main fire (~L693): `cd.effect` = enemy OR door/entity skills.json def → `skill = raw.skillIds[cd.effIdx]`. ✓ (covers enemies AND door/trap entities)
9. trap-timeout volley (~L834): `entity.skills[0]` skills.json def → `skill = entity.skillIds[0]`. ✓
Ids are threaded via a **parallel `skillIds` array** (skills[i]↔skillIds[i]) so the shared skill-def objects are never copied (REQ-0121 invariant intact).
Measured on batch002/golden-A: 36 ray_fires → **13 labeled** (door_keeper_strike×11, hrim_cleave×1, trap_deadfall_volley×1 — all resolve in skills.json); 23 player-item rays (dagger/beast_jaw/blade/herb_pouch) unlabeled by design.

### Goldens rebaseline
- `c050218`. `sim/tests/goldens/replay_hashes.json`: all 12 `jsonl_sha256` moved; **0** `def_sha256` changes; **0** `events`-count changes. Proven diff on batch002/golden-A: 366 events before==after; 13 ray_fire lines differ by exactly one appended `skill` key; nothing else moved/added/reordered. (4th rebaseline: 0256/0257/0263/this.)

### Gate proof (all GREEN, final code)
- `node sim/tests/goldens.cjs` → 12/12 (RED→gen→GREEN).
- `node sim/tests/run.cjs` → 121/0 (REQ-0121 shared-ref test passes).
- `node sim/tests/forecast_parity.cjs` → 18/0.
- `node sim/tests/s4_test.cjs` → 14/0 (metrics select named fields; skill never reaches corpus; baselines unmoved).
- `STORAGE_BACKEND=files node server/tests/api_test.cjs` → 194/0 (determinism + public.cjs art_urls non-leak).
- `node server/tests/pacing_test.cjs` → 15/0 (REQ-0276 serve-time enrichment deep-equal intact).
- `STORAGE_BACKEND=pg node server/tests/artwork_test.cjs` → 18/0 (vfx sizing/BAD_SHAPE/shapeAndSize/forcedTiling; forced-tiling render; adopt+direct-serve; content/art/vfx export). Run with `ART_FAMILY_BARRIER=0` (no comfyui restart).
- `STORAGE_BACKEND=pg node server/tests/inspection_test.cjs` → 6/0 (kit routing; role in identity; no mass-stale).
- client `tsc -p tsconfig.app.json` → 0 errors.
Consumers checked (additive-safe): `s4/metrics.cjs`, `humanize.cjs`, `seals.cjs` all read named ray_fire fields (no spread) → ignore `skill`.

### Handoff notes
- **P3 (/schedule monitorFx) resolution order**: `vfx_<role>_<skill>` if `skill` present (enemy/trap/door), else `vfx_<role>_<src>` (player-item rays; note enemy `src` is `<defId>#<idx>` — strip `#idx` if used as a key), else `vfx_<role>_default`.
- **P4 (art)**: `art_job.py` vfx templates are PROVISIONAL (Fable rules final wording + V2 no-baked-glow; `vfx.flatness` [S7] calibrates from the first gallery). Migration 025 already applied. Render only if ComfyUI reachable+idle.
- **Ops note**: `comfyui.service` was restarted once (~01:20 UTC) by a pump test run before `ART_FAMILY_BARRIER=0` was set; it is back up and healthy. All later pump tests set `ART_FAMILY_BARRIER=0`.

## Status log
- 2026-07-22 P1+P2 implemented + goldens rebaselined; all P1/P2 gates green (see evidence).

## P3 evidence (2026-07-22, implementer)

### Commit
- (this commit) P3 client seam: `monitorVfxArt.ts` resolver + TilingSprite ray trail + hit-still blit + ray_fire latch/prefetch.

### New module: `client/src/schedule/monitorVfxArt.ts` (API)
- `resolveVfxTexture(role: 'ray'|'hit', skill: string|null, src: string|null): Promise<Texture|null>` — walks the chain, awaits each name in order, resolves to the FIRST hit (a skill override short-circuits the default fetch), else null. Doubles as the ray_fire fire-and-forget PREFETCH.
- `peekVfxTexture(role, skill, src): Texture|null` — SYNCHRONOUS cached-only read; returns a Texture only when the chain outcome is already known (every earlier candidate a known miss, this one a known hit). If the head of the chain is still in flight it returns null (indeterminate → the current effect falls back procedurally). Never triggers a fetch, never waits.
- `__resetVfxCache()` — test/debug seam.

### Resolution / caching semantics (verbatim)
- Candidate order per role: `vfx_<role>_<skill>` (only if skill present) → `vfx_<role>_<src-stripped>` (src's `#idx` suffix stripped; `?`/empty dropped) → `vfx_<role>_default`. Names failing `/^[A-Za-z0-9_]+$/` are dropped (can't name an adopted asset).
- Cache is per-NAME (NOT per-chain): `Map<name, Texture|null>` + `Map<name, Promise>` in-flight dedupe. Each system_name is fetched at most once per session; `undefined`=unattempted, `null`=known miss (404/empty-decode → procedural, logged-once by pixi, never per-frame retried), `Texture`=ready. Mirrors `monitorArt.loadMonsterTexture` policy exactly.
- URL: `/api/art/<name>.png` via `Assets.load({loadParser:'loadTextures'})` — direct fetch, NOT art_urls/getItemArtUrl (vfx names are not content-def ids; REQ-0264 s11.5).
- Ray strips get `tex.source.style.addressMode='repeat'` on load so a TilingSprite tiles seamlessly in X; hit stills are plain Sprites (no wrap).

### Latch + prefetch mechanics (`MonitorRenderer.ts`)
- New field `currentRayVfxKey: {skill,src}`, latched at `ray_fire` from `ev.skill`/`ev.src` (mirrors how `currentRayField`/`currentRayColor` are latched). Reset to `{null,null}` in `reset()`.
- At `ray_fire` (full mode, non-silent only): fire-and-forget `resolveVfxTexture('ray',…)` + `resolveVfxTexture('hit',…)` — warms cache so the impending ray_step trail and ray_hit impact usually resolve synchronously.
- `animateStep` (ray_step) peeks `vfx_ray_*` → passes `Texture|null` as the new optional `rayProjectile(…, tex?)` arg.
- `currentHitTexture()` peeks `vfx_hit_*`; passed into `impactBurst(…, tex?)` from the ONLY two ray-hit impact sites (`floatDamageLocated`, `floatDamage`). Gimic bursts / link pulses / player-damage bursts pass nothing → procedural (unchanged).

### Draw geometry (`monitorFx.ts`)
- `rayProjectile`: textured trail = one `TilingSprite` per polyline segment, anchor (0,0.5), rotated to the segment direction, `tileScale=(cell·√2/256, bandH/64)`, `tilePosition.x = -(cumulative path distance to segment start)` so the strip flows continuously and NEVER stretches. **Tile-advance law: 1 tile = one diagonal cell run = cell·√2 = 25.456px of path** (256 source px → 25.456 screen px; REQ-0264 s7.2's 56.57px/EXP-diagonal adapted to the 18px monitor cell). Band height = `0.55·cell` (≈9.9px). Per-frame the head walks the polyline; each segment shows only the traversed sub-length (`width = min(segEnd,headDist)-segStart`) at a head→tail alpha (`TRAIL_TEX_ALPHA=0.85`, fading to 0 across the `RAY_TRAIL_CELLS·cell` window, × the afterglow fade) — the SAME per-segment fade law as the procedural trail. The luminous procedural HEAD (elongated stroke + white disc, additive while glow-budgeted) stays on top unchanged. Textured trail spends NO extra glow (glow ledger semantics unchanged).
- `impactBurst`: hit still = a `Sprite(tex)` anchored 0.5 at the cell, added BENEATH the spawn() core flash, driven over the existing 700ms burst by the renderer ramp: `scale 0.35→1.0` (easeOut, peak = `2.8·cell·burstScale` to match the procedural circle) and `alpha 1→0`. Untinted (art carries its own colour; renderer supplies only the ramp). AoE's `burstScale<1` scales the still too. Procedural core flash unchanged on top.

### First-ever ray vs cached
- First ray of a key: peek returns null (cache still `undefined`, prefetch in flight) → this ray/impact draws PURELY procedural (no wait, no jitter). The ray_fire prefetch then resolves; every subsequent ray/impact of that key (same run or later) peeks the cached Texture and draws textured. On a 404 (no asset adopted — the normal dev/e2e/files-backend path) the name caches `null` forever → always procedural, byte-identical to today's visuals.

### Mode handling
- `off` (webdriver/e2e): `rayProjectile`/`impactBurst` early-return; prefetch gated on `fx.animated` (=full) so ZERO new `/api/art` requests fire under automation — every e2e seam/counter untouched.
- `reduced` (prefers-reduced-motion): unchanged — floating numbers only, no ray animation and no textured decoration. DECISION: no static textured stamp, upholding the existing reduced-motion doctrine ("information, not decoration"); documented as the minimal choice.
- `silent` (replay scrub/catch-up): never calls into fx and skips prefetch — no VFX, no fetch, by construction.

### Gate status (this worktree)
- `tsc -b --force` (client) → EXIT 0.
- `oxlint` on the 3 touched files (monitorVfxArt.ts, monitorFx.ts, MonitorRenderer.ts) → 0 warnings, 0 errors.
- No new harness added (P5 owns gates); `rayProjectile`/`impactBurst` new params are optional → signature-compatible (only callers are these two files).

### P4 (art) handoff — measured system_names the client will request
Tallied ray_fire across ALL 12 replay goldens (batch-002 pilot + dungen/default L1/3/5/8 × dg-11/dg-22 + test_fixed): 331 ray_fires, 62 skill-labeled, 269 player-item (keyed by src).
- **Signature skill art (enemy/trap/door — 3 ids cover 100% of labeled rays):** `door_keeper_strike` (×45), `hrim_cleave` (×12), `trap_deadfall_volley` (×5). → make `vfx_ray_<id>` + `vfx_hit_<id>` for these.
- **Signature player-item art (keyed by src — these are the MOST VISIBLE rays in any run):** `dagger` (×156 — ~47% of ALL ray_fires; the single highest-impact asset after defaults), `beast_jaw` (×51), `blade` (×33), `herb_pouch` (×29). → `vfx_ray_<item>` + `vfx_hit_<item>`.
- **Always make first:** `vfx_ray_default`, `vfx_hit_default` — they alone make every ray/impact in a normal run textured (the fallback tier).
- Priority order for demo visibility: defaults → dagger (dominant) → door_keeper_strike (dominant labeled) → beast_jaw/blade/herb_pouch → hrim_cleave/trap_deadfall_volley.
- Ray strip = 256×64 forced-tiling (P1 `forcedTiling`); hit still = 256×256. No baked glow (renderer owns the ramp/head glow). Client keys player-item rays by the bare item id (strips `#idx`), so an item's `src` id IS its vfx name suffix.

## Status log (cont.)
- 2026-07-22 P3 implemented: client /schedule VFX-art seam (monitorVfxArt resolver + TilingSprite ray trail + hit-still ramp + ray_fire latch/prefetch). tsc -b --force EXIT 0; oxlint clean on touched files. Fallback = current procedural visuals when no asset adopted.

## P4 evidence (2026-07-22, Fable art pass)

### Style ruling (FINAL -- replaces the P1 PROVISIONAL templates; commit `9bacf49`)
- `tools/art_style.py` gains `VFX_RAY_STYLE` / `VFX_HIT_STYLE` + `vfx_prompt(role, clause)`;
  `tools/art_job.py`'s vfx branch routes BOTH roles there. `vfx` is removed from
  `KIND_TEMPLATE` (the Anime template stays banned for vfx: "bold outline" turns a beam
  into a bordered object -- the measured leather-patch failure class).
- Grammar (both roles): PURE BLACK ground; strong simple silhouette; luminance does the
  drawing (no stroke outline); no text/runes/glyphs/sigils; no lens flare. Ray = one
  single straight edge-to-edge beam, centered vertically, wisps stretched along the
  travel axis, seamless horizontal repeat. Hit = one single centered radial burst,
  spikes + sparks from a small bright core.
- **V2 no-baked-glow, RULED (REQ-0264 s10 open question):** V2-as-amended. Soft INNER
  luminance gradients are the asset's essence -- a streak IS light -- and are PERMITTED
  inside/around the core silhouette. The WIDE OUTER HALO is FORBIDDEN: a broad low-alpha
  bloom lobe extending well beyond the energy silhouette duplicates the client's additive
  budget (procedural head + impact ramp, <=3 glow sources, blur <=8) and is uncullable at
  19 rays in flight -- REQ-0264 s10.1's argument stands; this ruling narrows its remedy
  from "flat art" to "self-contained light". Enforcement: the border-key matte turns any
  halo into exactly the soft alpha skirt `vfx.flatness` measures (soft_alpha_band <=0.12
  on the CUTOUT), plus the adoption eye: candidates with halo lobes wider than ~2x the
  core band height are rejected (two such candidates rejected below, both otherwise
  beautiful).
- **Matte convention for vfx (documented decision):** cutouts run with
  `ART_KIT_MATTE_METHOD=borderkey`. On a pure-black ground the border-key IS a luminance
  key (alpha = smoothstepped distance from the sampled black median) -- deterministic,
  tiling-safe, and model-free (birefnet is a saliency matte + ~12 GB RSS beside a warm
  ComfyUI; wrong tool for light). Adopted asset = the border-key CUTOUT of the winning
  seed (RGBA over transparent), per REQ-0264 s8 "alpha-matted, composited over the field".
- Element semantics (subject clause carries them; V4 one dominant hue per asset):
  defaults are element-NEUTRAL pale gold / bone-white; dagger silver-white steel;
  planned-but-not-rendered: door_keeper_strike molten gold iron, hrim_cleave frost
  (#6FC4DE family), trap_deadfall_volley dark ember-red, beast_jaw blood-tinged bone,
  blade broad silver-steel, herb_pouch dusty bone-white motes.

### Adoption table (registry = live namespace via scoped api :7801; exports committed here)
| system_name | subject | candidates | adopted | kits (cutout) | note |
|---|---|---|---|---|---|
| vfx_ray_default | pale gold and bone-white energy | seeds 1-3 + cutouts | **cutout 100002** (of seed 2) | flatness PASS 0.020, coverage PASS 0.264, seam WARN-low 0.118 | seed 1 REJECTED: wide baked halo lobes (V2) |
| vfx_hit_default | pale gold and bone-white energy | seeds 1-3 + cutouts | **cutout 100003** (of seed 3) | flatness PASS 0.038, coverage PASS 0.480, seam SKIP (hit) | densest symmetric burst; halo self-contained |
| vfx_ray_dagger | needle-thin swift silver-white energy | seeds 1-3 + cutouts | **cutout 100003** (of seed 3) | flatness PASS 0.014, coverage PASS 0.152, seam WARN-low 0.791 | seed 1 REJECTED: wide halo (V2); thinnest/fastest read at 10 px |
| vfx_hit_dagger | (same) | seed 1 only (2-3 canceled) | **SKIPPED** | flatness PASS 0.033 on cutout 100001 | sole candidate badly off-center (core ~30% left); no re-roll possible after GPU loss; falls back to vfx_hit_default by the client chain |
| vfx_ray/hit_door_keeper_strike | heavy molten gold iron energy | none (canceled) | -- | -- | artworks created as owner head-start; renders canceled at GPU loss |
| beast_jaw / blade / herb_pouch / hrim_cleave / trap_deadfall_volley | -- | not created | -- | -- | not reached |

### tiling.seam calibration note [S7]
Every vfx ray cutout scores seam_ratio_x BELOW the bpskin band [0.83, 1.10]
(0.109-0.791 across 6 strips) -> WARN-low. Cause: the ratio divides wrap-contrast by
interior-contrast, and an energy strip's interior contrast (bright core on black) is
extreme, so a genuinely seamless wrap reads <<1. All six strips eyeballed at 3x
horizontal tiling on the night-iron ground: no visible seam. Advisory kit, verdict
unchanged; recommend a vfx-specific band (~[0.0, 1.10]) when the kit is next versioned.

### GPU + abort record
- ~8 min GPU total (02:10:56-02:18:30 UTC): 12 ok renders (256x64 x6, 256x256 x6) +
  1 killed mid-flight. Renders ~20-30 s each at 30 steps.
- 02:18:30: `comfyui.service` began being restarted every ~6 s by an EXTERNAL ssh
  session (verified: restarter `systemctl --user restart comfyui.service` ppid =
  `sshd-session`, NOT this harness -- /proc env of the :7801 api shows
  `ART_FAMILY_BARRIER=0` -- and not backpack-api). Loop still active at 02:25. Per the
  ComfyUI-availability rule this pass STOPPED all GPU work at 02:20 (canceled 8 queued/
  running renders), finished CPU-side matte/inspect/adopt for what had rendered, and
  ships 3 adopted assets. NO comfyui restart was ever issued by this pass.
- Harness: scoped api on :7801 (worktree code, live DATABASE_URL, ART_EXPORT_ROOT ->
  this worktree, ART_FAMILY_BARRIER=0, ART_KIT_MATTE_METHOD=borderkey), torn down after
  the pass; ports 7800-7809 free.

### P5 notes
- Adopted + exported: `content/art/vfx/{vfx_ray_default,vfx_hit_default,vfx_ray_dagger}.png`
  (adoptions live in the shared pg registry, so /api/art/<name>.png serves them on any
  pg-backed api). A /schedule screenshot run will show: textured trails on ALL rays
  (default tier), dagger-specific silver strips on dagger rays (47% of ray_fires),
  textured gold impact on every ray hit. e2e/files-backend unaffected (404 -> procedural).
- Remaining signature set (door_keeper_strike, hrim_cleave, trap_deadfall_volley,
  beast_jaw, blade, herb_pouch) is deliberately left to the owner's art sessions per the
  origin ruling; subjects above are the ready-to-use briefs.

## Status log (P4)
- 2026-07-22 P4: style ruled (V2-as-amended), 3 assets adopted (defaults + dagger ray),
  GPU work aborted cleanly on external comfyui restart loop; evidence above.
