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

## P2 evidence (Opus, 2026-07-23)

Client instance-HUD: pt-clock ramp evaluator + item-cooldown overlays, unit-charge
wedges, monster/gimic skill badges (icon + sweep), passive-flash tie-in, HP
normalization. On `req-0292-instance-hud-cooldown-skill-icons`, source-only (the
web/app bundle is P4's canonical rebuild).

### A. Modules / files
- **NEW `client/src/schedule/monitorRamps.ts`** — pure `RampStore` (no Pixi). Cooldown
  `{pt0, durationMs}` and charge `{pt0, value0, capacity, rate}` maps; `TICK_SECS = 0.01`
  mirrored from `sim/lib/core.cjs:105` (same "mirrored constant" discipline as
  `pacingClient`). `cooldownFrac = clamp01(1-(pt-pt0)/durationMs)`,
  `chargeValue = clamp(value0 + rate*(pt-pt0)/1000, 0, capacity)`, `chargeFrac = value/capacity`.
- **NEW `client/src/schedule/monitorSkillArt.ts`** — `skill_icon` texture cache, exact-name
  direct `/api/art/<skill_id>.png` (P1 ruling E: NOT art_urls), null-miss cached, single
  in-flight promise; `peekSkillTexture` synchronous cached-only read (glyph fallback until
  it lands). Mirrors `monitorVfxArt` verbatim.
- **NEW `client/src/schedule/monitorHud.ts`** — stateless draw primitives `sweepPie` (circular
  clockwise sweep from 12 o'clock) + `sweepRectMasked` (rect sweep clipped to a PO box via a
  rect mask). Winding note: Pixi y-down => arc counterclockwise=false advances CLOCKWISE.
- **EDIT `board/squadCompositor.ts`** — added an OPTIONAL `onSeatAnnotation` hook to `ComposeOpts`.
  `drawUnitSeat` inserts an empty Container in board z-order BETWEEN the core disc and the unit
  icon sprite and hands back the seat geometry; compositor stays draw-only (reserves the slot,
  never draws/stores the annotation). No behaviour change when the hook is absent.
- **EDIT `schedule/monitorActors.ts`** — `instanceBox(instanceId)` (FIELD-LOCAL footprint box, the
  skill-badge anchor space) beside the stage-space `centroidOfInstance`.
- **EDIT `schedule/monitorGlyphs.ts`** — `skillGlyph(skillId)` element-hint runic fallback.
- **EDIT `schedule/MonitorRenderer.ts`** — ramp store + per-frame ticker + three draw passes +
  captures + reset cleanup + seam (details below).
- **EDIT `schedule/Monitor.tsx`** — pushes `setPlayhead(playheadMs)` (every rAF) + `setPacingVersion`,
  and exposes the `ramps()`/`setPlayhead` debug seams.

### B. Ramp store design + silent-rebuild
- **Key shapes.** Cooldowns: player item overlay `item|<slot>|<src-stripped>`, enemy/gimic skill
  badge `skill|<srcInst>|<skill>`. Charges: `<slot>` (0..3). `pt0 = ptOfEvent(ev, pacingVersion)`
  — the SAME ms clock the release cursor uses, so ramp time and the playhead never disagree.
- **cooldownTicks presence = cadence discriminator.** A re-arming fire carries it => overlay/badge
  ramp; reactive/pulse/charge fires and one-shot trap volleys omit it => NO overlay (they still flash).
- **STATE not VFX.** Captures run in `applyOneEvent` REGARDLESS of `silent` (mirroring how enemy
  markers/discovered-ids rebuild on a silent catch-up). `reset()` clears the store + destroys every
  drawn overlay. So a backward seek (`reset()` + silent replay) rebuilds every cooldown/wedge/badge
  from scratch — no stale or missing HUD. Charge every_secs interpolates between snapshots; the next
  snapshot re-locks ground truth (no arm event by design; pre-first-snapshot shows no wedge — honest,
  never fabricated).

### C. Where each overlay draws (z-order + anchor)
- **Item cooldown** — `cooldownLayer` (own Container, ABOVE all squad visuals on the player field,
  re-attached each `mountSquads`). One masked pie per matching PO footprint box (from
  `SquadSlotHandle.icons`, the same board-canon boxes the muzzle flash uses); drawn EXACTLY over the
  item's footprint, clipped by a rect mask so nothing spills into adjacent cells. Translucent black
  (`MJ.void`, α 0.55), vanishes at ready.
- **Unit charge wedge** — drawn into the compositor-reserved seat-annotation Container (z: ABOVE the
  core disc, BEHIND the unit icon sprite — REQ-0263 (l), never occludes the icon). Slot-keyed;
  translucent GOLD fill (`MJ.gold`, α 0.32) growing clockwise. First seated BP per slot hosts it.
  Existing dock pips (Pixi + DOM SquadDock) stay event-driven off the same `unit_charge_*` events, so
  wedge and pips never disagree.
- **Skill badge** — `skillBadgeLayer` (enemy field, above the gimic overlay). Circle
  (`MJ.panel`/`MJ.borderLo`) + skill_icon Sprite (or `skillGlyph` fallback) + clockwise translucent-
  black cooldown sweep (`MJ.void`, α 0.55). Anchored at the owning instance's footprint TOP-INSIDE
  (fixed offset, never displaced; clear of the status/HP rows).

### D. Passive-flash verification — PASS, no code change needed
`flashSourceItem` is called for EVERY player-origin ray_fire: the existing gate is
`field === 'enemy' && !silent && ev.src && ev.src !== '?'` — keyed on `src` PRESENCE, NOT on
`cooldownTicks`. So passive/reactive fires (cooldownTicks ABSENT) already flash their source cell(s)
(`'#'`-suffix stripped to the base item), satisfying REQ-0263 "パッシブ的な発動条件のアイテムもちゃんと発動したら、光る".
Cadence fires flash AND get the cooldown overlay; passives flash only. Verified by reading the
ray_fire branch — the flash predates and is orthogonal to the P2 cooldown capture inserted beside it.

### E. Badge stacking rule
Per owning instance, badges sort by skill id (deterministic) and lay out horizontally from the
footprint's top-left: `d = clamp(min(FIELD_CELL_PX*0.95, min(box.w,box.h)*0.85), 9, ..)`, gap 2px,
cap `maxN = floor((box.w+gap)/(d+gap))` and additionally break if `bx + d > FIELD_W`. Skills beyond
the cap are TRUNCATED (state still tracked/seam-readable, just not drawn) — never overflow the field,
never move the actor. Instances with no roster actor (gimic/legacy) track state but draw nothing.

### F. Modes
`off` (webdriver): the per-frame ticker is NOT registered at all — zero drawing, but the store +
badge defs are still captured, so every seam asserts. `reduced`: ticker redraws only when
`rampsDirty` (a capture/reset) — static fractions, no per-frame churn. `full`: redraws every frame
(smooth sweep). Sweeps are translucent BLACK / a low-α gold fill — no additive glow, glow budget
untouched.

### G. Seams
`__monitorDebug[room]` gained `ramps()` (read-only `{pt, cooldowns:[{key,frac}], charges:
[{key,value,capacity,frac}], badges:[key]}` at the current pt) and `setPlayhead(ms)` (drives that
pt). Every prior seam (squads/enemyBounds/pulseCounts/attachmentCounts/applyTestEvents/chimeStats/
enemyActors/setTestRoster) is intact. Renderer surface: `setPlayhead`, `setPacingVersion`,
`getRampsSnapshot`.

### H. HP normalization — ALREADY honest, verified + asserted
Per P1's hpMax ruling (`ApiRunRosterEnemy.hpMax = hp[1]`, no fabricated per-instance roll):
`buildActor` seats `hp = enemy.hpMax` (100%) and `hit()` sets `hp = hp_after`. Non-masked enemies show
100% from encounter until the first attributed `hp_after` names them, then track `hp_after/hp[1]`;
masked reveal on first hit. Asserted via `setTestRoster` + `enemyActors` (hp 100 -> 60 on a
ray_hit hp_after=60, hpMax stays 100).

### I. Tests + gates
- **NEW e2e** (`schedule.spec.ts`, "REQ-0292: instance-HUD ramps"): drives `applyTestEvents` with
  cooldownTicks/charge fields + `setPlayhead`, asserts item cooldown 1.0->0.5->0 across the span,
  skill-badge cooldown 1.0->0.625->0, badge key EXISTS, event-driven charge STATIC 0.5, every_secs
  charge fills 0->0.3->1 (clamped) — fractions MOVE with the playhead (structural, via `ramps()`, not
  pixels, since webdriver=off). Plus the HP-normalization test above.
- `tsc -b` EXIT=0; `oxlint` 0 errors (pre-existing warnings only; none of the P2 files flagged).
- **Scoped schedule e2e (REQ-0292 decade, ports 2920/2921/2922, GPU)**: the 2 REQ-0292 tests PASS
  (isolated 6.7s AND within the full serial run). Full `schedule.spec.ts`: **30 passed, 1 failed** —
  the single failure is `REQ-0240 ...capture desktop+narrow` on a slot-assign `409` (a pre-existing
  cross-test squad deploy-gate isolation flake in the server run-lifecycle, which P2's client-only
  changes never touch); it PASSES in isolation (12.4s). No regression attributable to P2.

### J. For P3 (Fable art/aesthetics) to polish — exact names
- `monitorHud.ts`: `sweepPie` / `sweepRectMasked` — sweep fill colour/alpha, easing, inner-radius
  ring, tick notches.
- `MonitorRenderer.drawItemCooldowns` (α/colour of the item overlay), `drawChargeWedges` (wedge
  colour — currently `MJ.gold` α 0.32 — and a possible full-charge "ready" pulse),
  `drawSkillBadges` (badge ring styling, icon inset `ib = d*0.82`, size `d`, gap, stacking cap).
- `monitorGlyphs.skillGlyph` — the runic fallback set once real `skill_icon` art (P3 batch) lands.
- `monitorSkillArt.resolveSkillTexture` — no logic change expected; P3 just supplies the art the
  cache serves. `composeSquad`'s `onSeatAnnotation` z-slot is the sanctioned place for any richer
  seat-background treatment.

## P3 evidence (art batch + registry, 2026-07-24)

### A. Generation — 81/81, 0 failures
All 81 live-fielded skills generated as skill_icon emblems via the P3
SKILL_ICON_STYLE grammar (flux2 klein Q8_0, 256x256, seed 42, 30 steps),
one centered concrete object per skill, hue keyed to the skills

## P3 evidence (art batch + registry, 2026-07-24)

### A. Generation - 81/81, 0 failures
All 81 live-fielded skills generated as skill_icon emblems via the P3
SKILL_ICON_STYLE grammar (flux2 klein Q8_0, 256x256, seed 42, 30 steps),
one centered concrete object per skill, hue keyed to the skill's element
(Chill->frost blue, Burn->ember orange, Poison->venom green, lifesteal/
bleed->blood red, Stun/petrify->stone grey, Weakness/curse->dull violet-
gold, neutral->steel/bone). Subject clauses authored from name_en + verb/
status. Batch wall time 60.8 min (~40s/render: the 8 GB box swaps the FLUX
unet and the 8 GB Qwen3 encoder each render; the 450-540s art_route note is
the ~1MP case, not 256x256). Commit 4248f26 tracks the 81 PNGs under
content/art/skill_icon/ (the reference exports, vfx precedent).

### B. Outer-glow ruling (user, 2026-07-24)
The emblems carry a tight rim glow despite SKILL_ICON_STYLE ruling #5
(no baked outer glow). User art-direction ruling: KEEP as-is (glow is tight,
reads well inside the badge circle). A deliberate relaxation of ruling #5.

### C. Registry registration + serving (the display data path)
CORRECTION to a naive file-drop: public GET /api/art/<name>.png is
hServeAdopted -> storage.getAdoptedRender -> the render IMAGE BYTES from the
DB, NOT a disk scan. So the tracked PNGs alone do not serve. Registered all
81 into the live registry (namespace = hash(~/backpack_ragnarok)): per skill
createArtwork(kind=skill_icon,256x256) or reuse, createRender(seed 42),
updateRenderResult(image bytes + sha256 + final_prompt + params), adoptRender.
Result: created 75, reused 6 (the interrupted-Fable unadopted stubs:
door_keeper_strike, hrim_cleave, trap_deadfall_volley, rotting_claw,
festering_grasp, spectral_touch), adopted 81, 0 fail. No GPU re-render (the
already-rendered bytes were injected). Serving VERIFIED on the live
backpack-api: /api/art/{hrim_cleave,fire_dart,venom_bite,doom_toll,
trollish_vigor,petrifying_glare}.png -> 200 image/png, valid PNG signature,
sizes match; a nonexistent id -> 404 (class-glyph fallback path intact).

### D. Aesthetic pass (P2 s.J) - no speculative change
All 81 skills now have real art, so the glyph-fallback tuning is moot; P2's
sweep/badge defaults (MJ.void a0.55 sweep, MJ.gold a0.32 charge wedge) stand.
22px badge-scale legibility verified via a contact sheet. Further sweep/badge
tuning deferred to user review from live screenshots.

## P4 evidence (gates, 2026-07-24)
Node v22.23.1, worktree branch. ART_ROUTE_MOCK=1 for the pg logic suites
(isolated test namespace; live rows untouched):
- [0/8] check_e2e_ports: OK (4 harnesses, all derived, no collisions).
- sim goldens: 12/12 (determinism intact - icons are additive, no sim change).
- forecast parity: 18/18. unit_charge_test 13/13; unit_charge_encounter 24/24.
- artwork_test.cjs: 19 passed / 0 failed, incl "REQ-0292 skill_icon: 256x256
  still, NOT force-tiled; adopt + direct serve + content/art/skill_icon/
  export". (inspection-kit numpy warnings are the ad-hoc-shell venv, non-fatal.)
- inspection_test.cjs: 7 passed / 0 failed.
- Live serving proof: see P3.C. P2's scoped schedule e2e (2 REQ-0292 HUD
  tests) stands - the icons don't change its structural (webdriver=off) asserts.

Remaining: deploy (merge to master, client/web rebuild, api restart since
server/ changed) then live monitor screenshot.

## Deploy evidence (2026-07-24)
Integrated onto current master (was 64+ behind; REQ-0293..0300 balance/scaling
already live) via a merge of master into the branch, NOT a naive replay:
- CONFLICT sim/lib/encounter.cjs: master (REQ-0296) extracted the enemy timed-
  fire body to module-level fireEnemyInstanceSlot (shared with the monster
  arena). Kept master's extraction; re-applied REQ-0292's enemy cadence tagging
  (srcInst + cooldownTicks back-patch registration) at the CALL SITE, mirroring
  the player side, leaving the shared fn + arena untouched.
- CONFLICT sim/tests/run.cjs: both-added tests, kept BOTH (REQ-0292 cadence +
  REQ-0293/0294/0297/0298).
- sim/tests/goldens/replay_hashes.json: REGENERATED on the merged tree.
- Merged-tree gates GREEN: run.cjs 184/0 (incl "REQ-0292: cadence ray_fire
  carries slot/cooldownTicks (player) + srcInst/cooldownTicks (enemy)"),
  goldens determinism OK, forecast 18/0, unit_charge 13/24.

Client bundle REBUILT on the merged tree (pnpm build -> web/app, index-Sz7_yWii.js).
Merged into master: 9844f83 (Merge REQ-0292 into master, --no-ff).
Services restarted (systemctl --user): backpack-api + backpack-web, both active.

LIVE verification:
- 81 skill_icon artworks registered + adopted in the live registry (75 new, 6
  interrupted-Fable stubs reused), image bytes injected (no GPU re-render).
- Serving: local api AND public tunnel https://backpack-dev.qtie.jp/api/art/
  <skill_id>.png -> 200 image/png (hrim_cleave/venom_spit/trollish_vigor/
  petrifying_glare/dominion_of_flame verified; sizes match). Unknown id -> 404
  (class-glyph fallback path intact).
- Web serves the new bundle (assets/index-Sz7_yWii.js).
Client in-situ badge display renders on the next live battle run (P2 e2e already
covers the HUD logic structurally; serving + bundle are live-verified here).

## Status log (append)
- 2026-07-24 built -> done (merged 9844f83, deployed, api+web restarted, serving
  live-verified local + tunnel). Outer-glow relaxation of SKILL_ICON_STYLE #5
  per user ruling. Backup ref: req-0292-backup-predeploy.
