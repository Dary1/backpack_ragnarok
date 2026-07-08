# REQ-0087 — Expeditions never depart: the rooms LIST endpoint never settles a room

- **Status**: BUILT (2026-07-07) — implemented on branch
  `req-0087-expedition-never-departs` (worktree
  `~/backpack_ragnarok_worktrees/req-0087-expedition-never-departs`, off
  `master` @ `d9723c8`). Gates green (§5). **MERGED AND DEPLOYED**
  (2026-07-07, user go-ahead given in-session): `master` fast-forwarded
  to `8eb3818` then to the follow-up `a4c11c0` (§8), `backpack-api`
  restarted both times, live health/behavior re-verified after each
  restart. Scope class: **bugfix, server-only** (no schema/DTO change, no
  client change).
- Origin: direct user report via this Cowork session, verbatim below.

## Session note (honesty per this project's convention)

This session initially concluded (from a raw TCP probe against
`192.168.0.6:22` that returned no SSH banner) that it had no LAN/SSH
reach to `llmlocal`, and was about to write this REQ as investigation-
only, queued for a future server-side session — the same posture
REQ-0085/0086's own initial drafts recorded before they, too, discovered
that assumption was wrong. Rereading REQ-0086's own outcome note (which
explicitly flagged its initial "no SSH reach" belief as WRONG, corrected
at the user's prompting) prompted a real retry with the actual `ssh`
client and the documented key — which connected immediately. All of
§2–§5 below (recon, root cause, fix, gates, commit) was done for real
over SSH in the worktree above, not drafted blind.

## User report (verbatim, 2026-07-07, via backpack-dev.qtie.jp/app/#/schedule)

> Expeditionsで、新規にExpeditionを作り、Slot1/preset11/12/13を入れて、
> エラーにならないのに、出発してくれません。

(Creating a new Expedition and filling it — Slot1 / Preset 11 / Preset 12 /
Preset 13 — produces no error, but the expedition never departs.)

## 1. Repro

The live dev site already had a room reproducing this exactly: room
`room_f2decb2e04eb374e` ("Niflheim Depths", owner `dev`), created
`2026-07-07T02:31:28Z`. Its slots (read via the API, and independently
via a read-only `storage.readProfile()`-style inspection) were:

```json
"slots": [ { "presetIndex": 0 }, { "presetIndex": 10 }, { "presetIndex": 11 }, { "presetIndex": 12 } ],
"status": "open", "lastRunId": null, "updatedAt": "2026-07-07T02:31:37Z"
```

All 4 slots hold distinct, deployable (backpack-equipped) presets — the
room is genuinely, validly full — yet `status` stayed `"open"` (displayed
"Idle" in the UI) through 25+ minutes and dozens of the client's own list
polls, with `lastRunId` still `null` (no run was ever even attempted) and
zero console/network errors at any point. Every one of the four
`PUT /api/schedule/rooms/:id/slots/:i` calls that filled it had already
returned `200 {ok:true}`, so there was nothing left for the client to
report as a failure.

A fresh room built the same way during this session's own browser repro
reproduced the identical symptom (filled 4/4, stayed `open`). Separately,
this session also hit a transient `400 presetIndex out of range for this
player` while re-testing slot assignment — traced to
`server/services/units.cjs:134`'s `presetIndex >= profileCanvas.presets
.store.length` check, which is correct as written; a direct read of the
live `dev` profile showed `presets.store.length === 10` at that moment,
i.e. the shared `dev` account's preset count was itself in flux from
other concurrent work on this box (`git worktree list` shows 15+ active
REQ worktrees) during this investigation. Noted for awareness, not
treated as part of this REQ — it is a data-timing artifact of a shared
live dev account, not a code defect.

## 2. Root cause

`server/routes/schedule.cjs`'s `GET /api/schedule/rooms` (the rooms
**list** route) responded with:

```js
sendJSON(res, 200, { ok: true, rooms: schedule.listOwnRooms(callerId) });
```

`listOwnRooms` (`server/services/rooms.cjs`) is a bare storage filter —
`storage.listRooms().filter(r => r.ownerId === callerId)` — with **no**
call into `settleRoomIfDue`. `settleRoomIfDue`/`maybeAutoStartNextRun`
(`server/services/runs.cjs`) are the ONLY place a room's `open → active`
transition (or a cooldown-elapsed restart, golden i) actually happens.
Every OTHER room-touching route (single-room `GET .../rooms/:id`,
`DELETE`, `PUT .../slots/:i`, `PUT .../swap`, `GET .../run`) already
calls `settleRoomIfDue` first, via the route file's own
`loadAndSettleRoom()` helper — whose comment literally says "called by
every room-touching handler before anything else." The list route was
the one handler that comment didn't actually cover.

This matters because `client/src/schedule/SchedulePage.tsx` — the real,
shipped Rooms view — polls **only** `fetchRooms()` (`GET
/api/schedule/rooms`, every `ROOMS_POLL_MS` = 4000ms) in its refresh
loop. It never calls `fetchRoom(id)` (the single-room GET) as part of
normal rendering. So the one route real user traffic actually depends on
for "did my expedition start yet?" was exactly the one route that never
checked.

Sequencing detail: `loadAndSettleRoom` DOES run at the top of the 4th
(last) `PUT .../slots/:i` call too — but at that moment the slot being
filled right now is still `null`, so `maybeAutoStartNextRun`'s own guard
(`room.slots.some(s => s.presetIndex == null)`) correctly declines to
start. `assignSlot` then fills the 4th slot and returns — without itself
calling settle/start. Nothing afterward ever asks the list route to look
again in a settle-aware way, so a room can complete its roster and then
simply never be examined by anything that would flip it to `active`.

**Why REQ-0045 (c)'s own auto-start regression test didn't catch this**:
that test (`server/tests/api_test.cjs`, "four mutually-unique presets...
auto-starts") fills all 4 slots, then asserts `status==='active'` via
`GET /api/schedule/rooms/**:id**` — the single-room route, which DOES
settle. Every other schedule test asserting an auto-start reads the room
back the same way. The gap was never exercised by anything in the suite
until this REQ's new test (§4) deliberately reads back through the LIST
route instead, matching what the live client actually does.

## 3. Fix

`server/routes/schedule.cjs`, `GET /api/schedule/rooms`:

```js
const { itemDefsById } = schedule.getScheduleContent();
const canvas = loadOwnCanvas();
const rooms = schedule.listOwnRooms(callerId)
  .map((room) => schedule.settleRoomIfDue(room, canvas, itemDefsById));
sendJSON(res, 200, { ok: true, rooms });
```

Mirrors `loadAndSettleRoom`'s existing pattern exactly (same canvas load,
same `itemDefsById`, same facade call), just applied to every room in the
list instead of one room by id. `settleRoomIfDue` is a no-op passthrough
for any room that isn't due (canceled, mid-run with an unelapsed clock,
still cooling down, or not yet fully filled) — confirmed by inspection,
so this stays cheap on a 4-second poll cadence and doesn't change
behavior for the ~163 already-canceled rooms sitting in this same dev
account's list. No client change needed or made: the client already
renders whatever `status` the list gives it correctly (it just never
used to receive `"active"` promptly).

## 4. Regression test

New test in `server/tests/api_test.cjs`, right after REQ-0045 (c)'s own
auto-start test: fills all 4 slots via `PUT`, then asks **only** the list
endpoint (`GET /api/schedule/rooms`, never the single-room GET) and
asserts the returned room's `status === 'active'`.

Verified both ways before finalizing:
- Against the OLD route (`git stash` on just the route file, test kept):
  **FAILS** — `'open' !== 'active'` — reproducing the live bug exactly.
- Against the fixed route: **PASSES**.

## 5. Gates

| gate | result |
|---|---|
| `node mock-src/tests/run.cjs` (via `test:quick`) | 97 / 0 (unaffected — no engine touch) |
| `node sim/tests/run.cjs` (via `test:quick`) | 63 / 0 (unaffected — no sim touch) |
| sim replay goldens (determinism contract) | clean |
| `tsc -p tsconfig.server.json` (checkJs) | clean |
| engine type-surface drift check | clean |
| `node server/tests/api_test.cjs`, files backend | **137 / 0** (was 135; +2 new, incl. §8's follow-up) |
| `node server/tests/api_test.cjs`, `STORAGE_BACKEND=pg` | **137 / 0** (ran manually, both backends identical) |

**Not run**: client typecheck/build (no client file touched) and full
Playwright e2e (needs the live `backpack-api`/`backpack-web` pair; this
worktree's server change was never deployed there, and per PROJECT.md's
"coordinate before any edit, merge, or restart" rule for live services,
this session did not stand up or redirect them — same posture REQ-0085/
0086 recorded for their own gate runs). The HTTP-contract-level server
test (§4) already exercises the exact route/service/storage path a
browser would hit, in both storage backends, which is why this is judged
sufficient for a server-only fix of this shape.

## 6. Deploy log (done, with a real incident in the middle)

1. Merged `req-0087-expedition-never-departs` into `master` locally
   (worktrees share one repo — `git merge --ff-only` from
   `~/backpack_ragnarok`, no separate push needed) and restarted
   `backpack-api`. Health check green, `/app/` and `/api/health` both
   200.
2. **Live re-verification immediately surfaced a real regression in this
   very fix** — see §8. `GET /api/schedule/rooms` started returning
   `400 {"error":"slot 1 preset snapshot not found"}` for the `dev`
   account: one room's now-stale `presetIndex` (the shared dev account's
   own preset count had changed from other concurrent work on this box
   while this REQ was in flight) made `settleRoomIfDue` throw inside the
   new `.map()`, and that exception escaped to 400 the ENTIRE list
   instead of just that one room.
3. Root-caused, fixed, tested (new regression test, verified red→green,
   confirmed the failure no longer cascades into unrelated tests), and
   redeployed the same way (commit `a4c11c0`, second `backpack-api`
   restart). Re-verified live: list endpoint back to 200, a fresh
   test room's partial-fill state renders correctly, canceled cleanly.
4. The room(s) that were stuck before this REQ (`room_f2decb2e04eb374e`
   and possibly others accumulated silently over the preceding days)
   were removed from the account by unrelated concurrent activity on
   this shared box before a final live A/B could be captured on that
   *exact* room — the fix's correctness rests on the deterministic
   server-side regression tests (§4, §8) plus the live 400→200 recovery
   observed directly, not on re-observing that one specific room. Any
   room in this shape going forward self-heals on its next list poll,
   no manual repair needed.

## 8. Follow-up fix: one room's settle failure must not 400 the whole list

Found by this session's OWN live re-verification right after step 1 of
§6 — see §6.2-3 for the incident narrative. Root cause: `settleRoomIfDue`
can legitimately throw for a single room (`startRun` → `buildUnitSnapshots`
→ `presetCanvasOf` finds nothing at a `presetIndex` that was valid when
assigned but points past the CURRENT `presets.store.length` — e.g. a
preset deleted, or in this box's case, a shared dev account whose preset
count changed from unrelated concurrent work between slot-assignment
time and the next list poll). The first version of this REQ's fix let
that exception escape `Array.prototype.map`, so the route's outer
`try/catch` turned ONE stale room into a 400 for the caller's entire
`GET /api/schedule/rooms` response.

**Fix**: wrap each room's `settleRoomIfDue` call in its own `try/catch`
inside the `.map()` — a room that fails to settle is returned AS-IS
(unsettled) rather than failing the whole list. Matches the existing
best-effort convention `applyPendingSwapIfAny` already uses elsewhere in
this same file.

**Regression test**: fills a room, then truncates that SAME player's
`presets.store` out from under two of its already-assigned slots
(simulating a preset deleted post-deployment), creates a second healthy
room, and asserts the list endpoint still returns 200 with the healthy
room intact and unaffected. Verified failing (`400`) against the
pre-hotfix `.map()`, passing after; the fixture's corrupt/restore steps
are wrapped in `try/finally` so a failing assertion here can never poison
`scheduleP1`'s canvas for every test that runs afterward in the same
process (confirmed: without the hotfix, exactly 1 test fails, not 9).

Commit `a4c11c0`, same branch. Included in the gate numbers in §5 and the
deploy log in §6.

## 9. Related work on this box (context, not overlapping)

- **REQ-0085** (now merged to `master`, per this session's own log check)
  fixed an unrelated crash (`mock-src/engine.js`'s `switchPreset`
  throwing on a corrupted null preset-store slot, in the Backpacks
  preset-tab UI). Different file, different code path — never touched
  `server/services/{units,runs}.cjs` or `routes/schedule.cjs`.
- **REQ-0086** (now merged to `master`) relocated the Warehouse tab to
  its own nav entry — client-only, never touched the Rooms/slots/run
  code this REQ changes.
- The transient `presetIndex out of range` / preset-count churn noted in
  §1 and hit again live in §6/§8 is incidental cross-session activity on
  the shared `dev` account (this box has 15+ active REQ worktrees per
  `git worktree list`, several landing during this REQ's own session) —
  not a symptom of this REQ's bug or fix, though §8 exists precisely
  because that churn is real and this route now has to tolerate it.
