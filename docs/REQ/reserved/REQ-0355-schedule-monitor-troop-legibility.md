# REQ-0355 - Schedule Monitor: troop battles are illegible (4 user-reported defects)

- **State**: todo (user-reported 2026-08-01, fix requested directly; that request IS the ratification)
- **Program**: co-op Troop play (follows REQ-0325/0337)
- **Reported against**: https://backpack-dev.qtie.jp/app/#/schedule, a live 4-seat troop
  (dev + 3 fleet bots), runs auto-restarting every ~15min, every one
  `result:"wipe"`, `durationSecs:300`, `simDurationSecs:~16`.

## The four reports (user, 2026-08-01, verbatim intent)

1. Only the VIEWER's own squad canvas POs render on the Monitor; the other three
   seats' squads are invisible.
2. The event log is unreadable - lines like `bp_starter_guard 0`.
3. HP never visibly decreases on either side; the battle appears to never end.
4. At 5:00 the run force-wipes with no attack ever having shown damage.

## Diagnosis (from live run docs, e.g. run_654b7ad7f59a300a)

The SIM is healthy: direct hits on `bp_starter_guard` are floored to ~0 by
damage_reduction (tank works as authored), while Burn status ticks kill all four
squads by sim t=16s; `result:"wipe"` is legitimate. REQ-0240 pacing stretches the
1153-event log to the 300s clamp -> the "5:00 force wipe". Everything the user
saw is a PRESENTATION gap:

- (1) `Monitor.tsx` composes seat visuals from the viewer's OWN squad store
  (`snapshot.state.presets`); a seat held by another owner has no canvas
  client-side (documented REQ-0337 limitation). The run doc stores no snapshot
  visuals either.
- (3a) Player dock HP is a documented M1 fallback: full bars until `run_end`,
  because player-target hit events carry only a CONTENT id (`bp_starter_guard`
  x3 seats = unattributable).
- (3b) Enemy HP never updates in `reduceRunRoster`: it requires
  `ev.field==='enemy'` but `ray_hit` events carry NO `field`, and it keys the
  roster map by def id (`frost_giant`) while `dst` is the instance label
  (`frost_giant#1`). Both conditions fail on every hit.
- (2) `feedCopy.ts` renders no row at all for `apply_status`/`status_tick` (the
  actual killer), prints raw ids for player BPs (`enemyName()` falls through to
  the id), prints `src` as `?` (ray_hit has no src), and prints the ~220
  zero-amount tank hits as `... 0` spam.
- (4) = (3) seen to its end: the deaths happen in Burn ticks the UI never
  surfaced, so the wipe at the 300s clamp looks causeless. Pacing itself is
  ratified REQ-0240 behaviour and is NOT changed here.

## Fix design

**A. sim (additive event attribution; goldens REBASELINED - precedent REQ-0292 P1)**
Player-field target events gain additive identity fields so a viewer can
attribute per-seat damage mid-run:
- `ray_hit`, `ray_aoe`/`ray_hit_all` `hits[]` entries, `apply_status`,
  `status_tick` gain `slot` (0..3 formation index) and `bpIdx` (index of the BP
  within its compiled squad) when the target is a player BP.
- No existing field changes value; enemy-target events unchanged (their `dst`
  instance label is already unique). `sim/tests/goldens.cjs gen` rebaselines.

**B. server serving layer (no stored-event change)**
- `pacing.enrichDecoration`: track the walking ray context (`ray_fire.field`)
  across the FULL event walk and stamp `field` onto served `ray_hit` /
  `ray_aoe` / `ray_hit_all` copies (stored events stay byte-identical).
- `pacing.buildRoster`: slot bps gain `bpIdx`; each slot gains `canvas` - the
  lean frozen squad snapshot (`{bps,pos,sis}`) captured at `startRun` - so ANY
  viewer can draw ALL four seats' BPs/POs. Solo rooms serve it too (harmless;
  same shape).

**C. client**
- `Monitor.tsx`: mount squad visuals from `run.roster.slots[].canvas` when
  present (all seats, any owner); fall back to the REQ-0337 own-store path for
  legacy runs.
- `runRoster.ts reduceRunRoster`: enemies keyed by `instanceId` (def-id
  fallback); enemy updates keyed off served `field`/instance match instead of
  the never-true `ev.field==='enemy'` gate; player per-slot HP pools now drain
  mid-run from `slot`/`bpIdx`-attributed `ray_hit`/`status_tick`/aoe `hits[]`
  `hp_after`; `run_end.troop_bp_hp` stays the final authority.
- `feedCopy.ts`: rows for `apply_status` + `status_tick`; name resolution for
  player BPs (item def names, ja-aware) and enemies (roster, instance label
  aware); zero-amount hits suppressed; tone from served `field`.
- i18n en+ja for every new string.

## Gates
- `node sim/tests/run.cjs` + every sim test green; goldens regenerated
  deliberately in their own commit.
- `node server/tests/api_test.cjs`, `node server/tests/pacing_test.cjs` green
  (+ new pacing cases: field stamping, slot attribution passthrough, roster
  canvas presence).
- `cd client && pnpm exec tsc -b && pnpm build && pnpm exec oxlint` green.
- Verification vs a REAL stored troop run doc: reduce the served events and
  assert per-slot HP reaches 0 before run_end and enemy HP decreases.

## Out of scope
- Combat balance (tank 0-damage hits, Burn lethality) - authored content.
- REQ-0240 pacing clamp (300s troop replays) - ratified presentation design.
- Mid-run status chips on player squads (stage), KO stamp timing.
