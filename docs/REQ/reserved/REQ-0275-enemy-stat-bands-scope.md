# REQ-0275 — Stat-band scoping: item-only labels + enemy-side bands from live data

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user ratified in chat (2026-07-22 JST): implement both
  (a) scope labeling and (b) enemy-side bands.

## Origin
User question: "are statistics separated between enemy and item?" Answer
found: no — and the corpus contains ZERO enemy entries (Backpack Battles is
PvP with no monsters; the Backpack Hero wiki has no enemy pages). Current
bands are de facto ITEM-only, yet the browser overlays 36 live skills on
them (category mismatch shown as if comparable), and candidate_gate STATIC
is a silent na for skills/enemies.

## Problem
(a) Item-derived bands carry no scope marker and are visually applied to
enemy skills — a misread waiting to happen. (b) Enemy/skill candidates get
no static sanity check at all; an hp:[300,400] common enemy would sail into
the sim stage before anyone notices the magnitude error.

## Proposal
(a) Scope labeling: content/corpus_stats.json bands gain scope:"item";
    browser and candidate_gate STATIC wording state the scope explicitly.
(b) Enemy-side bands derived from OUR LIVE data (not the corpus — the wikis
    cannot provide this): new tools/enemy_bands.py (stdlib) reads
    content/live/dungeon/enemies.json (44 enemies, lowercase rarity,
    hp:[lo,hi]) + skills.json (81 skills) and derives
    content/enemy_bands.json (TRACKED, deterministic, per-tier n +
    provisional flags, basis:"live_self"):
    - per-rarity enemy HP bands (over hp midpoints);
    - per-rarity enemy TOTAL-dps bands (enemy dps = sum of its skills'
      dps proxies, same formula as check_stat_bands);
    - pooled per-skill dps band (skill/1 has no rarity).
    candidate_gate STATIC: kind=enemy -> hp band + total-dps band for its
    rarity (candidate skills resolved from live + supplied defs);
    kind=skill -> per-skill dps band. Absent bands file -> na fallback.
    Browser LIVE COMPARISON: skills compare against the enemy-skill band
    (items keep item bands); scope labels shown.

## Posture notes
- basis:"live_self" is honest: these bands describe our CURRENT live meta
  and catch outliers against today's game, not genre truth. Documented in
  the file and the browser.
- Same closed-vocab, deterministic, stdlib/dep-free constraints as
  REQ-0268/0272. No vocab changes; no server code.

## Gates (when implemented)
- enemy_bands.py deterministic (two runs byte-identical); tests for band
  math on fixtures; gate STATIC: an hp-outlier common enemy fixture flags,
  a sane fixture passes, an OP skill dps fixture flags statically now;
  browser test updated; quick CI green.
