> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0098 — Room cooldown ring (蛇環 / 次戦まで %)

- **Status**: DRAFT (原案) — awaiting owner review (2026-07-08). Part of the
  Expedition 大改修 series (see REQ-0097 §Series). Mock element: the cooldown room
  card's "ヨルムンガンドの環 — 次戦まで 68%" progress ring. Reuses REQ-0072's
  `TtlRing` arc/dot geometry (its heads-up note lifts it for exactly this).
- **Origin**: REQ-0071 omitted the ring because "`ApiRoom` has `cooldownUntil` but
  not the cooldown's total duration, so a percentage can't be derived at card
  level." This REQ surfaces the REAL total, so the % is honest data — NOT fiction.
  It is independent of REQ-0097 (works on the current cards too) → good early win.

## The data gap

Cooldown END is `ApiRoom.cooldownUntil` (exists). A progress ring needs
`elapsed / total`. The total IS computed server-side at run end (REQ-0036 golden l:
"cooldown scaled by all participating Squads' BP HP at finish"); it is simply not
exposed on the wire. Fix = expose the span, derive the pct client-side.

## Design

- **Server**: add ONE optional field to `ApiRoom` in `shared/dto.ts` — [USER pick]:
  - `cooldownStartedAt` (ISO) — **preferred**: pairs with `cooldownUntil`, needs no
    recompute (it is the run-settle instant), and the client derives
    `pct = (until − now) / (until − started)`.
  - or `cooldownTotalSecs` (number) — the computed duration.
  Written where `cooldownUntil` is set (run settlement in `server/services/rooms.cjs`
  / `runs.cjs`). Persist through the storage seam (files + pg parity). Legacy rooms
  lacking the field: NO ring, textual countdown chip only (REQ-0071 fallback) — no
  invented value.
- **Client**: on `status === cooldown` room cards, render a frost arc ring (lift
  `TtlRing` from `WarehouseTab.tsx`) around the emblem disc (or beside the existing
  `schedule-room-countdown` chip); fill = remaining pct; center label = `次戦まで
  {pct}%` or the existing mm:ss countdown. Display-only; the 1s ticker already runs
  (REQ-0071). The mock's "ヨルムンガンド/蛇環" naming is flavor for the cooldown
  ring — EN stays neutral ("cooldown"); ja MAY adopt the 蛇環 / 次戦まで copy.

## i18n

`schedule.room.cooldownRing` (title/aria). Existing countdown keys reused.

## Selector contract

New: `data-testid="schedule-room-cooldown-ring"` (+ class
`.schedule-room-cooldown-ring`). Existing `schedule-room-countdown` kept.

## [USER] decision list

1. Field: `cooldownStartedAt` (recommended) vs `cooldownTotalSecs`.
2. Ring placement: around the emblem disc vs beside the countdown chip.
3. ja copy: adopt 蛇環 / 次戦まで vs neutral wording.

## Dependencies

- Small server DTO + one settlement write. Independent of REQ-0097; if 0097 lands
  first the ring simply rides the new list card.

## Test plan (gates before DONE)

- server: a cooled-down room exposes the field (files + pg parity); a legacy room
  without it is handled gracefully (no ring, no NaN).
- client E2E: a cooldown room shows the ring with a plausible pct that decreases
  across a backdated tick; a non-cooldown room shows no ring.
- `tsc -b` clean; fresh dist committed.
