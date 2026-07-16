# REQ-0195c — market-si-listings: SI instances on the market

**Phase of REQ-0195 (see REQ-0195a §4; §4.2/4.3 si rows).**
**Ratified:** 2026-07-16 (user directive).
**Depends on:** REQ-0195a.

## Scope
- Server: kind:'si' listings — inventory pages[].sis[] eligibility (socketed-in-inventory included), deployed -> suspended, gone -> auto-withdraw; settle strips the sis[] entry, delivers a plain warehouse row (q copied; claim already validates via siDefsById, REQ-0115).
- Server: the PO-sale SI re-home fix (REQ-0195a §4.2 po): settling a PO re-homes SIs hosted on it to host:'inv' (never orphan host refs).
- Client: SellPane si tab; BuyPane/MinePane cards (si icon, rarity).
- Tests: server suite (si create/settle/re-home) + e2e si listing visible in browse.

## Status log
- 2026-07-16 split from REQ-0195 while in todo/.
- 2026-07-16 implemented + committed. Gates: server api_test 180 passed / 0
  failed (files backend, incl. the new si + PO-sale re-home suite); client
  tsc -b + vite build clean. e2e si-browse authored (content-agnostic).
  todo -> built.
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
