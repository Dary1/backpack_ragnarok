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
