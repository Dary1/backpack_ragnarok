# REQ-0075 — Dex screen (#/dex) MJOLNIR re-skin

Branch: `req-0075-redesign-dex`. Fifth of the redesign series (after
REQ-0069 foundation, REQ-0070 canvas, REQ-0071 expedition, REQ-0072
warehouse). Mock NORMATIVE for visuals: `web/redesign/dex.html` (+
styleguide/ui.css, shared layer already in `client/src/theme/mjolnir.css`).

Scope: the item encyclopedia (`#/dex`) — catalog grid, two-pane detail,
No. chips, rarity words, the market-engraving block placeholder. Dex v2
BEHAVIOR UNCHANGED (REQ-0035/0038/0042 semantics): the combined PO+SI
grid off the raw `/api/content` payload, search + rarity/tag filtering,
selecting a card switches the whole view into the [list | diagram | info]
detail layout (the shared `render/itemCard.ts` composition math drives
every shape-mounted thumbnail/diagram — NOT forked), the display-only TM
strip, the role-gated edit view (DexAdmin — a SEPARATE layout, restyle
NOT in scope since the mock doesn't cover the edit form), the 1100px wide
breakpoint, and locale-only content text (REQ-0038 R3). It is a read-only
wiki; it never touches the engine/GameState.

## What landed (mock → delivered)

| Mock element | Delivered as |
| --- | --- |
| `.pagehead` (kicker EMBERS OF KNOWLEDGE / 知の炉 / lede) + headline rune ᚲ | `.dex-pagehead` strip + `.rune-divider` (glyph ᚲ) at the top of the Dex view, mirroring the SchedulePage/CanvasChrome pagehead recipe. New i18n keys `dex.pageKicker/pageTitle/pageLede`. |
| `.dexstrip` progress panel (収集 68/120 + gold bar + filter/lang chips) | `.dex-strip` = `panel ornate` + knots. Big den-gold `{collected}/{total}` readout + 収集/COLLECTED labels + theme `.bar` gold fill. The count is HONEST (see omissions): total = PO+SI+TM catalog size, collected = same (no per-player discovery set exists), so the bar reads a truthful 100% "the codex is complete" rather than the mock's illustrative 57%. |
| Filter chips すべて/武具/遺宝/連結/霜/焔/未発見 | The FUNCTIONAL controls (search box + rarity `<select>` + tag `<select>`, REQ-0038) are kept verbatim (their selectors are E2E-load-bearing) and re-skinned to night-iron fields. The mock's decorative element/keyword chips are NOT reproduced as fake filters — the tag `<select>` already exposes the REAL tag vocabulary. |
| `ことば: 日本語 / EN` + `編集 — item_admin 限定` chips | The lang toggle stays in the global chrome (REQ-0069 stance, same as siblings). The edit affordance stays as DexRoot's real role-gated `.dex-mode-toggle` (only rendered for item_admin) — not duplicated as a strip chip. |
| Catalog `.colhead` (形の目録 / CATALOG) | `.dex-colhead` (rune ᚲ + dj title + den + micro note), the sibling colhead recipe. Keys `dex.catalogTitle/catalogDen/catalogNote`. |
| `.dgrid` of `.dcard` (No. chip, rarity frame+gem, dthumb well, dname, dsub 武具/剣 ・ LONGSWORD, rarity word + shape SVG) | `.dex-grid` unchanged selector, re-skinned: `.dex-card` wears theme `.rar rar-*` + `.gem`; the No.NNN chip is REAL (honest 1-based position in content.items, see below); the shape-mounted thumbnail (ShapeGrid via the shared fit module) sits in the mock's night-iron `.dthumb` well; sub line = first-tag category ・ EN name caps; rarity WORD via the theme ramp. The mock's per-card raw SVG polyomino is REPLACED by the real shape-mounted ShapeGrid render (the actual footprint + icon, which is strictly more informative and is the REQ-0038 catalog behavior the E2E asserts). |
| Detail `.colhead` (詳解 / SCHEMA & LORE ・ 図鑑 No.061 ・ name) | `.dex-detail-colhead` with the current No.NNN ・ localized name on the right. |
| `.detail2` two-pane (図解 SCHEMA panel LEFT | 銘と効果 info panel RIGHT) | The REQ-0038 three-column `[list | diagram | info]` layout (list rail + the mock's two panes) — each column is now a `panel ornate` (info + diagram panels also wear the selected item's `.rar-*` frame). Diagram panel gets the mock's `.phead` (図解/SCHEMA) with the back button; info panel gets the mock's name+EN header, rarity/tag chip row, and rune dividers (ᛁ/ᛞ/ᚠ) between effect/lore/provenance/market blocks. |
| 図解 SVG (frost cell grid, gold/frost callouts, send-port ◆, socket dot) | The REAL DexDiagram (ShapeGrid large grid + port tiles + socket-marker SVG overlay + coord labels, REQ-0038) re-toned to the mock's frost cells / gold callouts / frost socket dots via CSS. Component logic + selectors unchanged. |
| 銘と効果 stat rows / flavor / 出所 provenance | The REQ-0038 ItemDetailCard fields (effects rendered text + raw-AST `<details>`, flavor, tags-with-ancestry, part/assembly, stretch, batch provenance) re-skinned; provenance micro-line now carries the mock's No.NNN. |
| §市場の刻銘 (THE MARKET ENGRAVINGS: 刻銘中 N件, last-5 dated anchor rows, caption) | `.dex-market` EMPTY-STATE block (`dex-market-block` testid). Renders the mock's block shell — title/den, listing-count chip, anchor-price row, bilingual caption, ᚠ 市場で見る link — with HONEST placeholders (count 0, anchor "—", "no settlements engraved yet" note), NOT invented numbers. See "Market block" below. |

## Market block (REQ-0075 §scope: "empty-state otherwise")

The mock's 市場の刻銘 block shows a per-item settled-price history
(rolling last-5) + an active-listing count. Those wire shapes DO exist in
`shared/dto.ts` (`ApiMarketPriceHistoryEntry {qty,t}`,
`ApiMarketListing.priceHistory`, `.dexNo`) — but ONLY on the
`/api/market/*` listing endpoints (REQ-0064). There is **no Dex-facing
per-item card feed**: that is REQ-0052 ("Dex card API+subwindow"), a
separate still-queued REQ, not started, not in this scope. The
`/api/content` payload the Dex consumes carries NOTHING market-related.

Per REQ-0075's own fallback clause ("render the block from the mock now,
fed by whatever the card DTO already offers; empty-state otherwise") and
the orchestrator's explicit resolution, the block is rendered as its
visual shell with real zero-state values:

- listing count → `刻銘中 0件` / `engraved: 0`
- anchor price → `ᚠ —` (em dash, not a number)
- an explicit "no settlements engraved yet" / 「まだ刻銘はない」 note
- the mock's settlement-vs-ask caption (bilingual) is kept verbatim (it
  is lore/law text, not data)
- a real `ᚠ 市場で見る` link to `#/market`

**No new backend endpoint was built** (that would be scope creep into
REQ-0052). When the Dex card feed lands, this block's placeholders are
the only thing that swaps to live data; the shell is already correct.
New testids `dex-market-block` / `dex-market-count` / `dex-market-empty`.

## Dex No. numbering (UI-is-truth: inferred, not invented)

The mock's `No.NNN` chips are drawn from the item's **1-based position in
`content.items`** (`client/src/dex/dexNo.ts`). This is exactly the
numbering `shared/dto.ts`'s `ApiMarketListing.dexNo` documents ("1-based
position in content/live/live_items.json (v1 dex numbering)"), derived
client-side from the already-fetched payload — no new endpoint, no faked
IDs. Object insertion order in the `items` map mirrors the JSON file
order the server loads. Only POs get a number; SIs and TMs are not part
of the v1 dex numbering per that same DTO field, so they show their kind
tag (PO/SI/TM) instead of a No. chip.

## Omitted / diverged (no backing data — "UI is truth")

- **Collection progress 57% / 68 of 120**: no per-player "discovered" set
  exists anywhere in the data model — undiscovered `.dcard.undis` "? 未発見"
  cards are a mock-only concept. Rather than fabricate a discovery ratio
  or render fake "?" cards, the strip shows the REAL catalog size and a
  truthful 100% bar (every catalogued form IS a page), with a micro-note
  stating discovery gating isn't tracked yet. Divergence from the mock, in
  the data's favor (same posture as REQ-0072's currency-decay call).
- **`.dcard.undis` undiscovered cards** (No.034 「― 未発見 ―」 etc.): omitted
  for the same reason — no per-player discovery state to hide anything by.
  Every real entry renders as a full card.
- **Per-card market marker ᚠ** (mock draws it on No.014/No.061): would
  require knowing which items currently have active listings — that is the
  same missing Dex market feed. Omitted (no card is marked "engraved")
  rather than marking arbitrary cards.
- **HUD chips (TM balance 1,284 / 第参季 残り23日 / 収集率 57% / 通算分解 312)**:
  global chrome = REQ-0069's stance; REQ-0071/0072 took the same omission.
  The 通算分解 ("total disassembly raises floors") framing and the
  `現在最低(基礎)〜最大` stat-range notation in the mock's info panel have
  NO backing data (effects are stored as single ranges, not a
  floor/base/max triple; no per-account disassembly counter is exposed) —
  the effect rows render the REAL `eff_en/eff_ja` server-rendered strings
  as before, not the mock's illustrative triple-value copy.
- **Per-card polyomino SVG**: the mock hand-draws a tiny rect grid per
  card; the port renders the REAL shape-mounted ShapeGrid (actual
  footprint + composited icon) instead — strictly more information and the
  established REQ-0038 catalog behavior the E2E depends on.
- **Background particles / grain / vignette / `bg_dex.jpg` key art**: the
  page-shell key art + `#pfx` ember canvas are chrome-level; not opted in
  here (same compositing-cost stance as REQ-0070/0071/0072). The dex has
  no live WebGL board of its own, but the omission is kept consistent with
  siblings; `bg_dex.jpg` is available in `web/redesign/assets/` if a later
  pass wants it (served via the same `/redesign/assets/` convention).
- **Edit-view restyle**: out of scope — the mock does not cover the admin
  edit form, and REQ-0075 says "restyle is in-scope only where the mock
  covers it". DexAdmin keeps its function and its existing look; only the
  shared `.dex-tag-chip`/`.rune-divider` tokens it inherits shift.

## Reuse note (per the brief)

`rarThemeClass()` was lifted OUT of `WarehouseTab.tsx` into a new shared
`client/src/render/uiBits.ts` (the REQ-0072→0075 heads-up predicted this)
and is imported by both WarehouseTab and the Dex — NOT copy-pasted. The
shared version covers the full theme ramp (adds Epic/Legend/Mythic
defensively) while keeping WarehouseTab's exact Common/Uncommon/Rare/
Relic→legend behavior as a subset. `TtlRing` was NOT lifted — the dex has
no countdown/ring visual (it was warehouse-specific).

## Selector contract

Kept verbatim (E2E load-bearing — `client/e2e/dex.spec.ts` +
`dex-admin.spec.ts`): `.dex-root`, `.dex-view`, `.dex-count`, `.dex-card`,
`.dex-card-summary`, `.dex-card-shape .shape-grid`, `.shape-grid-cell-shape`,
`.shape-grid-icon-overlay` (+ `data-footprint-w/-h`), `.shape-grid-cell-icon`,
`.dex-search`, `.dex-grid`, `.dex-empty`, `.dex-tab-active` (text
Items/アイテム), `.dex-detail-columns` (+ the 1100px breakpoint),
`.dex-detail-col-list/-diagram/-info`, `.dex-detail-item-list-row`,
`.dex-detail-item-list-row .shape-grid-icon-overlay`, `.dex-detail-back-btn`,
`.dex-diagram`, `.dex-diagram-grid-wrap`, `.dex-diagram-ports .dex-port-row`,
`.dex-diagram-socket-overlay/-dot`, `.dex-diagram-socket-labels .dex-tag-chip`,
`.shape-grid-cell-coord`, and ALL `.dex-admin-*` / `.dex-mode-toggle*` /
`.dex-admin-list-thumb` selectors (edit view untouched).

New hooks (not load-bearing for old specs): `.dex-pagehead(-*)`,
`.dex-strip(-*)` + `dex-collected-count` testid, `.dex-colhead(-*)`,
`.dcard`/`.dthumb`/`.dname`/`.dsub`/`.dfoot` (mock aliases layered onto the
existing dex-card DOM), `.dex-card-no`, `.dex-detail-phead(-*)`,
`.dex-detail-namehead`/`-chiprow`, `.dex-market(-*)` + `dex-market-block`/
`dex-market-count`/`dex-market-empty` testids.

Note: NO existing testid was renamed, so no `client/e2e/` spec needed
editing. The dex E2E specs were dry-run-read against the new markup (see
Gate notes) rather than run (Playwright's baseURL is the live site).

## i18n

New keys (EN natural / ja mock copy), all `dex.*`: `pageKicker pageTitle
pageLede collectedWord collectedDen stripNote catalogTitle catalogDen
catalogNote detailTitle detailDen schemaTitle schemaDen noPrefix
market.title market.den market.listingCount market.anchorLabel
market.emptyNote market.caption market.captionEn market.viewInMarket`.
No existing dex key changed (locale-only content rules, REQ-0038 R3, are
untouched on the new chrome).

## Gate notes (final run)

All gates green on the worktree (`~/backpack_ragnarok-dex`, branch
`req-0075-redesign-dex`), this being a CLIENT-ONLY change:

- engine (`node mock-src/tests/run.cjs`): **97 passed, 0 failed**.
- `client && npx tsc -b`: **clean** (exit 0).
- `client && npm run build` (tsc + vite): **success**. Warnings are the
  pre-existing/expected ones only -- the vite "chunk larger than 500 kB"
  note, and the `/redesign/assets/*.jpg` "resolved at runtime" notes for
  the served (never-bundled) key-art convention. (`bg_dex.jpg` is NOT
  referenced by this REQ -- see the background omission above -- so it
  does not appear in that list.)
- `client && npm run check:sprites`: **22/22** non-blank, 0 errors.
- server (`node server/tests/api_test.cjs`): **134 passed, 0 failed**.
- server pg (`STORAGE_BACKEND=pg` with `server/.env`): **134 passed, 0
  failed**. (Client-only change; both server runs are proof nothing
  server-side was touched.)

E2E was NOT run here (Playwright's baseURL is the live public site, not
this worktree -- per the brief). Instead every selector in
`client/e2e/dex.spec.ts` and `client/e2e/dex-admin.spec.ts` was dry-run
read against the new markup:

- catalog: `.dex-root` (DexRoot, untouched), `.dex-count`, `.dex-card`
  (on PO/SI cards only -- TM cards stay `.dex-tm-card`, so the PO+SI
  count assertion is unaffected), `.dex-card-summary`, `.dex-card-shape
  .shape-grid` + `.shape-grid-cell-shape` + `.shape-grid-icon-overlay`
  (ShapeGrid untouched -- footprint metrics unchanged), `.dex-search`,
  `.dex-grid`, `.dex-empty` -- all present.
- detail: `.dex-detail-columns` (+ 1100px breakpoint kept),
  `.dex-detail-col-list/-diagram/-info` in DOM order [list|diagram|info]
  (CSS flex order preserved for the bounding-box order + stacked-fallback
  tests), `.dex-detail-item-list-row` (+ its `.shape-grid-icon-overlay`
  for the blade 1x2 footprint assert), `.dex-detail-back-btn`, and the
  whole `.dex-diagram*` family (DexDiagram untouched: tower_shield ~5x
  per-cell size, flame_tablet 2-port rows, hilt socket dot/label, coord
  labels all render as before; the diagram column's 80vh cap at the
  2000x1400 E2E viewport comfortably contains the 620px-capped grid).
- locale-only (R3): the info panel shows ONLY the active locale's
  name/flavor/effects via the unchanged localized-resolvers; the mock's
  EN name caption is rendered UPPERCASED, so it never collides with the
  spec's exact-case `not.toContain(enName)` check in JA mode; id/rarity
  stay locale-neutral and present.
- edit gate: `.dex-mode-toggle(-row)` (DexRoot), all `.dex-admin-*`
  selectors + `.dex-admin-list-thumb` (DexAdmin untouched), and the
  chrome-lang test's `.dex-tab-active` Items/JA flip -- all present.

No testid was renamed, so no `client/e2e/` spec required editing.
