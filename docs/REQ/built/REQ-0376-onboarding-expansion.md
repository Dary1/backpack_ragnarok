# REQ-0376 — Onboarding beyond the canvas: hall cards + in-game glossary + dry rules

## Status
built — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.
Built by Cowork session 2026-08-11 on branch `req-0376-onboarding-expansion`
off master @ `c51d3b4b`; merged and deployed 2026-08-12. User acceptance pending.

## Origin
UI gap analysis 2026-08-10 (Cowork). Finding P1-7, absorbing the report's
clarity notes 1 (sortie/schedule roles), 2 (rules buried in flavor copy) and
4 (ᚠ literacy).

## Problem (gamer-facing)
First-run guidance exists ONLY on the canvas: the 5-step tour + 3 contextual
hints (`client/src/guide/guideModel.ts`), and the Settings replay re-runs just
that. Every concept a new player actually gets wrong lives elsewhere and is
explained nowhere: expeditions auto-repeat in real time; the destination is
drawn at random from the attack level; warehouse spoils rot in 7 days; every
trade burns 8%; a claimed/placed item is final; ᚠ is the currency. Those
rules exist only inside flavor prose ("ash has no owner", "the stone shelf
will not wait") — atmospheric, but there is no dry statement of law anywhere,
and no glossary despite the proper-noun load (Canvas/BP/PO/SI/Unit/Squad/
Troop/TM/LRDST). The schedule page also never says "this is the watching
hall; departures happen in Sortie" — the CTA exists
(`SchedulePage.tsx:262/288`) but the role split is unstated.

## Spec
1. Hall cards: on FIRST visit to schedule / sortie / warehouse / market /
   workshop, one dismissible card (non-modal, the ContextualHint visual
   family) stating that hall's 3-4 laws in plain language, both locales.
   Persistence: extend `GuidePersisted` with per-hall seen flags — the same
   client-only `state.guide` field riding the auto-save PUT (REQ-0141
   precedent), preserving its guarantee: a returning profile's saved canvas
   is never rewritten just by shipping this (flags write on first dismiss).
2. Glossary: a "Terms" tab in the Dex (the reference surface; coexists with
   the draft REQ-0227/0228 dex plans) — a static chrome-i18n'd list: each
   closed-vocabulary noun in one sentence, plus the dry rules block
   (auto-repeat, random draw, 7-day decay, 8% burn, receipt finality, ᚠ).
   Content i18n NOT involved — this is chrome text at the barrel.
3. Settings "Replay the guide" becomes "Replay all guidance": clears the tour
   AND the hall-card flags.
4. Schedule empty/awaiting states gain the one role-clarifying line
   ("Expeditions are watched here — departures are ordered in Sortie.").

## Gates
- Fresh-profile e2e: first schedule visit shows the card; dismiss; reload —
  never again. Each hall independently.
- Returning-profile guarantee: a profile without `state.guide` gains no field
  until a card is dismissed (byte-unchanged save otherwise) — the REQ-0141
  gate re-asserted.
- Glossary tab renders complete in en and ja; dex existing tabs/selectors
  unchanged.
- CI green.

## Out of scope
Interactive per-hall tutorials, video, reworking the canvas tour, content-
pipeline i18n.

## Build log (2026-08-11)

### Decisions taken while building (none contradict the spec; all recorded)

1. **The hall card is IN-FLOW, not a floating toast.** The spec asks for the
   ContextualHint *visual family*, which it wears (panel ground, gold rule, ×
   dismiss) — but it renders inside the page directly under each pagehead
   divider instead of `position:fixed` over it. Two reasons. Design: a hall's
   laws are read once, deliberately, on arrival — not glanced at mid-gesture
   like a hint, which is what the fixed placement is for. Mechanical: a fixed
   overlay on five whole pages would sit on top of live controls (the sortie
   launch bar, the market tab row, the warehouse toolbar), hiding them from the
   player *and* intercepting the e2e suite's clicks, since Playwright's
   actionability check hit-tests an element's centre point. In-flow, the card
   can cover nothing. Cost: five one-line mounts instead of one App.tsx mount.

2. **Veterans see the cards; the guarantee is kept by not writing, not by
   hiding.** The spec's own gate ("gains no field *until a card is dismissed*")
   only makes sense if a guide-less profile can see and dismiss one, so the card
   is NOT gated on `guide.seen` the way contextual hints are. What preserves
   REQ-0141 is that `markHallSeen()` is the sole writer: boot, navigation and
   render write nothing. The record a veteran gains is `defaultGuide('done')` —
   status `done` so the canvas tour does not retroactively start on them, and
   `seen:false` so `noteHint()`'s cohort gate stays shut exactly as before.

3. **`halls` is OPTIONAL on `GuidePersisted`.** Every guide record persisted
   before this REQ lacks the key and must round-trip through the auto-save PUT
   untouched; absent === nothing dismissed yet, which is the right reading.

4. **`HALL_LAW_COUNT` is a table, not a runtime key count.** It keeps
   `TranslationKey` a compile-time union — every `guide.hall.<id>.law<n>` key
   the table implies exists literally in `src/i18n/guide.ts`, so the barrel's
   en/ja parity gate covers the new copy like any other chrome string.

5. **The Terms tab is LAST in the dex tab row** and reads no payload, so the
   four existing tabs keep their positions, Items stays the default, and the
   glossary renders complete even if `/api/content` is unavailable. It coexists
   with the draft REQ-0227/0228 dex plans: it adds a tab and touches none.

6. **Glossary copy is transcribed, not paraphrased** (PROJECT.md: cite engine
   code for any convention; a guessed brief caused REQ-0029). Sources, all
   re-read for this build: `MARKET_BURN_RATE = 0.08` and `burnOf()`'s
   `max(1, ceil(qty*rate))` floor plus `sellerReceives = qty - burn`
   (`server/services/market/lib.cjs`, `market/trade.cjs`); `WAREHOUSE_TTL_MS =
   7 days` (`server/services/core.cjs`) with expiry auto-dismantling rather than
   vanishing (`server/services/warehouse.cjs`, REQ-0063 §4); `WAREHOUSE_CAP =
   200` (`shared/constants.json`); the uniform draw over
   `{d : d.levelMin <= attackLv}` (`server/services/rooms.cjs` `drawDungeonId`,
   REQ-0304); auto-repeat after cooldown unless canceled
   (`server/services/runs.cjs` `maybeAutoStartNextRun`); deployed items refused
   by the market with `reason:'deployed'`, the Law of Possession
   (`server/services/market/listings.cjs`); the placement vocabulary from
   `docs/user_managed/canvas_spec.md`; Squad/Troop/Unit from
   `terminology_unit_squad.md`; TM dual-use and "no abstract coin" from
   `economy.md`; LRDST's expansion from REQ-0042.

### Gate results — all green

| Gate (from the spec above) | Result |
|---|---|
| Fresh-profile e2e: first visit shows the card; dismiss; reload; never again — each hall independently | PASS — `hall-guidance.spec.ts` tests 1-3 |
| Returning-profile guarantee: a profile without `state.guide` gains no field until a card is dismissed (byte-unchanged save otherwise) | PASS — test 4 asserts `JSON.stringify(after) === JSON.stringify(before)` after walking all five halls, then that the first dismiss writes exactly `{market:true}` with `status:'done'`, `seen:false` |
| Glossary tab renders complete in en and ja; dex existing tabs/selectors unchanged | PASS — test 7 (11 terms + 6 rules in both locales, no raw `guide.glossary.` key leaks, Items still default, `.dex-md` intact after leaving Terms) |
| Schedule role line (spec item 4) | PASS — test 6 |
| Settings "Replay all guidance" clears the hall flags too (spec item 3) | PASS — test 5 |
| CI green | **CI GREEN** — full `tools/ci.sh`, 425s, scope=public, 243 e2e passed / 0 failed (was 236 at REQ-0371; +7 = this REQ's new spec). Receipt tree `dca17a87075ea4af3a8bffec3fa22d20b35f5fbc`. |

### Commits

- `811abc85` — the whole change (client src + `client/e2e/hall-guidance.spec.ts`
  + rebuilt `web/app` dist). Its tree IS the receipted tree above.

### Not done here (deliberate, matches Out of scope)

Interactive per-hall tutorials, video, any rework of the canvas tour, and
content-pipeline i18n. The Ragnarok and Friends routes get no card: the former's
laws are the draft REQ-0068 season design and the latter is still a
PlaceholderPage, so there is nothing settled to state.

## Amendment (2026-08-12) — the new spec file tripped two latent order-dependences

The worktree gate was green on the SCOPED hermetic path. The first full
`tools/release.sh` run — the LEGACY shared-fleet path, where Playwright's four
workers are reused across spec files — was not, twice, and neither failure was
in this REQ's code:

1. `sortie-prefill.spec.ts` (REQ-0371) failed with 400 `squadIndex out of range
   for this player`. Cause: `client/e2e/fixtures/baseline-smoke-fixture.json`
   has NO `presets` key. A spec that PUTs it and then MUTATES leaves a repaired
   profile behind (the auto-save PUT writes the client's state, and
   migrateStateV2 synthesises presets on load); this REQ's tests 4 and 6 PUT it
   and only READ, so they left `default` presets-less — a shape no real profile
   is ever in. Any later spec on that worker that boots WITHOUT its own fixture
   inherits it, and `assertSeatAllowed`'s `!profileCanvas.presets` branch fires.
   Adding a spec file shifted the spec-file → worker sharding enough to put the
   two together. **Fixed on the side that creates the state** (`f2cafe12`): an
   `afterEach` in both describes PUTs the seeded `e2e_ci` canvas back.
   Reproduced deterministically before and after with
   `E2E_PARALLEL=1 pnpm exec playwright test hall-guidance.spec.ts sortie-prefill.spec.ts`
   (before: 7 passed / 1 failed; after: 8 passed).

2. `market.spec.ts` then failed on a worker-GLOBAL `toHaveCount(2)` of listing
   rows, finding 3 — `input-conventions.spec.ts` (REQ-0369) was seeding a
   listing and never withdrawing it. Not fixed here: REQ-0375 and REQ-0370
   merged to master mid-flight and had already fixed exactly this pair
   (`input-conventions` gained "leave the shared fleet worker's hearth as we
   found it"; `sortie-prefill` gained a recruiting-troop guard). The re-run over
   the merged tree is green.

**The standing lesson, for whoever adds the next spec file:** a spec that PUTs a
fixture onto `default` and does not mutate leaves that fixture behind for the
next spec on the same fleet worker, and adding ANY spec file re-shards the
suite, so a latent leak surfaces as an unrelated red. Restore what you borrow.

## Outcome (2026-08-12)

Merged to master (merge commit `fbb8609e`) and LIVE on the main checkout via
mtime hot-reload — no service restart needed (no server-code change; the
committed client dist `web/app` is the deploy unit).

- `tools/release.sh` on the merged tip: content-registry parity **STRICT OK**
  (MATCH=413, DRIFT=0, MISSING-IN-REGISTRY=0, UNADOPTED=0), **CI GREEN**
  (scope=both, 404s), `dist unchanged -- nothing to commit`, receipt tree
  `0229480b2111522dc97853a4f3ae70a619f274a1`.
- `predeploy_recalibrate_powerlevel.cjs --check`: **CLEAN** (zero writes, marker
  intact) — run per PROJECT.md's standing rule even though nothing here is
  level-affecting.
- Live-verified: `:8801/app` serves `assets/index-DBv_nZH-.js`, byte-identical
  to the committed `web/app`, carrying `hall-card`, `hall-card-dismiss`,
  `dex-glossary`, `dex.tabTerms`, the hall law strings and the Japanese copy;
  `:8802/api/content` 200; tunnel `https://backpack-dev.qtie.jp/app/` 200;
  `backpack-api` / `backpack-web` / `backpack-tunnel` all active.
- Master moved under this REQ mid-gate (REQ-0375 and REQ-0370 merged); both
  merges carry this REQ's commits as ancestors and the dist REQ-0370 rebuilt
  from merged source is the one now serving.
