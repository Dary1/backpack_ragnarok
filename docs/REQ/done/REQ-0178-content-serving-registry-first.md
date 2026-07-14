# REQ-0178 — content-serving-registry-first: /api/content entity sections served from the registry (Phase 1)

**Ratified:** 2026-07-14 (user, chat) — the data-side completion of the same-day ledger
canon. Sequence: the user asked why content/registry_exports/ exists instead of writing
content/live/*.json directly, then "逆に、陳腐化されるべきが、content/live/*.jsonなの
でしょうか?"; the orchestrator's phased registry-first proposal was explained on request
and the user answered "go on" (recorded as the Phase-1 go-ahead).
**Requested by:** user, 2026-07-14 (chat). Spec authored by orchestrator (Fable).

## Ruling being implemented (Phase 1 of 3)
- The content registry (adopted variants) becomes the SERVING source for entity content;
  content/live/*.json becomes a FALLBACK tier (Phase 2 turns fallback hits into warnings;
  Phase 3 retires the entity files + the export/integrate bridge). Non-entity singletons
  (dungeon graph, formations, entities.json interactables, scenario, seasons) stay
  file-served until registry kinds exist for them (out of scope here).
- Mirror of the art-side chain deployed the same day (REQ-0133): resolution is
  `registry adopted variant → live-file entry → absent`, computed server-side at the
  storage chokepoint, warm-cached, invalidated on adopt/edit.

## Scope
### A. Investigation first (binding on the implementer)
Map EXACTLY how the served payloads are assembled before coding:
- /api/content (items/sis/tms + trees/vocab/scenario…) — which module builds it, what
  caching exists, where REQ-0133's art_urls warm cache hooks in.
- The dungeon content path (enemies/skills — REQ-0122 dynamic loading; formations) and
  the gacha_pack serving path (REQ-0171) — decide per path: include in Phase 1 ONLY if
  the seam is as clean as the main payload's; otherwise document as Phase-1b follow-up.
  The REQ log must state the in/out decision per kind with reasons.
### B. Registry-first assembly
- For each served entity of a registry kind (po_def/si_def/tm_def minimum): if a content
  def with that system_name + matching kind has an ADOPTED variant, serve the adopted
  variant's data VERBATIM; else serve the live-file entry (fallback). Key order may
  differ (JSONB) — consumers must not care; the e2e proves the game runs on it.
- Warm cache (art_urls pattern): TTL + boot + explicit invalidation from the adopt /
  edit / delete / patch handlers. The endpoint stays synchronous.
- Fallback + source accounting: the payload (or a dev/meta endpoint) reports, per
  section, counts {registry, fallback_file, file_only_names[]} so drift is observable;
  log a single warn line per boot when fallback_file > 0.
### C. Parity verification tool
- `tools/verify_content_registry_parity.cjs`: for every entity in the live files of the
  covered kinds, deep-compare (key-order-insensitive) the file entry vs the adopted
  registry variant; report MATCH / DRIFT (with a field-level diff) / MISSING-IN-REGISTRY
  / UNADOPTED. Exit non-zero on DRIFT. --json for machine use. This runs at deploy
  BEFORE the cutover restart (orchestrator step) and becomes the standing drift check.
### D. Tests
- pg tests: adopted-variant beats file entry; fallback when no def/no adoption; cache
  invalidation on adopt (a fresh adopt changes the served payload within one
  invalidation); accounting counts correct. api_test BOTH backends stays green —
  note: under the files backend (no pg) the registry tier is EMPTY by definition and
  the payload must be byte-identical to today (fallback covers everything) — assert it.
- Full default e2e suite green (the game now runs on registry-served data).

## Contract preservation
- Wire shape of /api/content stays backward compatible: existing fields unchanged;
  additions are additive (source accounting). The engine/client need NO changes if the
  data is truly verbatim — any client change is a spec smell; if one seems needed, STOP
  and record why in the log before proceeding.
- Export/integrate (content_export.cjs) untouched this phase. Registry semantics
  (REQ-0155) untouched. contentadmin untouched (it already shows adopted-vs-served
  truthfully once serving follows adoption).

## Out of scope
- Phase 2 (fallback warnings/alarms), Phase 3 (file retirement + export/integrate
  removal); singleton kinds; monsters/units/skills/gacha if the investigation rules
  them out for Phase 1; PROJECT.md edits (user-managed).

## Gates
- G1: server tests (new + content_test + contentagg + api_test files/pg) green; client
  tsc/build green (should be untouched).
- G2: parity tool MATCH-or-explained on the harness corpus; contentadmin/artadmin e2e
  green; FULL default suite green (pre-merge branch run + post-deploy rerun).
- G3: hygiene; diff limited to server/tools/tests/docs (+ dto typing if accounting is
  typed); no client rendering changes.
- Deploy (orchestrator): parity tool on LIVE (must be MATCH across the board — the
  REQ-0157c/0160 backfills were verbatim, so DRIFT means a post-backfill file edit:
  STOP and surface to the user), then merge → restart backpack-api → post-deploy suite
  → S7.

## Risks
- JSONB key-order differences: harmless to the engine (proven by e2e), but the parity
  tool must compare order-insensitively.
- A def adopted with data that diverged from the file (drift) would change what the
  game serves at cutover — exactly what the parity gate exists to catch.
- Files backend (dev fallback) must remain fully functional with an empty registry.

## Implementation log

### Session 1 — implementation (2026-07-14, opus implementing engineer)

**Investigation (how the served payloads assemble; binding map before coding).**
- `/api/content` is built by `server/lib/content.cjs` `buildContentPayload()`,
  cached by `ensureFilePayload()` (mtime-checked over vocab/items/sis/tms/units/
  bpskins/packs/scenario/registry). `getContent()` returns that payload and, per
  REQ-0133, attaches the warm `art_urls` map SYNCHRONOUSLY (a TTL+boot+adopt-
  invalidated cache computed at the storage chokepoint via
  `storage.resolveItemArtNames`). `server/routes/public.cjs` serves it (sync).
  This is the single clean chokepoint the registry-first data overlay hooks into,
  exactly mirroring the art_urls warm-cache pattern.
- The adopted-variant DATA is the entry JSON stored VERBATIM (tools/
  backfill_content_registry.cjs: `data = entry` with "no reshaping"), so a
  backfilled variant's data equals the live-file entry field-for-field (JSONB key
  order aside). That is what makes registry-first serving byte-transparent and
  what the parity gate proves.
- The gacha ROLL (`server/services/gacha.cjs` -> `services/core.cjs
  getScheduleContent()`) and the dungeon path (enemies/skills/formations, served
  by `server/schedule.cjs`/`lib/forecast.cjs` also via `getScheduleContent()`)
  read a SEPARATE file cache, NOT `lib/content.cjs`. Decisive for the per-kind
  decision below.

**Per-kind Phase-1 coverage decision (in/out, with reasons).**
- IN — `po_def` -> items, `si_def` -> sis, `tm_def` -> tms. All three are served
  ONLY through `lib/content.cjs` buildContentPayload; the seam is identical to the
  REQ-0133 art_urls seam (keys are the served ids; lookup is by system_name +
  matching kind). This is the spec minimum and the whole cutover surface.
- OUT (Phase-1b) — `gacha_pack` (packs) and `unit_def` (units). Although the
  /api/content units/packs sections are structurally identical, pack odds AND
  unit defs have a SECOND, still-file consumer: the authoritative gacha roll +
  squad/starter builders read them from `services/core.cjs getScheduleContent()`
  (a file cache this REQ does not touch). REQ-0170's explicit purpose was
  display==roll parity; making the display feed registry-first while the roll
  stays file-based would re-introduce exactly that drift. The seam is therefore
  NOT as clean as the main payload's (two consumers, one untouched). Phase-1b must
  make `resolvePack`/`getScheduleContent` registry-aware in the same change.
- OUT (Phase-1b) — `monster_def`, `skill_def` (dungeon path). Not present in
  /api/content at all; served through a different module (`schedule.cjs`/
  `forecast.cjs` via `getScheduleContent()`, reading content/live/dungeon/*).
  Registry-first here means teaching that loader the registry tier — a separate
  seam.
- OUT (permanently for Phase 1) — formations. Not a registry kind (the backfill
  SKIPS formations.json as composition data), so there is nothing to serve from.

**Registry-first assembly + cache/invalidation design.**
- New chokepoint `storage_content.resolveAdoptedContentData(kind, names)`: one
  cross-table round-trip returning `{bare -> adopted DATA}` for names whose
  content_def has that EXACT kind AND an adopted variant; omitted otherwise
  (fallback). Kind filter is load-bearing (system_name is UNIQUE across kinds).
- `lib/content.cjs`: a warm snapshot `registryData = {po_def,si_def,tm_def}`
  (pg-only; empty under the files backend), refreshed on TTL (15s, mirroring
  ART_URLS_TTL_MS) + boot (setImmediate) + explicit `refreshRegistryData()`.
  `getContent()` OVERLAYS the snapshot synchronously (registry entry served
  verbatim through the SAME eff_en/eff_ja + i18n back-compat transform the file
  path applies, keyed by the served id so the key set is unchanged), cached by
  (filePayload, snapshot) identity. An EMPTY snapshot returns the file payload
  object unchanged -> byte-identical to the pre-REQ payload. Endpoint stays
  synchronous (no per-request DB round-trip).
- Explicit invalidation is awaited from the adopt / edit / delete / patch / dev-
  clear handlers (`routes/content.cjs invalidateServedContent()` ->
  `refreshRegistryData()`), the determinism contract the wiring proves. Adopt is
  the load-bearing one (it changes what is served); edit/delete/patch are
  included per spec and are cheap no-ops when they do not change adoption.

**Source accounting wire shape.**
- Additive `{registry, fallback_file, file_only_names[]}` per section, exposed on
  a NEW dev/meta endpoint `GET /api/content/dev/sources` (public read, same
  posture as /api/content): `{ok, backend:'pg'|'files', covered_kinds:{items:'po_def',
  sis:'si_def', tms:'tm_def'}, items:{...}, sis:{...}, tms:{...}}`. Deliberately
  NOT folded into the /api/content payload — that keeps the served shape byte-
  identical under an empty registry (the spec's byte-parity contract; asserted in
  api_test both backends). Typed additively in shared/dto.ts
  (ContentSourceAccounting / ApiContentSourcesResponse).
- One boot warn line when fallback_file>0, SUPPRESSED under the files backend
  (there an empty registry tier is BY DESIGN per the spec, not drift). Verified in
  the pg serving-test boot: `[content] REQ-0178 registry-first serving: 0 entities
  from registry, 29 from file fallback (items=22 sis=6 tms=1)`.

**Contract preservation / no client changes.** No client src touched. The engine/
client need no changes: registry data is served verbatim and byte-transparent
under an empty registry, so the files-backend fleet e2e (the default suite) runs
the game unchanged, and the pg overlay serves the same data (key order aside,
which the engine ignores by construction).

**Gate results.**
- G1 (all green):
  - `tsc -p tsconfig.server.json`: OK (installed root devDeps frozen; no lockfile
    change).
  - api_test files: 177 passed / 0 failed (1371 assertions). api_test pg: 177 / 0
    (1371). Both include the new byte-parity assertion in api/public.cjs.
  - content_test 18/0; contentagg_test 5/0; artwork_test 7/0.
  - NEW content_serving_test.cjs (pg): 7/0. NEW verify_content_registry_parity_test.cjs
    (DB-free): 3/0.
  - client `pnpm run build` (tsc -b + vite): green, untouched (web/ build churn
    restored via `git checkout -- web/ && git clean -fd web/`).
- G2 (all green):
  - Parity tool on the harness corpus (isolated TMPHOME namespace seeded by
    tools/backfill_content_registry.cjs from the real live corpus): MATCH=17
    DRIFT=0 MISSING-IN-REGISTRY=0 UNADOPTED=0, exit 0. `--json` verified (ok=true).
  - tools/content_admin_e2e.sh: 22 passed (34.2s). tools/artadmin_e2e.sh: 4
    passed (35.3s). Both drive this worktree's code on isolated pg namespaces.
  - FULL default e2e suite (this branch, ci.sh invocation:
    `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8803 E2E_GPU=1 E2E_PARALLEL=4 pnpm run
    e2e`): 178 passed, exit 0 (3.4m). Note: E2E_PARALLEL=4 runs a fleet of
    ISOLATED api instances built from THIS worktree on the FILES backend
    (tools/e2e_fleet.cjs) — so the registry tier is empty and serving is byte-
    transparent; this is the no-regression baseline (my code loads/runs, the game
    is unchanged). The post-deploy rerun against the LIVE pg (registry populated)
    is the orchestrator's step.
  - Logs: /tmp/req0178_e2e_content.log, /tmp/req0178_e2e_artadmin.log,
    /tmp/req0178_e2e_default.log, /tmp/req0178_e2e_chain.log.
- G3 (clean): diff limited to server/{storage_content,lib/content,routes/content}.cjs,
  server/tests/{content_serving_test,verify_content_registry_parity_test,api/public}.cjs,
  tools/{verify_content_registry_parity.cjs,ci.sh}, shared/dto.ts, docs (this file).
  No client src changes; web/dist churn restored.

**Commits (branch req-0178-content-serving-registry-first):**
- 49760d8 — registry-first assembly + warm cache + accounting (storage/lib/routes/dto).
- 59f3404 — parity/drift tool.
- 38dfce8 — tests + byte-parity assertion + ci wiring.
- (this docs commit) — implementation log.

**Deviations from a literal reading (documented):**
- Boot fallback-warn gated to the pg backend (files-backend empty registry is the
  spec's own defined state, not drift). Documented above.
- Source accounting placed on a dev/meta endpoint rather than the payload —
  REQUIRED to satisfy the "byte-identical under files backend" contract (any new
  payload field would break it). The spec permits "the payload (or a dev/meta
  endpoint)".

**For the deploy (orchestrator) — exact LIVE parity command (read-only):**
Run from the checkout that serves live content (default CONTENT_ROOT = that
checkout's content/), against the LIVE pg namespace:
```
set -a; . server/.env; set +a
STORAGE_BACKEND=pg node tools/verify_content_registry_parity.cjs          # human
STORAGE_BACKEND=pg node tools/verify_content_registry_parity.cjs --json   # machine gate
```
MUST be MATCH across po/si/tm (DRIFT exits non-zero -> a post-backfill file edit;
STOP and surface to the user). MISSING-IN-REGISTRY / UNADOPTED are reported but do
not fail the tool by design (spec C: non-zero exit ONLY on DRIFT) — for the cutover
they should be 0 for the covered corpus; if not, investigate before restart.

**Orchestrator must-know before merge/restart:**
- After merge + `backpack-api` restart, the boot warm fires `refreshRegistryData()`
  and (pg) may emit the one fallback-warn line if any covered id has no adopted
  variant — expected 0 fallback for the fully-backfilled corpus; a non-zero count
  is the drift signal to inspect (cross-check with the parity tool / GET
  /api/content/dev/sources).
- Serving is registry-first for po/si/tm ONLY; units/packs/monsters/skills stay
  file-served (Phase-1b). This is intentional; the game is unaffected because the
  data is verbatim.
- No client changes; no migrations; no export/integrate changes.


### Follow-up 2026-07-15 (orchestrator): starter-items inventory widening (user ruling)
The post-deploy source accounting exposed 12 items served via file fallback: the REQ-0051
starter-kit corpus (content/live/starter_items.json, po/2, 14 entries), which landed after
the sanctioned backfill inventory was fixed. User ruling 2026-07-15 ("実施どうぞ"): they
enter the ledger. SOURCES + the parity tool's COVERED gain the file with
['lockpick','spyglass']
-- the two documented Scout-kit reuse copies whose names dungeon/items.json owns
(system_name is UNIQUE). entriesFromFile enforces per-source exclusion loudly; tests updated
(backfill 11/0, parity 3/0).
