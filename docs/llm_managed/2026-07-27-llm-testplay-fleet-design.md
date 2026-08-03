# LLM Test-Play Fleet — Overall Technical Design (pre-REQ)

Premise: the fleet program (REQ-0309..0320) is in flight.
Expires-when: program complete or superseded by as-built docs.

- **Date**: 2026-07-27
- **Status**: DESIGN ONLY. No REQ reserved yet, no code written. This document exists
  to be argued with before any number is burned.
- **Author**: orchestrator session (survey of `master` @ `0918773`)
- **Supersedes**: nothing. `docs/REQ/draft/REQ-0039-bot-api-pending.md` (old, written
  by a previous model) is treated as a *statement of intent only*; this design was
  derived from the source, not from that REQ.
- **Scope of the survey**: `server/` (routes, services, storage), `shared/`,
  `sim/`, `shared/engine.js`, `client/src/store`, `client/src/api`,
  `docs/user_managed/*`, `docs/REQ/done/REQ-0036`.

---

## 0. What is being built, in one paragraph

Seven Claude CLI sessions, each running twice per 12 hours on `llmlocal`, each
playing the LIVE game as an ordinary player with exactly ONE Squad. Each session
is a short strategic conversation: a deterministic CUI tool renders the world into
a small, bounded digest; the LLM answers with one strategic verb; the CUI expands
that verb into the full, correct sequence of HTTP calls and canvas mutations. The
purpose is NOT debugging. The purpose is **liveness**: to guarantee that a human
who wanders into the game finds a Troop that can actually depart.

Success is therefore measured in *matchmaking*, not in bug counts:

> A human player who logs in at a random moment finds a joinable Troop with a free
> seat within N minutes, joins it, and the Troop departs.

Everything below serves that sentence.

---

## 1. The one blocking finding — read this first

**Co-operative Troops do not exist in the server today.** The feature the whole
premise rests on is unbuilt.

Evidence from the source:

- `server/services/rooms.cjs:111` — `visibility: 'self'` is a hardcoded literal
  with the comment *"golden c: P1-B rooms are always self-only (multi-visibility
  is P2)"*.
- `server/services/rooms.cjs` — `getOwnRoomOr404()`: a room belonging to another
  player is indistinguishable from a nonexistent one. There is no room-browse
  endpoint, no join endpoint, no leave endpoint. The route table
  (`server/router.cjs`) has no path that could carry one.
- `server/services/squads.cjs:149` — `assignSlot(room, callerId, slotIndex,
  squadIndex, profileCanvas, …)`: a slot holds a bare integer `squadIndex` into
  **the caller's own** `profileCanvas.presets.store`. A slot has no owner field;
  it structurally cannot name another player's squad.
- `server/services/runs.cjs:77` — `startRun(room, profileCanvas)` takes exactly
  ONE canvas, and `const participants = [room.ownerId];` carries the comment
  *"solo scope: the room owner is the sole participant/reward recipient"*.
- `docs/REQ/done/REQ-0036-dungeon-schedule.md` — golden **b** ("a sortie Party = 4
  Units (any number of players)") and golden **c** (visibility levels + "matching
  rooms + a join UI") are recorded as **P2, deferred**. P1 shipped solo-only.

So the user requirement *"each AI runs one Squad and must find three others"*
cannot be expressed against today's API at all. It is not a bot problem; it is a
missing game feature.

**One piece of good news.** The simulator was written multi-participant from the
start: `sim/lib/dungeon.cjs:32` `distributeRewardsUniform(rewardItems,
participants, rng)` already assigns each reward an `owner` drawn uniformly from a
participant list, and `runDungeon` already accepts `participants`. The combat core
needs no change. The work is entirely in the *service* layer: room ownership,
slot ownership, loading four canvases instead of one, and fanning settled rewards
into four warehouses.

**Consequence for planning.** The fleet cannot be the first deliverable. The
dependency order is: co-op Troop (server) → matchmaking (server) → CUI tool →
fleet. Roughly half the proposed REQs are game-server work, not automation work.

### 1.1 A second, quieter finding: the client holds game logic

Several player actions are **two-phase, and the second phase is the client's job**:

- **Gacha** (`server/routes/workshop.cjs`): `POST /api/workshop/gacha` only *rolls*
  and records a pending row. The server never writes the profile. The CLIENT must
  deduct the LRDST cost from its own canvas, first-fit-place the rolled BP, and
  `PUT` the canvas. That PUT is what finalises the roll
  (`finalizeGachaForCanvas`), and it verifies **both** that the minted uid is
  present **and** that the balance actually dropped by the cost.
- **Warehouse claim** (`server/services/warehouse.cjs:226`): marks the row
  `claiming` and returns the payload. The client must place it and PUT; a
  `claiming` row reverts to `claimable` after 120 s if the PUT never lands.
- **Fresh profile** (`client/src/store/boot.ts` → `buildStarterUnitsState`): the
  initial four starter Squads are a **client-side boot seed** built from
  `/api/content`'s `starterUnits`. `POST /api/starter/claim` only enforces a
  regrant limit; it grants nothing.

Therefore a headless player is **not** an HTTP client. It is a re-implementation of
the client's canvas layer. It must produce canvases that satisfy
`engine.js`'s `checkUidInvariant` (one home record per uid, in `st.inv.pages`) or
saves will be silently wrong.

**This single fact decides the tool's language and its most important dependency:**
the tool must run `shared/engine.js` — the very module the server itself loads in
`services/core.cjs` — rather than reimplementing placement. `engine.js` is a
UMD-style CommonJS module (`module.exports=factory()`, no DOM), so Node can require
it directly. Language: **Node.js CommonJS**, same as the server. This also
satisfies the reuse requirement in the brief.

---

## 2. Ground truth — the game as it exists today

### 2.1 Domain model (surveyed, not assumed)

| Term | Meaning | Where it lives |
|---|---|---|
| **PO / SI / BP** | placement object / socket item / backpack | `docs/user_managed/canvas_spec.md` |
| **Unit** | exactly one per BP, seated at mint time, casts link beams | `canvas_spec.md`, `live_units.json` |
| **Squad** | one 8×8 canvas = many BPs. 5 squad slots per player (`engine.js` `SQUAD_COUNT=5`) | `canvas.presets.store[]` |
| **Troop** | 4 Squads = one room's `slots[]` (`SQUAD_SLOTS=['unit1'..'unit4']`, legacy keys) | `services/core.cjs` |
| **Inventory** | 5 pages, the MASTER home of every uid | `canvas.inv.pages[]` |
| **Warehouse** | 200-item cap, 7-day TTL, rewards land here | `services/warehouse.cjs` |
| **LRDST** | the Transmutator that is currency; a 1×1 stackable that occupies inventory | `economy.md`, `tms` |
| **attackLv** | the ONLY dungeon entry knob since REQ-0304; the dungeon is randomly DRAWN from `{d : d.levelMin <= attackLv}` | `services/rooms.cjs:49` |
| **Run** | simulated instantly, revealed on a wall clock; auto-restarts after cooldown forever | `services/runs.cjs`, `services/pacing.cjs` |

### 2.2 Timing constants that size the whole fleet

- Presentation window per run: **45 s – 300 s** (`services/pacing.cjs`, clamped).
- Cooldown: `CD_MIN_SECS 60` … `CD_MAX_SECS 600`, linear in surviving-HP fraction
  `H` (`sim/lib/core.cjs`, `sim/lib/dungeon.cjs:43`). A wipe = the H=0 end = 600 s.
- Wipe also drops `attackLv` by `FAILURE_STEP 1`, floor `LEVEL_MIN 1`.
- Gacha: `GACHA_COMMON_BP_COST 10` LRDST (pack def may override).

**The load-bearing consequence:** `maybeAutoStartNextRun` (`runs.cjs:323`) restarts
a room's run the moment cooldown clears, forever, with no scheduler process. A
Troop that has departed **once** keeps departing. So the scarce event is not
"running" — it is **birth**. All matchmaking design should minimise the number of
Troops that must ever be born.

### 2.3 The API surface a player actually uses

Auth is a single `X-Auth-Token` header (or a Supabase `Bearer` JWT); no cookies, no
CSRF, no session — `route_auth.cjs` calls this posture *"bot-friendly (REQ-0039
design-first-class requirement)"*. The endpoints a one-Squad player needs:

```
GET  /api/me                              identity
GET  /api/content                         items, sis, tms, units, packs, starterUnits
GET  /api/profile/:id/canvas              the whole player state
PUT  /api/profile/:id/canvas              <=64KB; ALSO the finalize hook for gacha+claim
GET  /api/schedule/dungeons               dungeon + formation list
POST /api/schedule/sorties                atomic create-room + fill 4 slots  (solo today)
GET  /api/schedule/rooms | /rooms/:id     own rooms; settles due runs as a side effect
GET  /api/schedule/rooms/:id/run          paced event feed + final result
PUT  /api/schedule/rooms/:id/swap         queued squad swap
DELETE /api/schedule/rooms/:id            cancel (immediate | after current run)
GET  /api/warehouse                       rewards inbox
POST /api/warehouse/claim                 phase 1 of 2
POST /api/workshop/gacha                  phase 1 of 2
GET  /api/market/listings?filter=&q=      browse
POST /api/market/listings                 sell   (Idempotency-Key supported)
POST /api/market/listings/:id/buy         buy    (Idempotency-Key supported)
POST /api/market/listings/:id/withdraw    delist
POST /api/dismantle                       junk -> 1 LRDST + permanent ledger
GET  /api/ragnarok/*                      season meta (optional for v1)
```

Endpoints the fleet must be **structurally forbidden** from calling: everything
under `/api/admin/*`, every `.../dev/...` path (`dev/backdate`, `dev/clear`,
`listings/dev/clear-all`, `warehouse/dev/*`), and `genSeed`/`drawSeed` on room
creation. These are test-control seams; a tester that uses them is not testing the
game. Most are already gated to the dev_mode no-token fallback — which leads to
the next point.

### 2.4 Identity hazard

`data/config/dev_user.json` on the live box carries no `dev_mode` key, and
`readDevUser()` treats a missing key as **true**. Therefore **any request with no
`X-Auth-Token` silently resolves to the `dev` player** and writes the developer's
own profile. A bot that drops its header does not fail — it possesses the
developer's account.

Mandatory guard, cheap to implement: the CUI refuses to start unless
`GET /api/me` returns a `playerId` that (a) is not `dev`, (b) matches the
agent's configured id, and (c) has `roles: []`. Fail closed, exit non-zero.

---

## 3. The Judgment Interface (判断界面) — defined first, as instructed

### 3.1 The dividing principle

> **The LLM never interprets and never executes. It only chooses.**

Concretely, three rules that decide, for any piece of logic, which side of the line
it lives on:

1. **If it has a right answer, it belongs to the CUI.** First-fit placement, uid
   bookkeeping, "is this Squad deployable", "which listings match my need", "did
   this run wipe" — all deterministic. The LLM must never see a raw canvas, a raw
   event log, or a raw listing array.
2. **If it is a trade-off between incommensurable goods, it belongs to the LLM.**
   Spend LRDST now on a gacha roll or bank it for a market buy? Push `attackLv`
   up for better loot or hold and finish this Troop's streak? Join a weak Troop
   now or wait for a stronger one? These have no right answer; they are exactly
   what we want a player-shaped mind to answer.
3. **If it can deadlock the ecosystem, it belongs to the CUI as a hard rule, not
   to the LLM as advice.** The join-before-host rule (§6) is a *precondition*,
   not a prompt suggestion.

This is also the cost design: a bounded digest and a closed verb set mean a session
is a handful of small turns, not an agentic crawl over an API.

### 3.2 The loop

```
  bpk digest            ->  Situation Digest (JSON, <= ~2 KB, capped)
        \-> LLM chooses one Decision Verb (JSON, <= ~200 B)
  bpk act --verb ...    ->  Receipt (JSON, <= ~1 KB) + full detail to the JSONL log
  repeat until END_SESSION, turn budget exhausted, or wall-clock budget exhausted
```

Everything crossing the LLM boundary is JSON with a versioned schema. The digest is
*rendered*, never dumped: the CUI decides what a player would plausibly notice.

### 3.3 Situation Digest — schema sketch (v1)

```jsonc
{
  "schema": "bpk.digest/1",
  "turn": 3, "turnsLeft": 7, "sessionDeadline": "2026-07-27T09:40:00Z",
  "me": { "playerId": "p_ab12…", "persona": "hoarder", "attackLv": 6 },

  "squad": {                       // MY one squad, summarised — never the raw canvas
    "name": "Warden",
    "bps": 4, "cells": 27, "filled": 22, "hpMax": 1180,
    "links": { "made": 5, "possible": 8 },      // from engine.traceBeams
    "topTags": ["Sword", "Shield", "Gem"],
    "power": { "band": "mid", "vsBandMedian": "+8%" }   // deterministic, from sim heuristic
  },

  "wallet": { "lrdst": 34 },
  "inventory": { "freeCells": 61, "junkCount": 12, "unplacedRewards": 0 },
  "warehouse": { "items": 17, "cap": 200, "expiringSoon": 3 },

  "troop": {                       // the rendezvous view — the heart of the digest
    "mine": { "roomId": "room_…", "seats": "3/4", "state": "waiting",
              "waitedMin": 6, "runsCompleted": 4, "lastResult": "victory", "H": 0.72 },
    "joinable": [                  // capped at 5, pre-ranked by the CUI
      { "roomId": "room_…", "seats": "3/4", "attackLv": 6, "ageMin": 2,
        "members": ["human?", "bot", "bot"], "fitScore": 0.91 },
      { "roomId": "room_…", "seats": "1/4", "attackLv": 9, "ageMin": 22,
        "members": ["bot"], "fitScore": 0.34 }
    ],
    "hostAllowed": false,          // <- the anti-deadlock gate, computed by the CUI
    "hostBlockedBecause": "3 joinable troops exist in your level band"
  },

  "market": {                      // pre-filtered to what MY squad could use
    "affordableOffers": [ { "listingId": "…", "what": "Sword +q0.6", "price": 12,
                            "fitScore": 0.8 } ],
    "myListings": [ { "listingId": "…", "what": "…", "price": 9, "ageH": 11 } ],
    "sellableSurplus": 6
  },

  "lastRun": { "result": "victory", "clearPct": 100, "H": 0.72,
               "lostBps": 0, "rewards": 3, "notable": "boss felled" },

  "alerts": ["warehouse 3 items expire within 24h",
             "your troop has waited 6 min with 3/4 seats"]
}
```

Design notes:

- Every array is **capped and pre-ranked**; `fitScore` is a deterministic CUI
  number so the LLM compares like with like instead of re-deriving preferences.
- `hostAllowed` is the single most important field. The LLM cannot host when the
  CUI says no; the field explains why so the model does not fight it.
- No raw combat log ever crosses. `lastRun` is a five-field verdict. If we later
  want the LLM to *comment* on a battle (useful test signal!), that is a separate,
  explicitly-budgeted `NARRATE` turn with a rendered summary — not a log dump.

### 3.4 Decision Verbs — the closed set (v1)

| Verb | Params | Meaning | CUI expands to |
|---|---|---|---|
| `ENLIST` | `roomId` | join an existing Troop | join call, then verify seat held |
| `HOST` | `attackLv`, `formationId?` | open a new Troop | legal only if `hostAllowed` |
| `HOLD` | `minutes` | stay put, let the current Troop run | poll + sleep, no state change |
| `LEAVE` | `reason` | abandon a stalled Troop | leave call, re-enter pool |
| `SET_LEVEL` | `attackLv` | change entry level next sortie | clamps to legal band |
| `HARVEST` | `policy: all\|useful\|expiring` | warehouse → inventory | claim → place (engine) → PUT, per item, with rollback |
| `DISMANTLE` | `policy: junk\|duplicates\|none`, `max` | items → LRDST | select → dismantle → PUT |
| `GACHA` | `rolls: 1..n` | spend LRDST on packs | roll → deduct → first-fit → PUT, per roll |
| `SELL` | `what: surplus\|specific`, `pricePolicy: floor\|median\|premium` | list on market | price from a deterministic band table |
| `BUY` | `listingId` | buy a listing | buy → claim → place → PUT |
| `REBUILD` | `objective: hp\|links\|dps\|balanced` | re-run auto-build on my squad | the auto-build algorithm (§4.4) |
| `END_SESSION` | `note` | stop early | flush logs |

Every verb also carries `"why": "<one sentence>"`. That sentence is the *research
output* of this whole system — it is what a designer reads to learn how the game
reads to a fresh mind. It is logged, never acted upon.

Deliberately **absent** verbs, and why:

- No "place item at cell" — that is tactics; the CUI owns it (brief item 1).
- No "create second squad" / "deploy multiple squads" — out of scope by the brief.
- No free-form HTTP. The verb set IS the API from the LLM's point of view.

### 3.5 The refusal contract

`bpk act` never fails silently and never half-executes. It answers with one of:

```jsonc
{ "schema":"bpk.receipt/1", "verb":"ENLIST", "status":"ok",
  "changed": { "troop":"3/4 -> 4/4", "departsIn":"~15s" },
  "cost": { "requests": 3, "ms": 840 } }
```

```jsonc
{ "schema":"bpk.receipt/1", "verb":"HOST", "status":"refused",
  "reason":"host_blocked_joinable_exists",
  "explain":"3 joinable troops in band 4-6; hosting would fragment the pool",
  "alternatives":[ {"verb":"ENLIST","roomId":"room_…"} ] }
```

```jsonc
{ "schema":"bpk.receipt/1", "verb":"BUY", "status":"partial",
  "completed":["purchased"], "rolledBack":["placement"],
  "reason":"no_inventory_space", "explain":"item stays in warehouse, claimable" }
```

`refused` **does not consume a turn** (it is a rule the model could not have known);
`partial` and `ok` do. Refusals are logged and counted: a high refusal rate is a
prompt bug, and we want to see it.

### 3.6 Budgets

| Budget | Value (proposal) | Enforced by |
|---|---|---|
| LLM turns per session | 10 | CUI turn counter; digest carries `turnsLeft` |
| Wall clock per session | 25 min | CUI deadline; `HOLD` cannot exceed it |
| HTTP requests per session | 300 | CUI counter, hard stop |
| Request rate | ≥ 400 ms apart, jittered | CUI, always on |
| LRDST spend per session | ≤ 60 % of balance | CUI clamp on `GACHA`/`BUY` |
| Market listings live per agent | ≤ 5 | CUI clamp on `SELL` |

The economy clamps exist because REQ-0039 already flagged trade as the surface
where bots distort a game. Seven tireless agents can move a small market a long way
in a week.

---

## 4. System architecture

### 4.1 Layer map

```
  L4  fleet/          systemd user timers, 7 agent slots, kill switch, budget ledger
        |                                        (shell + systemd, on llmlocal)
  L3  claude CLI      `claude -p` headless, one session per agent per window
        |             allowed-tools = ONLY `bpk` subcommands; no shell, no net
  ---- the judgment interface (digest / verb / receipt) -------------------------
  L2  bpk session     turn loop, budgets, refusal contract, JSONL transcript
  L1  bpk tactics     DETERMINISTIC kernel: auto-build, triage, pricing, laddering
  L0  bpk core        HTTP client + canvas layer (requires shared/engine.js)
        |
      backpack-api    live, unchanged except for the co-op feature work
```

The line marked `----` is the only place a language model appears. Everything below
it is testable with plain unit tests and no API key.

### 4.2 Language, placement, dependencies — decided

- **Language: Node.js, CommonJS.** Same as `server/*.cjs`. Forced by §1.1: the tool
  must `require('../shared/engine.js')` to mutate canvases correctly, and must
  read `shared/constants.json`, `shared/pacing.json`, and `content/vocab.json` the
  same way the server does. Reimplementing placement in another language would
  guarantee drift from `checkUidInvariant`.
- **Placement in the tree: a new top-level `bot/`**, sibling to `server/`,
  `client/`, `sim/`, with its own `package.json` (the convention `server/` already
  follows). `tools/` is a flat drawer of one-file scripts; this is a subsystem.
- **Dependencies: none.** `node:http`/`fetch` is enough — `server/api.cjs` itself
  is proudly framework-free. pnpm only, per PROJECT.md.
- **Binary name**: `bpk` (`bot/bin/bpk.cjs`), subcommands
  `bpk doctor | digest | act | run-session | fleet-status`.

### 4.3 What the deterministic kernel owns

This is the bulk of the engineering, and none of it needs an LLM:

- **Canvas layer**: load canvas → engine state; first-fit placement
  (`invCanPlacePO`/`invMovePO`/`invCanPlaceBP`/`invMoveBP`); uid minting that reuses
  the warehouse row's uid (required by `finalizeClaimingItemsForCanvas`); LRDST
  stack arithmetic; `migrateState` on load; `checkUidInvariant` before every PUT —
  **never PUT a canvas that fails the invariant**.
- **Fresh-profile bootstrap**: port `buildStarterUnitsState` from
  `client/src/store/boot.ts`. A brand-new agent account has no canvas; without this
  it cannot play at all. (This is a straight port, and it is a drift risk worth
  naming: if the client's boot seed changes, the bot's must too. Proposal: extract
  the seed builder into `shared/` so both consume one implementation — a small,
  optional refactor REQ.)
- **Triage**: which warehouse items are worth claiming (fit vs. free cells vs.
  expiry), which inventory items are junk (no tag my Units can port to, duplicate
  of something strictly better), which are surplus (sellable).
- **Pricing**: a deterministic band table derived from observed listing history;
  `floor|median|premium` map to percentiles. No dynamic pricing — the economy doc
  forbids formula-driven prices, and a bot fleet must not become one by accident.
- **Level ladder**: `attackLv` policy given recent `H` values and wipe history.
  Wipes already auto-drop the level; the ladder decides when to climb.
- **Fit scoring**: a cheap static estimate of "would this item improve my squad",
  reusing `sim/` compile helpers where possible. Deliberately *not* a full sim.

### 4.4 Auto-build — kept deliberately dumb

The brief says: do not build clever canvases; call an auto-build command that
decides locally with a simple algorithm. Proposal — a greedy, seeded, three-pass
pack:

1. **Seat pass.** Keep existing BPs; sort POs by (fit-tag match × footprint
   efficiency × quality `q`), place greedily with first-fit + rotation, respecting
   "a PO must fit entirely inside ONE BP".
2. **Link pass.** For each Unit, count beams that terminate on another Unit
   (`engine.traceBeams` / `connShapeOf`). Try up to K random BP repositionings
   within the 8×8 canvas, keep the arrangement with the most links. K small
   (≈50), seeded per agent so builds are reproducible and *different per agent*.
3. **Socket pass.** Seat SIs into matching sockets greedily by socket-type
   hierarchy.

Objective weights differ by `REBUILD objective` (hp / links / dps / balanced) and
by persona seed. That is enough to satisfy golden pillar **P5** ("no two players'
canvases converge") without any search worth calling AI. The build is a pure
function of (inventory, seed, objective) — so it is unit-testable against goldens.

---

## 5. The missing co-op Troop — minimal shape

Only what the fleet strictly needs; everything else stays P2/P3.

### 5.1 Data model change

`room.slots[i]` becomes `{ ownerId, squadIndex, joinedAt } | null`, and the room
gains `visibility: 'public' | 'self'`, `hostId`, `quorum: 4`, `musterDeadline`.
`ownerId` on the room becomes `hostId` (the host is a participant like any other,
but owns the cancel policy).

### 5.2 Endpoints (proposed, minimal)

```
GET    /api/schedule/troops?attackLv=&state=open      browse joinable troops
POST   /api/schedule/troops                           host one (1 of my squads)
POST   /api/schedule/troops/:id/join   {squadIndex}   take a free seat
POST   /api/schedule/troops/:id/leave                 free my seat (pre-departure)
GET    /api/schedule/troops/:id                       state, settling due runs
```

The existing `/api/schedule/rooms*` surface stays exactly as-is for solo play; the
troop surface is additive, which is the same order-safe tail-append pattern
`router.cjs` documents for every family added since REQ-0064.

### 5.3 Rules that must be decided (they are game design, not automation)

- **Deploy gate across players.** `assignSlot`'s uid-overlap check is per-player
  and stays per-player — two different players cannot share a uid. But
  `isSquadDeployable` must run against *the joiner's* canvas, loaded on join.
- **Frozen canvas.** golden: a sortie locks the canvas until the dive ends. With
  four owners, "locked" must mean *the snapshot taken at departure*, and the
  server already does this (`buildSquadSnapshots`). Confirm: a member may keep
  editing their canvas mid-run; the run uses the snapshot. Recommended: yes —
  otherwise a 4-player troop freezes four players' whole game for 5 minutes.
- **Cancellation.** golden g says any participant cancelling cancels the schedule.
  For an auto-restarting troop this is harsh; recommend: `leave` between runs is
  free and the seat re-opens; only the host may cancel the troop outright.
- **Rewards.** `distributeRewardsUniform` already assigns per-item owners
  uniformly at random — contribution-blind by design (economy doc calls this
  deliberate). Settlement must fan out to each owner's warehouse.
- **Level.** A troop has ONE `attackLv`. Whose? Recommend: the host sets it at
  creation and it is immutable; wipes drop it for the troop, not per player. This
  makes `attackLv` the natural matchmaking bucket (§6).

---

## 6. Rendezvous — the anti-deadlock design

### 6.1 The failure modes, named

1. **Fragmentation.** Seven agents wake, each finds nothing, each hosts. Seven
   troops of 1/4. Nobody departs. This is the failure the brief names.
2. **The 2+2 split.** Two troops sit at 2/4 forever because nobody will abandon a
   seat they already hold. Fragmentation's stable cousin.
3. **Band scatter.** Agents at `attackLv` 3, 4, 5, 6, 7, 8, 9 are technically all
   "waiting" but no four share a level. Fragmentation in a second dimension.
4. **Human lockout — the one that actually matters.** The bots are *too* good at
   filling seats. Every troop is 4/4 within seconds, so a human who arrives finds
   nothing joinable, hosts a fresh troop, and waits alone. The fleet succeeds at
   playing and fails at its entire purpose.
5. **Zombie troop.** A member's account breaks; the troop sits at 3/4 forever and
   permanently sinks three seats.

### 6.2 Invariants — enforced by the CUI, not asked of the LLM

- **I1 — Join before host.** `hostAllowed` is false whenever any joinable troop
  exists in the agent's band. Hosting is a fallback, never a preference.
- **I2 — Join the fullest.** When several troops are joinable, `fitScore` ranks
  3/4 above 2/4 above 1/4. Greedy-fullest is the standard anti-fragmentation rule
  and directly dissolves mode 2.
- **I3 — Bands, not levels.** Matchmaking buckets `attackLv` into a small number
  of coarse bands (proposal: 1-3 / 4-6 / 7-10 / 11-15 / 16+). A Schelling point
  beats a continuum; this kills mode 3.
- **I4 — Muster deadline.** A troop that has not reached quorum within `T_muster`
  (proposal: 20 min) auto-dissolves; members return to the pool and re-run I1/I2.
  Rather than a fifth troop being born, four halves recombine. Kills mode 5, and
  makes mode 1 self-healing even if it happens.
- **I5 — The greeter seat.** *At least one* public troop per active band must hold
  a free seat at all times. The fleet's job is to be a lobby, not to consume it.
  Implementation: the fleet's coordination state (§6.3) tracks band occupancy; an
  agent whose join would take the last free seat of the last open troop in its
  band is refused with `reason: "would_close_greeter_seat"` and told to host a new
  troop instead (which immediately becomes the new greeter). This is the direct
  answer to mode 4, and it is the single most important rule in the document.
- **I6 — Departure beats waiting.** If a greeter troop has held its seat for
  `T_greeter` (proposal: 30 min) with no human, one agent fills it and the troop
  departs — then a fresh greeter troop is opened. Bots must not idle forever
  waiting for a human who is asleep.

### 6.3 Where the coordination state lives — two options

**Option A — server-side (recommended).** Muster deadline, band bucketing, and
greeter-seat accounting live in the game server as real rules. Humans get them for
free; a human hosting a troop that nobody joins also gets auto-dissolved and
re-pooled, which is good game design regardless of bots.

**Option B — fleet-side.** A small shared JSON/SQLite state file on `llmlocal`,
written by the CUI under a flock, that only the seven agents respect. Cheaper, no
game-server change, but humans are invisible to it and the invariants degrade the
moment a real player shows up — which is the entire point of the exercise.

Recommendation: **A for I3/I4, B for I5/I6.** Band bucketing and muster deadlines
are game rules and belong in the game. The greeter-seat reservation is a *fleet
politeness policy*, not a game rule — no human should ever be told "you may not
take this seat".

### 6.4 The resulting steady state (worked example)

Seven agents, band 4-6, `T_muster` 20 min, greeter policy on:

```
  t=0    A1 wakes, no troops exist        -> HOST  T1 (1/4)  [greeter]
  t=2m   A2 wakes, T1 joinable            -> ENLIST T1 (2/4)
  t=4m   A3                               -> ENLIST T1 (3/4)
  t=6m   A4  would close last free seat   -> refused (I5) -> HOST T2 (1/4) [greeter]
         ...T1 sits at 3/4 with one seat held open for a human...
  t=9m   HUMAN arrives, browses, sees T1 (3/4) and T2 (1/4) -> joins T1 -> 4/4
         T1 DEPARTS and now auto-restarts forever (runs.cjs:323)
  t=11m  A5, A6 -> ENLIST T2 (3/4). A7 refused by I5 -> HOST T3 [greeter]
  t=36m  T2 still 3/4, no human -> I6 fires -> A7 leaves T3, fills T2 -> departs
```

Two properties worth noticing: the human's *first* action is a successful join, and
the number of troops ever born stays near the minimum. Because departed troops
never stop, the ecosystem accumulates running content rather than idle lobbies.

### 6.5 Metrics that prove it works

- `time_to_muster` distribution (p50 / p90) per band.
- `troops_born` vs `troops_departed` — a healthy ratio is close to 1.0.
- `greeter_seat_uptime` — fraction of wall-clock where ≥1 free public seat existed.
  **Target ≥ 95 %.** This is the acceptance criterion for the whole project.
- `human_join_latency` — from a non-fleet playerId's first browse to their join.
- `stalled_troop_minutes` — should be ~0 once I4 is live.

---

## 7. Fleet orchestration

### 7.1 Identity

Seven guest accounts minted with the existing operator tool:
`node server/cli_invite.cjs "tester-01"` … `"tester-07"` (roles `[]`, never
`item_admin`). Tokens land in `~/backpack_fleet/agents/<id>/token` mode 0600,
outside the repo, never committed, never logged. `bpk doctor` verifies §2.4's
identity guard before any session may start.

Naming is a design choice, not a detail: give them ordinary player names, not
`bot_01`. A human who meets them should meet *players*.

### 7.2 Scheduling: 7 agents × 2 sessions / 12 h

The naive schedule (each agent twice a day, randomly) is wrong — it spreads seven
agents thinly over 24 h and guarantees fragmentation. The schedule must
**concentrate** wakefulness.

Proposal — **muster windows**: two windows per 12 h, each ~40 min, all seven agents
staggered 0/4/8/12/16/20/24 min inside the window. Every agent still runs exactly
twice per 12 h (the brief's constraint), but during a window at least four agents
are awake simultaneously, which is what quorum requires.

```
  window A: 08:00–08:40 JST     window B: 20:00–20:40 JST
  (choose windows to overlap the human owner's own play time —
   the point is for a human to bump into them)
```

Implementation: `systemd --user` timers (linger is already on, per PROJECT.md), one
timer per agent per window, `OnCalendar` + `RandomizedDelaySec` for jitter.
`systemctl --user stop backpack-fleet.target` is the kill switch. Sessions are
`Type=oneshot`, `TimeoutStartSec` slightly above the session wall-clock budget, so
a hung session is reaped by systemd rather than by hope.

Note that `HOLD` plus the auto-restart property means an agent does *not* need to
be awake for its troop to keep playing. A session's job is to make decisions and
leave; the troop runs on without it.

### 7.3 Cost

Per session: ~10 turns × (≈2 KB digest + ≈1 KB receipt + prompt) ≈ **15–25 K
tokens**. 7 agents × 2 sessions × 2 (12 h→24 h) = **28 sessions/day** ≈ 0.5–0.7 M
tokens/day. That is small enough that model choice can be driven by *play quality*
rather than by price — and small enough that a runaway loop is the real cost risk,
not steady state. Hence the hard turn/request/wall-clock caps in §3.6, enforced by
the CUI (which cannot be talked out of them) rather than by the prompt.

Proposal: mixed models across agents (e.g. 5 fast / 2 strong) so the test
population is heterogeneous — a game that only reads well to one model class has
not been tested.

### 7.4 Personas

Each agent gets a fixed persona seed injected into its system prompt *and* into the
tactics kernel's build seed: e.g. *hoarder* (banks LRDST, rarely rolls),
*gambler* (rolls gacha hard), *merchant* (lives on the market), *climber* (pushes
`attackLv`), *turtle* (optimises H and cooldown), *socialite* (always joins,
never hosts), *builder* (rebuilds constantly).

Personas are not flavour. They are how one fleet produces seven different economies
of behaviour, which is what makes the market, the level distribution, and the
build space actually get exercised.

---

## 8. Safety and blast radius

- **Live data.** The fleet plays the LIVE game against live Postgres, because the
  point is to meet real humans. There is no hermetic option that satisfies the
  brief. Therefore blast radius must be bounded by capability, not by environment:
  - allowlist of endpoints compiled into `bpk`; anything matching `/api/admin/`,
    `/dev/`, or carrying `genSeed`/`drawSeed` is refused **in the tool**, not in
    the prompt;
  - `claude -p` runs with `--allowedTools` limited to the `bpk` subcommands: no
    Bash, no file writes, no network. The model literally cannot reach the API
    except through the verb set;
  - the identity guard of §2.4 (fail closed if `playerId === 'dev'`).
- **Reversibility.** Every agent account is disposable. `Devotion`
  (`services/ragnarok/devotion.cjs`) is an account-wide destructive rite — the
  fleet must never call it in v1. Add it to the endpoint denylist.
- **Rate.** ≥400 ms between requests, jittered; ≤300 requests/session. Seven agents
  at that rate are a rounding error next to one human clicking around.
- **Market containment.** Spend caps, listing caps, and a standing rule: **no
  fleet-to-fleet trading**. Detect and refuse buying a listing whose seller is
  another fleet account, or the seven of them will happily launder value in a
  closed circle and the market data will be worthless.
- **Data protection.** PROJECT.md's hands-off list applies unchanged; the fleet
  touches `~/backpack_fleet/` only. Live services are read/write via HTTP only —
  no direct DB access, ever.

---

## 9. Observability

Every session writes one JSONL transcript to
`~/backpack_fleet/logs/<agent>/<iso8601>.jsonl`: one record per turn holding the
digest, the verb, the `why` sentence, the receipt, and request timings. A session
footer records budgets consumed and terminal state.

Two derived views:

- **Fleet board** — a static HTML page (built by a small script, served from
  `web/`, same pattern as `tools/build_corpus_browser.py`) showing live troop
  occupancy per band, greeter-seat uptime, time-to-muster, and each agent's last
  decision with its `why`.
- **Play journal** — the `why` sentences, grouped by verb, newest first. This is
  the qualitative product: it is where a designer discovers that every model
  reads `attackLv` as "difficulty" and none of them notice that links matter.

Alarms (cheap, log-driven): greeter-seat uptime < 90 % over an hour; any troop
stalled > `T_muster` × 2; any agent with > 3 consecutive refused verbs; any session
hitting its request cap.

---

## 10. Verification strategy

The tool must be provable without touching live data.

- **Unit** — the tactics kernel is pure: auto-build, triage, pricing, laddering,
  fit scoring all get goldens (the `sim/tests/goldens.cjs` pattern).
- **Canvas conformance** — the highest-risk area. Property test: for random
  inventories, every canvas the CUI would PUT must satisfy
  `engine.checkUidInvariant`. Plus a round-trip test against a real API instance:
  gacha-roll → place → PUT → assert the pending row finalised; claim → place → PUT
  → assert the warehouse row is gone. These are the two flows where a silent bug
  loses a player's items.
- **Integration** — run against a **hermetic** API using the existing rig:
  `tools/e2e_harness.sh` + `tools/e2e_ports.sh`, which lease a free port block
  from the rental port desk (`tools/port_desk.sh`) at run time. Never hand-pick
  a port.
- **Rendezvous simulation** — a pure discrete-event simulation of §6 with N bots
  and M humans arriving by a Poisson process, asserting the invariants hold and
  greeter-seat uptime clears 95 %. This is how the anti-deadlock design gets
  falsified *before* it is deployed, and it costs nothing to run.
- **Live canary** — before the full fleet, run 1 agent for a day, then 4 (the
  minimum quorum), then 7. Do not skip the 4-agent stage; it is the first time
  quorum is exercised for real.

---

## 11. Open questions for the user

These change the design, so they are worth settling before any REQ is written.

1. **Co-op Troop scope.** Confirmed as a real game feature to build (§5)? Or is
   there an alternative reading of the brief in which the AIs share Troops through
   some mechanism that already exists and this survey missed?
2. **Greeter seat (I5).** Do you accept bots deliberately *declining* to fill a
   seat so humans can? It costs the fleet some play throughput and is the single
   biggest lever on "a human can find a game".
3. **Muster windows (§7.2).** Is "twice per 12 h" a hard budget constraint, or a
   proxy for "don't spend much"? Concentrated windows serve quorum; if the intent
   was continuous presence, a different shape (more agents, fewer turns each) is
   better.
4. **Live vs. staging.** Confirm the fleet plays LIVE with real accounts. There is
   no way to meet human players otherwise, but it means bot canvases, bot
   listings, and bot names are permanently in the real data.
5. **Market participation depth.** Full buy+sell, or sell-only in v1? Sell-only is
   dramatically safer for economic integrity and still exercises the surface.
6. **Ragnarok season meta** (`devotion` / `einherjar` / `order`) — in or out of the
   main loop? `devotion` is destructive; recommend out for v1, and denylisted.
7. **Starter-seed duplication** (§4.3) — accept the port-and-drift risk, or do the
   small refactor that moves `buildStarterUnitsState` into `shared/`?

---

## 12. Proposed REQ decomposition

Ten REQs in four tracks. Nothing here is reserved yet.

### Track A — game feature (server). Blocking; without it nothing else has meaning.

| # | Working title | Substance | Size |
|---|---|---|---|
| A1 | co-op troop data model + join/leave | slot ownership, `visibility:'public'`, browse/join/leave endpoints, per-joiner deploy gate | L |
| A2 | multi-participant run execution | load four canvases at departure, snapshot, fan settled rewards to four warehouses, multi-owner cancel/leave semantics | L |
| A3 | muster rules | level bands, `musterDeadline` + auto-dissolve, troop-level `attackLv` immutability | M |

### Track B — the CUI tool (`bot/`). The reusable asset.

| # | Working title | Substance | Size |
|---|---|---|---|
| B1 | `bpk` core: client + canvas layer | HTTP client, auth guard, endpoint allowlist, engine.js adapter, first-fit/uid/LRDST ops, `checkUidInvariant` gate, fresh-profile bootstrap | L |
| B2 | tactics kernel | auto-build (§4.4), triage, pricing bands, level ladder, fit scoring — all pure, all goldened | L |
| B3 | judgment interface + session runner | digest/verb/receipt schemas, refusal contract, budgets, JSONL transcript, `bpk digest` / `bpk act` | M |
| B4 | hermetic conformance suite | REQ-derived-port harness, gacha/claim round-trips, canvas property tests, rendezvous discrete-event sim | M |

### Track C — the fleet.

| # | Working title | Substance | Size |
|---|---|---|---|
| C1 | claude CLI integration + personas | prompt pack, `--allowedTools` sandbox, model mix, seven persona seeds | M |
| C2 | fleet orchestration | seven accounts + token vault, systemd timers, muster windows, kill switch, budget ledger, greeter-seat policy state | M |
| C3 | observability + acceptance | fleet board, play journal, alarms, the greeter-seat-uptime ≥95 % acceptance gate | M |

### Dependency graph

```
   A1 ──> A2 ──┐
    └──> A3 ───┤
                ├──> C1 ──> C2 ──> C3
   B1 ──> B2 ──┤            ↑
    └──> B3 ───┘            │
          └──> B4 ──────────┘
```

Track B can be built and fully tested against the *solo* API while Track A is in
flight — `bpk` playing solo (one player, four own squads) is a legitimate
intermediate milestone that exercises every non-rendezvous surface. That is the
recommended parallelisation, and it is also the natural place to discover the
canvas-layer bugs while they are still cheap.

### Suggested order

`B1 → A1 → B2 → A2 → B3 → A3 → B4 → C1 → C2 → C3`

B1 first, deliberately: it is where the unknown-unknowns live (the client-authored
canvas seam of §1.1). If B1 is harder than it looks, everything downstream needs
re-planning, and it is better to learn that in week one.

---

## 13. What this design refuses to do

- **No LLM in the hot path of interpretation.** No parsing event logs, no reading
  canvases, no "look at this JSON and decide". If the model ever needs raw game
  state to choose well, that is a bug in the digest, not a reason to widen the
  interface.
- **No free-form tool access.** The verb set is the whole API. A tester that can
  call arbitrary endpoints is an agent, not a player, and it will exercise paths
  no human ever walks.
- **No cleverness in the canvas builder.** The brief is explicit and the design
  agrees: a simple local algorithm. Squad optimisation is a separate research
  problem and would swamp the matchmaking signal we actually want.
- **No hidden privileges.** If the fleet needs a dev seam to play, that seam is a
  missing feature and should be built as one.

---

## Appendix — decisions & findings folded from the program handoff (2026-08-02, REQ-0358; original: archive/2026-07-27-fleet-program-handoff.md)

User-ratified decisions (2026-07-27):

1. **Tidy first** — the engine moved into `shared/` (REQ-0309) so `bpk` calls
   `shared/` instead of re-implementing the client canvas layer.
2. **Reactive, not autonomous** — bots never HOST a Troop; they wake on a
   player's recruitment and drip-fill seats ~2 min apart; they never cancel.
   This deletes the matchmaking/anti-deadlock apparatus; fragmentation is
   structurally impossible. The LLM's work moves to the housekeeping window
   after a Troop disbands.

Consequences easy to lose:
- Polling is not autonomy: a cheap deterministic daemon watches the event feed;
  the LLM wakes only when a real choice exists.
- The escape hatch is mandatory: the deploy gate blocks a uid across active
  rooms and auto-restarts forever (`runs.cjs:323`). Rule: 解散はしないが、席は
  返す — leave when the host is absent T hours or opens a new Troop.
- Without the housekeeping session the LLM is a cron job: seat-filling is a
  shell script; the value is claim/dismantle/gacha/market/rebuild plus the
  one-sentence `why` each verb carries.

Findings a fresh session must not re-derive:
- Co-op Troops do not exist: `rooms.cjs:111` hardcodes `visibility:'self'`; a
  slot is a bare `squadIndex`; `startRun` sets `participants=[room.ownerId]`.
  BUT `sim/lib/dungeon.cjs:32` `distributeRewardsUniform` is already
  multi-participant — the combat core needs no change.
- Gacha, warehouse claim and the fresh-profile seed are client-authoritative:
  the server rolls/reserves; the CLIENT mutates the canvas and PUTs, and that
  PUT is the commit (why REQ-0310 existed).
- Identity hazard: live `data/config/dev_user.json` has no `dev_mode` key and
  `admin.cjs:71` defaults it to true — a token-less request silently resolves
  to the DEV player. `bpk` must fail closed on this.
- `tools/ci.sh` is not reliably green at its default 4 e2e workers (observed
  twice independently, different specs; green at `E2E_PARALLEL=1`) — recorded
  as an addendum to REQ-0222.
- Salvage: `~/backpack_ragnarok_salvage/req-0073-build_dungeon_preview.patch`
  (145 lines of real uncommitted work).
