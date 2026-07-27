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

## Gate results (2026-07-27)

**Branch** `req-0308-forecast-slot-pressure-draw-rehome`, off green `master` @`0918773` (REQ-0307 done).
Commits: `48ab177` reserve · `a67dddd` spec + reserved->todo · `74860da` the excision
(30 files, +23 / **-2967**) · `82ce935` REQ-0210 reserved->done · `e5dc23f` web/app rebuild.

**Every stage of `bash tools/ci.sh` is green except a pre-existing e2e parallel-load flake
(evidence below).** Run with `DATABASE_URL` from `server/.env`, `STORAGE_BACKEND` unset, nothing
skipped.

- `[1/7] sim run.cjs` **184 passed / 0 failed** with the parity test removed.
- `[2/7] sim replay goldens` **byte-identical (12 cases)** -- as required: the forecast was a
  read-only serving-layer view and never fed the sim, so its removal must not (and does not) move
  the REQ-0301 determinism fixture.
- `[2.6/7]` (forecast<->sim ray parity) **no longer exists** -- deleted with the feature. ci.sh is
  one stage shorter.
- `[2.5] s4`, `[2.65] dungeon_roll`, `[2.95] balance sim`, `[3] mock-src`, `[3.5] server+shared
  typecheck (checkJs)`, `[3.6] engine type-surface drift`, all content gates: green.
- `[4] api_test (files)` + `[5] api_test (pg)`: green on BOTH backends. `[5.37] schedule_serving`
  green -- `skillNamesById` survives the excision (it is still read by `server/lib/content.cjs` for
  dex cards; only the comment naming its consumer was stale).
- `[6] client tsc -b + vite build`: green, **no unused-import or dead-export complaint** -- the
  excision left no dangling reference. `[6.1]` Supabase-env tripwire green.
- `[6.5] admin e2e trio` (artadmin / artinspect / contentadmin) + `[6.6] registry-first serving
  e2e`: green.
- `[7/7] scoped hermetic e2e` (REQ-0308 decade, ports 3080/3081/3082 = 5000+3080+idx): **194-195
  passed / 1 skipped (pre-existing) / 1-2 failed**, the failures being the flake below. 197 total
  vs master's 204 -- exactly the 7 `forecast.spec.ts` tests this REQ deletes.

**The `[7]` reds are a PRE-EXISTING harness flake, PROVEN on master, not a REQ-0308 regression.**
This was measured rather than assumed:

| run | tree | result | failed |
|---|---|---|---|
| 1 | REQ-0308 | 195 pass / 1 skip / 1 fail | `bp-rotate.spec.ts:88` |
| 2 | REQ-0308 | 195 pass / 1 skip / 1 fail | `workshop.spec.ts:121` |
| 3 | REQ-0308 | 194 pass / 1 skip / 2 fail | `bp-rotate.spec.ts:88` + `bp-transfer.spec.ts:76` |
| 4 | **master @`0918773`, unmodified** | **202 pass / 1 skip / 1 fail** | **`workshop.spec.ts:121`** |

Run 4 is the decisive one: a clean master worktree (`tmp-r308-masterbase`, since removed), same
box, same 4-worker scoped harness, same ports -- and it fails the SAME test run 2 failed. The
failure set is non-deterministic across runs and moves between unrelated specs (canvas drag-drop,
gacha), which is the signature of load, not of a code change. Serial re-runs on the REQ-0308 tree
pass every one of them: `bp-rotate` + `bp-transfer` **10/10**, `workshop` **11/11** at
`E2E_PARALLEL=1`. `playwright.config.ts` sets `retries: 0`, so a single slow worker is a red.

None of the flaking specs touches the removed code. The one plausible coupling was checked and
ruled out: `<ForecastOverlay />` used to render inside `.board-gridbox`, next to the canvas board
the drag specs drive -- but it was `pointer-events:none` and returned null while off, run 2's
failure was a non-canvas spec, and master flakes identically without the change.

**This flake class is already owned by REQ-0222 (`e2e-harness-load-resilience`, in `todo/`)**,
which measured the same family in 2026-07 and prescribes the fix (threaded static server /
`domcontentloaded` + readiness probe / load-aware nav timeout, across ALL harnesses). Per REQ-0159
this is NOT being memorised as an accounted red: it is a stale/fragile GATE with an open REQ, and
the fix belongs there, not here. No REQ-0308 change can move it.

## Outcome
Code-complete, self-green, and green on every deterministic gate. `todo -> built`; not yet merged
or deployed.
