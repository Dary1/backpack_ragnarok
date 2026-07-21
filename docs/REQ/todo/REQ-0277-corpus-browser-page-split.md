# REQ-0277 — Corpus browser page split: items / monsters / index

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user ratified in chat (2026-07-22 JST). Rationale:
  mixed item+enemy views invite cross-category noise for human analysis and
  for any future LLM asked to read the surface; the machine path
  (gen_context packs, per-scope JSONs) is already kind-separated — the human
  surface should mirror it.

## Proposal
tools/build_corpus_browser.py emits THREE pages into web/preview/corpus/:
- index.html — normalization-quality summary (per-source cards, unmapped/
  excluded stats) + attribution + prominent links to the two kind pages.
- items.html — corpus item entries table + item curves/bands
  (bands_scope=item) + live ITEM comparison. No enemy/skill content.
- monsters.html — enemy-side bands (basis live_self) + live enemy/skill
  comparison. States prominently: the corpus contains ZERO enemy entries
  (BB is PvP; BH wiki has no enemy pages); all monster stats derive from
  OUR live data.
Shared inline CSS/JS may be duplicated per page (self-contained pages, no
external requests). Deterministic output; corpus_browser tests updated for
the 3-page structure; ci step unchanged in position.

## Gates
- Tests green (page presence, per-page content isolation: no enemy strings
  on items.html live section, no item-band table on monsters.html); two
  runs byte-identical; quick CI green.
