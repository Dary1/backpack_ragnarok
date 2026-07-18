# REQ-0251 - e2e harnesses: one bringup library, and a port rule that holds

**Reserved:** 2026-07-17
**Slug:** e2e-harness-dedupe

## Problem

Four isolated admin harnesses -- `art_inspect_e2e.sh` (REQ-0152),
`artadmin_e2e.sh` (0156), `content_admin_e2e.sh` (0157) and
`registry_first_e2e.sh` (0221) -- were ~90 lines each and ~85% byte-identical.
The HOME remap, the temp dirs, the cleanup trap, the api + proxy spawn, the
readiness poll and the lock+run tail were copy-pasted four ways. So was the
PROSE: the REQ-0233 family-barrier paragraph and the REQ-0234 (F7) proxy-wiring
paragraph each existed in four copies.

This is not a tidiness complaint. The duplication had already been paid for
twice: REQ-0233 had to add `ART_FAMILY_BARRIER=0` to every copy, and REQ-0234
had to fix the same proxy-wiring bug in every copy. A fix that must be applied
four times eventually gets applied three times.

Three latent defects were found while reading them, none of which had bitten
yet:

1. **The config side of the port rule had rotted unseen.** REQ-0172 made ports
   derive from the REQ number and shipped `check_e2e_ports.cjs` to enforce it --
   but the gate only ever read `tools/*_e2e.sh`. It never read
   `client/e2e/*.config.ts`, and all three admin configs still carried their
   PRE-0172 hand-picked baseURL defaults: 8903 / 8913 / 8923 -- the exact 89xx
   block REQ-0172 was written to abolish. Harmless only because the harness
   always passes `PLAYWRIGHT_BASE_URL`; a hand-run
   `playwright test --config=e2e/artinspect.config.ts` went straight at a dead
   port. A gate that watches one half of a rule watches none of it.

2. **The gate's fleet exemption was waiving the very port it should catch.**
   It skipped `port >= 8810 && port < 8910` -- a 100-port window for a fleet
   that is 8810 plus at most 6 workers. 8903 sits inside that window, so had
   artadmin's stale default ever been in a file the gate read, the gate would
   have green-lit it.

3. **The port rule had a scheduled flake ~3000 REQs out.** `PORT = REQ*10`,
   capped at REQ-6552 "because 6553*10+9 overruns 65535". That bound asks what
   the port NUMBER FIELD allows, never what the KERNEL will let us bind.
   `/proc/sys/net/ipv4/ip_local_port_range` on llmlocal is `32768 60999` -- the
   ephemeral range, which the kernel hands to OUTGOING connections. Every REQ
   from **3277** up derived a decade inside it, and would have bound fine most
   days and then, one run in fifty, lost the race to an unrelated outgoing
   socket and died on EADDRINUSE with nothing to point at.

## Decision (user, 2026-07-18)

- Extract the shared bringup rather than patch the one harness that was asked
  about (`artinspect-kits-pg-mockgpu` = `art_inspect_e2e.sh`); fixing it alone
  leaves the other three clones.
- Port rule becomes **`PORT = 5000 + REQ*10 + index`** (user's proposal, adjusted:
  the literal `5000 + REQ` yields ONE port per REQ, but a REQ needs the whole
  decade -- index 0/1/2 plus the 4-9 fleet slots of REQ-0217).
- Both changes land in this one REQ (user, over the split-REQ recommendation).

## Spec

### `tools/e2e_harness.sh` (new)

Sourced library. A harness declares its REQ, its api env and its config; the
library owns the sequence.

    source "$(dirname "$0")/e2e_harness.sh"
    e2e_harness_req 0152 art_inspect_e2e     # ports, namespace, trap
    e2e_harness_api_env KEY=VAL ...          # repeatable
    e2e_harness_run [--no-skip] --config=e2e/<name>.config.ts

Optional hooks, called if defined: `e2e_h_seed_preboot` (before the api boots --
the registry view is built lazily on first request, so a pre-boot seed needs no
cache-invalidation dance) and `e2e_h_after_ready`. `e2e_harness_node <cmd...>`
runs a tool inside the isolated namespace.

Two behaviours are now library-wide by construction rather than per copy:

- `ART_FAMILY_BARRIER=0` (REQ-0233) for every harness. The barrier restarts
  `comfyui.service`, a live box-global systemd unit; it was the one thing in this
  rig that reached outside the sandbox, so it is off by default now, not by
  remembering.
- The temp HOME is always shaped like a fleet worker's (`w0/home/...`). REQ-0221
  needed that shape for `client/e2e/e2e-env.ts` path construction; the others
  did not care. One shape, not two near-identical ones.

`ALLOW_DEV_CLEAR` is deliberately **not** a library default: it ungates the
destructive clear-all / bump-kit seams (added by REQ-0156 after a live-namespace
wipe incident), so a harness that needs it asks for it. `registry_first` does
not, and no longer receives it -- a small tightening vs. the old code.

### `tools/e2e_ports.sh`

- `PORT = 5000 + REQ*10 + index`. Base 5000 also clears the low registered ports
  (the old rule put REQ-0152's api on **1521**, Oracle's TNS listener).
- Range **REQ-0001 .. REQ-2775**. No lower bound is needed any more (5000 clears
  1024 for every REQ); the ceiling is the ephemeral FLOOR:
  `5000 + 2775*10 + 9 = 32759 < 32768`, whereas 2776 gives 32769 and overlaps.
- **REQ-0380 and REQ-0381 are refused** (exit 64). Their decades contain the
  permanent, NOT REQ-scoped shared services: 8800-8809 holds backpack-web 8801,
  backpack-api 8802 and the e2e proxy 8803; 8810-8819 holds the REQ-0083 fleet.
  Under `REQ*10` these were REQ-0880/0881, ~630 REQs out; the 5000 base pulls
  them to ~130 REQs out, so this is live, not theoretical. A REQ landing there
  does not get to hand-pick a port -- it must move the service or revisit the
  rule.

### `tools/check_e2e_ports.cjs`

- Accepts either derivation route: `e2e_harness_req NNNN` or the direct
  `source .../e2e_ports.sh NNNN`.
- New `CONFIGS` list: each `client/e2e/*.config.ts`'s baseURL DEFAULT must equal
  its REQ's proxy port (index 2).
- Any `client/e2e/*.config.ts` that pins a host:port but is **not** declared is a
  failure -- otherwise a new config would be invisible to the check, which is
  exactly how 8903/8913/8923 survived.
- Fleet exemption narrowed from `8810..8909` to the 8810 decade, matching the
  REQ-0381 poisoned decade.

### Port migration

| harness | REQ | old | new |
|---|---|---|---|
| art_inspect | 0152 | 1520/1521/1522 | 6520/6521/**6522** |
| artadmin | 0156 | 1560/1561/1562 | 6560/6561/**6562** |
| content_admin | 0157 | 1570/1571/1572 | 6570/6571/**6572** |
| registry_first | 0221 | 2210/2211/2212 | 7210/7211/**7212** |

Config baseURL defaults: 8913 -> 6522, 8903 -> 6562, 8923 -> 6572, 2212 -> 7212.

### Incidental

`content_admin_e2e.sh` said "REQ-0155" in its header while sourcing ports for
0157 and logging to `req0155_*`. 0157 is what the port gate declares and what
the lock used; 0157 is now the single answer throughout.

## Gates

- G1: `bash -n` on the library + all four harnesses.
- G2: `check_e2e_ports.cjs` green, AND proven to FAIL on each defect it now
  covers (negative tests, below). A gate is only worth its green if its red is
  demonstrated.
- G3: all four harnesses run end-to-end and match their pre-refactor result.
- G4: `tools/ci.sh` green.

## Log

- 2026-07-18: implemented as commit 23a2325.

### G1 -- shell syntax
`bash -n` clean on the library and all four harnesses.

### G2 -- port gate, proven RED before green
`check_e2e_ports.cjs` reports `4 harnesses + 4 configs ... no collisions`. A green
gate proves nothing on its own, so each defect it now covers was reintroduced and
the gate confirmed to FAIL, then restored:

| negative test | result |
|---|---|
| put 8913 back in artinspect.config.ts | caught (baseURL default vs decade) |
| add an undeclared `sneaky.config.ts` pinning 127.0.0.1:9999 | caught |
| type `APIPORT=8902` into a harness | **initially PASSED -- see below** |
| `FOOPORT=8810` (a genuine fleet port) | still allowed, as intended |

The third test is why this section exists. `APIPORT=8902` sailed through the
first version of the gate: 8902 fell inside the old `>= 8810 && < 8910` fleet
exemption -- a 100-port window for a fleet of 8810 plus at most 6 workers. That
slack also covers **8903**, artadmin's stale default, so the gate would have
green-lit the very hand-picked port it exists to forbid. Narrowed to the 8810
decade; the test then caught it. The green run had hidden a hole that only the
red run could show.

### G3 -- all four harnesses, end to end

| harness | REQ | api port (derived) | result |
|---|---|---|---|
| artadmin | 0156 | 6561 | **7 passed** |
| content_admin | 0157 | 6571 | **28 passed** |
| registry_first | 0221 | 7211 | **4 passed** |
| art_inspect | 0152 | 6521 | **1 passed** (3/3 runs) |

39 specs. The behaviour that had to survive extraction did:
artadmin's cancel spec still observes a pending job (so `ART_MOCK_DELAY_MS=1500`
survived), content_admin's sprite backfill seeded 19 artworks via the new
`e2e_h_after_ready` hook, and registry_first reported `registry serves 1 item(s)`
via `e2e_h_seed_preboot` with the `--no-skip` guard armed and not tripping.

### A pre-existing flake found while verifying (NOT caused by this REQ)

art_inspect failed twice on first run, at `artinspect.spec.ts:56 page.reload()`,
`TimeoutError: waiting for navigation until "load"`. The pre-refactor code was
restored in the same worktree and run again: it failed **identically**, which is
what established the refactor as behaviour-preserving rather than the cause.
Pristine code then passed 3/3 (24.7 / 19.0 / 18.9 s). So: flaky, not broken.

The mechanism is worth recording, because it contradicts a stated contract.
`web/app/index.html` carries a render-blocking external stylesheet:

    <link href="https://fonts.googleapis.com/css2?family=Cinzel..." rel="stylesheet" />

A `<link rel=stylesheet>` blocks the `load` event until it resolves, so **every
`page.goto`/`page.reload` in the suite waits on fonts.googleapis.com** -- the
public internet -- before `load` fires. REQ-0217 says an e2e run is hermetic;
this is a hole in that. From llmlocal the fetch is ~80-120 ms, so it passes
almost always, which is exactly why it presents as a rare flake rather than a
failure. `artinspect` is the only spec in the suite that waits for `load` twice
(`goto` **and** `reload` -- `page.reload` appears nowhere else), so it has double
the exposure and is where the flake surfaces first.

Ruled out along the way, each by evidence rather than reasoning: the proxy's
keep-alive handling (two `/app/` requests on one connection: 200 in 4 ms and
1 ms); socket-pool exhaustion (0 requests in flight at the moment of reload);
and `E2E_FLEET_ROOT`, newly set for all four harnesses by the library
(`artinspect.spec.ts` does not import `e2e-env.ts`).

Not fixed here -- it is a different REQ, in a file this one does not touch, and
folding an app-shell change into a harness refactor would muddy both. Worth
raising: self-host the two font files, or have the local proxy serve
`fonts.googleapis.com` a stub, and the whole suite gets faster and actually
hermetic.

### Also observed

The committed `web/app` bundle is STALE with respect to `client/src`: a plain
`pnpm run build` in a clean worktree produces different asset hashes
(`index-BteqOqyq.js` -> `index-BzidCTP-.js`) and rewrites `index.html`. Since
`web/` is tracked and is what the harnesses serve, the gates test a bundle that
is not the one the current source builds. Flagged, not touched.

### G4 -- ci.sh: RED, at a step this branch cannot reach

`tools/ci.sh` fails at **[5.1/7] server artwork registry tests**:
`artwork_test: 7 passed, 4 failed`, both failures `render seed 1 did not finish
in time`, preceded by `[art_jobs] inspection ... failed: No module named 'numpy'`.

This is environmental and pre-existing, not a regression:

- REQ-0251 changes 7 files under `tools/` and 4 under `client/e2e/`. It touches
  **no `server/` file and not `ci.sh`** (`git diff master --name-only`). Step
  [5.1] is `STORAGE_BACKEND=pg node server/tests/artwork_test.cjs` -- it reads
  nothing this branch modifies, so its result is identical on master by
  construction.
- Two independent env gaps feed it. (a) [5.1] runs with **no `ART_ROUTE_MOCK`**,
  so it drives a REAL render through ComfyUI on :8188 -- which is the user's
  manually-run art session (`comfyui.service` is `inactive`; PROJECT.md marks the
  art stack HANDS OFF), so the render times out. (b) It also sets no
  `ART_KIT_PYTHON`, so the kits spawn the system python, which has no numpy --
  note that [5.16] on the very next line DOES default it to
  `$HOME/backpack_ragnarok/.venv/bin/python`. [5.1] is missing that default.

Not fixed here: (a) needs the user's GPU stack, which this REQ must not touch,
and (b) is a one-line ci.sh change that belongs to whoever owns [5.1]. Both are
worth their own REQ. **G1-G3 -- every gate that is actually about this branch --
are green.**

---

# Consolidation audit — 2026-07-18

Appended by the e2e structure-review session, at the user's direction ("全体を見て
整理してほしい"). This section is written by an auditor, NOT by the session that
implemented this REQ; every claim below was re-run independently rather than read
off the sections above.

## Finding: REQ-0248 is the SAME refactor, built independently and in parallel

`req-0248-e2e-harness-rig-dedupe` extracted `tools/e2e_harness_lib.sh` (215 lines)
from the same four harnesses, with the same motivating evidence (the REQ-0233
`ART_FAMILY_BARRIER` and REQ-0234 F7 proxy paragraphs pasted 4x), reaching
`built/` with its own green gates on the same day. Neither session knew of the
other; the REQ board cannot show it, because a REQ's status is its folder and each
worktree only sees its own branch. Two sessions therefore paid for one refactor
twice.

Measured, not assumed:

| test | result |
|---|---|
| `git merge` 0250 -> 0247 -> 0252 -> **0251** onto master | **all clean** |
| `git merge` **0248** onto that stack | **CONFLICT** in all 4 harness `.sh` files |
| scope | 0251 ⊃ 0248: 0251 touches the same 4 harnesses **plus** `check_e2e_ports.cjs`, `e2e_ports.sh` and 4 configs |

## Decision: REQ-0251 owns the harness dedupe; REQ-0248's number is BURNED

Rationale — 0251 is a strict superset and the stronger body of work. It fixes the
port gate (config scanning + the fleet-exemption hole), it proved its gate RED
before green, and it composes cleanly with every other in-flight e2e REQ. Keeping
0248 instead would mean re-deriving the gate work and re-testing it.

This is not a quality judgement against REQ-0248, which is a good REQ. It is a
duplicate, and duplicates are resolved by scope, not by merit.

Per PROJECT.md numbering policy an abandoned reservation permanently burns its
number: **0248 is a gap by design, never to be reused.** Its branch is NOT deleted
here — retiring a branch needs fresh user go-ahead (the REQ-0231 precedent), and
its 215-line library is worth reading before it goes.

## Carried over from REQ-0248 — findings that must not die with its branch

**1. Folding ci.sh `[6.6]` into `[6.5]` was investigated and REJECTED on evidence.**
The two stages cannot share a namespace. `contentadmin.spec.ts` opens EVERY test
with `POST /api/content/dev/clear-all` -> `clearAllContent()` ->
`DELETE FROM content_defs WHERE system_name LIKE ns:%`
(`server/storage_content.cjs:401`). `registry.config.ts` requires the single
adopted def seeded by `tools/seed_registry_e2e.cjs` to stay alive for the whole
run and fails hard if the registry serves 0. Run in one namespace, the first
contentadmin test destroys the registry seed. Folding them would mean two HOME
remaps and two sequential playwright runs inside one file — the same two harnesses
concatenated, no dedupe won, and two independent gates newly coupled into one
pass/fail. **ci.sh's [6.5]/[6.6] split stands, and this is the evidence for it.**

**2. The library is where REQ-0242's fix now lands.** REQ-0242
(`e2e-harness-decade-contention`, `draft/`) is that a harness binds its decade
BEFORE it takes its lock, so a second session on the same harness dies at the
preflight (exit 75) instead of queueing. With the rig extracted, moving the lock
acquisition ahead of the namespace/api bringup is a change to ONE function instead
of four copies. That leverage is this REQ's real payoff for REQ-0242, and REQ-0242
should be re-read with this in mind before it is scheduled.

## Independent verification of this REQ's own claims

Re-run by the auditor on a clean merge of master + 0250 + 0247 + 0252 + 0251:

| check | result |
|---|---|
| `bash -n` on `e2e_harness.sh` + `e2e_ports.sh` + all 4 harnesses | clean |
| `node tools/check_e2e_ports.cjs` | `4 harnesses + 4 configs ... no collisions`, exit 0 |
| negative: plant `8903` into `artadmin.config.ts` | **caught** (exit 1, names REQ-0156 owns 6560-6569) |
| negative: undeclared `sneaky.config.ts` pinning `:9999` | **caught** (exit 1, "checked by nothing") |
| negative: `8902` (the old `8810..8909` exemption hole) | **caught** (exit 1) |
| `e2e_ports.sh` boundaries: 0380 / 0381 / 2776 / 3000 | all **exit 64**, as specified |
| `e2e_ports.sh` 2775 | OK, 32750/32751/32752 — below the 32768 ephemeral floor |

The gate has teeth. The G2 negative-test discipline in this REQ is the reason the
fleet-exemption hole was found at all, and it held up under re-test.

## OPEN — the 5000 base is challenged by its own arithmetic

The **ephemeral-range finding is correct and valuable**: `/proc/sys/net/ipv4/
ip_local_port_range` is `32768 60999`, and the old cap of REQ-6552 did schedule a
rare EADDRINUSE flake for any REQ from 3277 up. That defect is real and must be
fixed.

But the **remedy** — moving the base to 5000 — is a net loss on every axis this
project can measure. Computed independently:

| | old rule `REQ*10+i` | this REQ `5000+REQ*10+i` |
|---|---|---|
| highest ephemeral-safe REQ | **3275** | 2775 |
| usable span | **3173 REQs** (0103..3275) | 2775 REQs (0001..2775) |
| distance from counter (0253) to the poisoned 8800-8809 decade | **627 REQs** | **127 REQs** |

The 5000 base buys exactly two things. (i) REQ-0001..0102 become derivable — worth
**nothing**: the allocator is monotonic and sits at 0253, so those numbers can
never be issued again. (ii) It dodges 1521/Oracle-TNS — real, but nothing on
llmlocal binds 1521, and 6520 is no less "registered" than 1520.

Against that it costs ~400 REQs of span and pulls the shared-services collision
**5x closer** — from 627 REQs out to 127, which this REQ itself concedes is "live,
not theoretical". At the observed burn rate (11 REQs on 2026-07-18 alone) the
counter reaches 0380 in weeks, not years.

**The minimal fix for the actual defect is one number:** keep `PORT = REQ*10 + i`
and change the cap from `6552` to `3275`. Zero migration, zero port churn, no
`8800` proximity change, and PROJECT.md needs a two-character edit ("0103-6552" ->
"0103-3275") instead of a rule rewrite.

This is NOT actioned here. The 5000 base was an explicit user decision (recorded
above), it is correctly implemented, and it is loudly guarded (exit 64 at both
boundaries) — it is suboptimal, not broken. And the rule's canonical text lives in
PROJECT.md, which is user-owned and which no agent may edit, so this returns to the
user either way. Recorded so the choice is made on the numbers.

## Status note

This REQ is `built/`, not merged. Nothing above changes that. The audit's
recommended merge order and the decisions that remain with the user are reported
in the session that appended this section.
