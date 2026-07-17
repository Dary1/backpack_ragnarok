# REQ-0238 — ci-serving-mode-coverage-map: name which ci.sh stage proves which backend

**Status:** todo — ratified by the user (2026-07-17, chat).
**Reserved:** 2026-07-17
**Slug:** ci-serving-mode-coverage-map
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」.
**Relates to:** REQ-0221 (done — built the [6.6] harness), REQ-0178/0176 (the registry-first
authority path), REQ-0182b (the 409 guard), REQ-0231 (cross-session hygiene).

## Why

ci.sh runs in two serving modes and nothing says so. `STORAGE_BACKEND=files` (the [7/7] fleet,
[4/7]) has NO registry at all — `computeRegistryData` is pg-only — so every registry-first path is
unreachable there. `STORAGE_BACKEND=pg` ([5/7], [5.355], [5.36], [5.37], [6.5], [6.6]) seeds an
adopted def and exercises it. Which stage is which is discoverable only by reading
`e2e_fleet.cjs`, `content_serving_test.cjs` and `content_admin_e2e.sh` together and noticing what
each sets.

That omission has now cost three times, the same way each time:

1. **REQ-0221 was filed on a false premise** — "under CI the registry is ALWAYS EMPTY and every
   registry-first code path is unreachable" — true of the fleet, false of ci.sh, which already ran
   [5.36], [5.37] and [6.5].
2. **A second agent re-derived the same false conclusion** from the same tree, rescoped REQ-0221 to
   a "route-level gap" that was also already covered ([6.5] `contentadmin.spec.ts:884`, and it has
   never skipped), and proposed building infrastructure that existed.
3. **A third duplicated merged work** — re-implementing REQ-0221 hours after it went `done`
   (`bc6c012`, live-verified), because the tree gave no way to see what was already proven.

A misread this reproducible is not three careless readers; it is a missing map. Cheap to fix, and
it compounds: [6.5] and [6.6] now BOTH assert the 409, and a fourth reader has no way to know that
a third copy would add nothing.

## What to do

- Add a SERVING-MODE COVERAGE MAP comment block to `tools/ci.sh`: mode (A) files vs (B) pg, which
  stage sits in which, what each proves, and where new registry-first coverage belongs.
- State explicitly that a skip in the files-mode fleet is not automatically a hole (check (B)
  first), since that inference is what produced (1) and (2).
- Record the [6.5]/[6.6] overlap and that it is not a licence for a third copy.
- Pointer comment at the [7/7] fleet stage, where the misreading starts.

## Out of scope
- Changing any gate, harness, port band, or serving semantics. **Comments only, zero behaviour
  change.** In particular this REQ does NOT remove [6.6]; whether that overlap should be
  consolidated is a separate decision with its own ratification.

## Gates
- G1 `bash -n tools/ci.sh` clean; `tools/check_e2e_ports.cjs` green.
- G2 `git diff` touches `tools/ci.sh` comment lines only — no executable line changed.
- G3 The map matches the tree: every stage it names exists, with the mode it claims.

## Outcome
_(to be filled)_
