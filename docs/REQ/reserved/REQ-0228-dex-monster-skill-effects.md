# REQ-0228 — Dex monster detail: show what a skill DOES, not just its name

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> draft: retrospective proposal from REQ-0208; needs
  a design decision (payload shape + spoiler posture) before work starts.

## Origin (REQ-0208 retrospective)
The REQ-0208 monster detail lists skill CHIPS localized through
monster_skills ({name, name_ja} only). While wiring it, the gap was obvious:
skill/1 entries carry compact, display-worthy mechanics (trigger cadence,
verb + damage band, attack_profile edge/direction/penetration/aoe), the
forecast surface already turns them into human-readable facts (REQ-0057),
and the engine vocabulary is closed -- yet the Dex, the one reference/wiki
surface, shows only a name. "Gnoll Claw" tells a player nothing about
range, cadence or damage.

## Problem
The full-display Dex posture (user-ratified in REQ-0208) stops one field
short: monsters expose hp/footprint but their skills are opaque labels.
Players must enter a battle (or open the forecast overlay mid-run) to learn
what a monster actually does.

## Proposal (decision needed between a/b)
- (a) widen monster_skills entries with a display-safe mechanics slice
  ({trigger, verb, attack_profile}) -- one map, no new section; the Dex
  renders a compact per-skill line under each chip (cadence ・ verb n[min-max]
  ・ edge/direction/penetration/aoe), reusing eff_render/forecast wording
  where it exists rather than a new formatter.
- (b) a separate `skills` payload section keyed by id (full skill/1 display
  slice), monster_skills stays names-only; heavier but reusable by a future
  skill_def catalog tab.

## Posture notes
- Same anti-drift rule as REQ-0208: the slice derives from core.cjs
  getScheduleContent()'s skillDefsById (registry-first), never a second load.
- "forecast != spoiler" (REQ-0057) stays satisfied: skill mechanics are
  static content, not a run's hidden placements. Masked detection-mode
  entities (doors/chests) are not monsters and stay out of the payload.

## Gates (when implemented)
- api test: mechanics slice served for a fixture skill; e2e: a skill line
  renders localized under the monster detail chips.
