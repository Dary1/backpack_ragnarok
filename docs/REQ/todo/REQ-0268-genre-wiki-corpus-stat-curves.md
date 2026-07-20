# REQ-0268 — Genre wiki corpus: normalized reference data + stat curves

## State log
- 2026-07-20 reserved (stub).
- 2026-07-20 reserved -> draft: spec written from the content-pipeline consultation
  (user, 2026-07-21 JST); blocked on user ratification of scope decisions
  (source list, storage location).
- 2026-07-20 draft -> todo: user ratified (chat, 2026-07-21 JST): sources = Backpack
  Hero + Backpack Battles; storage = data/corpus/ gitignored with the tracked
  stats file under content/.

## Origin (content-pipeline consultation)
Balance-tuning phase begins; monster skills and item effects are the focus.
The user proposed downloading Backpack-genre wiki data and training a
generative DL model on it. Consultation outcome: the corpus is valuable, the
training is not — a few thousand entries is 2-3 orders of magnitude short for
generative training, and cross-game numbers do not transfer (different HP
scales, economies, grid rules). Repurposed: build the corpus as REFERENCE
data — statistical grounding plus retrieval/few-shot context for the existing
LLM generation pipeline — never as training data, never as verbatim content.

## Problem
Current item/skill generation rests on LLM-authored prose principles with no
empirical grounding. There is no quantitative power budget: no rarity/cost
curves, no effect-frequency taxonomy, no regression linking numbers to cost.
Generated candidates cannot be linted against anything measurable.

## Proposal
- tools/corpus_fetch.py: download wiki data for an agreed source list
  (ratified: Backpack Hero + Backpack Battles). Cache raw
  pages with source URL and license attribution (Fandom wikis are typically
  CC-BY-SA; the game data itself belongs to each developer — see Posture).
- tools/corpus_normalize.py: parse raw pages into one normalized schema
  aligned with content/vocab (effect taxonomy mapped onto our verbs where a
  mapping exists; rarity, cost/price, numeric fields, shape/footprint when
  present). Unmappable effects land in an unmapped bucket, not dropped.
- tools/corpus_stats.py: derive the deliverables — per-rarity cost/power
  distributions, effect frequency tables, number-vs-cost regressions (power
  budget curves), outlier lists. Output a machine-readable stats file plus a
  human-readable report.
- Pipeline hookup: the stats file becomes (a) retrieval/few-shot context for
  generation and (b) lint bands consumed on the gen_data -> integrate path.

## Posture notes
- Reference only, hard rule: no corpus text or numbers copied verbatim into
  live content; the corpus never becomes model-training data. Derived
  statistics inform OUR curves; our vocab stays the closed authority.
- Licensing: keep per-source attribution; the corpus is internal tooling
  data, never shipped.
- Storage (ratified): raw+normalized corpus lives in data/corpus/ (gitignored,
  like profiles/); only the small derived stats file is tracked, under
  content/ (consumed by the generation pipeline).

## Gates (when implemented)
- Normalizer unit tests run on committed fixture pages (no network in tests).
- Stats run is deterministic and reproducible from the normalized corpus.
- A lint check consuming the stats bands rejects a deliberately out-of-band
  fixture item.

## Implementation (State log)
- 2026-07-20 todo -> implemented. Built the corpus pipeline on branch
  req-0268-genre-wiki-corpus-stat-curves. Deliverables (all English, stdlib /
  dependency-free):
  - tools/corpus_fetch.py (urllib/json/time): MediaWiki api.php fetcher.
    Endpoints discovered via the siteinfo API -- Backpack Hero =
    https://backpack-hero.fandom.com/api.php, Backpack Battles =
    https://backpack-battles.fandom.com/api.php (both content CC-BY-SA).
    generator list=allpages ns=0 (nonredirects) then per-page
    prop=revisions|categories. Polite: descriptive User-Agent, >=1s sleep,
    idempotent per-page cache (skip unless --refresh). Flags --source/--limit/
    --refresh/--out/--delay. Raw + manifest under data/corpus/raw/<source>/
    (gitignored).
  - tools/corpus_normalize.py: brace-depth template extraction + regex (no
    parser libs). Emits data/corpus/normalized/<source>.json (schema corpus/1).
    Robust: a weird page never crashes (per-page try/except -> "other" +
    <parse error> in unmapped); unmappable effect phrases are kept in `unmapped`.
  - tools/corpus_stats.py: deterministic content/corpus_stats.json (TRACKED,
    sorted keys, rounded, no timestamps -- verified byte-identical on rerun) +
    data/corpus/report.md (untracked). Per-source & pooled rarity distribution;
    per-rarity n/mean/median/p25/p75/p95 for damage-mid, cadence-mid, dps-proxy
    (damage_mid/cadence_mid) and hp; verb frequency; rarity-ratio curve; derived
    dps warn `bands`.
  - tools/check_stat_bands.cjs (node, dep-free): computes a def's dps-proxy
    (damage-verb n-mid / every_secs s-mid, summed) vs its rarity band.
    --report (exit 0) / --gate (exit 1 out-of-band) / --self-test (embedded
    fallback bands = vocab dps_ceiling_warn; in-band passes, overpowered fails).
    Reads po/2 items and skill/1 files (skills have no rarity -> advisory `na`).
  - tools/tests/corpus_test.py (plain python3, assert-style) + 5 real trimmed
    CC-BY-SA fixture pages under tools/tests/fixtures/corpus/ (README carries
    attribution). Covers known-item mapping, excluded_attested bucketing,
    unparseable/malformed page robustness, stats determinism, hand-computed
    band derivation. 35 assertions green.
  - ci.sh: added [3.95/7] `python3 tools/tests/corpus_test.py` and [3.96/7]
    `node tools/check_stat_bands.cjs --self-test` after [3.9/7] (existing steps
    untouched; live content stays advisory -- ci runs --self-test only).

### Key decisions
- Rarity ladders (mapping tables live in the tool, NOT in vocab -- vocab is
  never widened): Backpack Hero Common/Uncommon/Rare/Relic map 1:1 to our four.
  Backpack Battles has a FIVE-rung ladder (Common<Rare<Epic<Legendary<Godly,
  plus Unique); mapped rank-preservingly onto our four by collapsing the top two
  (Legendary, Godly, Unique) into Relic: Common->Common, Rare->Uncommon,
  Epic->Rare, Legendary/Godly/Unique->Relic.
- Band formula: warn_hi[r] = round(vocab.dps_ceiling_warn['Common'] *
  pooled_ratio[r], 1); ratio[r] = corpus median dps-proxy of tier r / that of
  Common. Only the corpus RATIO curve transfers -- absolute cross-game numbers
  do not (different HP/economy scales), so Common is anchored to OUR ceiling
  (12) and higher tiers scale from it. A tier with no dps data falls back to
  vocab dps_ceiling_warn[r] (basis=vocab_fallback).
- dps-proxy is only defined where BOTH a damage and a cadence number exist.
  Backpack Hero is energy-gated (no cooldown), so its items carry no cadence and
  do not feed dps-proxy; the ratio curve is effectively Backpack Battles'
  cooldown-DPS scaling, which matches our tick/every_secs model.
- Template coverage: Backpack Hero's main card is bare {{Item}} (field
  `effects`) plus {{infobox carving}}; Backpack Battles uses {{Item_Template}}
  and {{BPB_Item_Template}}. The matcher accepts any *infobox*, any
  *item_template*, and bare {{Item}} (excludes {{Items Navbox}}/{{AddItem}}).

### Fetch / normalize / stats numbers (2026-07-20 fetch)
- Fetch: backpack-hero 302 pages, backpack-battles 165 pages; 0 failures.
- Normalize (kind): BH item=271, other=31; BB item=122, other=43.
  Verb tokens mapped: BH 192, BB 90 (pooled 282). Unmapped phrases: BH 109,
  BB 254 (icon-only BB effects lose status words when File links are stripped --
  intentional, honest).
- Pooled rarity distribution: Common 98, Uncommon 78, Rare 90, Relic 61,
  unmapped 140 (n=467). Relic is BB-only (BH has no Relic-tier items in-corpus).
- Pooled dps-proxy counts by tier: Common n=5, Uncommon n=4, Rare n=10,
  Relic n=28 (all n=47).
- Derived bands: Common warn_hi=12 (ratio 1.0), Uncommon 23.6 (1.968),
  Rare 18.2 (1.515), Relic 25.2 (2.099).
- Pooled verb frequency top: strike 146, block 46, heal_ally 35,
  apply_status 25, cleanse 8, haste 6, slow_enemy 6.

### Gaps / notes
- dps-proxy per-tier n is small (4-28) because only cooldown items qualify; the
  ratio curve is therefore noisy (Uncommon 1.968 > Rare 1.515 is a sampling
  artifact, not a real inversion). Advisory only -- fine for reference grounding,
  not a hard gate. Live check runs --self-test in ci; --report on live items is
  advisory (blade dps=15 > Common warn 12).
- Quick CI (SKIP_PG/SKIP_CLIENT/SKIP_E2E) runs green through every pure-node
  suite (117/14/18/5/15/13/13/13/23/119 tests) then halts at [3.5/7] tsc:
  this worktree has no node_modules (never pnpm install-ed) -- a pre-existing
  environment gap, unrelated to REQ-0268. The two REQ-0268 steps pass when run
  directly from the worktree root (corpus_test 35/35; check_stat_bands
  --self-test OK).
