# REQ-0270 — Corpus browser: dev-only static HTML view of the normalized wiki corpus

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: spec written; user ratified in chat (2026-07-21 JST):
  static HTML browser under web/preview/corpus/. Draft skipped — no decision
  pending. User requirement: the view must be meaningful END TO END (corpus ->
  normalization quality -> derived bands -> live-content comparison), not a
  raw table dump.

## Origin
REQ-0268 landed fetch/normalize/stats; the only human surfaces are
data/corpus/report.md and content/corpus_stats.json. The user wants to eyeball
the 467 normalized entries and read a meaningful report (chat, 2026-07-21).

## Problem
Normalized-corpus quality (kind classification, rarity mapping, verb mapping,
unmapped/excluded buckets) is invisible without opening raw JSON. Both
normalizer debugging and balance reference need a browsable, connected view:
what we harvested, how well it normalized, what bands it produced, and where
OUR live content sits against those bands.

## Proposal
- tools/build_corpus_browser.py (stdlib only): reads
  data/corpus/normalized/*.json + content/corpus_stats.json +
  content/live/live_items.json (+ live/dungeon skills/enemies) and emits ONE
  self-contained web/preview/corpus/index.html (inline CSS/JS, no CDN,
  offline-capable).
- Page structure — four connected views telling one story:
  1. ENTRIES: searchable/sortable/filterable table (source, kind, name,
     rarity raw -> norm, damage, cadence, dps proxy, hp, price, verbs_mapped,
     unmapped, excluded) with row expansion showing effect_text and raw
     numbers.
  2. NORMALIZATION QUALITY: per-source mapped/unmapped/excluded counts, kind
     and rarity-mapping breakdowns, top unmapped phrases — the "can we trust
     the corpus" panel.
  3. CURVES & BANDS: rarity distribution, per-rarity dps-proxy spread,
     verb frequency, and the bands table (ratio_raw vs isotonic ratio vs
     warn_hi) with the derivation formula shown.
  4. LIVE COMPARISON: our live items/skills' dps proxy plotted against the
     corpus bands (same formula as tools/check_stat_bands.cjs — parity
     asserted by test), flagging over-band entries. This is the panel that
     makes the whole pipeline actionable.
- Output is dev-only and UNTRACKED: add web/preview/corpus/ to .gitignore.
  Corpus content is CC-BY-SA third-party reference data (REQ-0268 posture:
  internal tooling, never shipped). Attribution footer per source (license +
  URL) in the page.
- Regeneration: one command; prints the output path.

## Posture notes
- No server code touched; the page rides the existing dev static docroot
  (web/). No CDN, no network at view time.
- Nothing tracked contains corpus text: generator + tests + fixtures only.
- dps-proxy formula must match check_stat_bands.cjs exactly (single source of
  meaning across the pipeline); a test pins parity on hand-computed values.

## Gates (when implemented)
- tools/tests/corpus_browser_test.py (stdlib python3, ci-wired next to the
  REQ-0268 steps): builds from committed fixtures; asserts expected rows and
  values present, dps parity with check_stat_bands fixtures, deterministic
  output (two runs byte-identical).
- Real run on server data produces the page; quick CI green.
