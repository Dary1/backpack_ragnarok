> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0062 — Themed BP Packs (Workshop pack catalog)

- **Status**: USER-RULED acquisition model (2026-07-06) — implementation QUEUED.
  Extends REQ-0042's single Common gacha into a **player-chosen catalog of themed
  packs**; each content REQ declares its own pack assignment (仕分け) and this REQ
  owns the aggregate catalog.

## User spec
「開けるBPパックを選べば良くて、これらが欲しい人はBPパックそのものを選べば良い。
出現するBPパックの仕分けもそれぞれのREQに追加しておいてください。シナジーがある
ものを入れてあげるのが良い」

## Design

### Pack anatomy (content-defined, `content/live/live_packs.json`)
```jsonc
{ "id":"clockwork",
  "price":{ "tm":"weathervane", "qty":15 },          // [TUNABLE]
  "guaranteed_bp":{
     "shape":{ "cells":[3,4] },                       // size band (random-walk mint)
     "unit":{ "dirs":[1,2], "types":{ "delay":3, "divider":3, "junction":2 } } },
  "bonus":[ { "pool":"po", "table":{ "spark_candle":5, "ember_fuse":3 } } ], // 0..2 slots
  "i18n":{...} }
```
- Guaranteed slot mints a BP (REQ-0042 random-walk machinery, claim-style two-phase
  finalize unchanged); bonus slots may add POs / SI lenses / TMs — the "synergy
  bundle" the user ordered: a pack should teach its own combo by construction.
- **Transparent odds**: the pack's Dex card (REQ-0052) lists every table with
  weights — no opaque loot boxes, ever (friends-scale honesty; also future-proof
  hygiene).
- All rolls server-seeded; per-pack sub-streams (house RNG discipline).

### v1 catalog (rows owned by their REQs; this list aggregates)
| pack | contents (synergy bundle) | source REQ |
|---|---|---|
| common | existing gacha: standard unit, 4–6 cells (unchanged, default) | REQ-0042 |
| clockwork | wave-1 logic units + chain-friendly shapes + spark PO bonus | REQ-0061 |
| ember | multi-dir standard units + spark/payload PO bonuses (circuit starter) | REQ-0048 |
| prism | lens SI bonus + amplifier/splitter/condenser units | REQ-0054 / 0061 w2 |
| martyr | tanky shapes + death-will PO + testament lens bonus | REQ-0056 |
Pack lineup growth = a content-batch decision (S0 brief names the pack row), not a
code change.

### Economy discipline
- Prices premium over Common [TUNABLE ×1.5–3 in Weathervane]; every pack is a sink —
  S4-E1 monitors the faucet/sink invariant (economy.md).
- POs/SIs remain dungeon-droppable on their own tables; **unit TYPES are
  pack-only** (BPs only enter the world via packs/starter grant, so this is the
  natural consequence, not an artificial exclusive).
- [ORCH default, vetoable]: no time-limited packs, no rotation — the catalog only
  grows. Rotation is appointment pressure (retention ruling).

## Test plan
- server: pack claim two-phase per pack, odds-table schema validation (S2 extends),
  price debit atomicity, files+pg parity.
- client: E2E open each catalog pack, result modal renders bundle (BP 図解 +
  bonuses), Dex pack cards with odds.
- S4: E2-class per-pack BP audit (shape/type distributions match declared tables).


---

## Implementation log (2026-07-14)

Built on top of REQ-0170's already-generalized pack machinery (packs are DATA in
`content/live/live_packs.json`; `resolvePack`/`rollPackBp` already used per-pack RNG
sub-streams `gacha/<pack>/{shape,unit}`). This REQ adds the **bonus-slot** layer, the
**transparent-odds** surfaces, and the **player-facing pack catalog** UI.

### What was built
- **Pack anatomy — bonus slots.** `gacha_pack/1` entries gain an optional
  `bonus: [{ pool:'po'|'si'|'tm', table:[{ id, weight, qty? }] }]` (0..2 slots). Each
  slot draws ONE weighted entry from its own table via a dedicated per-slot RNG
  sub-stream `gacha/<pack>/bonus/<i>` (house RNG discipline — labelled, independent,
  reproducible from the stored master seed). `server/services/gacha.cjs`
  `rollPackBonuses()` mints a uid + a read-only def echo per bonus and attaches
  `bonuses[]` to the roll result + pending doc.
- **Two-phase claim UNCHANGED.** The guaranteed BP's uid + the balance-delta remain the
  sole finalize gate (`finalizeGachaForCanvas`); bonuses ride the same client-authored
  save (consistent with the existing trust model — the BP's own shape/unit are already
  client-honoured). The Workshop client first-fit-places each bonus (`firstFitPlace`
  for po/si, `firstFitOrMergeTM` for tm) alongside the BP before the auto-save.
- **Transparent odds.** Bonus tables are (1) content-validated —
  `check_units.cjs` now loads PO/SI/TM id sets and `validatePackEntry(pack, unitIds,
  contentIds)` rejects any table row that names content with no live def; (2) served on
  the pack's Dex card — new `GET /api/dex/card/pack/:id` returns cost/cells/pool/bonus
  with weights; (3) rendered in the Workshop odds view (weight -> % per slot).
- **Workshop UI.** Pack selector (`workshop-pack-select`, choose which pack to open),
  per-pack price/pool/odds, bonus-odds panel, and a bonus bundle in the result modal.
  Full `i18n.ja` for every new string (barrel parity gate passes).

### v1 catalog — shipped vs gated
| pack | status | contents (real live ids) | notes |
|---|---|---|---|
| common | shipped (unchanged default) | 12 Common units, 6-8 cells, no bonus | REQ-0042/0170, untouched |
| clockwork | **shipped** | watcher/squire/thief, 4-5 cells; +PO bonus {flame_tablet, oil_flask} | chain-friendly tight shapes + spark PO |
| ember | **shipped** | angel/priest/princess/littleprincess (multi-dir queens), 6-8 cells; +PO {flame_tablet, blade, oil_flask} +SI lens {acc_whet, acc_frost} | circuit-starter synergy |
| prism | **gated (omitted)** | lens SI + amplifier/splitter/condenser units (REQ-0054/0061 w2) | source content NOT on master — no lens-typed SI, no logic units. Omitted from the live catalog; re-add when REQ-0054/0061-w2 content lands. |
| martyr | **gated (omitted)** | tanky shapes + death-will PO + testament lens (REQ-0056) | source content NOT on master. Omitted; re-add when REQ-0056 content lands. |

Gated rows are OMITTED from `live_packs.json` entirely (not shipped disabled) so the
content gate's "every table references a real live id" invariant holds with zero
placeholder ids. clockwork/ember are composed only from ids that exist on master today
(units: watcher/squire/thief/angel/priest/princess/littleprincess; POs: flame_tablet/
oil_flask/blade; SIs: acc_whet/acc_frost).

### [ORCH default, vetoable] decisions recorded
1. **Bonus table shape = array-of-rows `[{id,weight,qty?}]`** (not the REQ sketch's
   `{id:weight}` object map), to match the existing `pickWeighted` pool convention.
2. **Bonus qty**: po/si always draw 1 instance (qty must be 1/absent); only tm rows may
   carry qty>1 (a currency stack). Keeps client delivery a single first-fit per bonus.
3. **Themed catalog = clockwork + ember only** (plus unchanged common); prism/martyr
   gated for missing source content (recorded above). clockwork/ember unit/PO/SI
   picks are a thematic mapping onto REAL live ids (the spec's named source ids do not
   exist on master).
4. **Prices [TUNABLE]**: clockwork 15, ember 18 LRDST (premium over Common's 10, within
   the spec's x1.5-3 band). Every pack remains a pure sink.
5. **Finalize gate unchanged** (BP uid + balance-delta); bonuses are part of the
   atomically-saved bundle, not independently server-verified — matches REQ-0042's
   existing client-authored-placement trust model at friends-scale.
6. **web/app build artifacts reverted** on the feature branch (source-only commit); the
   deploy pipeline rebuilds them — avoids 3k-line generated-bundle diffs conflicting
   with the day's HOT integration.
7. **No time-limited packs / no rotation** (carried from the spec's own ruling — the
   catalog only grows).

### Files touched
- `content/live/live_packs.json` (catalog: common unchanged + clockwork + ember)
- `shared/content_validate.cjs` (`validatePackEntry` bonus-slot + id validation)
- `tools/check_units.cjs` (load PO/SI/TM id sets; pass to validator; print bonus count)
- `server/services/gacha.cjs` (`rollPackBonuses`; attach `bonuses` to `rollPackBp`)
- `server/schedule.cjs` (re-export `rollPackBonuses`)
- `server/routes/dex.cjs` (pack Dex card kind — transparent odds)
- `shared/dto.ts` (`ApiPackEntry.bonus`)
- `client/src/api/workshop.ts` (`ApiRolledBonus`, `bonuses` on `ApiRolledBp`)
- `client/src/schedule/WorkshopPage.tsx` (pack selector, bonus odds, result bundle, bonus placement)
- `client/src/i18n/workshop.ts` (en+ja keys)
- `client/src/styles/workshop.css` (layout)
- `server/tests/api/harness.cjs` (+`test_themed` fixture pack), `server/tests/api/workshop.cjs` (themed-pack test)
- `client/e2e/workshop.spec.ts` (clockwork open-end-to-end + odds render)

### Gate results
- Content gate `node tools/check_units.cjs`: ALL GREEN (packs: 3 / pool rows: 19 / bonus slots: 3 / failures: 0).
- Server api tests (mint/claim/odds): files backend 176 passed / 0 failed; pg backend 176 passed / 0 failed (files+pg parity). Includes the REQ-0062 themed-pack test (bonus sub-streams, seed-reproducibility, pack Dex card odds, BP-uid+balance finalize).
- Client typecheck + build: GREEN.
- `flock /tmp/backpack_ci.lock bash tools/ci.sh`: **CI GREEN** (CI_DONE_RC=0). Every gate green: sim/engine/typecheck/vocab/content gates, files+pg api tests, client build, admin e2e harnesses (4+1+21 passed), default e2e suite.
- e2e (default suite, ALL-GREEN policy): **165 passed / 0 failed (3.0m)** -- includes `workshop.spec.ts:913` "REQ-0062: themed BP pack (clockwork) -- open end-to-end" (choose clockwork -> pay -> claim -> guaranteed BP [4-5 cells] + bonus PO land in inventory; balance 999->984; odds view renders the bonus table).

### Test-harness note
`tools/e2e_fleet.cjs` seeds each isolated e2e worker's content by copying LIVE-repo `content/live` then overlaying specific worktree files not yet on master (REQ-0051 precedent). Added `live_packs.json` to that overlay so the parallel e2e backend serves this branch's clockwork/ember catalog.

### Commit hashes (branch `req-0062-themed-bp-packs`, base master `0b56a03`)
- Feature commit (all source + tests + e2e_fleet overlay): `5d36c5d1d7651ba821fd9b8f28759aa40202fb22`
- Doc/close commit (append this log + git mv todo -> built): recorded in `git log` on the branch (this commit).

NOT merged to master, NOT deployed — a separate integration owner handles that.

---

## Integration-owner merge + deploy (2026-07-14)

- **Merged into master --no-ff:** merge commit `ddf6d30` (on top of the REQ-0060 merge
  `984f191`). Auto-merged with no manual conflicts -- the only shared file with REQ-0060,
  `server/services/gacha.cjs`, merged cleanly (this REQ's `rollPackBonuses` + `rollPackBp`
  bonus wiring + module.exports live alongside REQ-0060's gacha-finalize born-stamp).
- No migration in this REQ (no DB collision to resolve).
- **Full release gate** `flock /tmp/backpack_ci.lock bash tools/release.sh`: **CI GREEN.**
  content gate (check_units, bonus-id validation) green; api 176/0 (files+pg); admin e2e
  4+1+21; pre-deploy full e2e **165/0** incl. `workshop.spec.ts:913` "REQ-0062: themed BP
  pack (clockwork) -- open end-to-end". dist rebuilt + committed `6ae7051`.
- **Deployed:** restarted backpack-api + backpack-web (systemctl --user) -- both active;
  HTTP 200 on 8801 /app/ and 8802 /api/health.
- **Post-deploy full e2e** (sanctioned wrapper, live): first pass 162/3 under heavy concurrent
  box load (13.1m, ~4x slow). `workshop.spec.ts:913` PASSED (test 165, 4.4s), as did all
  workshop/gacha specs. The 3 reds -- reference-model.spec.ts:166 & :239, schedule.spec.ts:1429
  -- are drag/replay timing flakes UNRELATED to REQ-0062 and passed pre-deploy. Targeted serial
  rerun on a quiet box: **3 passed (42.7s)** -> confirmed flakes. Effective post-deploy result:
  **165/165 GREEN** incl. workshop.spec.ts:913.
- **e2e_fleet.cjs overlay note:** the `live_packs.json` overlay entry (added on-branch for the
  isolated parallel-worker backend) is harmless now that live_packs.json is on master; left in
  place (no functional effect post-merge).
- **Final master hash:** `6ae7051`.

built -> done: this file moves docs/REQ/built/ -> docs/REQ/done/ in the immediately following commit.
