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
