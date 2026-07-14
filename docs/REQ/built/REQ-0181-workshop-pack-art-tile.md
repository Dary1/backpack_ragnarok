# REQ-0181 - Workshop pack-select art tile + drop bonus-odds panel

**Status:** built (see Gate results)
**Reserved:** 2026-07-15
**Slug:** workshop-pack-art-tile
**Requested by:** user, 2026-07-15 (chat, two-part instruction on the Workshop
`#/workshop` screen).

## Goal

Two targeted client-only tweaks to the Workshop route (`client/src/schedule/WorkshopPage.tsx`):

1. **Drop the Bonus Odds panel and the rule bullets above it.** The odds panel
   ("Odds" cells/HP table) stays; the three rule bullets (`ruleCommon` /
   `ruleUnit` / `ruleTwoPhase`) and the whole transparent bonus-odds sub-panel
   (`bonusHeading` + the per-slot weight tables) are removed, along with the two
   rune dividers that bracketed them. The bonus MECHANIC (server roll, the
   result-modal bonus bundle) is UNCHANGED -- only the pre-roll odds DISPLAY of
   the bonus table is removed.

2. **Turn each "Choose a Pack" option into a 368x368 art tile.** The pack option
   button (`.workshop-pack-option`) becomes a fixed 368x368 tile whose
   background is the pack's assigned art. The inner text (name / cost / synergy
   chip) gets an outline so it stays legible over ANY background art.

## Decisions (user, 2026-07-15 chat, via clarifying questions)

- **Art source seam.** The button reads its art URL from the served, registry-
  first `gameData.ART_URLS[packId]` map (the same `/api/art/<name>.png` seam the
  item/unit icons use). The actual delivery of a pack's art -- a `custom`-kind
  artwork linked to the `gacha_pack` def via `artwork_ref` -- is **REQ-0179's**
  responsibility ("assume it comes in from there", user). This REQ only makes the
  client CONSUME `ART_URLS[packId]`: absent -> no background (graceful, exactly
  like unit-icon fallback), present -> the tile shows it.
  NOTE (follow-up, not this REQ): the server `computeArtUrls()` in
  `server/lib/content.cjs` today keys only items/sis/tms; for a pack art URL to
  actually reach `ART_URLS`, a pack id must be included in that map. That server
  wiring belongs to REQ-0179 / a serving follow-up, per the user's scoping.

- **Tile size.** 368x368 on the BUTTON is confirmed (REQ-0175 ruled the GENERATED
  art 768x768; a 768 asset is displayed `cover` inside the 368 tile). A broader UI
  rework is deferred to a separate session (user).

## Scope

### A. `client/src/schedule/WorkshopPage.tsx`
- Remove the JSX from the `<div className="rune-divider">{ ᛞ }</div>` through the
  end of the bonus conditional block (rune dividers + `workshop-rules` bullets +
  bonus `workshop-odds-head` + `bonusRows` none/slots), leaving the `Odds`
  head + `workshop-odds-rows` intact.
- Remove the now-unused module helper `bonusOdds()` and the now-unused component
  locals `bonusRows`, `bonusPoolLabel`, `bonusItemName`, `itemDefs`, `siDefsMap`
  (each was referenced ONLY by the removed bonus JSX; `connShapes`/`cost`/`odds`
  are kept).
- Pack option button: read `const artUrl = snapshot.gameData?.ART_URLS?.[pid]`,
  add `has-art` to the className when present, and set an inline
  `style={{ backgroundImage: url(artUrl) }}` when present.

### B. `client/src/styles/workshop.css`
- `.workshop-pack-option`: fixed 368x368, `box-sizing: border-box`, `overflow:
  hidden`, `background-size: cover / center / no-repeat`, content pushed to the
  bottom. Scoped `.workshop-pack-options .workshop-pack-option` so the tile geometry
  outranks the shared `.btn` background shorthand.
- Text outline on `.workshop-pack-option-name/-cost/-syn` via a 4-way `text-shadow`
  (+ a light `-webkit-text-stroke` / `paint-order` on the name).

### C. `client/e2e/workshop.spec.ts`
- The REQ-0062 clockwork test asserted the bonus-odds VIEW renders
  (`workshop-bonus-odds` / `workshop-bonus-row`). Those two assertions (and the
  matching clause in the test title) are removed; the roll + result-modal bonus
  assertions stay (mechanic unchanged).

## Non-goals
- No server / content / schema change (pack art delivery = REQ-0179).
- No change to the roll flow, the result modal, or the bonus mechanic.
- The unused i18n keys (`ruleCommon`, bonus*) and now-dead `.workshop-rules` /
  `.workshop-bonus-*` CSS are left in place (harmless data; a later cleanup or the
  deferred UI rework can prune them).

## Gate results

Branch `req-0181-workshop-pack-art-tile` off master @16747d1. Client-only change
(TSX/CSS + an e2e assertion trim); no server / sim / content code touched.

GREEN (run on the box, this branch):
- `tools/ci.sh` with SKIP_PG=1 SKIP_E2E=1 -> **CI GREEN**: sim (114/0 + goldens /
  S4 / forecast-parity), mock-src engine, server+shared `tsc`, engine-type +
  vocab + unit/gacha-pack content gates, files-backend api tests, backfill /
  registry-parity / moderation DB-free suites, and every client check script
  (unit-icon, link-trace, chime, auth, bpskin x2, overlay-a11y -- ALL GREEN),
  plus the client `tsc -b && vite build` step.
- client `tsc -b` typecheck: exit 0 (confirms the removed helpers -- bonusOdds,
  bonusRows, bonusPoolLabel, bonusItemName, itemDefs, siDefsMap -- left no
  dangling references).
- client `oxlint`: 0 errors (40 pre-existing warnings, all in unrelated e2e
  helpers, none in the touched files).

NOT run this session -- deferred to a coordinated box run before deploy:
- pg-backend api/artwork/content tests (SKIP_PG: no DATABASE_URL in this shell).
- Playwright e2e (SKIP_E2E). Reason: global-setup clears + restores the LIVE dev
  profile / content / dev-DB rows and holds the whole-box lock -- HANDS-OFF
  policy, so it is run only with explicit user coordination. The single e2e
  touched, `client/e2e/workshop.spec.ts` (REQ-0062 clockwork test), only had its
  two bonus-odds-VIEW assertions removed; the roll + result-modal-bonus steps
  are unchanged, so the flow is intact.

Dist / deploy: `web/app/` is NOT rebuilt in the implementation commit -- per repo
convention the client dist is rebuilt via `tools/release.sh` in a separate
"deploy: rebuild client dist" commit at deploy time.

Commits:
- impl: drop the bonus-odds panel + the rule bullets above it; make each
  "Choose a Pack" option a 368x368 art tile (background from
  `gameData.ART_URLS[packId]`, fed by REQ-0179's custom-kind artwork via
  `artwork_ref`) with an outlined label; trim the now-invalid e2e assertions.
- move: `reserved -> built` (separate commit; the move is the status update).
