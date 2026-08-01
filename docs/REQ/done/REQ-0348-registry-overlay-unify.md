# REQ-0348 — Collapse the registry overlay to ONE engine (extend the `*FromCore` doctrine to all served kinds)

**Status:** Todo (decisions resolved 2026-07-30; cleared to implement)
**Reserved:** 2026-07-30
**Slug:** registry-overlay-unify
**Origin:** API code audit, 2026-07-30 (whole-`server/` review; no prior REQ)
**Depends on:** nothing. **Blocks:** nothing. Sibling: REQ-0349 (independent).

---

## 1. Problem

The "registry adopted variant -> live-file entry -> absent" resolution chain is
implemented **twice**, independently, under the same private names, in two
modules that must agree but share no code:

| | display path | authority path |
|---|---|---|
| module | `server/lib/content.cjs` | `server/services/core.cjs` |
| public entry | `getContent()` `:525` | `getScheduleContent()` `:384` |
| serves | `GET /api/content`, Dex cards | gacha roll, run simulation, market, warehouse |

| concept | `lib/content.cjs` | `services/core.cjs` |
|---|---|---|
| snapshot var | `registryData` `:313` | `registryData` `:290` |
| snapshot timestamp | `registryAt` `:314` | `registryAt` `:291` |
| TTL constant | `REGISTRY_TTL_MS = 15000` `:315` | `REGISTRY_TTL_MS = 15000` `:283` |
| snapshot builder | `computeRegistryData()` `:317` | `computeRegistryData()` `:293` |
| snapshot refresher | `refreshRegistryData()` `:336` | `refreshRegistryData()` `:321` |
| empty test | `registryIsEmpty()` `:342` | `registryIsEmpty()` `:327` |
| overlay + memo | `applyRegistryOverlay()` `:365`, `servedCache` `:364` | `applyRegistryOverlay()` `:360`, `servedCache` `:351` |
| source accounting | `getContentSources()` `:393` | `getScheduleSources()` `:403` |
| boot warm | `setImmediate` `:553` | `setImmediate` `:392` |

The duplication is known and hand-maintained: `core.cjs:257` says "Mirrors
server/lib/content.cjs exactly", `:283` "mirror lib/content.cjs
REGISTRY_TTL_MS", `:359` "Same precedence as lib/content.cjs", `:391` "mirrors
lib/content.cjs's setImmediate warm".

### 1.1 The codebase already has the right answer — applied to the newer kinds only

`lib/content.cjs` does **not** overlay everything itself. Three sections of
`/api/content` are derived from the authority path instead, each applying only
the display reshape (`withBackCompatI18n`) on top of `core.getScheduleContent()`:

- `monstersFromCore()` `:457` — REQ-0208, `payload.monsters` + `payload.monster_skills`
- `gimicsFromCore()` `:485` — REQ-0211, `payload.gimics` + `payload.gimic_skills`
- `unitSkinsFromCore()` `:513` — REQ-0266, `payload.unit_skins`

`lib/content.cjs:310` states the doctrine explicitly: those kinds come from
"that same core path ... so neither kind ever joins this module's own overlay."

So there are two coexisting mechanisms for one job. The `*FromCore` derivation
(single engine, one source of truth) is the **newer** and correct one; the
private 5-kind overlay engine (`po_def`, `si_def`, `tm_def`, `unit_def`,
`gacha_pack`) is the **legacy** leftover it has been progressively replacing,
three REQs so far, without the last five kinds ever being migrated.

### 1.2 Consequence — REQ-0211's isolation fix exists in only one engine

REQ-0211 hit a real outage: a content kind whose pg enum value was not yet
migrated made `storage.resolveAdoptedContentData()` throw `invalid input value
for enum content_kind`, rejecting the whole `computeRegistryData()` promise and
**blanking every kind's overlay**. The fix — a per-kind `try/catch` so only the
failing kind degrades to file-served — was applied to `services/core.cjs:293-318`
**only**.

`lib/content.cjs:317-335` still has the unguarded shape: five bare `await`s in
one object literal, no per-kind guard. `refreshRegistryData()`'s outer `catch`
keeps the *last* snapshot, so `/api/content` does not 500 — it silently serves a
stale or empty overlay for **all five** of its kinds while the core-derived
sections keep working. This is the live residue of the REQ-0211 outage, and it
exists purely because there are two engines.

Deleting the second engine fixes it by construction. That is the whole argument
for this REQ.

### 1.3 Corrections to the original audit (2026-07-30)

Two claims in the first draft of this spec were checked and did **not** hold.
Recorded so nobody re-derives them:

- **"Divergence A: the display path is missing 5 kinds, so adoptions reach the
  game but not the Dex."** WRONG. `monster_def`, `skill_def`, `gimic` and
  `unit_skin` all reach `/api/content` via the `*FromCore` sections in §1.1, and
  `dungeon` is not a `/api/content` section at all (dungeon listing is
  `routes/public.cjs` + `core.listDungeonsAndFormations`). There is **no live
  display/authority content mismatch**. The real defect is structural (two
  engines) plus §1.2.
- **"Divergence C: `lib/content.cjs` and `services/core.cjs` require each other
  lazily to break a cycle."** WRONG. `services/core.cjs` does **not** require
  `lib/content.cjs` — it requires `lib/content_files.cjs` (`:42`), a different
  module; every other mention is a comment. The dependency is **one-directional**
  (`lib/content.cjs -> services/core.cjs`, lazily at `:251, 458, 486, 514`) and
  the lazy-ness is justified in place ("keeps standalone tool imports light").
  **This makes the fix easier, not harder** — §3 can point the dependency the way
  it already points, with no cycle to unwind.
- Still open but **out of scope**: `monster_pack` is in `routes/content.cjs:24`
  `KINDS` (admin-writable, 11 kinds) but in no serving list, so its adoptions
  reach nothing. `core.cjs:269` already documents this as "the `monster_pack`
  bug". Reconciling the admin-writable list against the serving list is its own
  REQ; this one must not silently change which kinds are adoptable.

## 2. Goal

**One overlay engine, in `services/core.cjs`.** `lib/content.cjs` keeps zero
registry state and becomes what it already is for three sections: a display
projection over `core.getScheduleContent()`.

## 3. Design — extend `*FromCore` to `items` / `sis` / `tms` / `units` / `packs`

Delete from `lib/content.cjs`: `REGISTRY_KIND_BY_SECTION` `:312`, `registryData`
`:313`, `registryAt` `:314`, `REGISTRY_TTL_MS` `:315`, `computeRegistryData`
`:317`, `registryIsEmpty` `:342`, `overlaySection` `:359`, `servedCache` `:364`,
`applyRegistryOverlay` `:365`, `sourceAccountingFor` `:387`, and the
`refreshRegistryData` warm at `:553`.

Keep and reuse: `servedEffEntry` `:352` (eff render + `withBackCompatI18n`) and
`servedTmEntry` `:358` — these are the genuine display transform and the ONLY
thing that differs between the two paths.

`getContent()` `:525` then becomes uniform: every registry-backed section is
`overlay-from-core + display transform`, the same shape `monstersFromCore` already
has. `core.cjs`'s `REGISTRY_KINDS` `:269` becomes the single serving kind list;
its per-kind `try/catch` becomes the only isolation behaviour; its `servedCache`
identity memo serves both paths.

`refreshRegistryData` and `getContentSources` stay **exported** from
`lib/content.cjs` as delegations to core, so `routes/content.cjs:87-88` and
`:381-382` need no change (the same facade discipline as `storage.cjs` REQ-0145a
sb and `schedule.cjs` REQ-0047 c). After this REQ, `routes/content.cjs:87-88`
awaits two functions that are one function — collapsing that call site is a
tidy-up commit at the end, not a separate REQ.

### 3.1 Why this is byte-parity-able

Same `storage.resolveAdoptedContentData` call, same raw adopted entries, same
overlay precedence (registry last, `core.cjs:353-359` and `lib/content.cjs:365`
already document identical precedence). Only the transform differs, and it moves
across unchanged.

**The one hazard, checked:** the two paths ask the registry for different name
sets. `core.cjs:162-169` builds `itemDefsById` from live_items **+ pilot
(`dungeon/items.json`) + starter_items**; `lib/content.cjs:96-110` builds `ITEMS`
from live_items **+ starter_items** (no pilot). Core's `po_def` name set is
therefore a **superset** of the display path's — so reading core's snapshot can
never miss a name the display path needs. This direction must be **asserted by a
test**, not assumed, because a future file added to the display payload only
would silently lose its overlay.

## 4. Scope

**In:** `server/lib/content.cjs`, `server/services/core.cjs` (mostly unchanged —
it becomes the sole owner), tests. **Out:** `routes/content.cjs:24` `KINDS` and
the `monster_pack` gap (own REQ), `storage.resolveAdoptedContentData`
(unchanged), the art-URL cache `refreshArtUrls` (a different DB-derived map that
merely shares the 15 s TTL — explicitly not touched), REQ-0349's route work.

## 5. Decisions — RESOLVED 2026-07-30

The original draft asked whether the display path should adopt the authority
path's 10 kinds (a) or keep 5 and unify the engine only (b). **Both options were
premised on the mistaken §1.3 reading and are withdrawn.** With the `*FromCore`
doctrine understood, the thorough option is neither: it is to **finish the
migration the codebase already started three times** and delete the second
engine. That is §3.

- **D1 — RESOLVED: delete `lib/content.cjs`'s overlay engine; all served kinds
  derive from core.** No payload change is intended (§3.1), so this ships behind
  the existing byte-parity gate rather than needing a client audit. It removes
  the duplicated invariants outright instead of leaving two configured copies.
- **D2 — RESOLVED: the shared module lives in `services/core.cjs`, no new file.**
  The original draft proposed extracting a third module
  (`registry_overlay.cjs`) and asked `lib/` vs `services/`. Rejected: with the
  dependency already one-directional (§1.3) a new module would add an indirection
  layer to justify a symmetry that does not exist. The authority path is the
  natural owner — it has the wider kind list, the isolation fix, and the
  synchronous-snapshot constraint. Extracting later stays possible if a third
  consumer ever appears.

## 6. Invariants that must not break

- `getScheduleContent()` stays **synchronous** (`core.cjs:384`; 20+ in-request-path
  consumers). The warm snapshot + opportunistic TTL refresh is what makes that
  possible; preserve the shape exactly.
- "Never throw / keep last snapshot": neither path may 500 on a transient DB
  read failure; worst case is file-served.
- Empty registry (files backend) must return the file payload **object
  unchanged** — `core.cjs:262-265` notes this is what keeps the default e2e fleet
  a true no-regression baseline.

## 7. Gates

1. `cd server && node tests/api_test.cjs` — baseline captured 2026-07-30 at
   `master` `e4b24dd0`: **229 passed, 0 failed, 1,950 assertions**. Must stay green.
2. `STORAGE_BACKEND=pg node tests/api_test.cjs` — the registry is pg-only, so
   this is the gate that actually exercises the overlay.
3. `tests/content_serving_test.cjs`, `tests/schedule_serving_test.cjs`,
   `tests/verify_content_registry_parity_test.cjs` — the existing
   display/authority parity trio.
4. `tools/ci.sh` full run.
5. **New test A (the point of the REQ):** one kind whose
   `resolveAdoptedContentData` throws degrades ONLY that kind, on the display
   path as well as the authority path — the REQ-0211 regression, now asserted for
   `/api/content` too (§1.2).
6. **New test B (the §3.1 hazard):** the display payload's registry-backed name
   set is a subset of `core.REGISTRY_KINDS`' requested name set, per kind. Fails
   loudly if a future display-only content file is added.
7. Byte-parity spot check: capture `GET /api/content` under `STORAGE_BACKEND=pg`
   with a non-empty registry before and after, and diff.

## 8. Result (implemented 2026-07-30)

Three commits on `req-0348-registry-overlay-unify`.

### §3's design was too broad; the implemented one is narrower and here is why

§3 said to delete `lib/content.cjs`'s overlay engine outright and have
`items`/`sis`/`tms`/`units`/`packs` derive from `core.getScheduleContent()` the
way `monstersFromCore()` already does. **That would have changed the served
payload.** `core.cjs:162-163` builds `itemDefsById` from live_items **+ the pilot
`dungeon/items.json` overlay** + starter_items, whereas `lib/content.cjs`'s
`items` section is live_items + starter_items and deliberately carries no pilot
entries. Deriving `items` from core would have leaked the batch-002 demo items
into `/api/content`. The `*FromCore` doctrine works for monsters/gimics/unit_skins
precisely because those sections have no display-side file payload of their own
to conflict with.

So what is shared is **the snapshot**, not the overlay application:

- **Deleted from `lib/content.cjs`:** `registryData`, `registryAt`,
  `REGISTRY_TTL_MS`, `computeRegistryData`, the async body of
  `refreshRegistryData`, and the registry half of the TTL/boot-warm policy.
- **Added to `services/core.cjs`:** `getRegistrySnapshot()` — the one snapshot,
  with the one opportunistic-TTL policy.
- **Kept per-consumer:** `applyRegistryOverlay`, `servedCache`, `registryIsEmpty`,
  `REGISTRY_KIND_BY_SECTION`, and the display transforms. These genuinely differ
  (different base payloads, section names, and per-kind transforms) and sharing
  them would change output.

That is a smaller unification than §3 promised, but it is the whole of the part
that was **broken**: §1.2's un-migrated REQ-0211 isolation lived entirely in the
deleted copy.

### Numbers

| | before | after |
|---|---|---|
| snapshot implementations | 2 (drifted) | 1 |
| `REGISTRY_TTL_MS` constants | 2, kept equal by hand | 1 |
| boot warm-on-`setImmediate` for the registry | 2 | 1 |
| per-kind isolation policy | 1 of 2 copies had it | 1, applies to both paths |
| `lib/content.cjs` CODE lines | 337 | 321 |
| `services/core.cjs` CODE lines | 306 | 311 |

Raw diff is +260/-28 across four files, but 170 of the added lines are the new
test and most of the rest is the comment recording why the overlay application is
NOT shared — the next person to read this will otherwise re-derive §3's broader
plan and break `/api/content`. §8's "~-90 lines" prediction was wrong in both
direction and magnitude; the win is one snapshot, not fewer lines.

### Byte parity, measured

`GET /api/content`'s five overlaid sections dumped from the real pg registry (95
entities from registry, 20 file fallback) before and after: **70,196 bytes,
`cmp`-identical**.

### `services/core.cjs` is still a grab-bag

Audit item P3 (path constants + content loader + registry overlay + i18n labels +
reward mapping + engine factory + `genId` + slot helpers in one 620-line module)
is untouched and remains a candidate REQ. It did NOT shrink here — it gained
`getRegistrySnapshot`.

## 9. Status log

- 2026-07-30 — reserved (`7e15078e`); first spec written and moved
  `reserved -> draft` (`46f04ca4`) pending D1.
- 2026-07-30 — audit claims re-verified: two withdrawn (§1.3), design replaced
  with the `*FromCore` collapse, D1/D2 resolved, moved `draft -> todo`.
  Evidence gathered at `master` `e4b24dd0`.
- 2026-07-30 — IMPLEMENTED on branch `req-0348-registry-overlay-unify` off
  `master` `e4b24dd0`. §3's design narrowed during implementation (see §8) after
  the pilot-items conflict was found; §8 rewritten with the result. Gates:
  - `node tests/api_test.cjs` (files): **229 passed, 0 failed**
  - `STORAGE_BACKEND=pg node tests/api_test.cjs`: **229 passed, 0 failed**
  - `content_serving_test` 9/0, `schedule_serving_test` 13/0,
    `verify_content_registry_parity_test` 3/0, `contentagg_test` 5/0,
    `content_test` 18/0 (all pg)
  - new `tests/registry_overlay_test.cjs`: 5/0, wired into `ci.sh [4.697/7]`.
    **Verified to have teeth** — run against `master`'s pre-fix
    `lib/content.cjs`, assertions 2 and 3 fail with exactly the §1.2 symptom
    (`items.registry == 0` because one rejected `await` blanked all five
    sections).
  - byte parity: the five overlaid sections `cmp`-identical before/after against
    the real pg registry (70,196 bytes)
  - `tools/ci.sh` full gate incl. scoped hermetic e2e: **CI GREEN**, 336s
  Moved `todo -> built`: code complete and green, NOT merged or deployed.

### Follow-ups this REQ deliberately did not take

- `routes/content.cjs:87-88`'s `invalidateServedContent()` still awaits two
  functions that are now the same one (`lib/content.cjs`'s delegates to core's).
  Harmless and idempotent; collapsing it touches the adopt/edit/delete/patch
  determinism contract, so it wants its own small REQ rather than a drive-by.
- The `monster_pack` gap (`routes/content.cjs:24` `KINDS` has 11 kinds, the
  serving list has 10, so `monster_pack` adoptions reach nothing) is untouched,
  as scoped in §4.
- `services/core.cjs`'s low cohesion (audit P3) — see §8.

## Deploy record (2026-08-01)

- Merged to master as dd9519c8 (merge order REQ-0348 -> REQ-0352 -> REQ-0353).
- `tools/release.sh` on the merged master: the NEW REQ-0353 drift gate ran
  FIRST on the release path and passed (MATCH=413 DRIFT=0 MISSING=0), full CI
  GREEN (343 s), dist unchanged, receipt written (tree 855262cd).
- Pushed e4b24dd0..27e8afbd (push gate accepted the receipt);
  `backpack-api` restarted 03:49Z; backpack-web / backpack-tunnel active.
- Live verification: `/api/content` on 127.0.0.1:8802 AND
  https://backpack-dev.qtie.jp serves frost_gnoll `["gnoll_claw","gnoll_snap"]`,
  troll/medusa/behemoth flavor skills, and `monster_skills.gnoll_snap` resolves
  with i18n names. Deployed; `built -> done` awaits user acceptance.
