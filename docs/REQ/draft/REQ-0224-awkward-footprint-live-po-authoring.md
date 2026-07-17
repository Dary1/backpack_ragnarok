# REQ-0224 — awkward-footprint-live-po-authoring: give production one real non-rectangular po

**Status:** draft — AGENT-PROPOSED, awaiting owner review. Content authoring is the owner's
call, so this cannot be cleared by an agent.
**Reserved:** 2026-07-16
**Slug:** awkward-footprint-live-po-authoring
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」.

## Why (the dormancy problem, still true after REQ-0187/0191)

Every po artwork in the live registry is a FULL RECTANGLE (verified across all 22 on
2026-07-15, REQ-0187). Consequences:

- REQ-0183/0186's shape conditioning resolves `auto → off` for the entire registry: the
  headline capability is DORMANT in production, exercised only by synthetic test artworks that
  REQ-0187 created and (per its own spec) deleted.
- REQ-0191's cell-shape backdrop can never show the owned/unowned split on live data; its S7
  checklist had to carry a caveat that the split is only visible in the e2e L-tromino.
- Any future regression in the strict path would be invisible in production until someone
  authors the first awkward item under deadline pressure.

REQ-0187's spec already stated the principle: "the owner's own item is better evidence than a
synthetic one."

## What to do
- The owner authors (or commissions through the normal content pipeline) at least one REAL
  po item with a non-rectangular footprint — L-tromino or T-tetromino class, per the fit
  doctrine (`item_content_pipeline.md` §0.2: pick mask orientation matching the subject's
  natural pose; symmetric-headed subjects are T-objects, offset-headed ones are L-objects).
- Generate its artwork through the production route (auto → strict engages), score with
  po.cell_fit, eyeball with the REQ-0191 backdrop — the first live, permanent exercise of the
  whole REQ-0153→0183→0186→0187→0191 chain.
- Wire it into real content (a pack/pool) so it persists, rather than living as registry
  debris.

## Out of scope
- New vocab, new mechanics, batch authoring; anything about monster/si/unit footprints;
  changing auto's rule (that is REQ-0220).

## Gates
- The item is live, adopted, non-rectangular, and its renders carry `resolved lock = strict`
  provenance; po.cell_fit row exists; backdrop shows a real owned/unowned split on live data;
  content self-tests + default suite green.
