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
