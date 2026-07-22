# REQ-0292 — instance HUD: cooldowns, charge sweeps, skill badges + skill_icon art kind

## Origin & ratification (user directives, 2026-07-22)
Absorbs REQ-0263 (expedition-instance-hud, draft in req-expedition-spec)
IN-PLACE onto the /schedule monitor, same retarget pattern as REQ-0276/0280.
User rulings, verbatim intent:
1. Skill icons: new art kind `skill_icon` in artadmin, generated at 256x256,
   and DISPLAYED. No draft parking — this REQ goes straight to todo.
2. Cooldown wire: "give the client the per-tick rate up front; when a factor
   changes the rate, notify" — i.e. the ramp-parameters-once design of
   REQ-0263 §6 is APPROVED. No per-tick streams (~300k events/run measured).
3. Standing delegation: internal-spec decisions are the implementer's.

## Decisions closed by the orchestrator (no further review)
- Replay goldens move again: ACCEPTED (mechanical rebaseline, REQ-0256/0280
  precedent). Determinism gate + forecast parity must stay green.
- REQ-0257 ordering hazard: superseded — fields land additively on the
  CURRENT ray_fire (REQ-0280 precedent); 0257 remains future work.
- Enemy hpMax hint (bars starting <100%): implementer inspects whether the
  rolled per-instance HP is reachable at serve time (run doc / roster
  enrichment); if yes send actual hpMax, else normalize display to start
  full. Honest either way; document the choice.
- skill_icon keying: skills.json def ids are REAL content ids — follow the
  content-kind conventions (art_urls join if the namespace rules allow,
  else direct /api/art serving like vfx; decide from code evidence, doc it).
- Missing icon fallback: class-glyph placeholder (existing norm, never blank).

## Display spec (from REQ-0263, user-authored)
- (k) item cooldown = translucent-black overlay ON the item (clockwise
  sweep), cleared at ready; passive-trigger items FLASH on fire.
- (k) unit charge = the unit's BACKGROUND filling clockwise (translucent
  wedge BEHIND the unit icon, never occluding it — 0263's reconciliation).
- (l) monster/gimic skills = circle + skill icon badge with clockwise
  translucent-black charge sweep, at the owning instance.
- All geometry cell-faithful per REQ-0283 rules (annotations never displace).

## Wire design (ratified ramp model)
Send ramp parameters once per state change, client evaluates against the
paced clock: e.g. cooldown {t0, durationTicks} on the firing event
(ray_fire +slot/+cooldownTicks, or sibling), charge {value, capacity, rate}
at encounter/charge events, and an explicit small notification event ONLY
when a modifier changes a rate mid-ramp. Data source: REQ-0256 tick-core
cooldownSkills / REQ-0200 unit_charge runtime. Serve-time enrichment
preferred (REQ-0276 pattern); sim emission only where the data lives
in-sim only — goldens rebaselined if so.

## Scope phases
P1 (Opus): wire/sim/server ramps + dto + goldens + tests; skill_icon art
    kind end-to-end (sizing 256x256 still, kits, artadmin role-less create/
    render/adopt, serving per keying decision, art_urls non-leak or join
    test accordingly).
P2 (Opus): client — ramp evaluator (pt-clock), item cooldown overlay, unit
    charge wedge, passive fire flash tie-in, skill badge actors with icon
    texture chain + glyph fallback; silent/off/reduced discipline; e2e seams.
P3 (Fable): skill_icon prompt template ruling + batch generation via
    artadmin (GPU idle-gated, live-fielded skills first, all 81 best-effort,
    abort cleanly if GPU contended); badge/sweep aesthetic pass (MJOLNIR).
P4 (Opus): gates (ci.sh, decade ports 7920-7929... NOTE: derived =
    5000+2920+i = 7920..7929), screenshots, todo->built, then merge+deploy
    per the session's standing authorization (main web rebuild, api restart
    ONLY if server/ changed, live verification).

## Non-goals
Dex skill-icon surfaces (REQ-0228/0265 revision later), #/expedition route.

## Status log
- 2026-07-22 reserved -> todo (user-ratified rulings above; no draft parking).
