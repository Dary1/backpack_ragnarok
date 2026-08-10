# REQ-0368 — Notification center: bell + nav badges + login digest

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

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
