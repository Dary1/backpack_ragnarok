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

## P1 evidence (Opus, 2026-07-23)

Two commits on `req-0292-instance-hud-cooldown-skill-icons`:
`450cd3a` (cooldown+charge wire), `def31fc` (skill_icon art kind).

### A. Wire field table (event -> new fields -> source)

| event (served) | new field | who fills it | value |
|---|---|---|---|
| `ray_fire` (player cadence fire) | `slot` | sim `encounter.fireInstanceSlot` (`inst.squadSlot` -> 0..3) | 0..3 squad index; item id already in `src` |
| `ray_fire` (player cadence fire) | `cooldownTicks` | sim, **back-patched** in `rollCooldownTicksFor` after the RESET roll | freshly rolled reset cooldown, in ticks |
| `ray_fire` (enemy/gimic cadence fire) | `srcInst` | sim `fireInstanceSlot` enemy branch (`inst.id`) | firing instanceId e.g. `hrimgrimnir#0`; `skill` already present (REQ-0280) |
| `ray_fire` (enemy/gimic cadence fire) | `cooldownTicks` | sim, back-patched | reset cooldown in ticks |
| `unit_charge_spend`/`_stack`/`_transform` | `value` | `unit_charge.cjs` emit sites | instance counter at emit (0 post fire_on_full/transform spend) |
| same | `capacity` | same | per-instance ROLLED capacity (client can't derive it) |
| same | `rate` | same, `every_secs` only | fill rate counts/sec = 1/period; OMITTED for event-driven triggers |

Detection/unlock rays (`encounter.cjs:372/391`) re-arm too (REQ-0263 s6.4 caveat 3) and
receive `slot`+`cooldownTicks` via the same path. One-shot trap volleys (`attFireVolley`)
carry NONE (they never re-arm) -- their absence is intentional and asserted.

### B. Enrichment vs sim-emission decision + proof
- **cooldownTicks: SIM EMISSION (required).** It is a per-fire RNG roll
  (`rng.stream(...).range(...)`) that is NOT in any stored event and NOT in the roster,
  so serve-time `decorateVisible`/`enrichDecoration` (which only join roster/gimic maps,
  never re-simulate; `run.events` is stored byte-identical) cannot reconstruct it without
  re-running the RNG. Hence sim emission, back-patched AFTER the roll so the RNG draw order
  is unchanged (REQ-0263 s6.4 caveat 4). `slot`/`srcInst` ride the same emission (free,
  since goldens move anyway).
- **charge value/capacity/rate: SIM EMISSION on existing events** (no serve join exists for
  the resolved rolled capacity/period; the charge engine runs only in-sim).

### C. Goldens status: REBASELINED (3rd move; REQ-0256/0280 precedent).
- All 12 `jsonl_sha256` moved; **ALL `events` counts UNMOVED**; **ALL 9 `def_sha256`
  UNMOVED** -- the sharpest REQ-0263 s10.1 checks pass.
- **Fields-only PROVEN**: stripping `{slot,cooldownTicks,srcInst}` from a fresh golden-A run
  and re-serialising reproduces the OLD hash `903ab2..` **byte-for-byte** (no line added/
  removed/reordered, every `t` unchanged). `git diff replay_hashes.json` = 12 jsonl lines
  only.

### D. Charge rate-change verdict: NO modifier -> NO event (per contract).
Verified in `unit_charge.cjs`: the `every_secs` period is `resolveRolledRange(trigger.s,...)`,
resolved once per instance from the frozen spec and re-read identically each tick -> a
CONSTANT fill rate. Haste/Chill/`advance_cooldown` act on item COOLDOWNS + status, never on
the charge timer. There is no mid-ramp charge-rate modifier, so no rate-change notification
event is invented (and none of REQ-0263's `unit_charge_arm`/`unit_charge_gain` events are
added -- snapshots on existing events suffice and preserve the
`unit_charge_encounter_test` "never-spends -> 0 charge events" invariant).

### E. skill_icon keying ruling (from code evidence).
**Direct-serve by exact name = the bare skill id. NOT joined into art_urls.**
`server/lib/content.cjs artUrlNameBatch()` (:226-262) enumerates exactly items/sis/tms/
monsters/gimics/dungeons/unit_skins -- **skills are absent**; the module comment (:308-310)
states monster/skill resolve only through core.cjs and never join the overlay; and per-skill
art already direct-serves (the vfx precedent, migration 025). skill ids ARE real content ids,
so the exact-name convention (artwork `system_name == <skill_id>`, as monster/gimic/dungeon
art use) applies. Proven non-leak: 0 of 81 served monster/gimic skill ids appear in
`artUrlNameBatch()`. The client resolves `/api/art/<skill_id>.png` with the class-glyph
fallback when absent.

### F. Registration points touched (skill_icon).
`art_sizing.cjs` KINDS + deriveSize (256x256); `routes/art.cjs` defaultsForKind (passthrough);
`migrations/026_artwork_kind_skill_icon.sql` (**APPLIED to supabase-db**: enum now
`{..,vfx,skill_icon}`); `tools/inspect_kits.json` (matte.coverage_band + si.subject_frame --
mirrors the si icon set; no new kit, no Python, no kit_version bump); `tools/art_job.py`
KIND_TO_STYLE `skill_icon->item`; client `artadmin/artShared.ts` (Kind/KINDS/deriveSizeClient/
defaultTemplate), `CreatePanel.tsx` (locked-256 note, grouped with si, no role selector),
`styles/artadmin.css` (`.aa-kind--skill_icon`). Export path is kind-generic ->
`content/art/skill_icon/<id>.png` (no art_export change).

### G. Tests + gates run.
- `sim/tests/goldens.cjs` 12/12 GREEN (rebaselined); forecast_parity 18/18; run.cjs 122/122
  (+ new `REQ-0292: cadence ray_fire carries slot/cooldownTicks/srcInst` test);
  unit_charge_test 13/13; unit_charge_encounter_test 24/24 (+ value/capacity/rate assertions,
  every_secs has rate / event-driven does not); pacing_test 15/15.
- skill_icon: `deriveSize`/`shapeAndSize`/`forcedTiling` verified; kit routing
  `['matte.coverage_band','si.subject_frame']` + no-mass-stale verified; art_urls non-leak
  verified; **end-to-end create->render(not tiled)->adopt->direct-serve(kind=skill_icon)->
  export content/art/skill_icon/hrim_cleave.png ALL PASS** (isolated, mock render). client
  `tsc --noEmit` EXIT=0.
- NOTE: the full `artwork_test`/`inspection_test` pg suites FLAKE on render TIMEOUTS under
  box load ~10 (comfyui/ternion) -- environmental, not code: untouched baselines
  G3/flow/REQ-0183 fail identically; the skill_icon logic passes in isolation. Re-run when
  the box is idle (P4).

### H. Notes P2 (client) needs.
1. **Cooldown overlay / badge sweep vs pt clock.** For a `ray_fire` with `cooldownTicks`:
   `frac_remaining(pt) = clamp01(1 - (pt - pt_fire)/(cooldownTicks * TICK_SECS))`, where
   `pt_fire` is that event's `pt` (the fire IS the arm; TICK_SECS from core). Draw the item
   overlay iff `cooldownTicks` present (the cadence discriminator -- no separate `cause`
   field). Player item: locate by (`slot` squad 0..3, `src` item id). Enemy badge: key by
   (`srcInst`, `skill`).
2. **Charge wedge vs pt clock.** `frac = clamp01(value/capacity)`; for `every_secs` interpolate
   `value(pt) = value0 + rate*(pt - pt_emit)` from the last `unit_charge_*` snapshot. Event-
   driven charges (no `rate`) step on each spend (flash), no smooth fill. First fill CYCLE
   before any spend: bootstrap from the content charge def midpoint (== the sim's resolved
   value today, pre-REQ-0190); the first snapshot then locks ground truth. (No arm event by
   design.)
3. **skill_icon texture resolution.** Fetch `/api/art/<skill_id>.png` (256x256), exact-name,
   NOT via art_urls; class-glyph fallback when 404/absent.
4. **hpMax decision (REQ-0263 s4.5 closed-decision) -- STATED.** Enemy full HP IS a
   per-instance roll: `packs.cjs:67` `hpMax = Math.round(hpStream.range(def.hp[0], def.hp[1]))`,
   and the enemy starts at `hp: hpMax`. That rolled value is **NOT reachable at serve time**:
   `pacing.buildRoster` reconstructs enemies from the ROLLED DEF + content (dungeonDef +
   enemyDefsById), which carry the hp RANGE only, and serves `ApiRunRosterEnemy.hpMax = hp[1]`
   (the def UPPER bound). The per-instance roll lives solely in the transient sim actor
   (`packs.cjs`), is never persisted on the run doc/roster, and buildRoster cannot obtain it
   without re-rolling the sim's private `hpStream` (= re-simulating -- rejected). **Decision:
   P1 does NOT send an actual rolled hpMax and did NOT touch buildRoster.** hp[1] stays the
   wire hpMax (leak-safe: hp_after/hp[1] never exceeds 100%). Per the closed decision's "else"
   branch, **P2 normalises the enemy bar to start FULL** -- render the bar at 100% until the
   first `hp_after` names the instance, then track hp_after/hp[1] thereafter (a bar the client
   knows is honest; it never sends a fabricated per-instance max).
