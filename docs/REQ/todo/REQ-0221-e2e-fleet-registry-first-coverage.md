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
