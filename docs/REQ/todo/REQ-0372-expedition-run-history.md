# REQ-0372 — Expedition run history: per-room past runs list + replay access

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Finding P1-2.

## Problem (gamer-facing)
Only the LATEST settled run of a room is viewable (REQ-0099 settled replay).
There is no past-runs list, no W/L record, no loot history — "what dropped
yesterday?" has no answer, and a player tuning a build cannot compare run N
with run N-1.

## Evidence (verified 2026-08-10)
`client/src/schedule/` census: Monitor renders the live or latest settled run
only; no history UI anywhere (grep). Replay JSONL is already produced per run
and persisted via the runs storage path — the data exists, only retention and
display are missing.

## Spec
1. Server: room runs listing — last N=10 settled runs {runId, result,
   startedAt, durationMs, level, lootSummary[]} — plus replay fetch by runId.
   Retention: keep the last 10 replays per room, prune older at settle time
   (storage-growth guard; both backends). Wire shapes into `shared/dto.ts`.
2. Client: a "History" fold in the room detail under the monitor — one row
   per run (result glyph, clear time, level, loot chips); clicking a row loads
   that replay into the existing monitor playback path.
3. Aggregate line at the fold head: this room's W/L tally (from the listed
   window, labeled as such — no pretense of all-time stats).
4. i18n en/ja for all new strings.

## Gates
- api_test: listing + by-id replay + pruning, files AND pg backends.
- e2e: two settled runs → history shows 2 rows → older row's replay plays in
  the monitor (transport controls work).
- Frozen surfaces respected: `sim/` untouched; replay bytes byte-identical
  through the new fetch path.
- CI green.

## Out of scope
Global cross-room stats page, charts/graphs, loot-table analytics.

## Cross-refs
REQ-0371 (may read "highest recent clear" from this listing).
