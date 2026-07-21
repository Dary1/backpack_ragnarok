# REQ-0271 — Corpus verification + effect semantics: make the corpus trustworthy and meaningful

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user directive "proceed to completion" (chat, 2026-07-21
  JST) after auditing the corpus browser and finding effects 44% unmapped.
- 2026-07-21 coverage verification + audit sample (tasks 1-2 + phrase extraction;
  subagent over SSH). COVERAGE: interrogated both wikis' MediaWiki API directly
  (siteinfo statistics + full allpages ns0 nonredirect with continuation).
  Backpack Hero: articles=302, allpages ns0 nonredirect=302 (307 incl 5
  redirects), cached=302 -> missing=0, extra=0; Items category=246 pages.
  Backpack Battles: articles=165, allpages ns0 nonredirect=165 (166 incl 1
  redirect), cached=165 -> missing=0, extra=0. NO fetch bug: corpus_fetch
  enumerate_pages continuation is correct (params.update(cont) propagates
  apcontinue) and both wikis sit under the 500 aplimit, so fetched >= wiki-side
  content pages for both sources -> Gate 1 SATISFIED. Refetch=0; no re-normalize
  (raw unchanged). Normalized counts unchanged: BH 302 (item 271/other 31), BB
  165 (item 122/other 43). ACCURACY AUDIT (task 2): seeded-random sample,
  random.seed(271), 10 per source, source order [backpack-battles,
  backpack-hero]; 20 audit cards emitted to orchestrator. Systematic finding:
  the BH rarity map is mis-specified -- it maps a nonexistent 'relic' rarity and
  omits the wiki's real 'Legendary' tier, so 66 BH items (rarity_raw=Legendary)
  normalize to rarity_norm=None (BH rarity_norm=None total 101/302 = 66
  Legendary + 34 no-rarity + 1 'N/A'). Flagged for orchestrator; fix deferred
  (out of this subtask's regen scope). PHRASE EXTRACTION (task 3):
  data/corpus/unmapped_phrases.json = 255 unique unmapped phrases, 363 total
  occurrences (BH 109, BB 254); entries with >=1 unmapped phrase BH 97/302
  (32%), BB 108/165 (65%); top phrases are trigger clauses ('Start of battle:'
  x22, 'On hit:' x20, 'Gain 1 .' x9). Verify artifacts under data/corpus/verify/
  (gitignored).

- 2026-07-21 REQ-0271 implementation (Proposal items 3-5 + the four audited
  normalizer defects; subagent over SSH, worktree
  req-0271-corpus-effect-semantics). NORMALIZER (tools/corpus_normalize.py):
  (a) BH rarity map now legendary->Relic (dead 'relic' key removed) -- the 66
  Legendary items normalize to Relic (BH rarity_norm=None 101->35, pooled
  140->74). (b) icon markup substituted by its alt / {{Pic}} arg (no more
  dangling "Gain 1 ." fragments). (c) clauses split on sentence terminators
  (. ;) only, never ':', so trigger headers stay attached to their clause.
  (d) verb mapper rewritten clause-scoped + target-aware, precision-first:
  strike only for own Damage stat / "deals N damage"; adjacency aura ->
  buff_adjacent; reduce/prevent damage -> damage_reduction; reflect ->
  reflect_damage; self-directed Slow never slow_enemy; opponent debuff ->
  apply_status. CURATED TABLE (tools/corpus_verb_map.json, TRACKED, 59 entries,
  closed vocab only) applied deterministically AFTER the auto layer (table wins);
  classifies 100% of the auto-layer residual (189 unique / 204 occ): 18 phrases
  verb-recovered, 4 noise, the rest no_model across 15 reason categories
  (resource_economy 39, mana_conductivity 28, star_synergy 24, item_lifecycle
  20, chance_percent 12, shop_economy 12, bp_geometry 11, card_mechanic 9,
  buff_status_unmodeled 5, enemy_buff_strip 5, max_hp_scaling 5, cadence_manip
  2, crit_accuracy 2, conditional_bonus 1, heal_amp 1). RESULT (honest): entries
  with residual `unmapped` 205/467 (43.9%) -> 0/467 (0.0%) -- GATE <15% met (the
  table classifies EVERY residual phrase; of 384 effect-bearing items 281 (~73%)
  map to >=1 closed verb, the other 104 are effect-bearing-but-no-verb, i.e.
  wholly no_model/noise genre mechanics). Pooled verb tokens 282 -> 381; strike
  146 -> 113 (adjacency false positives removed), NEW buff_adjacent 81 /
  damage_reduction 4, lifesteal 3 -> 18, reflect_damage 2 -> 9. STATS
  (content/corpus_stats.json): every band tier now carries n + provisional (n<30);
  all four tiers provisional (dps-proxy n Common 5 / Uncommon 4 / Rare 10 /
  Relic 28); top-level generated_from content hash; two runs byte-identical;
  bands unchanged (warn_hi 12.0/19.7/19.7/25.2). Browser regenerated into the
  untracked data/corpus/browser -- renders the enriched verbs_mapped, 0 unmapped.
  DESIGN-GAP report docs/llm_managed/genre_mechanics_gap.md (ADVISORY, no auto
  action; user-gated vocab design input). TESTS tools/tests/corpus_test.py
  49 -> 88 passed / 0 failed (four defect fixtures incl. Citrine buff_adjacent
  and Plate self-slow; table exact/prefix/contains + class routing; provenance;
  one expectation intentionally CHANGED: Bloodthorne now fully maps). GATES:
  corpus_test.py green; check_stat_bands --self-test + --report green; quick CI
  (SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1) GREEN. REQ NOT moved (stays in todo).

## Origin
User audit of the REQ-0270 browser: "the crucial part — effects — is mostly
unmapped". Trust review also surfaced never-verified claims: fetch coverage
(302/165 pages vs actual wiki size) and normalization accuracy (mapping
correctness never sampled). Bands rest on n=47. The original program goal is
balance-phase support for MONSTER SKILL CONTENT and ITEM EFFECTS — the
semantic layer is the core, not an extra.

## Problem
(a) Corpus completeness unverified; (b) normalization accuracy unaudited;
(c) 44% of entries carry unmapped effect phrases, so verb-level statistics
and few-shot exemplars are unusable; (d) band provenance (sample sizes,
provisional status) is not carried in the data.

## Proposal
1. Coverage verification: count wiki-side content pages per source via the
   MediaWiki API (category/allpages totals), compare against fetched page
   sets; re-fetch any gap; record the reconciliation in the corpus manifest.
2. Accuracy audit: random sample of 20 normalized entries diffed against
   their source pages; orchestrator (human-level) review; findings recorded
   in this REQ and fixed if systematic.
3. Curated effect mapping table tools/corpus_verb_map.json (TRACKED):
   unique unmapped phrases classified as {verb:[...cvocab verbs]+params} |
   excluded | no_model(reason) | noise. LLM drafts the table OFFLINE;
   orchestrator reviews; the table is a static input — corpus_normalize.py
   applies it deterministically (pipeline stays stdlib + reproducible).
   The closed vocab is NEVER extended by this table.
4. Regenerate normalized corpora + content/corpus_stats.json; bands carry
   provenance fields (per-tier n, provisional flag); browser regenerated.
5. Design-gap report docs/llm_managed/genre_mechanics_gap.md: no_model
   phrases aggregated into candidate mechanics the genre has and we lack —
   input for user-gated vocab design events. Strictly advisory.

## Gates (when implemented)
- Coverage reconciliation shows fetched >= wiki-side content pages per
  source (or documents the accepted delta).
- corpus_test.py extended: table application, determinism, provenance
  fields; ci green.
- Unmapped share drops materially (target: <15% of entries with unmapped
  phrases; report the achieved figure honestly).

## Orchestrator audit findings (2026-07-21, 20-card sample, seed=271)
Numeric fields (damage/cadence/price) correct in all 20 cards. BB rarity
collapse (Epic->Rare, Godly/Legendary/Unique->Relic) correct as designed.
Four normalizer defects identified:
1. BH rarity map: 'Legendary' missing (nonexistent 'relic' key instead) ->
   66 BH items get rarity_norm=None. Fix: BH Legendary -> Relic.
2. Icon markup stripped WITH its meaning: [[File:Icon Mana.png|alt=Mana|..]]
   and {{Pic|Luck}} must be substituted by their alt/arg text, not deleted.
   Current output leaves dangling fragments ("Gain 1 .").
3. Trigger headers split from their clauses ("On hit:" / "Start of battle:"
   land as standalone unmapped phrases). Sentence splitting must keep a
   trigger header attached to its following clause.
4. Verb-mapping false positives: any damage mention maps to 'strike'
   (Citrine adjacency aura should be buff_adjacent; Cap of Resilience
   damage-reduction is not an attack; Spiked Shield reflect is not strike);
   target-direction confusion (Plate Armor "Adds 1 Slow to self" wrongly
   mapped slow_enemy). Mapping must be clause-scoped and target-aware.
Direction: fix the normalizer first, re-extract phrases, then classify the
residual list via the curated table; regen with band provenance.
