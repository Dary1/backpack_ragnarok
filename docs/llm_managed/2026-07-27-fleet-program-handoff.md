# Handoff — LLM test-play fleet program (REQ-0309..0320)

Written 2026-07-27 by the orchestrator session, so a context reset costs minutes
rather than a re-survey. Read this with PROJECT.md's own "Recovery read" section
(`ls docs/REQ/built/ docs/REQ/todo/`).

## The program in one paragraph

Seven Claude CLI testers, each playing the LIVE game with exactly ONE Squad, so a
human who wanders in finds a Troop that can actually depart. The LLM makes only
strategic choices; a deterministic Node CLI (`bpk`) does all interpretation and
tactics. Full design: `docs/llm_managed/2026-07-27-llm-testplay-fleet-design.md`.

## Two decisions that shaped everything (user-ratified, 2026-07-27)

1. **Tidy first.** `mock-src/engine.js` — the real game engine — was required by
   server, sim, client, and tools, while `shared/README.md`'s charter says
   dependencies point INTO shared/. Fixing that is not housekeeping: it converts
   REQ-0314 (`bpk` core) from "re-implement the client's canvas layer" into "call
   `shared/`", which was the program's biggest unknown.
2. **Reactive, not autonomous.** Bots never HOST a Troop. They wake on a player's
   recruitment and drip-fill seats ~2 min apart; they never cancel. This deletes
   the entire matchmaking/anti-deadlock apparatus from the first design draft
   (bands, muster deadlines, greeter-seat policy) — fragmentation becomes
   structurally impossible. The LLM's work moves to the housekeeping window that
   opens when a Troop disbands.

Three consequences that are easy to lose and expensive to rediscover:

- **Polling is not autonomy.** A cheap deterministic daemon must watch the event
  feed; the LLM wakes only when a real choice exists.
- **The escape hatch is mandatory.** The deploy gate blocks a uid across active
  rooms and runs auto-restart forever (`runs.cjs:323`), so a bot holding its one
  Squad in an abandoned Troop is permanently unavailable. Rule: 解散はしないが、
  席は返す — leave when the host has been absent T hours, or when that host opens
  a new Troop.
- **Without the housekeeping session the LLM is a cron job.** Seat-filling alone
  is a shell script; the value is in claim/dismantle/gacha/market/rebuild
  decisions and the one-sentence `why` each verb carries.

## Board

- **built**: REQ-0309 (engine → `shared/`). CI GREEN, ratified.
- **todo**: REQ-0310 (client player actions → `shared/`) — next up.
- **reserved**, scope paragraphs only: 0311 co-op troop model · 0312 multi-participant
  run · 0313 player event feed · 0314 `bpk` core · 0315 tactics kernel ·
  0316 judgment interface · 0317 conformance suite · 0318 personas ·
  0319 orchestration · 0320 observability.
- Suggested order: 0310 → 0311 → 0312 → 0313 → 0314 → 0315 → 0316 → 0317 → 0318 → 0319 → 0320.
  Track B (`bpk`) can be built and tested against the SOLO api while track A is in
  flight; that is the recommended parallelisation.

## Findings a fresh session must not re-derive

- **Co-op Troops do not exist.** `rooms.cjs:111` hardcodes `visibility:'self'`;
  a slot is a bare `squadIndex` with no owner; `startRun` takes one canvas and sets
  `participants = [room.ownerId]`. REQ-0036 golden b/c were deferred as P2.
  BUT `sim/lib/dungeon.cjs:32` `distributeRewardsUniform(items, participants, rng)`
  is already multi-participant — the combat core needs no change.
- **Gacha, warehouse claim and the fresh-profile seed are client-authoritative.**
  The server rolls/reserves; the CLIENT mutates the canvas and PUTs, and that PUT
  is the commit. This is why REQ-0310 exists.
- **Identity hazard.** Live `data/config/dev_user.json` has no `dev_mode` key and
  `admin.cjs:71` defaults it to `true`, so a request with NO token silently
  resolves to the DEV player. `bpk` must fail closed on this.
- **`tools/ci.sh` is not reliably green at its default 4 e2e workers** — observed
  twice independently (subagent at REQ-0309 base, orchestrator on the merge
  commit), different specs each time, green at `E2E_PARALLEL=1`. Recorded as an
  addendum to REQ-0222.
- **Ports derive from the REQ number**: `5000 + REQ*10 + i`. REQ-0309 → 8090 decade.
  Never hand-pick.

## Environment state, 2026-07-27

- Worktrees cleaned: 104 removed (82 GB → 2.5 GB), **all 177 branch refs kept** —
  a removed worktree loses nothing, a deleted branch would. Kept:
  `design-llm-testplay-fleet`, `req-0309-engine-to-shared`, and
  `monsters-002-style-bakeoff` (untracked monster art WIP; PROJECT.md HANDS-OFF).
- Salvaged: `~/backpack_ragnarok_salvage/req-0073-build_dungeon_preview.patch`
  (145 lines of real uncommitted work found in a tree that was otherwise merged).
- NOT done, deliberately: no client bundle rebuild, no `backpack-api` restart.
  Live deploy was never authorised for this REQ.
