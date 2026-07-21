# REQ-0270 — Corpus browser: dev-only static HTML view of the normalized wiki corpus

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: spec written; user ratified in chat (2026-07-21 JST):
  static HTML browser under web/preview/corpus/. Draft skipped — no decision
  pending. User requirement: the view must be meaningful END TO END (corpus ->
  normalization quality -> derived bands -> live-content comparison), not a
  raw table dump.

- 2026-07-21 implemented (branch req-0270-corpus-browser-preview):
  tools/build_corpus_browser.py (stdlib only) emits ONE self-contained
  web/preview/corpus/index.html (inline CSS+JS, dataset embedded as a JSON
  blob, zero external asset requests, works from file:// and the dev
  docroot). Four connected views: ENTRIES (467 rows; search + source/kind/
  rarity/has-unmapped/has-excluded filters; sortable cols name..dps-proxy..
  price; row expansion -> effect_text, raw numbers, verb/unmapped/excluded
  chips), NORMALIZATION QUALITY (per-source cards: pages, kinds, raw->norm
  rarity map, mapped/unmapped/excluded counts, verb-freq bars; pooled top-20
  unmapped phrases, each clickable -> filters ENTRIES), CURVES & BANDS
  (pooled rarity distribution bars; per-rarity dps-proxy box plots as
  hand-rolled inline SVG min/p25/median/p75/p95/max; verb-freq bars; bands
  table ratio_raw->ratio->warn_hi + basis + bands_formula), LIVE COMPARISON
  (each live item/skill dps-proxy vs its rarity's warn_hi band, white band
  marker, OVER highlighted, severe >=3x band, summary counts).
- 2026-07-21 decisions/notes:
  * dps-proxy for LIVE content is a faithful port of check_stat_bands.cjs
    (DAMAGE_VERBS strike/multi_strike/charge_strike, sum verb.n-mid /
    trigger.s-mid over every_secs damage effects; counted==0 skipped;
    rarityOf capitalization); corpus-side proxy = damage_mid / cadence_mid
    mirrors corpus_stats.py; box-plot percentiles reuse corpus_stats'
    linear-interpolation method so numbers match corpus_stats.json.
  * Added a 'severe' flag at dps > 3x warn_hi (the 'flag multiple x3'
    requirement) beyond the plain OVER/OK from check_stat_bands.
  * skill/1 defs carry no rarity -> no band -> advisory 'na' (parity with
    check_stat_bands rarityOf==null); shown greyed, dps still plotted.
  * Real run on full corpus: 467 entries (backpack-battles 165 +
    backpack-hero 302), 2 sources; index.html ~291 KB; grep http = only the
    2 CC-BY-SA attribution hrefs + source api endpoints in the data blob
    (no asset loads). LIVE finding: 39 damage defs evaluated (3 items + 36
    skills), 1 OVER band -- 'Longsword Blade' (Common) dps-proxy 15.0 >
    warn_hi 12.0 when assembled; matches check_stat_bands (advisory).
  * web/preview/corpus/ added to root .gitignore (git check-ignore verified);
    ci.sh step [3.97/7] runs tools/tests/corpus_browser_test.py (29 asserts,
    incl. dps parity 30/2.0=15 & 10/2.0=5, bands==corpus_stats.json, two
    builds byte-identical). Quick CI (SKIP_PG/CLIENT/E2E) GREEN.

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
