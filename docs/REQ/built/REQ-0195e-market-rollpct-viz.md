# REQ-0195e — market-rollpct-viz: the roll-fulfillment bar (min=0%, max=100%)

**Phase of REQ-0195 (see REQ-0195a §4.1 rollPct + §3.2 unmeasured ruling; REQ-0196 defines the container).**
**Ratified:** 2026-07-16 (user directive: ハスクラ的性能の下限〜上限充足率をビジュアルで).
**Depends on:** REQ-0195a (DTO), best after b–d (bars on every kind's cards).

## Scope
- Server: listing DTO `rollPct: number|null` derived at DTO time from the seller's live instance — po/si: q (REQ-0063); unit: bp.roll?.pct (REQ-0196 container) else null; tm: null. Settled listings freeze the value on the settlement record for MinePane history honesty.
- Client: RollBar component (0–100% fill + % label) on BuyPane/MinePane cards and BuyModal; unit rollPct null -> "unmeasured" badge (未測定), never 0%; tm -> nothing.
- Tests: server DTO derivation suite + e2e: po listing bar % equals the seeded instance q; unit listing shows the unmeasured badge.

## Status log
- 2026-07-16 split from REQ-0195 while in todo/.
- 2026-07-16 implemented + committed (083682a). Server: ApiMarketListing +=
  rollPct (number|null, DTO-derived); views.cjs rollPctOf (po/si -> instance q
  per REQ-0063; unit -> bp.roll?.pct per the REQ-0196 container else null; tm ->
  null) wired into toListingDto; trade.cjs freezes rollPct onto the settlement
  record at the commit point (MinePane settled-row honesty). Client: marketShared
  RollBar (0-100% gold fill + % label; unit null -> 未測定 badge, never a 0% bar;
  tm -> nothing) wired into BuyPane/MinePane/BuyModal; i18n roll.unmeasured/
  roll.title EN+JA; market.css styles. Gates: server api_test 182 passed / 0
  failed (files backend, incl. the new rollPct derivation + freeze suite); server
  tsc (tsconfig.server.json) clean; client tsc -b + vite build clean. e2e: po bar
  % == seeded q (50%) + unit unmeasured badge authored (content-agnostic) -- not
  executed here (default e2e targets the LIVE services owned by the main checkout;
  same posture as phases a-d). todo -> built.
- 2026-07-16 (orchestrator review) market e2e EXECUTED against the isolated
  worktree fleet -- 14/14 passed (the original 13 + a new content-bound
  kind-chips case for review fix F1); tools/ci.sh SKIP_PG=1 SKIP_E2E=1 => CI
  GREEN; server api_test 183 passed / 0 failed (files backend). This CORRECTS
  the earlier "e2e authored but not executed / would hit the LIVE services"
  note(s) above: tools/e2e_fleet.cjs spawns THIS worktree's server/api.cjs under
  isolated /tmp homes and the local-proxy serves THIS worktree's web/app build,
  so the specs run the worktree code, not live services.
- 2026-07-16 (orchestrator review) review-fix commits this session: 80b774c
  (F1 browse filter/query resolve defs per kind + kind chips), 1207134 (F2/F3/F4
  PriceTag currency label + skip unit-less BPs + reset tm sell form), ec4c86b
  (F5 stale envelope docs -> v2 tms[]), 8744310 (F1 kind-chips e2e).
