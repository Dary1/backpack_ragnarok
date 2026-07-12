# REQ-0065 — Market UI: design brief for round 2 (to the UI designer)

- **Status**: ISSUED to the UI designer (2026-07-06). Companion to REQ-0064
  (market screen implementation draft). Deliverable = updated
  `web/redesign/market.html` (+ a small `dex.html` addition + assets).
- Audience note: this is a DESIGN brief — nothing here asks for code.

## 日本語サマリ
市場mockは思想面で完成度が高く、「3つの法」パネル・焼却内訳行・購入の誓いモーダルは
**凍結(canon)** とします。実装REQ(0064)を書く過程で見つかった「まだ描かれていない
状態」と小さな追加だけをお願いするラウンド2です。優先度P1が実装ブロッカー、P2は
品質向上。世界観コピーの調子(炉・刻銘・ムニン)はそのままでお願いします。

## Frozen — do NOT redesign (already canon)
- The three-laws panel (barter / 8% furnace tithe / no living prices) — wording and
  placement are now acceptance criteria in REQ-0064.
- Burn breakdown line on cards (`支払N → 焼却n ・ 相手受取m`), oath modal structure
  (breakdown table + post-pay balance + 成立 state), 専有の法 lock treatment,
  Dex-No. chips, furnace footer with seasonal burn total, penalty-free withdrawal
  microcopy. Tone throughout (炉/刻銘/ムニン voice).

## P1 — states the implementation needs drawn (blocking)
1. **Empty states** ×3: buy pane with zero listings; MINE with zero listings; sell
   hoard with nothing sellable (everything deployed) — each wants one lore line in
   the established voice, not a bare "no data".
2. **Listing expiry**: listings auto-withdraw after 7 days (no penalty). MINE rows
   need a calm remaining-days indicator (出品3日目 → e.g. 「あと4日で炉棚から下がる」)
   and an `expired` row state. NO urgency styling — house retention philosophy:
   deadlines inform, never pressure (no red countdowns, no pulsing).
3. **Suspended listing in MINE**: the buy-grid lock treatment exists (card #8);
   draw the OWNER's view of the same state — a MINE row showing 「配備中 — 一時停止」
   with a hint that undeploying reactivates it.
4. **Purchase failure states** (modal variants of 購入の誓い):
   a. race lost — someone settled first (「一足遅かった — 品は既に旅立った」register);
   b. buyer warehouse full (delivery impossible; point to warehouse);
   c. insufficient ᚠ (also: how a too-expensive card's 購入 button reads in the
      grid BEFORE the modal — disabled vs warning-on-click, designer's choice).
5. **Success → destination affordance**: the 取引成立 panel mentions warehouse
   delivery; add the action that takes you there (「倉庫を見る」) — and a small
   "from market" provenance tag on the corresponding `warehouse.html` row.
6. **Dex market block** (`dex.html` addition): the sell pane cites 「図鑑の直近刻銘」
   — design the Dex-entry section it points to: last settled prices (the anchor,
   ~5 entries), active listings count (「刻銘中」), and where a "market" chip sits
   on the item card. Settled trades only feed the anchor (asks are opinions,
   settlements are facts — that line may serve as its caption).
7. **EN copy pass**: house i18n rule is EN base + ja. Every lore/microcopy line on
   this screen currently exists only in ja — provide the EN register (same voice;
   the laws already have EN subtitles to match).
8. **Narrow viewport**: one reference layout for phone width (tabs, mgrid single
   column, sell-grid stacking, modal) — client runs on phones (haptics are already
   planned elsewhere).

## P2 — quality-of-life (non-blocking)
9. Loading skeleton for the listings grid (embers-calm, no spinners if avoidable).
10. Withdraw: silent vs one-line confirm — designer's call; if confirmed, keep the
    「咎なし」 assurance in the dialog.
11. Filter chips: overflow behavior when tag count grows (content-driven list);
    single-select is fine for v1 — indicate if you'd rather multi-select.
12. Price stepper: hold-to-repeat and/or direct numeric entry; visual for the cap.
13. Large-number style (furnace total) — tnum treatment is good; confirm grouping
    for 5–6 digits and the count-up motion budget.
14. Optional: seller-name hover (title? nothing?) — v1 has no profiles page; avoid
    implying one exists.

## Constraints (bind the design, not the taste)
- No auction affordances anywhere, ever (law ᛗ) — no "bid", no price graphs that
  imply a moving market; history is engraving, not a ticker.
- Transparency norm: tax and breakdowns always visible before commitment (already
  honored — keep it through every new state).
- Particles/motion: optional layer, perf-gated; every state must read with fx off.
- Follow `styleguide.html` tokens; new assets join `redesign/assets/` with the
  existing naming (ic_*.png).

## Acceptance
Round-2 `market.html` renders every P1 state (a static mock may fake tabs/data as
today), `dex.html` shows the market block, EN strings delivered alongside ja
(comment block or twin page — designer's choice). Review = owner pass, then
REQ-0064 implementation treats round 2 as normative.
