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
(to be filled by the implementing engineer)
