# REQ-0308 - Retire the Ray Forecast feature (REQ-0057) entirely

**Status:** todo (RATIFIED by the user in chat, 2026-07-27).
**Retires:** REQ-0057 (Ray Forecast Overlay) in full -- both halves.
**Closes:** REQ-0210 (forecast-pressure-perf, reserved) -- perf work on a feature being deleted.
**Origin:** follow-up flagged in REQ-0304's deploy record ("a post-entry re-homing against the DRAWN
dungeon is a possible follow-up"). Investigation turned that follow-up into a retirement; see below.

## The decision (user, verbatim intent)
"プレイヤーは一度出撃をしたらその後一切意思決定なく、そのままダンジョン攻略がリピートされます。よって、変更する
ことはできないし、意味もありません。敵に応じてフォーメーションを決める必要はどこにもありません。他のSquadを見て
フォーメーションを決める。つまり、Allyとのシナジーだけで最初に意思決定するだけです。それは元々そうでした。もし、
何かそこにテストが働いていたなら、私の意図することではありません。"

i.e. the game has exactly ONE decision point -- the pre-sortie muster -- and the only input to it is
ALLY SYNERGY BETWEEN SQUADS. After launch the run repeats with no player input, so there is nothing to
adapt and nothing to adapt it with. Deciding a formation from the ENEMY's attack pattern is not a
decision this game has, and never was. REQ-0057 was built for that non-existent decision.

## Why this is a retirement, not a re-home
REQ-0304 removed the pre-entry dungeon picker (the server now RANDOM-DRAWS the dungeon from
`{ levelMin <= attackLv }`), which orphaned `SlotPressureSummary` -- it needs a specific `dungeonId`
that no longer exists before entry. The obvious reading was "re-home it": either post-entry against the
drawn dungeon, or pre-entry as an expectation marginalised over the eligible draw set.

Both readings are wrong, and the random draw is not the reason. The user's ruling is that
enemy-conditioned placement is not a mechanic:
- **Post-entry** is inert by construction -- formation and squads are already committed and the run
  takes no further input, so the number cannot change any action.
- **Pre-entry expectation** would be actionable, but it would be actionable on an axis the game does
  not have. It would re-introduce enemy-driven formation choice as a mechanic, which is the opposite
  of the ruling.
- The **canvas ray-forecast overlay** -- REQ-0057's other, still-live half -- rests on the SAME premise
  one level down (place items on the backpack canvas according to where enemy rays rake hardest). The
  ruling retires it for the same reason. Its e2e coverage (`forecast.spec.ts:41-181`) is coverage OF
  the wrong premise, which is exactly what the user's last sentence disclaims.

So the whole feature goes. What survives is the muster itself: squads, `useSquadConflicts`, the troop
slots and shelf, and the formation select -- all of which are ally-side.

## Scope (the full REQ-0057 surface, code-verified)
Nothing outside the feature imports `shared/forecast.mjs`: the only importers are the feature's own
client modules, `server/lib/forecast.cjs`, and `sim/tests/forecast_parity.cjs`. The surface is
self-contained, so this is a clean excision, not an unpicking.

**Delete outright**
- `client/src/forecast/` -- `ForecastOverlay.tsx`, `ForecastPanel.tsx`, `SlotPressureSummary.tsx`,
  `forecastState.ts`, `pressure.ts`
- `client/src/styles/forecast.css` (301 lines, incl. the 11 `slot-pressure` rules)
- `client/e2e/forecast.spec.ts`
- `server/lib/forecast.cjs`
- `shared/forecast.mjs`, `shared/forecast.d.mts`
- `sim/tests/forecast_parity.cjs`

**Edit**
- `client/src/App.tsx` -- drop the two imports and the `<ForecastOverlay />` / `<ForecastPanel />` mounts
- `client/src/index.css` -- drop `@import './styles/forecast.css';`
- `client/src/i18n/canvas.ts` -- drop the 13 `forecast.*` keys, en + ja
- `client/src/api/schedule.ts` -- drop `fetchForecast`; `client/src/api.ts` -- drop the two DTO re-exports
- `shared/dto.ts` -- drop `ApiForecastProfile`, `ApiForecastPayload`
- `server/routes/public.cjs` -- drop the `GET /api/schedule/forecast` handler and the `getForecast` require
- `server/api.cjs` -- drop the route's line from the endpoint map
- `sim/tests/run.cjs` -- drop the parity-contract cross-reference comment
- `tools/ci.sh` -- drop step `[2.6/7] forecast<->sim ray parity` and renumber if the script requires it
- `shared/README.md` -- drop the `forecast.mjs` entry

**Comment-only touch-ups** (these mention the parity contract that is going away; no behaviour change):
`sim/dungeon_roll.cjs`, `shared/content_validate.cjs`, `server/services/core.cjs`,
`server/routes/content.cjs`, `server/tests/api/harness.cjs`, `server/tests/schedule_serving_test.cjs`,
`sim/tests/req0207_wildlands_test.cjs`, `sim/tests/req0219_deepstone_test.cjs`,
`client/src/canvas/CanvasSelectionOverlay.tsx`, `client/src/sortie/LevelStepper.tsx`

**Explicitly NOT touched** -- `client/src/ragnarok/*` and `client/src/i18n/ragnarok.ts` also contain the
word "forecast", but that is REQ-0067's eternal-order score projection, an unrelated feature. Leave it.

## Decisions pinned
- **`shared/forecast.mjs` goes too.** Its only remaining justification was the parity contract with
  sim's `walkRay`, and that contract exists only to keep the forecast honest. With no forecast there is
  no second implementation to keep in sync; sim's walker stays the single source of truth. Deleting the
  copy REMOVES a divergence risk rather than adding one.
- **The API route is deleted, not deprecated.** `GET /api/schedule/forecast` is no-auth and read-only
  with exactly one consumer, which this REQ deletes. No migration or compat window is owed.
- **REQ-0210 is closed as obsolete** by this REQ; its reserved number is burned, per the numbering
  policy (gaps are normal, numbers are never reused).
- **REQ-0057 stays in `done/`.** `done/` is terminal history and is not rewritten; this REQ is the
  record of its retirement.
- No new harness or port is introduced -- the 5000+3080+idx rule is N/A. `ci.sh` LOSES a step.

## Acceptance
- No file, symbol, route, DTO, i18n key or CSS rule belonging to the ray forecast remains outside
  `docs/` (`git grep -i forecast` returns only `docs/`, the ragnarok/REQ-0067 projection, and any
  retirement notes this REQ adds).
- `client tsc -b` + `vite build` green with no unused-import or dead-export complaint.
- `sim/tests/run.cjs` green with the parity test gone; goldens **byte-identical** (the forecast is a
  read-only serving-layer view and never fed the sim, so removing it must not move the fixture).
- `api_test` green on BOTH backends (files + pg); the forecast route 404s.
- Scoped hermetic e2e green with `forecast.spec.ts` gone and no other spec depending on it.
- `bash tools/ci.sh` prints literal `CI GREEN`.
