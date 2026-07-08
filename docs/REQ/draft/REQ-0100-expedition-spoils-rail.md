# REQ-0100 — Expedition spoils rail (right column preview)

- **Status**: DRAFT (原案) — awaiting owner review (2026-07-08). Part of the
  Expedition 大改修 series (see REQ-0097 §Series). Mock element: the right column
  `ᚷ 戦利品 SPOILS ・ 待機 4件`, capacity `倉庫 187/200`, item cards, and
  `一括回収`. Depends on REQ-0097's 3-column shell.
- **Origin**: REQ-0071 omitted the right column because "the warehouse lives in
  this page's Warehouse TAB (REQ-0072 owns its restyle); duplicating claim flows on
  the rooms view would fork that unit." This REQ adds a **READ-ONLY preview** (no
  claim fork), so the mock's 3-column frame is honest and complete.

## Design

- **Data**: reuse the warehouse rows `SchedulePage` already polls for the Warehouse
  tab (REQ-0072) — **no new endpoint, no new poll**. The rail is a compact,
  read-only preview:
  - header: `待機 {pending count}` + a capacity meter `{n}/200` (reuse REQ-0072
    `.bar` + staged `calm/warning/full` classes; distinct testid).
  - the soonest-to-expire N rows as small item cards (iconDataUrl thumb +
    rarity-tinted name + expiry chip), same ordering the tab uses.
  - `回収` / `一括回収` → **deep-link** to the Warehouse tab (switch tab + focus the
    row), NOT an inline claim — this avoids forking the REQ-0041 two-phase claim.
  - the mock's `収蔵は7日で朽ちる` lore line = the real 7-day TTL (honest).
- **No fork rule**: default = preview + deep-link. If [USER] chooses inline claim
  instead, it MUST call the SAME claim path as `WarehouseTab` (REQ-0041/0072) — one
  code path, never a parallel one.

## Explicitly omitted

- The **NIGHT TALLY** slab (踏破/討伐/被弾/献身) beneath the spoils in the mock —
  no aggregate data (see REQ-0097 §Omitted). The rail ends at the spoils preview.

## i18n

`schedule.spoils.title` / `.pending` / `.capacity` / `.claimHint` / `.lore`
(EN natural / ja mock copy).

## Selector contract

New: `schedule-spoils-rail`, `schedule-spoils-count`, `schedule-spoils-cap`,
`schedule-spoils-row`, `schedule-spoils-claim-jump` (deep-link) — or reuse the tab
claim testids if inline claim is chosen. Warehouse tab selectors unchanged.

## [USER] decision list

1. `回収` behavior: deep-link to the Warehouse tab (recommended, no fork) vs inline
   claim (reusing the exact tab path).
2. Preview row count (mock shows ~3–4).
3. Include currency (TM) rows in the preview, or spoils items only.

## Dependencies

- REQ-0097 (the right column exists in the shell). REQ-0072 (warehouse data + claim
  path — reused, untouched).

## Test plan (gates before DONE)

- client E2E: pending rewards appear in the rail (count + soonest-expiry order +
  capacity meter); `回収` deep-links to the Warehouse tab (or, if inline, claims via
  the same path and the row leaves BOTH rail and tab); assert no second claim path
  exists.
- `tsc -b` clean; fresh dist committed. No server change (default deep-link path).
