# REQ-0348 — Unify the registry-overlay engine (display path + authority path)

**Status:** Draft (blocked on decision D1 below)
**Reserved:** 2026-07-30
**Slug:** registry-overlay-unify
**Origin:** API code audit, 2026-07-30 (whole-`server/` review; no prior REQ)
**Depends on:** nothing. **Blocks:** nothing. Sibling: REQ-0349 (independent).

---

## 1. Problem

The "registry adopted variant -> live-file entry -> absent" resolution chain is
implemented **twice**, independently, in two modules that must agree but have no
shared code:

| | display path | authority path |
|---|---|---|
| module | `server/lib/content.cjs` | `server/services/core.cjs` |
| public entry | `getContent()` (`:525`) | `getScheduleContent()` (`:384`) |
| serves | `GET /api/content`, Dex cards | the gacha roll, the run simulation, market, warehouse |

Both modules privately define the same eight things, under the same names:

| concept | `lib/content.cjs` | `services/core.cjs` |
|---|---|---|
| snapshot var | `registryData` `:313` | `registryData` `:290` |
| snapshot timestamp | `registryAt` `:314` | `registryAt` `:291` |
| TTL constant | `REGISTRY_TTL_MS = 15000` `:315` | `REGISTRY_TTL_MS = 15000` `:283` |
| snapshot builder | `computeRegistryData()` `:317` | `computeRegistryData()` `:293` |
| snapshot refresher | `refreshRegistryData()` `:336` | `refreshRegistryData()` `:321` |
| empty test | `registryIsEmpty()` `:342` | `registryIsEmpty()` `:327` |
| overlay + memo | `applyRegistryOverlay()` `:365`, `servedCache` `:364` | `applyRegistryOverlay()` `:360`, `servedCache` `:351` |
| boot warm | `setImmediate(...)` `:553` | `setImmediate(...)` `:392` |

The two copies carry cross-references in their comments (`core.cjs:283` says
"mirror lib/content.cjs REGISTRY_TTL_MS"; `core.cjs:390` says "mirrors
lib/content.cjs's setImmediate warm"), i.e. the duplication is known and was
maintained by hand. **It has already drifted in three independent ways.**

### 1.1 Divergence A — kind coverage (three lists, three lengths)

There are three separate hard-coded kind lists that all have to agree:

- `routes/content.cjs:24` `KINDS` — **11** kinds (admin-writable)
- `services/core.cjs:269` `REGISTRY_KINDS` — **10** kinds (reaches the game)
- `lib/content.cjs:312` `REGISTRY_KIND_BY_SECTION` — **5** kinds (reaches display)

`core.cjs:269` already carries a warning about exactly this failure mode
("a kind in one list and not the other never reaches serving, the
`monster_pack` bug"), and `monster_pack` is still in `KINDS` but in neither
serving list. The five kinds the display path does **not** overlay —
`monster_def`, `skill_def`, `gimic`, `dungeon`, `unit_skin` — are adopted in the
admin UI and take effect in the game, while `/api/content` and the Dex keep
serving the live-file version. That is a silent display/authority mismatch.

### 1.2 Divergence B — per-kind failure isolation (REQ-0211 fix applied to one copy only)

REQ-0211 hit a real outage: a content kind whose pg enum value was not yet
migrated onto the DB made `storage.resolveAdoptedContentData()` throw
`invalid input value for enum content_kind`, which rejected the whole
`computeRegistryData()` promise and **blanked every kind's overlay**. The fix —
a per-kind `try/catch` so only the failing kind degrades to file-served — was
applied to `services/core.cjs:293-318` **only**.

`lib/content.cjs:317-335` still has the unguarded shape: five bare `await`s in
one object literal, no per-kind guard. `refreshRegistryData()`'s outer `catch`
keeps the *last* snapshot, so the display path does not 500 — it silently serves
a stale or empty overlay for **all** kinds while the game path keeps 9 of 10.
The REQ-0211 outage is therefore still live on the display path.

### 1.3 Divergence C — circular lazy require

The two modules require each other lazily to paper over a load-time cycle:

- `lib/content.cjs:251, 458, 486, 514` -> `require('../services/core.cjs')`
- `services/core.cjs:296` and `lib/content.cjs:267, 321` -> `require('../storage.cjs')`
- `services/market/lib.cjs:166, 171` -> `require('../core.cjs')`

`lib/content.cjs:458/486/514` justify the lazy require as "keeps standalone tool
imports of this module light", but `:251` has no such note and exists purely
because the cycle cannot be resolved at load time. A cycle between the display
and authority content loaders is the structural cause of A and B: neither module
can own the shared concept, so both copy it.

## 2. Goal

One overlay engine. Each consumer supplies only what is genuinely
consumer-specific: **its kind list**, **its file-payload key mapping**, and
**its per-kind transform**. Nothing else is duplicated, and the cycle is broken.

## 3. Proposed design

New module `server/services/registry_overlay.cjs` (name TBD; it is storage-
adjacent, not schedule-adjacent, so `server/lib/registry_overlay.cjs` is the
alternative — see D2). It owns, generically:

```
makeRegistryOverlay({ kinds, namesFor, transforms, ttlMs })
  -> { getSnapshot(), refresh(), isEmpty(), apply(filePayload), sources() }
```

- `kinds` — the kind list for this consumer.
- `namesFor(kind, filePayload)` — which file-payload map's key set to ask the
  registry for (replaces `REGISTRY_MAP_BY_KIND` / `REGISTRY_KIND_BY_SECTION`).
- `transforms[kind]` — the per-kind reshape. This is the ONE genuinely different
  axis: the display path applies `servedEffEntry` / `servedTmEntry`
  (`lib/content.cjs:352, 358` — eff render + `withBackCompatI18n`); the authority
  path applies identity for most kinds and the `skill_def` double-reshape
  (`skillMechanicsFrom` / `skillNamesFrom`, `core.cjs:338, 341`). Both express
  cleanly as a transform map.
- `ttlMs`, snapshot vars, `servedCache` identity memo, per-kind `try/catch`
  isolation, boot warm, "never throw / keep last snapshot" contract, and the
  `{registry, fallback_file, file_only_names[]}` source accounting all live in
  the shared module — written ONCE, with REQ-0211's isolation as the only
  behaviour.

`lib/content.cjs` and `services/core.cjs` each keep a module-level instance and
delegate. Both keep their existing public names (`refreshRegistryData`,
`getContentSources` / `getScheduleSources`) so `routes/content.cjs:87-88` and
`:381-382` need no change. The new module depends on `storage.cjs` only, so the
`content.cjs <-> core.cjs` cycle for overlay purposes disappears; the remaining
`lib/content.cjs:251` -> `core.cjs` call (`dungeonDefsById` key set) is
re-expressed as a `namesFor` closure and reviewed separately.

## 4. Scope

**In:** `server/lib/content.cjs`, `server/services/core.cjs`, new
`registry_overlay` module, tests. **Out:** `routes/content.cjs` `KINDS` (the
admin-writable list — reconciling it with the serving list is its own REQ),
`storage.resolveAdoptedContentData` (unchanged), the art-URL overlay
(`refreshArtUrls`, a different DB-derived cache — mentioned only because it
shares the 15 s TTL), REQ-0349's route-layer work.

## 5. Behaviour change — this REQ is a bug fix, not a pure refactor

The mechanical unification (one engine, two configs) is behaviour-preserving.
Two consequences are **not**:

1. **B is fixed on the display path** (per-kind isolation). Strictly an
   improvement, no decision needed.
2. **A changes what `/api/content` serves** if the display path adopts the
   authority path's 10 kinds. Adopted `monster_def` / `skill_def` / `gimic` /
   `dungeon` / `unit_skin` variants would begin reaching the Dex and the client
   content payload. This is the intent of the registry, but it is an observable
   payload change and it breaks the "byte-identical to the pre-REQ payload"
   parity contract that `lib/content.cjs:365` and `core.cjs:361` both assert.

## 6. Decisions required before implementation

- **D1 (blocking).** Does the display path adopt all 10 authority kinds, or stay
  at 5 for now?
  - (a) **Unify to 10** — one list, mismatch class eliminated. Changes
    `/api/content` output for adopted non-po/si/tm/unit/pack kinds; needs a
    parity-test rewrite and a client check (Dex renderers for monster/skill/
    gimic/dungeon/unit_skin).
  - (b) **Keep 5, unify the engine only** — zero payload change, ships behind the
    existing parity gate, leaves A open with a single documented kind list per
    consumer and a test that asserts the display list is a subset of the
    authority list.
  - Recommendation: **(b) now, (a) as an immediate follow-up REQ.** It splits the
    risky payload change away from the structural fix so each can be gated and
    reverted on its own.
- **D2.** `services/registry_overlay.cjs` or `lib/registry_overlay.cjs`? It is
  required by both a `lib/` and a `services/` module. `lib/` matches the
  "shared, no domain" convention of `http_util` / `route_auth`; `services/`
  matches where the fuller implementation lives today.

## 7. Gates

1. `cd server && node tests/api_test.cjs` — baseline captured 2026-07-30 at
   `master` `e4b24dd0`: **229 passed, 0 failed, 1,950 assertions**. Must stay green.
2. `STORAGE_BACKEND=pg node tests/api_test.cjs` — the registry is pg-only, so
   this is the gate that actually exercises the overlay.
3. `tests/content_serving_test.cjs`, `tests/schedule_serving_test.cjs`,
   `tests/verify_content_registry_parity_test.cjs` — the existing
   display/authority parity trio; the parity assertion is the contract this REQ
   is refactoring under.
4. `tools/ci.sh` full run.
5. **New test (the point of the REQ):** one shared table asserting that the
   display and authority overlays agree on every kind both cover, and that a
   single kind whose `resolveAdoptedContentData` throws degrades ONLY that kind
   on BOTH paths (the REQ-0211 regression, now asserted on the display path too).

## 8. Notes

- Nothing here is a hot path rewrite: `getScheduleContent()` must stay
  **synchronous** (`core.cjs:384`; 20+ in-request-path consumers) and the warm
  snapshot + opportunistic TTL refresh is what makes that possible. The shared
  module must preserve that shape exactly.
- Estimated net: roughly -150 lines across the two consumers, +180 in the shared
  module, with the duplicated invariants going from 2 copies to 1.

## 9. Status log

- 2026-07-30 — reserved (`7e15078e`), spec written, moved `reserved -> draft`
  pending D1. Audit evidence gathered at `master` `e4b24dd0`.
