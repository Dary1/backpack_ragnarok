# REQ-0357 - Wipe-streak circuit breaker: a pathological room stops itself

- **State**: todo (user-requested 2026-08-01: "wiping is fine, but a run that
  never deals progress is EVIDENCE of a problem -- surface it as a failure so
  the session can self-correct", point 4 of the schedule-monitor report)
- **Origin**: live troop room_d8005555cdca7677 wiped at 0% progress every ~15
  minutes for hours (auto-restart + wipe cooldown), silently burning cycles.
  Level-down on wipe (golden i) is the existing self-correction, but it floors
  at LEVEL_MIN -- at the floor a hopeless matchup loops forever with no signal.

## Design

**Detection (settleRun).** A settled run that ended `result:'wipe'` with NO
progress (`!(finalProgressPct > 0)`) increments `room.wipeStreak`; any other
outcome resets it to 0. Persisted on the room doc (additive field; absent ==
0 on legacy rooms).

**Breaker (maybeAutoStartNextRun).** When the next run would auto-start with
`wipeStreak >= WIPE_STREAK_LIMIT (3)`:
- co-op Troop: `disbandTroopRoom(room, 'wipe_streak')` -- the existing
  all-or-nothing teardown: seats returned (uids un-gated, market unfrozen,
  fleet bots freed to re-join something winnable), state 'canceled', and the
  REQ-0327 `troop_disbanded` notification lands in EVERY member's feed with
  `payload.reason:'wipe_streak'`.
- solo room: status 'canceled' + a discrete `room.haltEvent {roomId,
  reason:'wipe_streak', streak, haltedAt}` + a new `room_halted` notification
  to the owner (same feed machinery, new kind).

The room stops occupying its lane and the owner is TOLD why -- three
consecutive zero-progress wipes is the observable definition of "this
composition cannot beat this dungeon at any allowed level".

**Client.** The REQ-0327 toast surfaces both shapes: `troop_disbanded` with
reason `wipe_streak` gets its own copy; new kind `room_halted` gets its own
copy. en+ja.

**Not in scope**: any balance change; a CI gate red on live-data conditions
(a standing-red required gate violates the REQ-0159 "CI GREEN is literal"
rule -- the runtime breaker + notification IS the test that fails loudly,
at the moment the anomaly exists, visible to the session that caused it).

## Gates
- server/tests/api/schedule.cjs new cases: troop 3x zero-wipe -> disband with
  reason wipe_streak + notifications; solo 3x -> canceled + haltEvent +
  room_halted notification; a progress>0 wipe / victory RESETS the streak.
- Full ci.sh green; client tsc/build/oxlint green.
