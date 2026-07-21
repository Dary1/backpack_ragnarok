# REQ-0271 — Corpus verification + effect semantics: make the corpus trustworthy and meaningful

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user directive "proceed to completion" (chat, 2026-07-21
  JST) after auditing the corpus browser and finding effects 44% unmapped.

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
