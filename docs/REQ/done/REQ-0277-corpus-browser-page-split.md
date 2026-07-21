# REQ-0277 — Corpus browser page split: items / monsters / index

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user ratified in chat (2026-07-22 JST). Rationale:
  mixed item+enemy views invite cross-category noise for human analysis and
  for any future LLM asked to read the surface; the machine path
  (gen_context packs, per-scope JSONs) is already kind-separated — the human
  surface should mirror it.

- 2026-07-22 built (stays in todo; folder unchanged): tools/build_corpus_browser.py
  refactored from one 4-tab index.html into THREE self-contained pages under
  web/preview/corpus/ (index / items / monsters) via per-page emit functions
  sharing helpers; --out semantics unchanged (dir). index.html = normalization-
  quality summary + attribution + prominent relative nav links to both kind
  pages. items.html = all 467 corpus entries (item + item-page 'other'
  derivatives, labelled) + item curves & bands (scope=item, corpus-derived) +
  LIVE ITEM comparison only (3 rows). monsters.html = enemy-side bands
  (enemy_hp / enemy_total_dps / skill_dps, basis live_self) + live SKILL+ENEMY
  comparison (36 skills + 32 enemies = 68 rows; enemy dps = SUM of its skills'
  dps-proxies, parity with tools/enemy_bands.py + check_stat_bands.cjs) + a
  prominent ZERO-enemy-entries notice (BB is PvP; BH wiki has no enemy pages).
  Each page embeds ONLY its data slice, so content isolation holds at the data
  layer (items carries no enemy/skill live rows nor enemy-band tables; monsters
  carries no item-band table nor corpus entries table). Deterministic: two runs
  byte-identical per page; cross-page links relative; zero external asset
  requests. corpus_browser_test.py rewritten (61 asserts): 3-page presence,
  per-page content isolation, index links to both pages, item bands vs
  corpus_stats.json, enemy bands vs enemy_bands.json, per-kind live builders in
  isolation, dps-proxy parity, byte-identical per page. ci step position
  unchanged (3.97/7). Real-run (full corpus + live): index 14.4KB, items
  271.5KB, monsters 30.5KB; index cards=2, items entries=467 / item live=3,
  monsters live=68 (36 skills + 32 enemies), corpus_enemy_entries=0.

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
