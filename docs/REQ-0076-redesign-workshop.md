# REQ-0076 — Workshop screen (#/workshop) MJOLNIR re-skin

Branch: `req-0076-redesign-workshop`. Sixth of the redesign series (after
REQ-0069 foundation, REQ-0070 canvas, REQ-0071 expedition, REQ-0072
warehouse, REQ-0075 dex). Mock NORMATIVE for visuals:
`web/redesign/workshop.html` ("Forge of Fates") + styleguide/ui.css,
shared layer already in `client/src/theme/mjolnir.css`.

Scope: the Workshop route (`#/workshop`, REQ-0042) — the Common BP gacha
(10x LRDST -> seeded random polyomino BP), the currency balance display,
the casting-odds panel, and the result modal (the BP 図解: shape + linker
cell + compass beam dirs + hpMax). BEHAVIOR UNCHANGED (REQ-0042/0045
semantics): the two-phase claim-style gacha finalize (POST /api/workshop/
gacha mints a pending roll -> THIS client deducts the cost via engine
spendTM + first-fit-places the rolled BP + pulses + auto-saves -> the
profile PUT is what finalizes the roll server-side; lazy revert of
abandoned rolls), the page-scoped largest-stack-first spend, the
open-page-first placement with tab-pulse fallback, the local refund on a
"no space anywhere" roll, and the 409/insufficient-funds gate. This is a
CLIENT-ONLY re-skin plus one E2E test-fixture fix (Task 1, below). No
server, sim, content, or DTO code was changed.

The result diagram delegates to the shared `dex/BpDiagram` +
`dex/ShapeGrid` (the `render/itemCard.ts` composition-math family) —
NOT forked, NOT a new render path — re-toned to the forge palette via
CSS only.

## Task 1 (pre-req triage) — the `workshop.spec.ts:348` reward test

**Symptom (documented pre-existing failure, first flagged by REQ-0072).**
The test `Reward LRDST reaching warehouse › a dungeon run reward deposits
LRDST into the warehouse` (`client/e2e/workshop.spec.ts:348`) creates a
room, assigns 4 unique presets (which auto-starts the run), backdates it
5 s, then GETs the room to force lazy settlement and asserts an `lrdst`
warehouse row with `qty > 0`. It failed deterministically: the run
resolved `result:'wipe'` at t=0 with `party_bp_hp` all `[0,0,0,0]`, and a
wipe intentionally deposits nothing (golden i).

**Root cause = test-fixture bug (NOT a server/sim regression).** The old
fixture's only PO was a bare `hilt`. In the live content
(`content/live/live_items.json`), `hilt` has `effects: []` — it is a
weapon PART, inert unless assembled — while the damage-dealing strike
effect lives on `blade` gated `cond: 'assembled'`. So the party could
deal ZERO damage and ALWAYS wiped, regardless of hpMax; the fixture's
`hpMax:40` merely delayed the guaranteed loss. The reward path itself is
correct by design: `server/services/runs.cjs` settleRun gates reward
accrual behind `if (run.result !== 'wipe')` (golden i "a wipe deposits
nothing"), and the sibling `schedule.spec.ts:459` reward test documents
the same and only asserts rewards on a non-wipe. So no server/sim change
is warranted.

**Fix.** Give each of the 4 preset units an assembled weapon (a `blade`
at cell [0,1] + a `hilt` at [1,1], which the engine assembles into a
`longsword` whose blade strike fires once `cond:'assembled'` is met) plus
`hpMax:800` to survive the fixed niflheim gauntlet (which ends in the
400-HP hrimgrimnir boss). Per-tag-unique uids are kept so the REQ-0045
same-room deploy gate still passes.

**Verified empirically (headless, not just by inspection).** A repro
mirroring `runs.cjs` startRun exactly — `combat.runDungeon` over
`sim/dungen.cjs` `generate('test_fixed', 1, seed)`, `formation1`, level
1, 4x the fixture unit — across 200 crypto-random combat seeds:
  - OLD fixture (hilt only, hpMax 40): **0 victories / 200 wipes**;
    `lrdstReward: 0`, `rewards: 0` (reproduces the failure exactly).
  - NEW fixture (blade+hilt longsword, hpMax 800): **200 victories /
    0 wipes**; `lrdstReward: 13`, `rewards: 4` (LRDST now accrues).
The scenario is legitimate real play, so it was FIXED (not skipped).

Committed as `bd230d4` (the reward-test party must be able to WIN, not
just survive). `npx playwright test --list e2e/workshop.spec.ts` parses
all 8 tests cleanly after the change.

## What landed (mock → delivered)

| Mock element | Delivered as |
| --- | --- |
| `.pagehead` (kicker FORGE OF FATES / 工房 / lede ᛈ ペルスロ…) + headline rune ᛈ | `.workshop-pagehead` strip + `.rune-divider` (glyph ᛈ), mirroring the SchedulePage/Dex pagehead recipe. New keys `workshop.pageKicker/pageLede`. |
| HUD `.res` chip (ᚠ 1,284) + 第参季/鋳造可 chips | OMITTED — global chrome, REQ-0069 stance (every sibling port took the same omission). The cast panel's own cost row carries the real balance instead. |
| `.colhead` (鞄鋳造 / PACK CASTING) | `.workshop-colhead` (rune ᛈ + dj title + den + micro note). Keys `workshop.castHeading/castHeadingDen/castHeadingNote`. |
| `.forge-grid` cast panel (art well + 鋳 watermark, title, cost row, forge CTA, footnotes) | `.workshop-cast` = `panel ornate` + knots. Art well shows the mock's 鋳 seal glyph (no `ic_pack.png` art dependency). The `workshop-gacha-card` testid rides the cast panel. Cost row = ᚠ rune + currency wording + real owned balance. The roll button is the screen's one `btn-forge` (kept `workshop-roll-btn` testid). |
| Cost line `通貨アイテム ×10` + `所持 N` | `.workshop-cast-cost`: ᚠ rune + `workshop.cost` (re-worded to drop LRDST, see currency note) + `workshop.ownedLabel` + the real cross-page lrdst balance (`workshop-gacha-balance` testid, rendered as the plain integer the E2E asserts on). |
| `.odds` panel (鋳造の理 / CASTING ODDS, 4/5/6-cell rows with % bars + HP, ᛞ rule list) | `.workshop-odds` = `panel ornate`. Rows are the theme `.bar` gold fill at the mock's 40/35/25 widths; HP column = cells×15 (the REAL formula). Rules list = the mock's three ᛞ-bulleted laws (Common-only, linker stamped at cast, two-phase receipt). See "Casting odds" inference. |
| `.sub-grid` 変成 (Transmute) + 分解 (Dismantle) panels | `.workshop-subp` shells rendered as HONEST coming-soon states (mock's own 近日 chip + disabled CTA), NO fabricated item rows or dismantle values. See omissions. |
| modal 鋳造結果 (`.scrim`/`.modal`): BP 図解 (leather cells + linker seat ᛖ + compass rose) + stat rows (銘/品位/セル/耐久/連結座/方位) + flavor + 受け取る/もう一度/閉じる | `.workshop-result-scrim` + `.workshop-result` = `modal panel ornate`. The 図解 is the REAL `BpDiagram` (ShapeGrid + linker tile + compass-arrow overlay, `render/itemCard` math) re-toned gold/leather via CSS. Stat rows read straight off the rolled BP (品位 always COMMON; セル=cellCount; 耐久=hpMax "= cells × 15"; 連結座=linker.off as a B2-style coord; 方位=dirs as N/SE labels). Buttons: もう一度 (`btn-forge`, re-rolls if affordable) + 閉じる (`btn-ghost`, the `workshop-roll-result-dismiss` testid). |
| `受け取る → 配置中…` accept/placing button | OMITTED as a distinct step — the REAL two-phase finalize has NO user-facing accept: the BP is already first-fit-placed + auto-saved by the time the modal shows (the roll already happened server-side). Same call REQ-0072 made for its `.placing` copy ("the real board finalizes via auto-save with no user step"). The modal is informational + a re-roll shortcut; the mock's placing pulse is not reproduced on a control that would misrepresent the protocol. |
| `bg_workshop.jpg` key art + `#pfx` ember canvas + grain/vignette | NOT opted in (same compositing-cost stance as REQ-0070/0071/0072/0075). |

## Currency naming (REQ-0053 / REQ-0064 precedent)

The mock never shows the raw string "LRDST". Per REQ-0053 (Weathervane
rename) and the just-shipped market port (REQ-0064), the VISIBLE label
uses the ᚠ rune + the currency-item wording — `workshop.cost` is now
`Currency x{cost}` / `通貨アイテム ×{cost}`, and the balance is a bare ᚠ +
integer — while the wire/engine id stays `'lrdst'` EVERYWHERE (readTotal
LrdstBalance, spendTM('lrdst'), the tms `{id:'lrdst'}` records, the
gacha POST). The pre-port WorkshopPage.tsx showed a raw "LRDST" label;
the mock wins for the visible string, the code wins for wire ids.

## Inferences & omissions (each with its one-line rationale)

- **Casting odds 40/35/25% are DISPLAY-ONLY.** The server roll
  (`server/services/gacha.cjs` rollCommonBp) is a random-walk polyomino
  of 4-6 cells and does NOT publish per-cell-count probabilities — no
  live number backs the odds panel. The mock's own three fixed rows are
  reproduced verbatim as the designed presentation ("smaller packs are
  more common"); the HP column IS real (cells×15). Documented in a code
  comment on the `CASTING_ODDS` constant. (UI-is-truth: the mock's fixed
  figures ARE the spec here; no fabricated live stat, and no new endpoint
  invented to make them "real".)
- **变成 (Transmute) panel = honest coming-soon shell.** REQ-0042 states
  transmutators have "no use-effect yet"; there is no transmute feature.
  The mock itself designed this panel disabled with a 近日 chip, so it is
  rendered exactly that way (disabled CTA, no fiction).
- **分解 (Dismantle) panel = honest coming-soon shell; the mock's two
  fake item rows (ᚠ 32 / ᚠ 18) are OMITTED.** There is no dismantle
  feature and no dismantle-value data anywhere in the app; fabricating
  item rows + prices would be inventing data (out of scope per the brief:
  "omit + flag"). Rendered as the mock panel shell in a coming-soon state
  (same posture as the dex market-block empty-state, REQ-0075). If a real
  dismantle feature + value data ever lands, only this shell swaps to
  live rows.
- **Accept/placing step omitted** — see the "What landed" table row: the
  two-phase finalize has no user accept in the real protocol.
- **HUD chips (ᚠ balance / season / 鋳造可 ×128)** — global chrome,
  REQ-0069 stance; every sibling port omitted the same.
- **Cost thumbnail (`ic_lrdst.png`) / emblem (`emblem_horn3.png`) /
  pack art (`ic_pack.png`)** — decorative served-asset images not wired
  (the cast panel uses the mock's 鋳 seal glyph in a night-iron well
  instead; the balance/cost use the ᚠ rune). No new art introduced,
  consistent with the sprite-driven, original-orientation-only art law
  (`docs/art_golden.md`); the item-icon system itself is untouched.
- **Result stat 連結座 "B2" coord** is derived from the real rolled
  `linker.off` via a column-letter + 1-based-row label (the same A/B/1/2/3
  axis convention the mock figure draws and ShapeGrid's `showCoords`
  uses) — a readout, not an invention. 方位 "N / SE" is the real
  `linker.dirs` mapped through the project's one compass table
  (0=N..7=NW). 品位 is always COMMON (the gacha rolls Common only, per
  REQ-0042 + the odds panel).
- **鋳銘 mint id** shows the real rolled `uid` (the server-minted BP uid),
  not the mock's illustrative `0x7C21`.

## Selector contract

Kept verbatim (E2E load-bearing — `client/e2e/workshop.spec.ts`):
`workshop-gacha-card` (now on the cast panel), `workshop-gacha-balance`
(the plain-integer balance the spec asserts `.toContainText('999'|'989'|
'5')` on), `workshop-roll-btn` (the forge CTA, `disabled` on
!canAfford||rolling), `workshop-toast`, `workshop-roll-result` (now the
result MODAL panel), `workshop-roll-result-dismiss` (the 閉じる button).
The BP-figure testids come from the UNCHANGED BpDiagram/ShapeGrid:
`shape-grid-cell-shape`, `shape-grid-cell-linker`, `bp-diagram-arrow`,
`bp-diagram-hpmax`, `bp-diagram-cellcount`. The nav click target
`.nav-link` (text "Workshop") is the unchanged Nav.tsx.

Also present but not asserted by the spec (harmless extras kept from v1):
`workshop-error`, `workshop-gacha-cost`.

New hooks (not load-bearing for the spec): classes `.workshop-pagehead(-*)`,
`.workshop-colhead(-*)`, `.workshop-forge-grid`, `.workshop-cast(-*)`,
`.workshop-odds(-*)`, `.workshop-orow(-*)`, `.workshop-rules`,
`.workshop-sub-grid`, `.workshop-subp(-*)`, `.workshop-result(-*)`,
`.workshop-result-fig` (the gold/leather re-tone scope for the diagram).
NO existing testid was renamed, so no `client/e2e/` spec required editing.

## i18n

New/changed keys (EN natural / JA mock copy), all `workshop.*`:
`pageKicker pageLede castHeading castHeadingDen castHeadingNote castSub
castNoteUnique castNoteSupply oddsHeading oddsHeadingDen oddsHpNote
oddsCells oddsHp ruleCommon ruleLinker ruleTwoPhase transmuteTitle
transmuteDen transmuteCopy transmuteSub transmuteCta dismantleTitle
dismantleDen dismantleCopy dismantleSub dismantleCta soonChip ownedLabel
rollResultDen rollResultMint rollResultFlavor rollResultNote rollAgain
statRarity statCells statHp statLinker statDirs`. Changed: `workshop.cost`
re-worded to drop the raw "LRDST" (now the ᚠ/currency wording). The v1
`workshop.balance` key is now unused (the balance renders as a bare
integer) but left in place (harmless). All other v1 workshop keys
(rolledToast, rolledOnOtherPage, insufficientFunds, noSpace, spendFailed,
rollFailed, rollResultTitle/Dismiss/HpMax/CellCount, commonBpGacha,
rollButton, rolling) are unchanged and still used.

## Gate results (this worktree, `req-0076-redesign-workshop`)

- `node mock-src/tests/run.cjs` (engine) → **97 passed, 0 failed**
  (client-only + a test-fixture fix; engine untouched — baseline held).
- `node server/tests/api_test.cjs` (files) → **134 passed, 0 failed**.
- `set -a; source server/.env; set +a; STORAGE_BACKEND=pg node
  server/tests/api_test.cjs` → **134 passed, 0 failed** (DATABASE_URL
  confirmed present; pg backend confirmed selected). Both server runs are
  proof nothing server-side was changed.
- `cd client && npx tsc -b` → **clean** (exit 0).
- `cd client && npm run build` (tsc + vite) → **success** ("✓ built"),
  dist emitted to `web/app/`; only the pre-existing >500 kB chunk-size
  advisory.
- `cd client && npm run check:sprites` → **22/22** non-blank, 0 errors.
- `npx playwright test --list e2e/workshop.spec.ts` → **8 tests parsed
  OK**, exit 0 (NOT run against live — see below).

## E2E — dry-run traced, NOT live-executed

Playwright's `baseURL` is the shared production tunnel
`backpack-dev.qtie.jp`, which only reflects the currently-deployed build;
deploying is a separate later step outside this REQ's scope. So, like
every sibling port, the workshop spec was hand-traced against the new
markup (a manual dry run) rather than run:

- `workshop-gacha-card` (cast panel), `workshop-gacha-balance` (plain
  integer — `.toContainText('999')/('989')/('5')` all hold since those
  are <1000 with no thousands separator), `workshop-roll-btn` (enabled at
  balance 999, disabled at 5), `workshop-toast` (fires after a successful
  roll+placement) — all present.
- Result modal: `workshop-roll-result` count 0 before the first roll /
  visible after; inside it `.shape-grid-cell-shape` (>=1), exactly one
  `shape-grid-cell-linker`, one `bp-diagram-arrow` per `linker.dirs`
  entry, and `bp-diagram-hpmax`/`bp-diagram-cellcount` matching the
  finalized BP — all rendered by the UNCHANGED BpDiagram/ShapeGrid, so
  the REQ-0045 (h) diagram assertions are unaffected. Dismiss via
  `workshop-roll-result-dismiss` removes the panel and leaves the placed
  BP + the 989 balance — held (dismiss only clears rollResult state).
- The reward/merge/guest tests (`schedule-warehouse-row`,
  `schedule-warehouse-toast`, guest LRDST seed, move-handle) touch the
  warehouse tab / boards / server, none of which this REQ changed; the
  Task-1 fixture fix is the only edit inside the spec file.

Flagging (could not fully verify without a live run): the visual
gold/leather re-tone of the BP figure and the modal layout render only
under a real browser; the DOM structure + every asserted selector is
verified above, but pixel/layout correctness is not machine-checked here.
The orchestrator runs the suite for real after the (separate) deploy.

## Commits (newest last)

- `bd230d4` fix(workshop.spec:348): reward test party must be able to WIN
  (Task 1 test-fixture fix, verified 200/200).
- `719995c` REQ-0076 (a): workshop CSS — MJOLNIR forge chrome (index.css).
- `c086bc9` REQ-0076 (b): workshop TSX + i18n — forge chrome markup.
- `b139277` REQ-0076 (c): rebuild web/app dist.
