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
(to be filled by the implementing engineer)
