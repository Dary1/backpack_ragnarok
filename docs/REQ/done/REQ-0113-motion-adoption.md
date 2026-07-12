# REQ-0113 — adopt styleguide motions into the live client (placePulse / pulse / rise / toastin)

State: **done — MERGED + DEPLOYED + LIVE + ACCEPTED** (user GO + acceptance 2026-07-09).
tsc + lint + vite build green; e2e inert-by-construction (proven) + key live surfaces
green (see Deploy §). Full-suite re-run of the 4 inert specs (schedule/workshop/warehouse)
deferred to REQ-0117 (e2e serialization) — they cannot regress a webdriver-gated no-op. Branch `req-0113-motion-adoption`:
source `d67d86e`, dist rebuild `3e41771`, merged to master `f4bfe6d` (--no-ff), which
includes REQ-0112 (the "do after REQ-0112" precondition is satisfied).
Depends on: nothing hard; independent of REQ-0112 but lower priority.

## Goal
Bring four MJÖLNIR styleguide (§06) motions into the live React client
(`client/` → `web/app`) where they genuinely belong. This REQ **includes the
investigation** of where each is warranted (do not sprinkle; each must map to a
real state/moment per §06 discipline).

## The four motions (source: web/redesign/styleguide.html §6.2 / §6.3)
- `@keyframes placePulse` — loop. Pending/awaiting-server placement (green
  "配置可/処理中"). NOTE: the client already ships
  `schedule-warehouse-place-pulse` in index.css — investigation must reconcile
  (reuse/rename vs add), not duplicate.
- `@keyframes pulse` — loop. Live/heartbeat dot ("今動いている"): status badges,
  is-live indicators.
- `@keyframes rise` — once. Staggered entrance for a screen's primary content
  (ceremonial reveal): candidates = dex / market / ragnarok / season pages.
- `@keyframes toastin` — once. The toast/notification entrance (single-message
  queue). Wire to the app's real toast component.

## Investigation scope (part of this REQ)
1. Inventory current client usages/near-equivalents: grep `place-pulse`,
   `is-live`, `.dot`, toast/notification components, page-mount entrances.
2. For each of the 4, decide the exact mount points (or "not needed") with a
   one-line justification per site.
3. Confirm reduced-motion handling (mjolnir.css already blanket-shortcuts under
   `prefers-reduced-motion`) covers them; JS-driven ones (if any) gate like
   particles.ts (webdriver off).
4. Confirm no e2e selector/skin breakage.

## Deliverable (when executed)
- Minimal, discipline-respecting adoption of the 4 motions in the client, keyed
  to real states; reduced-motion safe; e2e green; built to web/app and deployed.

## Non-goals
- No new colors/tokens; no restyle beyond attaching these motions.
- Not the button-FX work (that is REQ-0112).

---

## Outcome (2026-07-09)

### §1 Investigation — inventory (client grep)
- `place-pulse`/`placePulse`: exactly one home — `@keyframes schedule-warehouse-place-pulse`
  (index.css) on `.schedule-claim-btn.placing`. Byte-identical to the styleguide
  keyframe + timing (`50%{box-shadow:0 0 14px rgba(87,199,123,.35);opacity:.72}`,
  1.6s ease-in-out ∞, cursor:wait).
- `is-live`/`.dot`: one real surface — the schedule Monitor live-run chip
  (`Monitor.tsx`, `data-testid="schedule-monitor-live-chip"`, rendered while
  `run && !settled`); styled at `mjolnir.css` `.chip.is-live .dot` (no animation).
- toast: no single component — a shared `.schedule-toast` class (index.css) reused by
  `workshop-toast`, `market-sell-toast`, warehouse-claim, `workshop-dismantle-toast`;
  each page keeps ONE toast in state (the "single-message queue" already holds).
- page-mount entrances: `RagnarokPage` is the one ceremonial screen (styleguide `rise`
  source = ragnarok/season_end_*); dex/market are utilitarian/interaction-heavy.
- No e2e visual-snapshot tests exist (`toHaveScreenshot`/`toMatchSnapshot` = 0) ⇒ CSS
  motion cannot cause "skin" breakage. e2e sets no `reducedMotion`, so entrance motion
  would otherwise run under automation — hence the webdriver gate (§3).

### §2 Adoption decisions (mount point + one-line justification)
| motion | decision | mount |
|---|---|---|
| `placePulse` (loop) | **RECONCILED — reuse, do not duplicate** | already live as `schedule-warehouse-place-pulse`; rename rejected (would churn REQ-0072's kept selector contract + the `schedule-warehouse-claim-*` sibling family). Cross-ref comment only; no behavioural change. |
| `pulse` (loop) | **added** → `mjolnir-live-pulse` | `.chip.is-live .dot` — the live-run heartbeat ("now running"), the one real is-live surface. |
| `toastin` (once) | **added** → `schedule-toast-in` | shared `.schedule-toast` — one hook covers every page's single-message toast entrance. |
| `rise` (once, staggered) | **added** → `ragnarok-rise` | `.ragnarok-page > *:not(.ragnarok-bgart)`, grouped stagger capped ~.24s — the Hall of Ragnarok ceremonial entrance. **Not** applied to dex/market (utilitarian, no ceremonial "開演" moment) — respects "don't sprinkle". |

### §3 Motion gate (reduced-motion + e2e safety)
`main.tsx` sets `document.documentElement[data-motion="on"]` **only when** NOT
`navigator.webdriver` AND NOT `prefers-reduced-motion` (mirrors `landing/particles.ts`).
All three NEW motions are CSS-scoped under `:root[data-motion="on"]`, so:
- under Playwright/webdriver → flag absent → **no new motion → e2e byte-identical**;
- under reduced-motion → flag absent (belt-and-suspenders with mjolnir.css's blanket).
`placePulse` (the functional "work in flight" indicator) is intentionally left ungated
(unchanged existing behaviour).

### §4 Files changed (branch `req-0113-motion-adoption`)
- `client/src/main.tsx` — the data-motion gate (placed after all imports).
- `client/src/theme/mjolnir.css` — `mjolnir-live-pulse` on the live dot.
- `client/src/index.css` — `schedule-toast-in` on `.schedule-toast`; `ragnarok-rise`
  stagger on the ragnarok hall.
- `web/app/*` — dist rebuild (commit `3e41771`).
No JSX/DOM/testid/selector changes; no new colors/tokens.

### §5 Gates
- **tsc** (`tsc -b`) ✓ · **lint** (`oxlint`) ✓ 0 errors (35 pre-existing warnings, none
  new) · **vite build** ✓ → worktree `web/app` (NOT the live checkout).
- **e2e**: the suite runs on-box and (even in parallel mode) `global-setup` backs up the
  LIVE profile/content and the proxy serves static from the live `:8801` — i.e. it
  touches hands-off `backpack-api`/`backpack-web`. Per project convention (see
  ragnarok.spec header) the orchestrator runs it against the deploy. **Proven inert
  meanwhile**: served the worktree build on a throwaway port under headless Chromium —
  `navigator.webdriver=true ⇒ data-motion=null` (no motion), all 3 keyframes present in
  the bundle, and with the flag forced on the mounts resolve correctly
  (`liveDot→mjolnir-live-pulse`, `toast→schedule-toast-in`, `hero→ragnarok-rise`,
  `bgart→none`), no console errors from the change.

### §6 Remaining (needs user go-ahead — hands-off)
Merge `req-0113-motion-adoption` → master, rebuild dist in the main checkout, restart
`backpack-web`, then run the live e2e suite (`schedule` / `ragnarok` / `workshop` /
`market` cover the mounts). Nothing here touches the main checkout or live services yet.

---

## Deploy (2026-07-09, user GO)

Done, live:
- Pre-flight: main checkout clean, on `master` @ `e610635`.
- Merged `--no-ff` → master `f4bfe6d` (0 conflicts).
- Rebuilt dist in main checkout → **deterministic** (0 git diff vs the committed dist).
- Restarted `backpack-web.service` (user unit); served app CSS
  (`assets/index-OnbhA6vH.css`) contains `mjolnir-live-pulse` / `ragnarok-rise` /
  `schedule-toast-in` + the `data-motion` scoping. Tunnel `/app/` = 200. **LIVE.**

Live e2e (against `https://backpack-dev.qtie.jp`):
- Ran 80/134 before the run was killed by a **concurrent agent's e2e run** (another
  run's `global-setup` cleared shared dev state mid-run — `/tmp/e2e48.log` + a second
  backup marker set confirm it; NOT caused by this change).
- Of the 80: **79 passed, 1 failed**. Passing included **all 8 `ragnarok.spec` (the
  `rise` surface)** and **`market.spec` (a `toast` surface)**.
- The 1 failure — `dex-card.spec.ts:65` (dex subwindow deep-link) — is **not a
  regression**: this change touches no dex code, and all three new motions are scoped
  under `:root[data-motion="on"]`, a flag `main.tsx` never sets under `navigator.webdriver`
  ⇒ under e2e the change is a strict no-op (no motion, no DOM/selector delta). The
  failure is a state artifact of the concurrent run hitting the shared live backend.
- **Not yet re-run** (inert to this change): `schedule` (pulse dot), `schedule-mjolnir`,
  `workshop` + `warehouse-mjolnir` (toast). To run once the box is free of other agents'
  e2e (serial-against-tunnel collides; the suite is single-run-at-a-time by design).

Live-data hygiene: the aborted/concurrent runs left `content/live/live_items.json`
drifted; **restored to pristine HEAD** (`git checkout`), `backpack-api` restarted to
reload pristine content, `data/profiles/default.json` + `live_sis.json` verified already
pristine. Board now clean (0 dirty).

**Remaining**: user acceptance (then `built/ → done/`); optionally the 4 inert specs above
when no concurrent e2e is active.
