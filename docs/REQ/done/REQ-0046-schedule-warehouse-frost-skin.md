# REQ-0046 — Schedule/Warehouse Frost-Fantasy Visual Pass

- **Status**: Rooms — visual pass still PROPOSED, not implemented. **Warehouse —
  DONE (2026-07-06)**: all 6 structural proposals below implemented, tested, and
  deployed live. Commits on `schedule-ux-improvements`: `73c6893` (feature),
  merged to master via `c3ef67a`, dist rebuild `7362215`.
- **Rooms section**: approved by user as-is (2026-07-06), not yet built.
  **Warehouse section**: rewritten below after a from-scratch UX pass
  (2026-07-06), then implemented in full the same day — see "Warehouse: design
  rationale" for what changed and why, and "Warehouse: outcome" for what shipped.

## Context
User rejected an early internal mockup for inventing a "Recall" action and a
persistent cancel-confirm fixture that don't exist in the real app ("Recallは、有効な
選択肢ではないはずです。勝手に新しいボタンは作らないでください。既存のコードを読み、
合わせてください。ただ、スタイルは良いです。"). This REQ corrects that: it re-skins
the Schedule screen's Rooms tab in the approved dark icy/dungeon visual language,
using ONLY the actions and fields that already exist in
`client/src/schedule/{SchedulePage,RoomCard}.tsx` (branch
`schedule-ux-improvements`, merged to `master` at `f09f43a`/`0f434d2`). No new
buttons, no new states, no server/API changes on the Rooms side.

For the Warehouse tab, the user asked for something further: not a reskin of the
current layout, but a redesign starting from what the system actually does and
from how other games solve the same problem, explicitly without anchoring on the
current implementation's shape ("あなたは...現在のデザインを参考にすべきではありません。
外部のデザインを参照し...take more time and research."). That research and its
conclusions are recorded below.

## Non-goals (do not invent these)
- No "Recall", "Undo cancel", or any reversible-cancel action. `cancelRoom` (`api.ts`)
  is a one-way call. `RoomCard.tsx`'s only cancel UI is the existing transient
  `confirmingCancel` row (lines 136–148) shown right after clicking Cancel on any
  non-canceled room — not a fixture attached to `cancelPending` cards.
- No new Warehouse actions (no sell/discard/bulk-claim). `handleClaim`
  (`WarehouseTab.tsx:289`) is the only mutation this tab has.
- No changes to `server/schedule.cjs`, `server/api.cjs`, or `api.ts` — every field
  used below is already returned today.
- No restyle of the embedded `InventoryBoard` (`schedule-warehouse-board-slot`,
  `WarehouseTab.tsx:436`) — shared with the Backpacks page; a separate REQ if ever
  done.

## Reference: real action/state inventory (implementer must not deviate)
**Rooms tab** (`SchedulePage.tsx`, `RoomCard.tsx`):
- Toolbar (`SchedulePage.tsx:175–195`): "Create a room"/"Collapse" toggle
  (`schedule-create-toggle-btn`) + "Hide canceled (N)" checkbox
  (`schedule-hide-canceled-toggle`, N = `canceledCount`, shown only when > 0).
- Card (`RoomCard.tsx:104–156`): room id (12 chars), status badge — one of
  `idle`/`cooldown`/`running`/`cancelPending`/`canceled` (`deriveStatus`, lines
  47–58) — dungeon name, level, `createdAtLabel`, cooldown countdown (status
  `cooldown` only), Expand/Collapse, Cancel (hidden once `canceled` or while
  confirming).
- Transient cancel confirm (lines 136–148): appears only right after Cancel is
  clicked; Yes (`schedule.cancelConfirmYes`) / No (`schedule.cancelConfirmNo`).
  This is the entire cancel flow — no other variant exists.
- Expanded body (lines 150–155): `SlotsPanel` + `Monitor` — out of scope, not
  visually touched by this REQ.

**Warehouse tab** (`WarehouseTab.tsx`):
- Header: title + "N / 200" cap (`schedule-warehouse-cap`, `WAREHOUSE_CAP=200`,
  line 53, display-only).
- Row (lines 400–423): item name (`localizedItemName`), harvested-at absolute
  timestamp, expires-in countdown or "Expired" (`formatCountdown`, reused from
  `RoomCard.tsx`), Claim button (disabled while `claimingUid` matches), inline
  error if `claimErrors` has an entry.
- Toast (`schedule-toast`, line 392) for no-space/failed feedback.
- Embedded live `InventoryBoard` portal (line 436) — same Pixi instance as
  Backpacks; out of scope (see Non-goals).

## Design — visual language (approved)
Dark icy/dungeon gradient background, cyan/cel-shaded accents, thin glowing
borders, card layout for rooms. See the reviewed mockup
(`niflheim_board_grounded_v2`) for the concrete target. Reuses the `--warn`/
`--dim`/`--ok`/`--bad` tokens already added in the `schedule-ux-improvements` pass
for status color — this REQ does not rename or remove them. (Warehouse now has
its own section below — it keeps this same visual language, but its structure
changed, not just its skin.)

## Client: `index.css` — Rooms only (additive; keep every existing class/data-testid)
- Background: radial dark-teal-to-near-black gradient on `.schedule-page` (check
  whether a parent layout container already sets a background before adding a
  second one).
- `.schedule-room-card`: swap flat background for a two-stop vertical gradient +
  0.5px translucent cyan border, per mockup.
- Status badges: keep the existing warn/cyan/ok/bad/dim color mapping fixed in
  the prior pass; add background alpha + subtle text-shadow glow only.
- New `.schedule-room-dungeon-icon`-style 40×40 thumbnail slot at the left of each
  card's title row — additive; no prop plumbing needed beyond what's already
  passed.

## Client: component logic — Rooms only
No new props, state, or handlers required in `SchedulePage.tsx` / `RoomCard.tsx`
for the background/card/badge changes — CSS only. The dungeon-thumbnail slot is
the only place needing a one-line JSX addition (an inline placeholder SVG) in
`RoomCard.tsx`'s title row (around line 107); see "Icons" below.

---

## Warehouse: design rationale (from-scratch UX pass, 2026-07-06)

The user's instruction was specific: do not reskin `WarehouseTab.tsx`'s current
list — re-derive what this screen is FOR from the real system end to end, look
at how other games solve the same problem, and design from there. This section
records that investigation before getting to any concrete proposal, so the
proposal below can be checked against its own reasoning.

### What the system actually does (re-verified in `server/schedule.cjs`, not assumed)
- **Loot never goes direct to inventory** — every dungeon-run reward lands in the
  Warehouse first, by design (`docs/REQ/REQ-0036-dungeon-schedule.md` golden e/f:
  "Harvested items do NOT go to inventory directly... Warehouse → inventory
  transfer any time"). The Warehouse is a deliberate gameplay beat (return from
  an expedition, then go collect what it found), not an incidental buffer.
- **Cap = 200 items, TTL = 7 days** (`WAREHOUSE_CAP`/`WAREHOUSE_TTL_MS`,
  `server/schedule.cjs:50-51`) — both real, both enforced server-side.
- **Two silent-loss paths exist today, and neither is surfaced to the player**:
  (1) `addToWarehouse` (`schedule.cjs:898`) refuses new rewards once the caller
  is at 200 items — the function's own comment calls this out explicitly:
  "a dungeon reward that arrives when the warehouse is already full is SILENTLY
  DROPPED (not queued, not bounced back to the run)". (2)
  `purgeExpiredWarehouseItems` (`schedule.cjs:875`) deletes any row past its
  7-day `expiresAt` on every read, before the client ever sees it — so the
  client's existing `schedule.warehouse.expired` label is only theoretically
  reachable in a sub-poll-interval race window, never in practice. **Both loss
  modes are invisible until after the fact.** This is the single most important
  finding of this pass: the redesign's job is to make the risk visible BEFORE
  loss, since after-the-fact notice isn't realistically possible given how the
  server is built.
- **Rewards arrive in two different shapes**, and the current UI treats them
  identically: individual PO/SI item rows (one per rewarded participant,
  `schedule.cjs:722-734`) that need a placement decision, versus an aggregate
  LRDST currency stack (`kind:'tm'`, carries `qty`, `schedule.cjs:745-753`) that's
  just a resource. `WarehouseTab.tsx`'s own `handleClaim` already branc