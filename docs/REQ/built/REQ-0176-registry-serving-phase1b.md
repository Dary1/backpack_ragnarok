# REQ-0176 — registry-serving-phase1b: getScheduleContent() becomes registry-first (REQ-0178 Phase-1b)

**Ratified:** 2026-07-15 (user, chat). The original spec was superseded before it was ever
implemented; the user ruled "Phase-1b として書き直す（番号温存）" + "仕様から実装まで完走".
Cleared to implement.
**Reserved:** 2026-07-14 (as `registry-adoption-writes-live`)
**Slug:** registry-serving-phase1b (was: registry-adoption-writes-live)
**Requested by:** user, 2026-07-14 (finding) / 2026-07-15 (rewrite ruling).

## 1. History — why this REQ was rewritten, not implemented

REQ-0176 was raised 2026-07-14 on a true finding: adoption reached nothing, and
`content/registry_exports/` had no reader. Its proposed remedy was **adoption WRITES
`content/live/*.json`**.

That remedy was overtaken THE SAME DAY. The user asked the follow-up question
「逆に、陳腐化されるべきが、content/live/*.jsonなのでしょうか?」 and ratified
**REQ-0178 (done, deployed 2026-07-14)**, which took the OPPOSITE direction: the registry
became the SERVING source and `content/live/*.json` became a fallback tier that 0178's own
Phase 3 retires.

Implementing 0176-as-written would therefore have built a merge engine for files already
scheduled for deletion, and restored a second writer to files the registry now overrides —
the exact DRIFT that REQ-0182 documents as actively harmful.

**Disposition of the original 0176 rulings** (taken 2026-07-15, then withdrawn once the
supersession was found — recorded so the reasoning is not re-litigated):

- *"adoption merges into live, upsert-only"* — VOID. Nothing should write live files.
- *"`PUT /api/admin/item/:id` returns 410"* — VOID and out of scope: **REQ-0182** (todo,
  ratified 2026-07-15) owns Dex Edit retirement, rules **409** not 410, and binds the
  sequence Phase A (port the editor) → Phase B (retire). This REQ must not touch it.
- *"publish auto-commits"* — VOID. There is no publish; the export path it referenced is
  retired by 0178 Phase 3.

**What survived** is the finding's real core, and it is what this REQ now is: the paths that
adoption still cannot reach.

## 2. The finding, restated exactly (source-verified, 2026-07-15)

REQ-0178 converted **one of the two modules** that read live content. It never touched the
other — `server/services/core.cjs` contains **zero** registry references (`grep` plus
`git log -- server/services/core.cjs` confirm 0178 is absent from its history).

| | Module | Serves | Registry tier today |
|---|---|---|---|
| Display | `server/lib/content.cjs` `buildContentPayload()` → `/api/content` | Dex, client surfaces | **YES** — po_def/si_def/tm_def (REQ-0178) |
| Authority | `server/services/core.cjs` `getScheduleContent()` | the gacha ROLL, the run SIMULATION, market, warehouse grants, forecast, devotion, seals, rooms | **NO — none, for any kind** |

Two consequences, both live today:

1. **The gacha gap** (the harm the original 0176 named, still true). `gacha_pack` /
   `unit_def` were explicitly ruled OUT of 0178 Phase 1. An operator retunes a pool in the
   admin, every check goes green, they adopt — and `resolvePack()` → `getScheduleContent()`
   keeps rolling the old odds.
2. **The display-vs-simulation gap** (larger, and NOT named by 0178). `po_def` has **35
   adopted variants on live**. `/api/content` serves them from the registry; `runs.cjs:66`
   simulates from `getScheduleContent().itemDefsById` — the FILE. Today drift is 0 (0178's
   parity gate holds), so it is harmless. The next adopted po_def edit makes the Dex show one
   thing and the battle do another. This is REQ-0182's documented Dex-Edit failure, inverted.

Phase-1b is therefore NOT "the four kinds 0178 skipped". It is **"convert the second module,
for all seven kinds"**. Restricting it to four would leave the worse gap live, for no less
work — the mechanism is one snapshot either way.

## 3. Goal

`getScheduleContent()` resolves **registry adopted variant → live-file entry → absent**, for
every registry kind — the same chain, at the same precedence, as `/api/content`. Adoption then
changes the game everywhere: display AND roll AND simulation, from one source.

## 4. Investigation map (binding; done 2026-07-15 before coding, per 0178's rule)

- `getScheduleContent()` (`services/core.cjs:79`) is **synchronous**, mtime-cached over 11
  paths, and has **20+ consumers** reached deep inside request paths and the sim:
  `gacha.cjs` (`resolvePack:101`, roll `:182`), `runs.cjs:66`, `rooms.cjs`,
  `market/{listings,views}.cjs`, `ragnarok/{snapshot,devotion}.cjs`, `seals.cjs`,
  `lib/forecast.cjs`, `routes/{schedule,admin,warehouse}.cjs`. It **must stay synchronous** —
  no `await` may enter those paths. The registry tier is therefore a WARM SNAPSHOT, exactly
  mirroring `lib/content.cjs` (TTL 15s + boot `setImmediate` + explicit `refreshRegistryData()`).
- Kind → map inside `getScheduleContent()`:

  | kind | map | shape |
  |---|---|---|
  | `po_def` | `itemDefsById` | raw entry; **pilot (`dungeon/items.json`) then starter overlay ON TOP** — overlay order is load-bearing |
  | `si_def` | `siDefsById` | raw entry |
  | `tm_def` | `tmDefsById` | raw entry |
  | `unit_def` | `unitDefsById` | raw entry |
  | `gacha_pack` | `packDefsById` | raw entry |
  | `monster_def` | `enemyDefsById` | raw entry |
  | `skill_def` | `skillDefsById` | **RESHAPED**: `{trigger, verb, attack_profile, modes}` only (REQ-0057 keeps it mechanics-only — `sim/lib/packs.cjs` mutates these in place) |
  | `skill_def` | `skillNamesById` | **RESHAPED**: `{en:{name}, ja:{name}}` from flat `name_en`/`name_ja` |

  `skill_def` is the only non-verbatim transform: the overlay MUST apply the same reshape to
  registry data, or the forecast tooltip and the combat fold diverge.
- `storage.resolveAdoptedContentData(kind, names)` (`storage_content.cjs:156`) is already
  **kind-generic** (kind is a bound parameter filtered against `content_defs.kind`) — reused
  as-is, no signature change.
- `lib/content.cjs` units/packs transform is `withBackCompatI18n(Object.assign({}, e))` —
  identical to the existing `servedTmEntry`, reused for the new sections.
- `formations` stays permanently out: not a registry kind (the backfill skips it as
  composition data), so there is nothing to serve from.
- Namespace: `NAMESPACE = sha256(os.homedir() + '/backpack_ragnarok').slice(0,16)` — derived
  from HOME, **not** CONTENT_ROOT, so worktrees share live's namespace. Tests MUST isolate via
  the established TMPHOME pattern (`content_admin_e2e.sh`), never by CONTENT_ROOT alone.

## 5. Live drift probe — the cutover is byte-transparent TODAY (read-only, 2026-07-15)

Every live-file entry compared against its adopted variant using the parity tool's own
`deepEqualUnordered`:

| kind | file | file entries | adopted | MATCH |
|---|---|---|---|---|
| `unit_def` | `live_units.json` | 12 | 12 | **12** |
| `gacha_pack` | `live_packs.json` | 3 | 3 | **3** |
| `monster_def` | `dungeon/enemies.json` | 7 | 7 | **7** |
| `skill_def` | `dungeon/skills.json` | 14 | 14 | **14** |

DRIFT=0 across all 36. Flipping the authority path to registry-first changes **nothing** the
game serves today — it changes what the NEXT adoption does. That is the whole point, and it is
why this can land safely. (po/si/tm are already gated MATCH by 0178's standing parity check.)

## 6. Scope

### A. Registry tier in `services/core.cjs`

- Warm snapshot `registryData = {po_def, si_def, tm_def, unit_def, gacha_pack, monster_def,
  skill_def}`, pg-only; **empty under the files backend** → `getScheduleContent()` returns the
  file payload unchanged (byte-identical to today; the default e2e fleet proves it).
- Overlay applied INSIDE `getScheduleContent()` **LAST** — after the file maps and their
  pilot/starter overlays are built — keyed by the served id so the key set is unchanged. The
  registry wins over every file source, matching `lib/content.cjs`'s precedence exactly.
  This is correct, not a hazard: `dungeon/items.json` and `starter_items.json` are THEMSELVES
  backfilled `po_def` sources, so the ledger owns their entries too. Verified 2026-07-15: the
  only ids present in more than one `po_def` file are `lockpick`/`spyglass` (starter ∩ dungeon)
  and their entries are **byte-identical**, so the precedence is unobservable on today's data —
  which is precisely why the backfill's `exclude: ['lockpick','spyglass']` is safe. If a future
  adoption edits one, the registry SHOULD win: that is this REQ's whole purpose.
- Cached on `(contentCache.payload, snapshot)` identity so the overlay is not rebuilt per call —
  `getScheduleContent()` is called several times per request.
- Never throws: a registry read failure keeps the last snapshot; the game must not 500 on a DB
  hiccup (`lib/content.cjs` precedent).

### B. Invalidation — one refresh, both modules

- `routes/content.cjs invalidateServedContent()` currently refreshes `lib/content.cjs` only. It
  must ALSO refresh `core.cjs` — awaited, same determinism contract. **One call site, two
  snapshots**: a divergence here would be the very drift this REQ exists to kill.

### C. `/api/content` units/packs registry-first

- Add `units: 'unit_def'`, `packs: 'gacha_pack'` to `REGISTRY_KIND_BY_SECTION`, transform =
  `servedTmEntry`. This and (A) MUST land together: REQ-0170's entire purpose was
  display==roll parity, so display and roll flip in the same commit or not at all.

### D. Parity tool coverage

- Extend `tools/verify_content_registry_parity.cjs` `COVERED` with the four new kinds. It is the
  standing drift gate and the pre-cutover check; it must see what it now governs.

### E. Source accounting

- `GET /api/content/dev/sources` gains the new sections plus a `schedule` block, so the
  authority path's registry/fallback split is observable, not inferred.

## 7. Non-goals

- Dex Edit / `PUT /api/admin/item/:id` — **REQ-0182 owns it.** Not touched here.
- 0178 Phase 2 (fallback → warnings) and Phase 3 (file retirement, export/integrate removal).
- `formations` (not a registry kind); new kinds; new checks; admin UX; client changes.
- The `git_committed` lie in `content_export.cjs:61` / `art_export.cjs:44` (both report
  `process.env.*_EXPORT_GIT === '1'` and neither module contains any git code). Real, but it
  belongs to the export path 0178 Phase 3 retires. **Recorded here, deliberately not fixed.**

## 8. Gates

- **G1** server tests green: `api_test` BOTH backends (files payload must stay byte-identical —
  assert it, as 0178 did), `content_test`, `contentagg_test`, gacha/runs/market/forecast suites;
  new `schedule_serving_test.cjs` (pg). `tsc -p tsconfig.server.json`. Client untouched (build
  green).
- **G2** parity tool green incl. the 4 new kinds on the harness corpus; `content_admin_e2e.sh` +
  `artadmin_e2e.sh`; FULL default suite (pre-merge). e2e ONLY via `pnpm run e2e` /
  `tools/e2e_run.sh`.
- **G3** hygiene: diff limited to `server/`, `tools/`, `docs/`. No client src changes.
- **Deploy (orchestrator):** run the parity tool on LIVE across all 7 kinds — MUST be MATCH
  (DRIFT ⇒ a post-backfill file edit: STOP, surface to the user) → merge → restart
  `backpack-api` → post-deploy suite → S7.

## 9. Risks

- **Blast radius.** Unlike 0178 (which fed only `/api/content`), this sits under the roll, the
  sim, market and warehouse. Mitigated by: empty snapshot ⇒ byte-identical (files backend), and
  DRIFT=0 on live (§5) ⇒ the pg cutover is a no-op on today's data.
- **`skill_def` reshape.** The one transform that is not verbatim. A mis-shaped overlay silently
  changes combat (`packs.cjs` folds these). Needs a direct test, not just a payload compare.
- **`po_def` overlay order.** Three files feed `itemDefsById` (live_items → pilot → starter)
  and the registry overlays on top of all three. Test the precedence explicitly, including the
  `lockpick`/`spyglass` duplicate-id pair.
- **Mid-request snapshot swap.** A TTL refresh between two `getScheduleContent()` calls in one
  request could serve two different snapshots. Pre-existing with the mtime cache; the identity
  cache must not make it worse. Keep the snapshot swap atomic.
- **Sealed seeds (REQ-0058).** Content changes shift replays. Unchanged by this REQ (DRIFT=0),
  but the standing hazard is worth naming.

## 10. Why one REQ

All seven kinds share ONE mechanism (a single warm snapshot in one module). Splitting per-kind
would duplicate the snapshot machinery and invite seven disagreements about precedence. The a/b
split stays available if `monster_def`/`skill_def` (the dungeon seam) later needs to move
independently of `unit_def`/`gacha_pack` (the roll seam).

## Implementation log

### Session 1 — rewrite + implementation (2026-07-15, opus orchestrator)

**Why this session did not implement the REQ it was handed.** The task was "do REQ176".
REQ-0176 sat in `draft/` — not cleared. Reading it against the source showed its premise had
been overtaken by REQ-0178 the same day it was raised (§1). Three rulings were taken from the
user on the REQ's original terms, then WITHDRAWN once the supersession surfaced: they were
answers to a question that no longer existed. The user ruled the rewrite (Phase-1b, number
preserved) and cleared it to implement. Recorded because the withdrawn rulings are the kind of
thing a later reader would otherwise re-litigate.

**Investigation (binding map, done before coding).** See §4. The load-bearing find: REQ-0178
converted the DISPLAY module (`lib/content.cjs`) and never touched the AUTHORITY module
(`services/core.cjs` — zero registry references, confirmed by grep + `git log`). With 35
adopted `po_def` variants already live, `/api/content` was serving registry data while
`runs.cjs` simulated from the file. DRIFT=0 kept it harmless; the next adoption would not have.
That is why scope became "all 7 kinds in the second module", not "the 4 kinds 0178 skipped" —
the mechanism is one snapshot either way, and stopping at 4 would have left the worse gap live.

**Implementation.**
- `services/core.cjs`: `getScheduleContent()` split into `ensureFilePayload()` (the untouched
  mtime-cached file tier) + a synchronous registry overlay. Warm snapshot (TTL 15s + boot
  `setImmediate` + explicit `refreshRegistryData()`), pg-only, never throws — a registry read
  failure keeps the last snapshot rather than 500ing the roll. Under the files backend the
  snapshot is empty and the file payload OBJECT is returned unchanged (identity, asserted).
  Identity-cached on `(filePayload, snapshot)` because the loader is called several times per
  request.
- Precedence: the registry overlays LAST, over every file source including the pilot/starter
  `po_def` overlays — both are themselves backfilled `po_def` sources, so the ledger owns their
  entries. The first spec draft had this backwards; corrected in c85a95e after checking the
  real data (the only multi-file ids are `lockpick`/`spyglass`, byte-identical, so the
  precedence is unobservable today — but a future adoption SHOULD win).
- `skill_def` is the one non-verbatim kind: registry data goes through the same mechanics-only
  (REQ-0057) and name reshapes as the file path, or the forecast tooltip and the combat fold
  disagree.
- `routes/content.cjs`: `invalidateServedContent()` now refreshes BOTH snapshots from one call
  site (`Promise.all`). A mutation refreshing only one would leave display and roll
  disagreeing — the exact drift this REQ kills.
- `lib/content.cjs`: `units`/`packs` join `REGISTRY_KIND_BY_SECTION` in the SAME change, which
  is what retires REQ-0178's stated reason for holding them back (display and roll now flip
  together — REQ-0170 parity preserved, asserted by a test).
- Parity tool: `COVERED` gains the 4 kinds; the banner now names its kinds off `COVERED` itself
  so it can never advertise coverage it does not check.

**Tests validated by mutation, not by passing.** `schedule_serving_test.cjs` (13, pg). With the
overlay disabled (pre-REQ behaviour) **8 of 13 FAIL**, including the headline
(`adopting a retuned gacha_pack changes what resolvePack() ROLLS`); the 5 that still pass are
the file-tier/fallback/negative cases, correctly insensitive. The first draft of the `skill_def`
mechanics test passed under the mutant — it asserted only the key set, which the FILE path also
satisfies — so it now plants a marker inside `attack_profile` to prove the combat fold reads the
ADOPTED variant. Rig note: this module anchors dungeon paths on `os.homedir()` (not
CONTENT_ROOT), so the temp home is SYMLINKED at the worktree — NAMESPACE hashes the homedir
string (isolated rows) while paths resolve through the link to the real corpus.

**Gate results.**
- **G1 (green):** `tsc -p tsconfig.server.json` exit 0. `api_test` files 177/0 (1371
  assertions) and pg 177/0 (1371) — the byte-parity contract holds. `content_test` 18/0,
  `contentagg_test` 5/0, `content_serving_test` 7/0, NEW `schedule_serving_test` 13/0,
  `verify_content_registry_parity_test` 3/0. Client `pnpm run build` green (untouched; `web/`
  build churn restored via `git checkout -- web/ && git clean -fd web/`).
- **G2 (green):** `check_e2e_ports` (ci [0/8]) — 3 harnesses, no collisions. Parity tool on the
  LIVE corpus, all 7 kinds: **MATCH=65 DRIFT=0 MISSING-IN-REGISTRY=0 UNADOPTED=0**, `--json`
  `ok:true`. `content_admin_e2e.sh` 22 passed (36.8s). `artadmin_e2e.sh` 5 passed (43.3s).
  FULL default suite: see below.
- **G3 (clean):** diff limited to `server/{services/core,lib/content,routes/content}.cjs`,
  `server/tests/schedule_serving_test.cjs`, `tools/{verify_content_registry_parity.cjs,ci.sh}`,
  `docs/`. No client src changes; no migrations; no `shared/dto.ts` change (the new accounting
  rides the existing dev/meta endpoint).

**Cutover safety — verified directly, not inferred.** The live drift probe (§5) compares the
FILES to the LEDGER; that is one step removed from the actual claim. So the claim was checked at
the chokepoint itself: an independent read-only script ran `getScheduleContent()` against the
LIVE registry + LIVE content with the snapshot empty (== the old file-only behaviour), then
refreshed and re-read, and deep-compared every served map:

| map | entries | registry-served | result |
|---|---|---|---|
| `itemDefsById` | 22 | 22 | SAME |
| `siDefsById` | 6 | 6 | SAME |
| `tmDefsById` | 1 | 1 | SAME |
| `unitDefsById` | 12 | 12 | SAME |
| `packDefsById` | 3 | 3 | SAME |
| `enemyDefsById` | 7 | 7 | SAME |
| `skillDefsById` | 14 | 14 | SAME |
| `skillNamesById` | 14 | (via skill_def) | SAME |

Key sets unchanged, zero entities changed, 65 now served from the registry (matching parity
MATCH=65). Flipping the authority path changes NOTHING the game serves today — it changes what
the NEXT adoption does. That is the entire point of the REQ, and the reason it can land.

**For the deploy (orchestrator) — pre-cutover check (read-only), from the checkout that serves
live content:**
```
set -a; . server/.env; set +a
STORAGE_BACKEND=pg node tools/verify_content_registry_parity.cjs          # human
STORAGE_BACKEND=pg node tools/verify_content_registry_parity.cjs --json   # machine gate
```
MUST be MATCH across all 7 kinds. DRIFT ⇒ a post-backfill file edit: STOP and surface to the
user; do NOT restart into it, because after this REQ the registry is what the ROLL and the SIM
read, so drift now changes the game, not just the Dex.

**Orchestrator must-know before merge/restart:**
- After restart the boot warm fires `refreshRegistryData()` in BOTH modules. The one boot warn
  line now counts units/packs too.
- `GET /api/content/dev/sources` gains a `schedule` block — the authority path's registry/
  fallback split beside the display path's. **The two should agree; a disagreement is drift.**
- No client changes, no migrations, no export/integrate changes.
- REQ-0182 (Dex Edit retirement) is untouched and still owns `PUT /api/admin/item/:id`.

**Deliberately not fixed (recorded, not actioned):** the `git_committed` lie in
`content_export.cjs:61` and `art_export.cjs:44` — both report `process.env.*_EXPORT_GIT === '1'`
while neither module contains any git code. Real, but it belongs to the export path REQ-0178
Phase 3 retires; fixing it here would be scope creep into a doomed module.

### Deploy (orchestrator, 2026-07-15 01:57 UTC)

**Pre-cutover parity (live, all 7 kinds):** `ok:true` MATCH=65 DRIFT=0 MISSING-IN-REGISTRY=0
UNADOPTED=0. The gate tripped once before this (DRIFT=1, `po_def dagger.stretch`) and the
deploy was correctly HALTED: root-caused to the `req-0182a` worktree's e2e running against
live at that moment (playwright worker 01:29:37 vs `live_items.json` mtime 01:29:37.028 —
the legacy Dex Edit PUT, i.e. the exact incident REQ-0182 exists to stop). Their teardown
restored the file; no hand-repair was needed. Waiting rather than hand-editing a live file
under someone else's running test was the right call.

**Base refresh.** REQ-0183/0186/0187 landed while this branch was in gates (fork 8830ace →
master 7d3332b). Merged master in (ac7b47d, zero conflicts — all art-side) and re-ran the FULL
gate set: a green from a stale base is not a green. tsc 0; api_test files 177/0 + pg 177/0;
content_test 18/0; contentagg 5/0; content_serving 7/0; schedule_serving 13/0; artwork_test
11/0; parity_test 3/0; client build green; contentadmin 22/22; artadmin 5/5; FULL default
suite 178 passed.

**Merge + restart.** master `356da9a`; `backpack-api` restarted 01:57:05, active. No migrations,
no dist rebuild (no client changes).

**Live verification — `GET /api/content/dev/sources` (backend `pg`):**

| path | sections | fallback |
|---|---|---|
| DISPLAY (0178+0176) | items=22 sis=6 tms=1 **units=12 packs=3** | **0** |
| AUTHORITY (0176, NEW `schedule` block) | itemDefs=22 siDefs=6 tmDefs=1 unitDefs=12 packDefs=3 **enemyDefs=7 skillDefs=14** | **0** |

Both paths registry-served with zero fallback, and their counts AGREE — which is the built-in
drift check. `enemyDefsById`/`skillDefsById` had no registry tier at all before this REQ. No
boot fallback-warn line, correct at fallback=0.

**Post-deploy suite (live pg):** first run 174 passed / 4 failed. Re-running the 4 on a QUIET
box: **22 passed / 2 failed**. `bp-transfer.spec`, `dex-card.spec` and `dex.spec` (both SI
tests) PASS — they were casualties of box contention with the concurrent `req-0182a` run, not
this REQ. The 2 real failures are **`dex-admin.spec.ts:69` and `:175`** — the two Dex-Edit
file-round-trip tests that REQ-0182 already documents as failing against registry-first serving.
They are **pre-existing since REQ-0178's deploy and owned by REQ-0182b** (draft); this REQ does
not touch `/api/content` items, which 0178 had already made registry-first.

**Concurrency note for the next reader.** `req-0182a` merged (`17bd440`) ~70s after this REQ
(`356da9a`), while this REQ's post-deploy suite was running. It touches only
`client/src/contentadmin/*` + its spec — no `server/`, no `web/` assets — so the running API is
current with master and the two changes do not interact. Two agents deploying to one box inside
two minutes is how a stray file edit or a stomped dev-player fixture becomes a mystery; the
lesson is that the post-deploy suite is only trustworthy on a quiet box.

**Status: `done/` — merged, deployed, live-verified, and ACCEPTED by the user (2026-07-15,
chat: "done and continue").**

**Accepted with one open consequence, surfaced before the deploy and acknowledged:** Dex Edit is
now fully inert for registry-covered po/si. Before this REQ it was HALF-inert (invisible in the
Dex, but still effective on the SIMULATION via the file); now the registry wins everywhere, so
the legacy `PUT /api/admin/item/:id` changes nothing an operator can observe. That is the correct
end state (one writer: the ledger), and REQ-0182a has already ported the friendly editor into
contentadmin — but the window stays open until **REQ-0182b** retires the route. The two
`dex-admin.spec.ts` failures (`:69`, `:175`) are the machine-visible face of that window, and are
0182b's to close.
