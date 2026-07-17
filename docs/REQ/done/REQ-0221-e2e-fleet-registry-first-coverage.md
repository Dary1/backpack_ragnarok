# REQ-0221 — e2e-fleet-registry-first-coverage: make ci.sh exercise registry-first serving

**Status:** draft — AGENT-PROPOSED, awaiting owner review. Not cleared to implement.
**Reserved:** 2026-07-16
**Slug:** e2e-fleet-registry-first-coverage
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」.

## Why (REQ-0182b finding — a structural CI blind spot, not a one-off)

The ci.sh default fleet runs `STORAGE_BACKEND=files` (`e2e_fleet.cjs:101`) and the registry is
pg-only (`content.cjs computeRegistryData`), so under CI the registry is ALWAYS EMPTY and every
registry-first code path is unreachable at the code level:

- The REQ-0178 serving drift (Dex Edit writing files that live serving ignored) shipped through
  a green ci.sh — the suite only failed once pointed at the LIVE api.
- REQ-0182b's 409 guard on the legacy PUT cannot fire on the fleet; its test had to `test.skip`
  there and live only in the pg contentadmin harness + post-deploy runs.
- The relocated grant-to-warehouse button needs a pg-backed adopted variant the fleet cannot
  create; its coverage also lives outside the default suite.

Pattern: "green ci.sh" currently proves nothing about registry-first behaviour, which is now the
AUTHORITY path for po/si/tm. Every future registry-first feature inherits the blind spot.

## What to do

- Give ci.sh a stage (or the default fleet a namespace) that runs pg-backed with a seeded
  adopted def, so registry-first serving, the 409 guard, and adoption-changes-payload are
  exercised on every CI run. Candidate shapes: (a) promote the existing pg contentadmin harness
  into ci.sh's mandatory chain if it is not already; (b) teach the fleet a `STORAGE_BACKEND=pg`
  variant with a seed script; (c) a minimal dedicated harness (ports derived from THIS REQ:
  `tools/e2e_ports.sh 0221` → 2210-2219) that boots pg, seeds one adopted def, and runs the
  guard specs.
- Un-skip / relocate the tests that currently `test.skip` on the fleet, so skip-on-CI stops
  being the norm for registry behaviour.
- Document in ci.sh which stages cover which serving mode, so the next REQ knows where its
  coverage belongs.

## Out of scope
- Changing registry/serving semantics; replacing the files backend in other stages (files-mode
  coverage is still wanted — the point is BOTH, not a swap).

## Gates
- A deliberately introduced registry-first regression (e.g. re-enabling the legacy PUT for a
  covered kind) is caught by ci.sh alone, demonstrated once and recorded; full default suite
  green; port rule enforced by check_e2e_ports.cjs.

## Implementation (2026-07-17, REQ-0234 branch, shape (c))
- tools/registry_first_e2e.sh (decade 2210-2219 via e2e_ports.sh 0221):
  isolated pg api (HOME remap shaped like a fleet worker w0/home so
  client/e2e/e2e-env.ts resolves into it), registry SEEDED pre-boot by
  tools/seed_registry_e2e.cjs (clearAllContent -> createContentDef po_def ->
  createVariant -> adoptVariant on one live PO), post-0217 proxy driven via
  E2E_FLEET_BASE_PORT=<api>. Runs client/e2e/registry.config.ts
  (dex-admin.spec.ts) and FAILS the stage if any test skips.
- Wired as ci.sh stage [6.6/8] inside the [6.5/8] guard block; harness
  registered in tools/check_e2e_ports.cjs.

## Gate results (2026-07-17)
- Seeded harness run: 4/4 passed, 0 skipped -- the REQ-0182b 409 guard
  (dex-admin.spec.ts:102) EXECUTES (114ms) instead of skipping; registry
  serving count asserted >=1 pre-run.
- Deliberate-regression demo: guard disabled via `if (false && servedKind)`
  in server/routes/admin.cjs -> harness fails on exactly that spec
  (1 failed / 3 passed); revert -> 4/4 green. Recorded here; ci.sh alone now
  catches a registry-first regression.
- check_e2e_ports: 4 harnesses, no collisions.

## Deploy record (2026-07-17)
- Merged to master bc6c012 (--no-ff, user go-ahead in chat). No runtime paths touched (tools/, sim/tests, client/e2e, docs only): no service restart, no dist rebuild needed.
- Live verification: full ci.sh GREEN on the identical tree pre-merge (FULLCI2 09:52:59-10:00:40, incl. admin trio 7/1/28, registry stage 4/4 no-skip, scoped e2e 187/1/0); backpack-web/api healthy post-merge (200/200). Main-checkout quick gates green EXCEPT the PRE-EXISTING [3.8] art-export red: the in-flight art session's untracked content/art mirror lacks the items005 renders (gate self-skips in any tree without that mirror; this merge touches no content paths) -- flagged to the user, not caused here.
