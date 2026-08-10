# REQ-0368 — Notification center: bell + nav badges + login digest

## Status
built — all gates green on branch req-0368-notification-center (2026-08-10);
NOT yet merged/deployed/accepted. Spec by Cowork session 2026-08-10 (gamer-lens
UI gap analysis batch); ratified by user 2026-08-10, chat: 「では、それらを全て、
TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Findings P0-6 + P0-7 combined (same
data spine).

## Problem (gamer-facing)
The game is designed around absence (real-time auto-repeating expeditions,
7-day warehouse decay) yet almost nothing is pushed to the player. Today's
entire push surface is two toast kinds: troop disband and the wipe-streak
halt (`client/src/TroopDisbandToast.tsx` + `client/src/i18n/notify.ts`, the
whole file). Everything else is pull-only:
- expedition returns / victory / wipe → must open Schedule;
- market settlement → must open My Listings (`market.mine.settledChip`);
- warehouse near-expiry → must open Warehouse; expired items vanish SILENTLY;
- there is no "what happened while I was away" summary at login, the single
  most important screen in an AFK-first design.
The nav rail carries no badges at all, while the lower-level inventory tabs
already pulse (`client/src/lib/tabPulse.ts`) — the hierarchy is inverted.

## Evidence (verified 2026-08-10)
As cited above; plus: `/api/notifications` + polling client already exist
(REQ-0327), and the server owns every emission moment (run settle in the
schedule services, market settle in `server/services/market/trade.cjs`,
warehouse expiry sweep in the warehouse service/storage).

## Spec
1. Server — extend the REQ-0327 notification seam with kinds:
   `run_settled` {result, dungeon, lootCount, roomId},
   `market_settled` {itemName, net, burn},
   `warehouse_expiring` {count} (emitted once per item entering the <24h
   window; batch-collapsed per sweep),
   `warehouse_expired` {itemNames[]} (the silent-loss fix).
   Storage via the existing notifications mechanism; pg migration only if the
   current schema cannot carry a kind payload. All emission points are
   existing service code paths — no new subsystems.
2. Client — Header bell with unread count; opening it lists notifications
   (newest first, mark-read on open). ONE poller: reuse/extend the
   TroopDisbandToast poll — do not add a second loop. Toast behavior for the
   existing two kinds is unchanged.
3. Nav badges — rail entries show counts where a kind maps to a hall:
   warehouse (expiring), schedule (unseen settled runs). Small, colorblind-safe
   (shape+number, not color alone — REQ-0143 convention).
4. Login digest — on boot, if unseen notifications exist since the last seen
   timestamp: one dismissible modal summarizing runs (W/L), spoils count,
   market income (net ᚠ), and expired losses. Pure aggregation of the
   notification rows; a `since` query param on the list endpoint is the only
   server addition.
5. All copy through chrome i18n (extend `i18n/notify.ts`), en/ja parity.

## Gates
- api_test: new kinds emitted at their moments; `since` filtering; both
  storage backends (files + pg parity as per the suite convention).
- e2e: settle a run → bell count 1 → open → count clears; expiring item →
  warehouse badge; reload with unseen rows → digest modal appears once.
- Polling budget: request cadence unchanged from today's toast poll.
- CI green.

## Out of scope
Web-push/email, friends/social notifications, notification settings page.

## Cross-refs
Digest links "organize" CTA → REQ-0373/0374 targets if they have landed.

## Build (2026-08-10)

Branch `req-0368-notification-center`, implementation commits `ad7d0689`
(feature), `5d61198a` (ci-scope table), `10ba90b8` (e2e hygiene).

### Files
New:
- `client/src/notify/notifyContext.ts` — the feed context + `useNotificationCenter`
  + `NOTIFY_POLL_MS` (15s, REQ-0327's cadence unchanged).
- `client/src/notify/NotificationCenter.tsx` — THE provider: one poller for the
  whole app, plus centralised ack with an optimistic local retire.
- `client/src/notify/digest.ts` — pure derivations shared by every surface
  (`buildDigest`, `navBadgeCounts`, `DIGEST_KINDS`).
- `client/src/notify/notifyText.ts` — one entry → one line, for bell + digest.
- `client/src/notify/NotificationBell.tsx` — header bell, mark-read on open.
- `client/src/notify/LoginDigest.tsx` — the boot modal.
- `client/e2e/notification-center.spec.ts` — the three e2e gates.

Edited:
- `server/services/notifications.cjs` — `append()`'s idempotency key widened to
  (kind, roomId, dedupeKey); four emitters added.
- `server/services/runs.cjs` — `settleRun` emits `run_settled` after both docs
  are durable, with the level the dive was FOUGHT at (captured before the
  level-down rewrites `room.level`).
- `server/services/market/trade.cjs` — `buyListing` emits `market_settled` to
  the seller after all seven settle steps commit.
- `server/services/warehouse.cjs` — the purge sweep's announce pass
  (`warehouse_expired`, `warehouse_expiring`), a `sweepDepth` re-entrancy guard,
  `WAREHOUSE_EXPIRING_WINDOW_MS` (24h), and `devSetWarehouseExpiry`.
- `server/routes/warehouse.cjs`, `server/schedule.cjs` — the
  `POST /api/warehouse/dev/backdate-expiry` seam.
- `shared/dto.ts` — `ApiNotificationKind`, `dedupeKey`, nullable `roomId`, the
  widened payload union.
- `client/src/App.tsx` (provider + digest), `Header.tsx` (bell), `Nav.tsx`
  (badges), `TroopDisbandToast.tsx` (reads the context; its poll moved out),
  `i18n/notify.ts` (+26 keys, en/ja parity), `styles/base.css`.
- `server/tests/api/schedule.cjs`, `server/tests/api/market.cjs` — 4 new AT
  blocks; three REQ-0327 assertions kind-scoped (see below).
- `client/e2e/helpers.ts`, `schedule.spec.ts`, `squad-switch.spec.ts` — the
  boot-time feed drain.
- `tools/ci_scope.sh` — `client/src/notify` declared public surface.

### Decisions taken while building (deviations from the spec, and why)
1. **`since` needed no server addition.** Spec item 4 called a `since` query
   param "the only server addition"; REQ-0327 had already shipped it as an id
   cursor, and it filters the new kinds exactly as it filters the old ones. The
   digest is built from the unseen rows the existing endpoint already returns.
   Nothing was added; the api_test asserts the cursor over a new kind.
2. **`append()`'s dedupe key had to widen.** REQ-0327's (kind, roomId) is only
   an identity for once-per-room events. A room settles a run every few minutes
   and each must notify, so entries now carry `dedupeKey` (run id / listing id /
   sweep stamp). It defaults to null — what every entry already on disk carries
   — so REQ-0327/0357 collapse behaviour is byte-identical.
3. **`warehouse_expired` carries ids AND resolved names.** Names are resolved at
   emit time through the same `def.name` / `i18n.ja.name` / `name_ja` chain
   `views.cjs`'s `toListingDto` uses, so the bell and a market card never
   disagree. `run_settled` carries `dungeonId` rather than a resolved dungeon
   name: the client already owns that lookup (`SchedulePage.dungeonNameFor`) and
   the settle path should not grow a content read.
4. **`market_settled` goes to the SELLER only.** The buyer acted synchronously
   and holds the receipt in that response; the seller is the absent party the
   centre exists for.
5. **`warehouse_expired` is NOT a nav badge.** The items are gone — there is no
   action to take in the warehouse — so only `warehouse_expiring` badges the
   rail. The loss still reports through the bell and the digest.
6. **A dev seam was necessary.** `POST /api/warehouse/dev/backdate-expiry`,
   sibling of REQ-0041's `dev/backdate-claim` and gated identically (dev_mode
   fallback caller only, always its own id). The 7-day TTL and its last-24h
   window are otherwise unobservable in a test.
7. **No pg migration.** `027_notifications` stores the whole entry as `jsonb`;
   the new fields need no schema change. pg parity is proven by [5/7] running
   the same suite against the pg backend.

### Two things this REQ found, not built
- **Three REQ-0327 assertions were counting the wrong thing.** They used
  "entries for this room" as a proxy for "troop_disbanded entries" — true while a
  room could only notify one way. The same room's final dive now emits
  `run_settled` on the settle poll, so they are kind-scoped. The disband
  emission itself is unchanged.
- **A boot-time modal is hostile to the e2e suite.** Eight specs failed on
  inherited feed debris, with the digest scrim intercepting the first click.
  Fixed at `helpers.bootApp`, which now acks the caller's unseen feed before
  navigating — deterministic, where "dismiss it if it appears" would race the
  first poll and "wait in case it appears" would put back the assertion-free
  sleep REQ-0331 (F4) removed from that very function.

## Gate results (all green, 2026-08-10)
- **api_test (files backend), [4/7]**: 236 passed, 0 failed (baseline 232 + 4 new
  REQ-0368 blocks). Covers: `run_settled` solo (payload, `attackLv` = the level
  FOUGHT, dedupe across re-polls, the `since` cursor, ack, no-leak);
  `run_settled` troop (every participant notified, each with their OWN
  `lootCount`, the per-participant counts summing to the run's whole reward set);
  the warehouse sweep announcing both edges, once each, with a row crossing into
  the window later getting its own batch; `market_settled` to the seller with
  `net`/`burn`/resolved name matching the market card, and the buyer NOT notified.
- **api_test (pg backend), [5/7]**: 236 passed, 0 failed — the files/pg parity
  the gate asks for, same suite, same assertions.
- **Typecheck**: `tsc -p tsconfig.server.json` exit 0; `client && pnpm exec tsc -b`
  exit 0.
- **oxlint**: 0 errors, 36 warnings — byte-identical to master's 36. The provider
  was split into `notifyContext.ts` / `digest.ts` / `NotificationCenter.tsx`
  precisely so it adds none.
- **i18n**: 26 en keys / 26 ja keys in `i18n/notify.ts`, set-equal.
- **e2e, [7/7]**: 229 passed, 1 skipped, 0 failed (scoped hermetic fleet, GPU).
  `notification-center.spec.ts` all 3: settle → bell 1 + schedule badge → open →
  both clear; a row entering the <24h window → warehouse badge; boot with unseen
  news → digest → dismiss → reload shows no second digest.
- **Polling budget**: unchanged. One `usePolledResource` at 15s, exactly the
  interval and hook `TroopDisbandToast` used before this REQ; four surfaces now
  share that one loop. No second interval exists anywhere in `client/src`.
- **CI GREEN**: full `tools/ci.sh`, `CI_SCOPE=both`, 352 s wall, receipt written
  for tree `e0191212` (2026-08-10).
