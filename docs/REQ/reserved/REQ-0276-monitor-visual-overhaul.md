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
