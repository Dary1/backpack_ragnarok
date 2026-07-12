> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0068 — Season-End Ragnarok (the event: Acts I–III)

- **Status**: DRAFT (原案) — awaiting owner review (2026-07-06). REVERSE-INFERRED
  from the three mocks (user: この題材はセッションで未討議 — expect a long [USER]
  list). Mocks NORMATIVE for surfaces:
  `season_end_ragnarok_1.html` (Act I 封印の間 — unseal/payment window),
  `_2.html` (Act II 決戦 — live spectate), `_3.html` (Act III 終幕 — results).
- Depends on: REQ-0066 (season registry §1, eternal order §2, Einherjar records
  §3). Canon: worldview doc (auto-participation, permanent ranking, report-to-
  buyer concept; monetization itself stays OUT of scope — see §2).

## Inferred event lifecycle
Season phase 12 ends → **Act I window** (unseal auction, deadline 刻限 =
battle start) → **Act II** (one colossal automated battle; hours of wall-clock
spectate) → **Act III** (results; scores merge into the eternal order; reports
dispatched; next season begins at the next moon-phase).

## §1 Act I — The Sealed Vault (封印の間)
- **The Sealed Five**: per-season, hand-authored mythic boss defs (existing enemy
  schema + colossal hp; art via the user-side pipeline). Identity MASKED (「???」+
  seal art) until unsealed — masking discipline as everywhere (「?」 rule).
- **Dutch auction per pillar**: price falls monotonically from `start` to `floor`
  reaching floor exactly at 刻限 (mock: 684,000 → 342,000). Server-authoritative
  price = pure function of (config, now) — no ticker process; concurrent unseal =
  first-wins at the price of THEIR request instant (409 `already_freed` for the
  loser). 「先んじる者は高く払い、名を刻む」 — paying early is glory-priced.
- **Liberator record**: name engraved on the pillar (battle board + records);
  mock shows 「無銘の商人」 → an **anonymity option** at purchase; group names
  appear (「北辺の九人衆」) → free-text inscription **[USER]** (moderation risk at
  scale; friends scale = fine).
- **Unfreed pillars at 刻限**: **[USER]** — (a) stay sealed, event scales to the
  freed count (min 1 system-guaranteed), or (b) manifest unowned at floor. Mock
  Act II shows 5/5 freed and does not answer this.

## §2 暗黒質 ◈ (Dark Matter) — the payment, deliberately quarantined
- A NEW premium balance, explicitly NOT a Transmutator: mock law chip
  「支払いは暗黒質のみ — 変成通貨は通じない」. It therefore lives OUTSIDE
  economy.md's barter laws (no market listing, no furnace tithe, no TM exchange —
  the two economies never touch; this is the wall that keeps Pay-to-Kill from
  leaking into player power: ◈ buys ENEMIES and inscriptions, never items).
- **Acquisition = [USER], out of this REQ's scope** (worldview: monetization
  concept is tentative and out of current scope). v1 ships with: balance field +
  admin grant endpoint ONLY (dev/testing), acquisition surface deliberately
  absent. All auction math works regardless of how ◈ arrives later.
- Ledger: append-only ◈ spend log (pillar, amount, instant, liberator) — the
  audit trail the battle report cites.

## §3 Act II — the battle (architecture proposal [ORCH, vetoable])
The mock shows only: 5 global HP pools (8–15M), a damage feed, kill stamps
(討滅 + とどめ troop), live hall with 確定 locks, an hours-long clock. Internals
are free. Proposed **relay-raid** architecture (maximal reuse, zero new combat):
- The host (EVERY Einherjar ever devoted, all seasons — it grows forever) is
  ordered by seed at battle start (「布陣は運命に委ねられる」). Squads fight as
  their **frozen snapshots** (REQ-0066 §3), grouped into troops of 4 by fate
  order, on STANDARD 26×18 fields vs **aspects** of a pillar (normal-scale enemy
  stand-ins whose damage taken debits the pillar's global HP ledger).
- Each troop runs an ordinary `sim/combat.cjs` encounter sequence vs aspects
  until wiped (permanent attrition; no healing between — glorious death is the
  design: ACT III 「すべての盾は砕けた/されど、誰も敗れてはいない」). Per-squad
  results: **討撃** (damage contributed), **昇天** (wall-clock time of its fall),
  kill credit if ITS encounter zeroed a pillar's ledger (→ 殿堂入り, score 確定
  immediately, per mock).
- Whole event **instant-sims** as a batch (12k+ squad-encounters ≈ ms each —
  embarrassingly parallel, shardable per pillar), then **replays at wall-clock
  pace over hours** via visibleEvents truncation — the REQ-0036 run-clock design
  at raid scale; no standing process; lazy settlement fires Act III exactly once.
- End condition: all freed pillars dead OR host exhausted — both are endings,
  both celebrated (mock's requiem framing). Leftover pillar HP display: **[USER]**.
- Determinism: one event master seed; the entire battle is a pure function →
  the spectate feed, the boards, and every 戦果 are replayable audit facts.

## §4 Act II — spectate surfaces
- Board: 5 pillar rows (art, liberator credit, HP bar/percent, 討滅+とどめ state),
  battle clock, 敵残存 chip. Data = polled event-log cursor (schedule-monitor
  pattern; no websockets needed at friends scale).
- 戦況の声 damage feed (ムニンの報せ): curated event classes only (pillar hits by
  named troops, kills, milestones — not 12k lines/sec; feed compaction rules
  [TUNABLE]). Hall of Fame LIVE: top troops by 討撃, 確定 lock on kill credit.

## §5 Act III — results & merge
- Requiem sequence (staged reveal per mock), final table: 序列 / 隊名 / 討撃 /
  昇天, me-row with eternal-order delta (「+序列 810」).
- Settlement: per-squad 戦果 computed by the SHARED formula (REQ-0066 §2 [USER]),
  appended to Einherjar records' perSeason history, eternal order rebuilt,
  season index advances (registry), furnace/dismantle season windows roll
  (REQ-0064 §6, REQ-0063 §5 — their deferred switches land HERE).
- **Battle report to each liberator** (worldview promise): their pillar's story —
  total damage dealt/received, squads slain by it (count + notable names), who
  felled it, duration. Delivered as a permanent record page + notification.
- Event archive: replay + boards kept **[TUNABLE: latest N seasons full replay,
  summaries forever]** (12k-squad JSONL is large; summaries are small).

## §6 Routes & storage (sketch)
`GET /api/ragnarok/event` (state machine: idle|vault|battle|results),
`GET /api/ragnarok/event/pillars` (+ live price), `POST /api/ragnarok/event/
pillars/:id/unseal` (◈ debit, first-wins), `GET /api/ragnarok/event/board`
(cursor), `GET /api/ragnarok/event/results`, `GET /api/ragnarok/report/:pillar`.
Tables: event, pillars, unseal ledger, squad results, reports. files+pg parity,
storage.cjs chokepoint, migrations 00N.

## §7 [USER] decision list (deliberately long — undiscussed territory)
1. ◈ acquisition & monetization stance (THE decision; everything else ships
   without it via admin grant).
2. Auction params (start/floor/curve/per-pillar variation) + unfreed-pillar rule.
3. Inscription: free text vs player name + anonymity toggle.
4. 戦果 formula (shared with REQ-0066) + kill-credit weighting.
5. Relay-raid architecture blessing (§3) — or a different battle fiction.
6. Aspect tuning: how pillar HP maps to aspect encounters (difficulty vs host size
   scaling — should the battle last ~hours regardless of host count?).
7. Event cadence guard: player with zero Einherjar sees Act II/III as pure
   spectacle — is Act I visible to them too? (mock implies yes).
8. Archive retention N.

## Test plan
- server: price function (property: monotone, floor at 刻限), unseal race
  first-wins, ◈ ledger atomicity, state machine transitions, lazy settlement
  exactly-once, files+pg parity.
- sim: relay-raid harness determinism goldens (small host fixtures), kill-credit
  attribution, 昇天 timestamps, ledger conservation (Σ aspect damage = pillar HP).
- client E2E: three acts against a fixture event (masked→freed pillar, live board
  poll, requiem reveal, me-row delta).
- S4: new R-class — host-vs-pillar balance sweep (event duration distribution vs
  host size; flag <1h or >12h [TUNABLE]).
