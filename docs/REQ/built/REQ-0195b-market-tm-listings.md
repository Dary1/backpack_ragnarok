# REQ-0195b — market-tm-listings: currency-for-currency trades

**Phase of REQ-0195 (see REQ-0195a §4 for the shared design; §4.1/4.2/4.3 tm rows).**
**Ratified:** 2026-07-16 (user directive + same-TM-forbidden ruling, REQ-0195a §3.1).
**Depends on:** REQ-0195a (kind field, multi-TM price core).

## Scope
- Server: kind:'tm' listings — create (itemId = live TM id, tmQty ∈ [1,999], price.tm ≠ itemId -> 400 {reason:'same_tm'}), derived SUSPENSION on balance < tmQty (never auto-withdraw), settle: debit seller stacks, deliver buyer a kind:'tm' warehouse row qty=tmQty, price/burn/proceeds/history as REQ-0195a.
- Client: SellPane tm tab (sell-qty stepper + balance + price form), BuyPane/MinePane/BuyModal render tm listings (no roll bar).
- Tests: server suite (create/validate/suspend/settle/insufficient-stock 409) + e2e tm-for-tm buy end to end.

## Status log
- 2026-07-16 split from REQ-0195 while in todo/.
- 2026-07-16 implemented + committed (b42cd95). Gates: server api_test 179
  passed / 0 failed (files backend, incl. the new tm suite); client tsc -b +
  server tsc + vite build clean. Added fixture TM 'gilt' so a real tm-for-tm
  settle is testable. NOTE: a full tm-for-tm BUY e2e is impossible against the
  LIVE single-TM content (only lrdst is minted; same_tm forbids self-pricing),
  so the e2e asserts the tm tab's dormant single-TM state + same_tm 400 instead;
  it unblocks automatically once a 2nd TM is minted. todo -> built.
