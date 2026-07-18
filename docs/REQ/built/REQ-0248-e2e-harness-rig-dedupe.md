# REQ-0248 - e2e harness rig dedupe

**Slug:** e2e-harness-rig-dedupe
**Opened:** 2026-07-18
**Origin:** user request -- "refactor the registry-first-serving-pg-seeded e2e"
(= `tools/registry_first_e2e.sh`, ci.sh stage `[6.6/8]`, REQ-0221).

## Problem

`tools/registry_first_e2e.sh` is the newest of FOUR isolated-pg e2e harnesses
that are copy-descendants of one another:

| harness | REQ | decade | lines (before) |
|---|---|---|---|
| `tools/art_inspect_e2e.sh` | 0152 | 1520-1529 | 90 |
| `tools/artadmin_e2e.sh` | 0156 | 1560-1569 | 93 |
| `tools/content_admin_e2e.sh` | 0157 | 1570-1579 | 93 |
| `tools/registry_first_e2e.sh` | 0221 | 2210-2219 | 93 |

Each carried its OWN byte-identical copy of the same rig: the `mktemp` +
HOME-remap that buys the isolated pg namespace, the `PIDS`/`trap` cleanup, the
api bringup, the local-proxy bringup, two `curl` readiness loops, and the
`e2e_run.sh` invocation with its lock. That is ~60 lines of rig wrapped around
~10 lines of real difference, x4.

**This shape has already cost us.** A fix to the rig had to be applied four
times or not at all, and the copies visibly drifted:

- REQ-0234's F7 fix (`E2E_FLEET_BASE_PORT` -- without it `/api` fell through to
  the default fleet base 8810 and every spec died on 502) is pasted into all
  four, with the same 8-line comment repeated verbatim each time.
- REQ-0233's `ART_FAMILY_BARRIER=0` (stop a hermetic harness restarting the LIVE
  `comfyui.service`) is pasted into three, with the same 6-line comment. It is
  absent from `registry_first_e2e.sh` -- correct today only because that harness
  happens not to touch art.
- The serialization-lock filenames drifted: `e2e.0152.lock`, `e2e.0156.lock`,
  `e2e.0157.lock` -- but `e2e.req0221.lock`.
- `content_admin_e2e.sh` (REQ-0157) writes its logs to `/tmp/req0155_*` -- a
  leftover of the REQ it was copied from.

The drift is the point: the one line that is NOT pasted uniformly is exactly
where the next bug lives.

## Decision

Write the rig ONCE (`tools/e2e_harness_lib.sh`); a harness declares only its
differences. Each harness keeps its own `source .../e2e_ports.sh 0NNN` line, so
the REQ-0172 gate (`tools/check_e2e_ports.cjs`, ci.sh `[0/8]`) still reads the
claimed REQ out of the harness itself rather than through an argument, and the
decade a harness owns stays visible on sight.

### `tools/e2e_harness_lib.sh` API

| function | purpose |
|---|---|
| `e2e_harness_init <name>` | names the harness, enforces `DATABASE_URL`, arms the cleanup trap |
| `e2e_harness_mktemp <var>` | `mktemp -d` remembered for the EXIT trap (no hand-written `rm -rf`) |
| `e2e_harness_home [--fleet]` | the isolation primitive: throwaway HOME symlinked back to the worktree |
| `e2e_harness_start_api [K=V]...` | boots this worktree's api on `$APIPORT` in that namespace |
| `e2e_harness_start_proxy` | boots the REQ-0217 local proxy, fleet base pointed at this api |
| `e2e_harness_wait` | bounded readiness wait for api then proxy |
| `e2e_harness_node <log> [K=V]... -- <args>` | a seed/backfill inside the same namespace |
| `e2e_harness_api_json <path> <expr>` | assert a harness precondition off its own api |
| `e2e_harness_run <config> [--forbid-skip]` | `e2e_run.sh` under this harness's own REQ lock |

Two rig facts are now structural rather than remembered:

- `ART_FAMILY_BARRIER=0` is the DEFAULT for every harness (REQ-0233 applies to
  all of them by the hermeticity rule, not by whether anyone pasted it). A
  harness that wants the barrier passes `ART_FAMILY_BARRIER=1` -- later `K=V`
  args win.
- `--forbid-skip` (REQ-0221's "a SKIP is the failure mode, and playwright
  reports it as success") is a rig capability any harness can claim, not a
  bespoke `grep` at the bottom of one file.

### Result

| file | before | after |
|---|---|---|
| `tools/art_inspect_e2e.sh` | 90 | 37 |
| `tools/artadmin_e2e.sh` | 93 | 39 |
| `tools/content_admin_e2e.sh` | 93 | 41 |
| `tools/registry_first_e2e.sh` | 93 | 52 |
| `tools/e2e_harness_lib.sh` | -- | 215 |
| **total** | **369** | **384** |

Total lines are flat; that is expected and is not the goal. What changed is
that the rig exists in ONE place (the 215 lines are ~60 lines of code and ~150
of the WHY that was previously duplicated 4x), and each harness is now readable
as "what makes this one different" -- which is what a reader of
`registry_first_e2e.sh` actually wants to know.

### Behaviour changes (deliberate, all cosmetic)

- Lock file `e2e.req0221.lock` -> `e2e.0221.lock` (uniform with the other three).
- `content_admin_e2e.sh` logs `/tmp/req0155_*` -> `/tmp/req0157_*` (its own REQ).
  No caller referenced the old paths (grepped: they appear only in the harnesses).
- The throwaway HOME gains a `home/` component (`$tmp/home/backpack_ragnarok`).
  Irrelevant to isolation: the namespace is `sha256($HOME/backpack_ragnarok)`
  over the literal path (`server/storage_content.cjs:28`), and `mktemp -d`
  already makes that unique per run.
- `registry_first_e2e.sh`'s seed output now goes to a log file rather than
  stdout, and is echoed as one summary line (matching `content_admin_e2e.sh`).

## NOT done: folding [6.6] into [6.5]

The third option on the table was to retire `registry_first_e2e.sh` and move its
coverage into `content_admin_e2e.sh` ([6.5]), on the strength of ci.sh's own note
that both stages assert the REQ-0182b 409 and that the 2026-07-17 injection test
showed [6.5] catches the drift even with [6.6] removed.

**Rejected -- the two cannot share a namespace.** `contentadmin.spec.ts` opens
EVERY test with `await request.post('/api/content/dev/clear-all')`, which is
`clearAllContent()` -> `DELETE FROM content_defs WHERE system_name LIKE ns:%`
(`server/storage_content.cjs:401`). `registry.config.ts` requires the single
adopted def seeded by `tools/seed_registry_e2e.cjs` to stay alive for the whole
run and fails hard if the registry serves 0. Run in one namespace, the first
contentadmin test destroys the registry seed. Merging them would therefore mean
two HOME remaps and two sequential playwright runs inside one file -- i.e. the
same two harnesses concatenated, with no dedupe won and two independent gates
newly coupled into one pass/fail.

The dedupe those stages needed is what this REQ actually delivers: with the rig
extracted, a harness costs ~10 lines of declaration, so "too many harnesses" is
no longer a reason to collapse two that prove different things. ci.sh's stated
split stands -- [6.5] proves the assertion, [6.6] proves the fleet-shaped spec
does not skip.

## Gates

Run 2026-07-18 from `req-0248-e2e-harness-rig-dedupe`, all against pg with
`server/.env` sourced.

| gate | result |
|---|---|
| `[0/8]` `tools/check_e2e_ports.cjs` | PASS -- "4 harnesses, all ports derived from their REQ number, no collisions" |
| `[6.6/8]` `tools/registry_first_e2e.sh` | PASS -- registry serves 1 item; 4 passed, **0 skipped** (incl. `dex-admin.spec.ts:102` REQ-0182b 409) |
| `[6.5/8]` `tools/content_admin_e2e.sh` | PASS -- backfill seeded 19 renders; 28 passed |
| `tools/artadmin_e2e.sh` | PASS -- 7 passed |
| `tools/art_inspect_e2e.sh` | PASS -- 1 passed |

`bash -n` clean on all five files. The REQ-0221 no-skip contract is preserved
end to end: the harness still refuses to proceed on a registry count of 0
(asserted via `e2e_harness_api_json`) and still turns a SKIP into a hard
failure (now via `e2e_harness_run --forbid-skip`).

### Flake note -- first pass, since reproduced clean

The first `artadmin`/`art_inspect` pass failed one test each, both on a
navigation timeout (`page.goto`/`page.reload`, "waiting until load"). Both
re-ran clean on an idle box (artadmin 1 failed -> 7 passed; art_inspect 1
failed -> 1 passed), and `master`'s pre-refactor `artadmin_e2e.sh` was run as a
control in the same worktree (`git stash push tools/`) and passed 7/7. Not a
regression from this REQ -- it is REQ-0222's known goto-under-load flake class.

**What was loading the box: another worktree running e2e concurrently.**
`req-0247-e2e-suite-slimming` had four `server/api.cjs` processes plus a
local-proxy and a playwright run live during the first pass. Worth flagging
beyond this REQ:

- The REQ-0172 derived-port rule makes two *harnesses* collision-proof, but
  gives no isolation between two *worktrees* running the SAME harness -- both
  resolve `artadmin_e2e.sh` to decade 1560-1569. The control run hit exactly
  this: `art_inspect_e2e.sh` aborted with the preflight's exit 75 while the
  previous run's ports were still held.
- The per-REQ lock (`$HOME/.cache/backpack/e2e.NNNN.lock`) is box-global and
  does serialize them -- but it is taken in `e2e_harness_run`, i.e. AFTER the
  ports are preflighted and the api/proxy are bound. So the loser of a race
  dies on preflight instead of queueing.
- That is REQ-0242 (`e2e-harness-decade-contention`) territory, not this REQ's.
  Noted here because the lib is now the one place a fix would land: moving the
  lock acquisition ahead of `e2e_harness_home`/`start_api` is a change to one
  function, which is precisely the leverage the extraction buys.

## Outcome

Implemented. `tools/e2e_harness_lib.sh` holds the rig; the four harnesses
declare only their differences (369 -> 384 total lines, but the rig went 4x ->
1x and each harness is now ~10 lines of real content). All gates green. The
[6.6]-into-[6.5] fold was investigated and rejected on evidence -- see above.

Not merged; awaiting user acceptance.

---

# SUPERSEDED — do not merge (2026-07-18)

Recorded by the e2e consolidation audit, at the user's direction.

**This REQ is a duplicate of REQ-0251 (`req-0251-e2e-harness-dedupe`), which was
built independently and in parallel on the same day, from the same evidence, on
the same four files. Neither session knew of the other.**

REQ-0251 is a strict superset: it extracts the same rig (as
`tools/e2e_harness.sh`) AND fixes `tools/check_e2e_ports.cjs` (which had never
read `client/e2e/*.config.ts`, so the pre-REQ-0172 defaults 8903/8913/8923 had
survived) AND closes a hole in the gate's own fleet exemption. Merging both is
impossible: `git merge` conflicts in all four harness `.sh` files.

Resolution: **REQ-0251 owns the harness dedupe. REQ-0248's number is burned** —
per PROJECT.md, an abandoned reservation permanently burns its number, and 0248 is
a gap by design, never to be reused.

Nothing here reflects on the quality of this REQ. It is a good REQ; it is simply
the second one. Duplicates are resolved by scope, not by merit.

**Two findings unique to this REQ were carried into REQ-0251 before it was
retired, and are preserved there:**

1. The evidence REJECTING the fold of ci.sh `[6.6]` into `[6.5]` — the namespace
   conflict between `contentadmin.spec.ts`'s per-test `dev/clear-all` and
   `registry_first`'s seeded adopted def.
2. The observation that the extracted library is now the single place REQ-0242's
   lock-ordering fix would land.

This branch is retained, not deleted: retiring a branch needs fresh user
go-ahead, and `tools/e2e_harness_lib.sh` is worth reading before it goes.
