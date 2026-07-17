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

Shipped `b69de2b` -- the SERVING-MODE COVERAGE MAP comment block in `tools/ci.sh`, plus a pointer
at the `[7/7]` fleet stage. Spec: `5a07547`.

### Gate results
- **G1** `bash -n tools/ci.sh` clean. `check_e2e_ports.cjs`: 4 harnesses, all derived, no collisions.
- **G2** Comments only, proven mechanically: every added line matches `^\s*#`; nothing removed
  (pure insertion); and the non-comment content of ci.sh is **md5-identical to master**
  (`6cf691c958f8069f7589bd426084ff53`). Zero behaviour change.
- **G3** Every stage the map names verified present in the mode claimed: `[4/7] [5/7] [5.355]
  [5.36] [5.37] [6.5/8] [6.6/8] [7/7]` all exist; `e2e_fleet.cjs` confirmed
  `STORAGE_BACKEND:'files'` + `DATABASE_URL:''`; `content_admin_e2e.sh` and `registry_first_e2e.sh`
  confirmed `STORAGE_BACKEND=pg`; `contentadmin.spec.ts:884` present and unconditional (0
  `test.skip`); `registry.config.ts` confirmed to run `dex-admin.spec.ts`; `registry_first_e2e.sh`
  confirmed to fail on skip.

### The [6.5]/[6.6] overlap — measured, not asserted
Recorded in the block itself. Injecting `if (false && servedKind)` into `server/routes/admin.cjs`
(the regression REQ-0221 named) took the `[6.5]` contentadmin harness from **28 passed** to
**1 failed at contentadmin.spec.ts:884**, and the broken run wrote `content/live/live_items.json`
behind the ledger (`"Longsword Blade"` -> `"must not apply -- registry-served"`) — the exact drift
REQ-0182b guards. Measured on 2026-07-17 before `[6.6]` existed on this tree. So a re-enabled
legacy PUT is caught by ci.sh **even with `[6.6]` removed**.

This is evidence, not a recommendation: `[6.6]` also proves the fleet-shaped spec does not skip,
which `[6.5]` does not. Consolidating the overlap is deliberately **out of scope** here and needs
its own ratification.

### Why this REQ exists at all
Three agents, one tree, one false conclusion, in sequence — the third duplicating work that had
already merged and gone live (`bc6c012`). None of them were careless; the tree simply gave no way
to see what was already proven. That is a documentation defect, and this is its fix.

## Deploy record (2026-07-17)
- Merged to master **`56ccc51`** (`--no-ff`, user go-ahead in chat: "marge and deploy").
- **No runtime paths touched** (`docs/` + `tools/` only) -> no service restart, no dist rebuild
  (same category as REQ-0221's deploy). Post-merge health: backpack-web 8801 = 200,
  backpack-api 8802 = 200, tunnel https://backpack-dev.qtie.jp/app/ = 200.
- Post-merge on master: `bash -n tools/ci.sh` clean; `check_e2e_ports` green (4 harnesses).
- **Full ci.sh deliberately NOT re-run, and this is the gate, not a shortcut:** the change is
  comments-only and the non-comment content of `tools/ci.sh` is md5-identical to master
  (`84cda97cf08d463f2203dee4bdb66acb`) before and after the merge, so ci.sh cannot observe it.
  A run would have re-validated master's own logic, not this change -- while the box was
  saturated by other sessions' ci runs (load peaked **18.42**, above the 13.7 that forced today's
  reboot, per REQ-0231). A `test:quick` was queued for ~45min and never got the lock; it was
  abandoned as redundant against the md5 proof.
- Rebased onto master pre-merge; G2/G3 re-verified against the NEW base afterwards (master's
  ci.sh had changed under the branch), so the map's claims match the tree as merged.

### Reserved-number note — REQ-0237 burned by this session
The first `touch_next_req_reserved.py` call appeared to fail (ssh timeout) but had in fact
succeeded server-side, allocating **0237** and committing its stub; the retry took **0238**.
Per PROJECT.md burned numbers are normal and never reused: `~/backpack_ragnarok_state/req/issued/0237`
remains, so 0237 can never be re-handed-out. The orphan stub -- a duplicate carrying this REQ's
exact slug -- was dropped from the branch rather than merged, leaving a clean gap instead of a
confusing second file. Cause worth noting for the next session: a timed-out ssh call is NOT
evidence the remote command failed.
