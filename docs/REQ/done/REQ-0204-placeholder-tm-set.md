# REQ-0204 — Placeholder TM set (4 new currencies WITH artwork)

## State log
- 2026-07-16 reserved (stub).
- 2026-07-17 spec written; reserved -> todo (user-directed content addition,
  cleared to implement immediately alongside REQ-0205 on this one branch — the
  REQ-0195/0196 shared-branch precedent).

## Problem / directive
User directive (2026-07-16, verbatim intent): add 4 more TM (Transmutator)
currency kinds. Placeholder quality is explicitly fine ("本当に適当でOK") — no
use-effects, and the names/images are throwaways that will be replaced later.

Purpose: the market's multi-TM machinery (REQ-0195a's price-TM selector,
PriceTag short labels, REQ-0195b's tm-for-tm listings) only ever lit up in the
DEGENERATE single-live-TM state, because content/live/live_tms.json ships
exactly one entry (`lrdst`). Adding real content exercises those code paths with
a genuine >1-TM registry — the selector gains options, PriceTag stops being a
lone unlabeled rune, and a currency-for-currency listing becomes possible.

## Change (content + artwork only; no server/client code paths change)
- content/live/live_tms.json: 4 new entries, APPENDED after `lrdst` (lrdst stays
  index 0 so `tms[0]` — the market's default price TM — is unchanged, and the
  live-registry ORDER the client renders in stays lrdst-first). Each follows the
  existing lrdst entry's shape EXACTLY:
  `{id, name, short, rarity:'Common', icon:'icon-<id>', stackable:true, flavor,
   i18n:{ja:{name,flavor}}}`. Ids/names are simple thematic placeholders (an
  ember coin, a frost shard, a verdant droplet, a void star). The id `gilt` is
  DELIBERATELY avoided — the server api_test harness (server/tests/api/harness.cjs)
  mints its own `gilt` fixture, and a live `gilt` would collide with that test's
  intent.
- content/sprite_all_v12.svg: 4 new `<symbol id="icon-<id>" viewBox="0 0 64 64">`
  entries appended right after `icon-lrdst`, hand-authored in the same 64x64 idiom
  (dark #2b2016 outline, stroke-width 3, round joins, one or two highlight dabs)
  but with VISUALLY DISTINCT silhouettes + palettes: coin (ember/brass), shard
  (frost/cyan), droplet (verdant/green), star (void/purple). Placeholder art, per
  the directive. Only v12 is touched (client bundles v12 via
  client/src/dex/dexIcons.ts's `?raw` import; the board pipeline parses the same
  sheet). v10/v11 and the raster/artwork-registry pipeline are NOT touched.
- tools/e2e_fleet.cjs: overlay THIS worktree's live_tms.json onto each isolated
  e2e worker's content/live (the fleet copies the REPO/master content/live, which
  still has lrdst-only, then overlays not-yet-on-master worktree files). Mirrors
  the REQ-0062 live_packs.json / REQ-0051 starter-content overlays exactly, so the
  isolated e2e backend serves the new TMs and the market regression exercises the
  real 5-TM reality.
- client/e2e/market.spec.ts: two tests that asserted the single-live-TM reality
  are updated to the 5-TM reality HONESTLY (the WIRE envelope `tms[]` assertion,
  and the currency-sell tab test that used to expect the dormant
  'no other currency to price in' state — with other live TMs, that tab now offers
  a real price-TM selector). Test INTENT is unchanged; only the content premise moved.

## Non-goals
- No TM use-effect (there is no tm-effect AST — REQ-0042). No registry adoption /
  raster generation for the placeholders (they resolve via the SVG sprite tier).
- The server api tests use their own synthetic content fixture (harness.cjs writes
  lrdst+gilt into a temp content dir), so they are UNAFFECTED by the live content
  change — expected no server-test edits.

## Gates
- `SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh` — content/registry/sprite gates + server
  files-backend api tests green.
- `cd server && node tests/api_test.cjs` green.
- `pnpm -C client run build` green (bundles the new sprite symbols).
- api-boot verification: GET /api/content serves tms with 5 entries.
- market e2e regression (17 -> updated) green under the fleet's 5-TM content.

## Chosen ids/names (placeholder, per directive)
| id | EN name | short | icon | ja name | silhouette/palette |
|----|---------|-------|------|---------|--------------------|
| ember_coin | emberdisc | EMBR | icon-ember_coin | 残り火のディスク | coin, ember/brass |
| frost_shard | rimeshard | FRST | icon-frost_shard | 霜のかけら | crystal shard, frost/cyan |
| verdant_drop | dewbead | VRDT | icon-verdant_drop | 露の雫 | droplet, verdant/green |
| void_star | voidmote | VOID | icon-void_star | 虚空の星屑 | 5-point star, void/purple |

## Gate results (2026-07-17)
- Implementation commit: 8cdf553 (content/live/live_tms.json, content/sprite_all_v12.svg,
  tools/e2e_fleet.cjs, client/e2e/market.spec.ts).
- served payload: buildContentPayload() (CONTENT_ROOT=worktree) serves tms=5 in
  registry order [lrdst, ember_coin, frost_shard, verdant_drop, void_star]; every
  entry carries name/short/icon/rarity/stackable + name_ja/flavor_ja (i18n.ja).
- sprite: client parseSymbols() (real @xmldom path) resolves 26 symbols incl. the
  4 new icon-<id>; each new symbol is individually well-formed XML.
- content gates GREEN: check_units (ALL GREEN), verify_content_registry_parity
  (DB-free, 3/0), content_checks_dialect (34/0).
- server api_test (files backend): 185 passed, 0 failed (harness uses its own
  lrdst+gilt content fixture -> unaffected by the live content change, as predicted).
- client build (tsc -b + vite): GREEN -- bundles the new sprite symbols.
- market e2e regression + its 5-TM test updates: run at the combined final gate
  (see REQ-0205 doc / final gate log) under the fleet's overlaid 5-TM content.
- PRE-EXISTING (not this REQ): `SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh` stops at
  step [1] sim tests -- 113 passed, 4 failed, ALL about the enemies.json roster
  (REQ-0122 enemies.json sha256 vs registry provenance; dungen references to
  enemy ids zombie/ghost missing from the batch-002 roster). Reproduced UNCHANGED
  on pristine branch HEAD with this REQ's working-tree changes stashed -> inherited
  from the branch base, orthogonal to TMs/sprites. Left untouched (out of scope;
  same "reproduced on pristine base = pre-existing" disposition as REQ-0194).
