# REQ-0036 — Dungeon Schedule (design REQ; user golden a–r)

- **Status**: **P1 COMPLETE** (A+B+C all done 2026-07-05; P2/P3 remain future work) —
  (design COMPLETE: combat spec v0.3
  RATIFIED "all green" 2026-07-05; mode tags battle/detection/unlock = user design;
  VX-1/2/4 schema blessings included in the go). P1 split: A=sim engine+schemas+
  starter content · B=schedule service (rooms self-only, runs, warehouse 200/7d,
  cooldowns) · C=client (schedule page, monitor, warehouse tab; deployment gated by
  isUnitIndependent). Design-phase notes below are historical.
  **P1-A DONE** (2026-07-05): `sim/combat.cjs` + vocab v5 + starter content
  `batch-002-dungeon-pilot`, sim tests 41/41.
  **P1-B DONE** (2026-07-05): `server/schedule.cjs` + 8 HTTP routes in `server/api.cjs`
  + migration `002_schedule.sql` — room CRUD, deploy gate (golden d), run lifecycle
  (instant-sim + wall-clock-paced replay, golden j runs-on-copies), warehouse (golden
  e/f, first-fit claim, no reverse path per golden r generalized), cooldown/wipe/swap/
  cancel (golden g/i/l). 69 server tests (was 46), green in files+pg mode. golden r
  (schedule-scoped trade) remains P3, not built.
  **P1-C DONE** (2026-07-05): client implementation — Schedule page (`#/schedule`,
  `client/src/schedule/`) with Rooms + Warehouse tabs, replacing the nav placeholder;
  room cards (idle/cooldown/running/cancel-pending/canceled status, countdown, cancel),
  create-room form (dungeon/formation from new `GET /api/schedule/dungeons`, level,
  visibility fixed "Self only", cancel-policy), 4-slot assignment panel (assign/swap,
  409 deploy-gate errors mapped to friendly i18n'd text). Monitor (golden k): small
  always-visible summary (progress %, encounter, telegraph) + expandable full view —
  two persistent `A1:Z18` grids rendered by ONE long-lived PixiJS Application (created
  once on first expand, never torn down on collapse/re-poll), animating
  `ray_fire`/`ray_step`/`ray_bounce`/`ray_hit`/`ray_hit_all`/`reflect_damage` events
  polled from `GET .../run` every ~2s (diffed against last-rendered event index, not
  replayed from scratch); masked "?" entities rendered as the server's literal mask
  until a real `ray_hit` reveals them. Warehouse tab (golden f) embedded in the
  Schedule screen: item list, 200-cap indicator, expiry countdowns, claim button
  moving an item into the player's canvas inventory (toast + inventory refresh).
  Server additions: `GET /api/schedule/dungeons` (no auth, dungeon+formation list) and
  a dev-only `POST /api/schedule/rooms/:id/dev/backdate` (403 for any real guest
  token; used only by E2E to force a run's clock into the past without waiting real
  time). New E2E `client/e2e/schedule.spec.ts` covers create room, slot assignment,
  monitor polling, run settlement, warehouse rewards + claim, deploy-gate 409 across
  rooms, and both cancel policies. Full gate green: sim 41/41 (untouched), server
  tests 72/72 (files + pg, +3 for the new route/hook), `tsc -b` 0 errors, client build
  OK (deployed to `web/app/`), sprite check 21/21, full Playwright suite 64/64,
  production `https://backpack-dev.qtie.jp/app/` -> 200 and
  `/api/schedule/dungeons` verified live. A real client bug was caught by E2E and
  fixed: `RoomCard`'s status derivation checked `active` before `cancelRequested`, so
  a deferred-cancel room showed "Running" instead of "cancel pending" — reordered.
  Commits (remote box `~/backpack_ragnarok`, branch `master`): `ac80c37` (a+b+c:
  schedule page/slots/monitor/warehouse), `afdbac8` (d: server helper routes),
  `2a6978d` (e: E2E + deploy + README correction). Deferred/out-of-scope (correctly,
  per P1 solo phasing): multi-player joins, trade, visibility beyond "Self only", real
  enemy art (simple footprint blobs used instead), richer ray VFX. **REQ-0036 P1 (A+B+C)
  is now feature-complete for the solo scope; P2 (multi-player rooms, visibility,
  swap notifications, cancellation-policy nuance) and P3 (trade, groups, spectate
  polish) remain future work per the Phasing proposal below.**
  (was) design phase. **Combat spec v0.2** integrates the user's
  RATIFIED formation-ray system (docs/users_proposals/backpack_battle_spec.md +
  formation.xlsx): two A1:Z18 planes, 45° edge-entry rays, penetration/reflection/
  bounce-scaling, monsters = HP+skills only (same PO pipeline, possessed without
  placement), entry = position-projection + seeded jitter, AOE in shared cells.
  All 19 v0.1 OQs resolved as vetoable defaults; ONLY open item = VX-3 (new po_tags
  root `Tool` for thief/rogue gating — vocab growth needs user approval/naming).
  formation4 data corrected (J11:Q18). Superseded v0.1 note below:
  (was) Combat spec v0.1 draft delivered
  (docs/combat_spec_draft.md, 2026-07-05): event-driven continuous-time seeded sim,
  8-status semantics, enemy pack grammar (StS telegraphs + PoE composition),
  encounters-as-combat with po_tags mode gating, cooldown formulas, S4 tuning
  surface, 19 open questions + 3 vocabulary/schema extension requests (VX-1 hpMax,
  VX-2 enemy schema fields, VX-3 new `Tool` tag) AWAITING USER REVIEW.
- **Date**: 2026-07-04. Details delegated to orchestrator ("細かい部分は、任せます").

## User golden (a–r, captured)
a. Auto-battle.
b. A sortie Party = 4 Units (any number of players).
c. Room creation: target dungeon + level, cancellation policy (see g), and a
   multi-selectable VISIBILITY level (public / friends / friends-of-friends /
   group[placeholder] / self-only). Matching rooms + a join UI.
d. A player may join ANY number of Dungeon Schedules as long as their concurrently
   active Units don't reference the same inventory items (→ REQ-0033 independence
   data is the enforcement source).
e. Harvested items do NOT go to inventory directly; they land in a player WAREHOUSE
   (max 200 items, kept up to one week from harvest).
f. Warehouse → inventory transfer any time (Warehouse tab inside Schedule screen).
g. Any participating player canceling cancels the schedule; room settings may
   disallow IMMEDIATE cancel (details TBD).
h. Monsters have NO canvas/BP system; they appear in PACKS (not necessarily one).
i. Party wipe: sortie level auto-drops by the room's failure-step (default 1) +
   sortie cooldown. No cancel, nothing lost, nothing gained.
j. A Unit's owner can SWAP the unit; other players get notified; swap applies after
   the current RUN ends (runs execute on a COPY of the unit).
k. Schedule screen has a small monitor of the current run, expandable to full view
   for any specific schedule.
l. Run end → cooldown scaled by all participating Units' BP HP at finish.
m. A run is a simple 0–100% progression.
n. TRAP encounters mid-run: must be "discovered" within a time limit or it triggers
   (discovery alone = win; no disarm step).
o. HIDDEN DOOR encounters: discover + unlock ⇒ shortcut (large progress jump).
p. At 100%: boss encounter; victory ends the run; mid-run rewards + boss rewards
   (distribution fully RANDOM).
q. Discovery/unlocking of doors/chests/traps is resolved AS COMBAT (they are
   monsters), but only mode-matching POs activate (thief/rogue role shaping).
   Forced end possible (e.g. "keyhole broke" after a time limit).
r. Between players of the same schedule: barter trade allowed ONLY for items gained
   in that schedule AND still in the warehouse (no inventory→warehouse return).

## Monster-behavior reference games (orchestrator proposal, h)
- **Loop Hero** — closest structural match: auto-run loops where player power comes
  entirely from pre-arranged loadout; traps/encounters as tile events.
- **Slay the Spire** — intent telegraphing (enemies display next action): readable
  auto-combat that stays interesting to WATCH (fits the monitor view k).
- **Path of Exile** — pack composition grammar (normal/magic/rare packs, pack-wide
  modifiers) for h's "monsters appear in packs".
- **Darkest Dungeon** — party-position mechanics and curio/trap flavor for n/o/q
  role-shaping (thief/rogue kit).

## Dependencies (blocking, in order)
1. Combat spec (seconds-based; every_secs ranges exist, but battle resolution,
   HP/Chill/Burn statuses, enemy defs = undesigned). ← biggest.
2. Enemy content type (flat tunable defs per REQ-0005; S4 simulate gate).
3. REQ-0033 reference model (independence = d's enforcement).
4. Identity/friends/visibility (EOS decision — separate discussion with user).
5. Server: schedule/run simulator service (server-authoritative, offline-first
   scheduled auto-runs per Key Design Facts), warehouse store (200 cap, 7-day TTL),
   trade (warehouse-only, same-schedule scope), notifications (j).

## Phasing proposal
P1 solo-able core: rooms(self-only) + run simulator + traps/doors/boss + warehouse
   + monitor (single player, no trade/visibility). P2 multi-player rooms, visibility,
   unit swap notifications, cancellation policies. P3 trade + groups + spectate polish.
