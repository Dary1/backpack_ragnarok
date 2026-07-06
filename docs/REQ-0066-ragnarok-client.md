# REQ-0066 — Hall of Ragnarok: rankings page + Devotion rite (client)

Branch: `req-0066-ragnarok-client`, off an already-merged, gate-green
`master` (carries the ragnarok BACKEND — seasons/order/einherjar/devotion,
134 server tests — AND the warehouse-port REQs). Mock NORMATIVE for
visuals: `web/redesign/ragnarok.html` (+ styleguide/ui.css, shared layer
in `client/src/theme/mjolnir.css`). Pure CLIENT consumer of a finished,
tested backend — NO server code changed.

Scope: the `#/ragnarok` route (殿堂 / "Hall of Ragnarok"). Replaces the
generic `<PlaceholderPage>` with the real screen: hero + pledge, season
strip (12-wedge wheel + no-urgency countdown), the Eternal Order stone
tablet (top-N + gap + me-row, tier chips, find-by-name), the Devotion
rite (candidate picker + blast-radius manifest + final-question modal),
and the Einherjar hall strip. Empty/first-season states throughout.

## IMPORTANT: the mock is ROUND 1, not ROUND 2

The brief said to expect a "ROUND-2" `ragnarok.html` (per a "REQ-0067")
adding empty-states, LOCKED ineligibility, the blast-radius manifest UI,
forecast labels, the event-time doorway, etc. **That round-2 mock does
not exist in the repo.** `git log -- web/redesign/ragnarok.html` shows a
single commit (`redesign: land MJOLNIR mock family v1.0`), and there is
NO "REQ-0067" anywhere in the tree (no md, no html). The mock I built
against is v1.0: one hard-coded devotion candidate, a bare confirm modal,
an unconditional 残り23日 / phase-9 season, and an unconditional link to
`season_end_ragnarok_1.html`.

So I treated the v1.0 mock as the VISUAL baseline and applied the
"REQ-0067 principles" the BRIEF ITSELF enumerates as behavioral
requirements (they are all named in the brief text and the REQ-0066 spec
body): locked-not-hidden ineligibility with reasons, the blast-radius
manifest carrying the weight before the final question, forecast (「予測」)
labels on projections, NO urgency styling on the countdown ever, empty/
first-season states as the realistic common case, and the season-end
event doorway (page itself out of scope). Everything below reflects that.

## What landed (mock → delivered)

| Mock element | Delivered as |
| --- | --- |
| `.bgart` void wash | `.ragnarok-bgart` (absolute, `radial-gradient(...) var(--void)`) — same served-`/redesign/assets/` non-bundled convention the expedition/warehouse ports use; no external image needed (pure gradient). |
| `<header class="hud">` rank + season chips | An in-page `.chip` strip (`ragnarok-hud-rank`, `ragnarok-hud-season`) at the top of the route content: real order rank+tier (unranked-aware) and the real season index/name/countdown. |
| Hero: mark + ラグナロクの殿堂 + pledge blockquote | `.ragnarok-hero` — the triple-arc mark inline, `ragnarok.title`/`ragnarok.kicker`, and the pledge blockquote. Pledge + cite are FROZEN VERBATIM from the mock (ja `ragnarok.pledge`/`ragnarok.pledge.cite`; EN key is a faithful translation for EN chrome). |
| Season strip: 12-wedge wheel + countdown + note + event link | `SeasonStrip.tsx`. Wheel geometry (12 wedges, trig, done/now classes) is a direct port of the mock's inline script, driven by `derived.phase` (1-based). Countdown shows `derived.daysToRagnarok`. States: live / ended / none (missing-or-future registry). |
| 終季の決戦を観る (season-end link) | Rendered as a doorway (`ragnarok-season-event-door`) ONLY in the ENDED state → `/redesign/season_end_ragnarok_1.html`. The season-end EVENT page (REQ-0068, Acts I-III) is OUT OF SCOPE; the link points at the mock and 404s harmlessly if that page isn't deployed (the documented "links nowhere real yet" doorway behavior). |
| Stone tablet: 永劫の序列 + THE ETERNAL ORDER + 刻銘 N名・更新は毎暁 | `EternalOrderTable.tsx` = `panel ornate mat-stone tablet`. `刻銘 {total}名` and 更新は毎暁 are real (`order.total`, the dawn-rebuild cadence). |
| Tier chip row 奴僕→自由民→族長→選定者→神域 (VALHALLA dimmed) | Rendered from `order.tiers` (API thresholds, NOT hardcoded). All five ladder chips render; the caller's active tier (`me.tier`) is lit; EINHERJAR gets the mythic frame; **VALHALLA renders dimmed** (`.chip-valhalla`, opacity .5) exactly as the mock shows — the server NEVER assigns it (client-side horizon beyond the ladder). |
| Ranking table (top-8, gold/silver/bronze rows, gap row, me-row with 汝 badge + projection line) | Real rows from `order.top` (top=8) with the mock's `top1/top2/top3` treatments; a `.gap` ⋯ row; the me-row (`order.me`) with the 汝 seal. The me-row is ALWAYS present, incl. below the gap, UNLESS the caller is already inside the shown top slice (then not duplicated). |
| me-row projection 「+此度の献身 +2%」 | `ragnarok-me-projection` — shown only while an ELIGIBLE candidate is selected (drives from the same preview the manifest uses). ALWAYS labeled a forecast: the whole line is wrapped in a `.forecast-tag` carrying 「予測」 + a tooltip (`ragnarok.order.forecastTip`). See the projection-semantics note below for what number it shows. |
| find-by-name (not in the mock, required by REQ-0066) | `ragnarok-order-search` input → server `?q=` (debounced 300ms). Results render in their own section (`ragnarok-search-results`); a miss shows `ragnarok-search-none`; clear returns to the standings. Server-paginated — never fetches the full table. |
| Devotion: 3-step rite (①隊を選ぶ ②誓いを読む ③名を刻む) | `DevotionSection.tsx`. The 3 steps + their descriptions are FROZEN VERBATIM from the mock. The FROZEN flow is preserved: pick → vow/manifest → final question → engrave. |
| Candidate unit card (.ucard + valknut + MYTHIC・献身候補) | The selected candidate renders as `.ragnarok-ucard` with the inline valknut glyph (the mock's `#vkn` symbol) + candidate word + a serving line. |
| Candidate PICKER (round-2 requirement) | Every preset from the live store (`state.presets.names`) is a button (`ragnarok-devotion-candidate-<index>`). An ineligible SELECTED candidate is shown **LOCKED (dimmed, not hidden)** with its reason(s) spelled out (`ragnarok-candidate-lock-<i>` / `ragnarok-candidate-reason-<i>`) — mirroring the market's "locked, not hidden" language. |
| ⚠ 献身は取り消せない warning | `.ragnarok-dev-warn`, frozen verbatim (`ragnarok.devotion.warn`). |
| BLAST-RADIUS MANIFEST (round-2 requirement — "the manifest carries the weight") | `ragnarok-blast-manifest`: four count cells (BP/item/form/total, from `preview.blast`) + an itemized list of every OTHER affected preset (`ragnarok-blast-affected-row`, each showing which kinds it loses) OR an explicit "no other unit shares these" line. This is the full account-wide itemization shown BEFORE the vow. |
| ᛏ 献身を誓う (blood button) | `ragnarok-vow-btn` (`.btn-forge.btn-blood`) — present ONLY when the selected candidate is eligible. Opens the final-question modal. |
| 最後の問い / THE LAST QUESTION modal (誓う/退く) | `ragnarok-final-question-modal` (scrim + ornate modal + valknut). Carries a compact manifest recap (`ragnarok-final-manifest-recap`) so the weight is restated, then 誓う (`ragnarok-final-yes`) / 退く (`ragnarok-final-no`). A per-open Idempotency-Key is minted so a double-submit replays rather than double-rites. |
| 刻銘済み — 選定者 (engraved success) | `ragnarok-engraved-modal` — revealed ONLY after the race-guard re-GET completes (see below). |
| Einherjar hall strip (.mini cards + 永劫に在り) | `ragnarok-hall` — real records from `GET /api/ragnarok/einherjar` (the caller's own), each `.ragnarok-mini rar rar-mythic` with the valknut, unit name, S{season}・戦果{score}, and the 永劫に在り seal. Empty → `ragnarok-hall-empty`. |
| 序列は全季を通じて残る footer | `.ragnarok-foot`, frozen verbatim. |

## The critical race condition — how it's solved

The Devotion rite rewrites the caller's canvas SERVER-side (preset slot
deleted + every referenced item destroyed account-wide, directly in the
DB) while this client holds an in-memory canvas with a debounced ~800ms
auto-save (`client/src/store/autosave.ts`) that would otherwise PUT the
STALE pre-rite canvas and resurrect the destroyed items (the REQ-0041
auto-save race class, called out verbatim in `shared/dto.ts`'s
`ApiRagnarokDevotionResponse` doc).

Defused EXACTLY as `client/src/market/MarketPage.tsx` does it
(`refreshAfterServerMutation`): `RagnarokPage.refreshAfterServerMutation`
calls the store's **`loadGame()` FIRST** — which re-GETs the fresh
(already-rewritten) canvas and replaces `state.{linked,bps,pos,sis,inv,
presets}` in place, then bumps `stateVersion` via `notifyStateChanged()`
— so any pending auto-save now PUTs the correct post-rite canvas, not the
stale one. Only THEN does it refresh the order + hall and clear the stale
selection. `DevotionSection.confirm()` **awaits** `onDevoted()` BEFORE
flipping to the 'engraved' phase — byte-for-byte the market BuyModal's
`confirm → onSettled → reveal` ordering. The E2E FULL-RITE test asserts
this held (destroyed uids gone from inventory AND the sharing preset
after the auto-save window).

## 409 / eligibility vocabulary handled

The AUTHORITATIVE reason set (from `services/ragnarok.cjs`
`riteEligibilityReasons` / `RITE_409_MESSAGES`) is exactly four:
`mid_rite`, `last_preset`, `empty_unit`, `deployed`. Each has:
- a picker LOCKED label + reason line (`ragnarok.reason.*`),
- a rite-panel ineligible explanation,
- and a distinct final-modal error message (`ragnarok.err.*`) for the
  case where the POST 409s anyway (e.g. a concurrent tab opened a rite →
  `mid_rite`, or the room state changed between preview and vow →
  `deployed`).

A **404** from the POST (the preset became unaddressable — already
devoted / index shifted) maps to `ragnarok.err.notFound`. On ANY rite
error the component still fires `onDevoted()` (fire-and-forget) so the
picker/order reconcile to server truth.

> NOTE — the brief's 409 list also mentioned **"already devoted"** as a
> reason. The actual service has NO such reason: devoting DELETES the
> preset slot, so an "already devoted" preset index simply doesn't exist
> anymore (→ 404 no-leak, which I handle as `notFound`). I did not invent
> an "already_devoted" reason. This is a brief/implementation mismatch,
> not a bug.

## Inferences / omissions ("UI is truth")

- **The me-row projection number.** The mock shows a score-GAIN forecast
  ("+2%"). But `ApiRagnarokProjection` supplies `topPercentile`
  ("you'd stand within top N%") and rank fields — NOT a percentage score
  gain, and every `score` is 0 until REQ-0068's season-end battles land,
  so a raw % gain is genuinely undefined today. I therefore surface the
  DTO field that IS defined — `topPercentile` — as the forecast
  ("予測: top N%"), always inside the 予測 forecast-tag + tooltip. When
  `topPercentile` is null (it can be, per the DTO) the projection line is
  omitted entirely rather than faked. This is the honest read of the real
  projection; the exact "+N%" string is deferred until the score system
  is real. (Documented inference, not a fabricated number.)
- **Emblem / crest art.** `ApiRagnarokOrderEntry.emblem` is the
  placeholder key `'emblem_horn3'` (server: `ORDER_EMBLEM_PLACEHOLDER`,
  "until a real emblem system ships"). Every row/crest resolves to the
  single real asset `/redesign/assets/emblem_horn3.png` — the same served
  path + placeholder posture the mock itself uses (it hardcodes
  `emblem_horn3.png` on every row). No per-player emblem is invented.
- **Candidate stat block (秒間火力/総耐久/焔威力/遠征成功).** The mock's
  `.ucard` shows rich per-unit combat stats. NONE of that is on any
  ragnarok DTO (the preview carries only preset name + blast + eligibility
  + projection; the frozen snapshot canvas is deliberately server-side and
  NOT on the wire). Rather than fabricate DPS/HP bars, the candidate card
  shows only what IS known: the unit name, the 献身候補 word, the valknut,
  and a serving line built from the blast counts (鞄/物品/型). The rich
  stat bars are omitted (UI-is-truth). The "serving since" date shows
  「—」 because the preview carries no devoted/created timestamp.
- **Hero HUD 通貨 (TM) chip / 序列1,024位・族長 JARL.** The mock's header
  shows a TM balance + a hardcoded rank. The rank/tier ARE real
  (`order.me`); the standalone TM resource chip from the mock header is
  omitted here (it belongs to the global app header, not this route — and
  duplicating it would drift from the store's own balance display).
- **Season strip 第九月相 / 残り23日.** These are mock placeholders; the
  real values are whatever `derived` returns (season 1 started
  2026-07-07, so at build time it reads phase 1, ~84 days — the realistic
  fresh-season state, which is exactly why the empty/first-season states
  matter and were built).
- **`data-testid` scheme.** `ragnarok-*` throughout, matching the
  house convention (warehouse/market specs). Enumerated ones use the
  index/tier suffix (`ragnarok-devotion-candidate-<i>`,
  `ragnarok-tier-<TIER>`).

## Suspected backend issues found (documented, NOT patched)

None that are actual bugs. The backend behaved exactly as its DTOs +
tests describe. Two brief-vs-reality mismatches worth flagging (neither is
a server defect):
1. The "ROUND-2 mock" (`REQ-0067`) the brief promised does not exist in
   the repo (see top). Built against v1.0 + the brief's stated principles.
2. The 409 vocabulary "already devoted" named in the brief is not a real
   service reason (the rite deletes the slot → 404, handled as notFound).

If a future round-2 mock lands with the rich candidate stat block backed
by a NEW preview field (unit power/durability/expedition record), the
candidate card's omitted `.us` stat rows are the place to wire it — the
CSS (`.ragnarok-us`-equivalent treatments) can be lifted straight from the
mock at that point.

## E2E status

`client/e2e/ragnarok.spec.ts` (10 tests) — AUTHORED + selector-traced +
Playwright-`--list`-verified, but **NOT executed against a live deploy**:
the shared `baseURL` points at the live site, which the main checkout
owns (and which I must not touch). The orchestrator runs it for real
right after deploy. Coverage: season strip (wheel 12 wedges + countdown +
NO-urgency-class assertion), Eternal Order (tier chips incl. VALHALLA,
unranked me-row), find-by-name (hit + miss + clear), devotion picker
LOCKED-with-reason (`deployed`), blast-radius manifest itemization
(asserts the exact {1,2,1,total 4} + affected P3 against a constructed
fixture mirroring the server's `ragA`), FULL RITE (UI rite → API assert:
destroyed uids gone from inventory AND the sharing preset + si stowed +
slot deleted + new einherjar record), 409 `empty_unit`, 409 `last_preset`,
hall strip (card + 永劫に在り) + empty hall, and the first-season/empty
composite.

### E2E HYGIENE LIMITATION (flag for the orchestrator)

There is **no dev-clear HTTP hook for einherjar records** (unlike
`/api/warehouse/dev/clear-debris`). `storage.deleteEinherjarRecord`
exists but is not exposed by any route, and I must not add server routes.
Consequence: the FULL-RITE and HALL-STRIP tests leave the DEV player with
permanent einherjar records (and minted invite players from the
find-by-name / deployed tests leave their own records + files, same as
market.spec's minted sellers). To keep the suite **order-independent**,
the three "fresh dev player" assertions (unranked me-row, empty hall)
query `GET /api/ragnarok/einherjar` first and only assert the empty state
when the dev player is genuinely record-free. Two things the orchestrator
may want: (a) run this spec against a fresh deploy for the cleanest first
pass; (b) consider whether a `POST /api/ragnarok/dev/clear-einherjar` hook
(gated like the warehouse one) is worth adding to server code in a
separate REQ so this suite (and any future ragnarok E2E) leaves zero
debris. Not done here — it's a server change, out of my worktree's scope.

## Gates (from worktree root)

- `node mock-src/tests/run.cjs` → **97 passed, 0 failed** (untouched).
- `node server/tests/api_test.cjs` (files) → **134 passed, 0 failed**.
- `set -a; source server/.env; set +a; STORAGE_BACKEND=pg node server/tests/api_test.cjs` → **134 passed, 0 failed**.
- `cd client && npx tsc -b && npm run build` → clean (dist rebuilt to `web/app/`).
- `cd client && npm run check:sprites` → **22/22 non-blank, 0 errors**.

## Files

- NEW `client/src/ragnarok/` — `RagnarokPage.tsx`, `SeasonStrip.tsx`,
  `EternalOrderTable.tsx`, `DevotionSection.tsx`, `ragnarokShared.tsx`.
- `client/src/api.ts` — +5 ragnarok fetchers (season/order/einherjar/
  preview/devote) + DTO re-exports.
- `client/src/App.tsx` — `#/ragnarok` now renders `<RagnarokPage>` (was
  `<PlaceholderPage>`). `Nav.tsx` already highlighted the route (ᛏ).
- `client/src/i18n.ts` — ragnarok chrome keys (en + ja).
- `client/src/index.css` — the Hall of Ragnarok CSS block (mjolnir tokens).
- NEW `client/e2e/ragnarok.spec.ts`.
- `web/app/**` — rebuilt dist (separate commit).
