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
