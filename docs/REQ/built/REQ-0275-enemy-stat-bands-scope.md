# REQ-0275 — Stat-band scoping: item-only labels + enemy-side bands from live data

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user ratified in chat (2026-07-22 JST): implement both
  (a) scope labeling and (b) enemy-side bands.
- 2026-07-22 IMPLEMENTED on branch req-0275-enemy-stat-bands-scope (5 commits).
  (a) Scope marker: content/corpus_stats.json gains a top-level bands_scope:"item"
      (sibling to `bands`, sorts between bands/bands_formula; bands_formula prose
      documents it). Regen was surgical: generated_from and every data field are
      BYTE-IDENTICAL to master -- only bands_scope + the appended bands_formula
      sentence change (the marker is a corpus-independent constant).
      Deviation/decision: the sole corpus copy the task permits (req-0268 worktree)
      is PRE-REQ-0271 normalized data and does NOT reproduce master's stats. Since
      the scope marker is data-independent, I proved on that stale corpus that the
      code change adds EXACTLY bands_scope (deterministic; two runs byte-identical),
      then applied the same constant to the real tracked file via the tool's own
      canonical serializer (which round-trips the tracked file byte-identically).
  (b) tools/enemy_bands.py (stdlib) -> content/enemy_bands.json (schema
      enemy_bands/1, basis live_self, generated_from content hash, no timestamps,
      deterministic). Band formula chosen -- multipliers are DATA in band_formula,
      not code constants: warn_lo = min*0.75, warn_hi = max*1.25; flag bounds =
      warn_lo/flag_mult .. warn_hi*flag_mult with flag_mult = 2.0; provisional
      when n < 30. dps-proxy is IDENTICAL to tools/check_stat_bands.cjs.
  Honest numbers (every per-rarity group is provisional):
    enemy_hp        common n20 warn[14.625,115.625] | uncommon n9 [45,175]
                    | rare n11 [93.75,500] | relic n4 [450,875]
    enemy_total_dps common n20 warn[0,8.152] | uncommon n9 [0,5.0]
                    | rare n11 [0,19.325] | relic n4 [1.765,6.944]
    skill_dps       pooled n36 (n_na 45) warn[0.01,17.361] -- NOT provisional (n>=30)
  candidate_gate STATIC extended: kind=skill -> per-skill dps vs skill_dps band;
  kind=enemy -> hp midpoint vs enemy_hp[rarity] AND total dps vs
  enemy_total_dps[rarity] (skills resolved from live + embedded def.skill_defs).
  Missing enemy_bands.json -> na fallback (unchanged). Wording states scope+basis
  ("item-scope bands" / "live_self enemy-hp / skill-dps bands").
  check_stat_bands.cjs now module.exports its dps formula (require-guarded main)
  so the gate reuses it EXACTLY (no fork).
  Demo: hp:[300,400] common enemy -> STATIC FLAG ("enemy hp midpoint 350 outside
  flag bounds [7.313, 231.25] ... live_self enemy-hp band for common"); sane
  common enemy hp:[35,50]/gnoll_claw -> STATIC PASS; OP strike skill (100 dps) ->
  STATIC FLAG (skill_dps flag_hi 34.722). The existing DYN_SKILL fixture stays
  static-PASS / sim-FLAG so both static and dynamic skill paths remain covered.
  Browser: corpus bands labeled scope item; live skills now compare vs the
  live_self skill_dps band (na rows gone -- 39 live defs banded, 1 over); a
  live_self enemy-side bands table added to CURVES & BANDS. Regenerated
  deterministically (untracked web/preview/corpus/).
  Tests all green: candidate_gate_test 7->10; NEW enemy_bands_test (29);
  corpus_browser_test 29->37; corpus_test 88->90; ci.sh step [3.99/7] added.

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
