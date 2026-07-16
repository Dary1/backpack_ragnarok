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
