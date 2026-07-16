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
