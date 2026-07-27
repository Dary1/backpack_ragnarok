# REQ-0309 — Move `mock-src/engine.js` to `shared/engine.js`

- **State**: built
- **Program**: LLM Test-Play Fleet, track "整理整頓" (step 1 of 2).
  Design: `docs/llm_managed/2026-07-27-llm-testplay-fleet-design.md`.
- **Depends on**: nothing.
- **Blocks**: REQ-0310, and through it REQ-0314 (`bpk` core).
- **Size**: M. Mechanical, wide, zero logic change.

## 1. Why

`shared/README.md` states the charter of `shared/` in one line:

> Rules: modules here may not require() from server/, sim/, client/, or
> mock-src/. Dependencies point INTO shared/, never out of it.

The codebase does the opposite with its single most load-bearing module.
`mock-src/engine.js` — 128 KB, the placement/canvas/link engine, the definition of
what a legal canvas *is* — sits inside a directory named for a throwaway mock, and
**every package requires out of the tree into it**:

| consumer | site |
|---|---|
| server | `server/services/core.cjs:21` `require('../../mock-src/engine.js')` |
| sim | `sim/combat.cjs:47`, and `sim/lib/compile.cjs` through it |
| sim tests | `sim/tests/run.cjs:1642` |
| client | `client/src/engine/adapter.ts:25` `import … '../../../mock-src/engine.js?raw'` |
| client scripts | `client/scripts/check_link_trace.mjs:29` |
| tools | `tools/tool_integrate.cjs:9`, `tools/check_engine_types.cjs:13`, `tools/migrations/req0170_purge_unitless_bps.cjs:37` |
| mock build | `mock-src/build.py:9` (inlines it into `web/mock/index.html`) |
| mock tests | `mock-src/tests/engine.js` (symlink → `../engine.js`) |

The type surface was already promoted (`shared/engine.d.ts`); **only the
implementation was left behind.** That asymmetry is the whole defect. It also
produced a visible workaround: `client/src/engine/adapter.ts` loads the file with
Vite's `?raw` and executes it through a `new Function` CJS shim, and its own header
comment explains this exists because the module is a hand-written UMD living
outside any package boundary.

Immediate motivation: REQ-0314 (`bpk`, the headless player) must `require` this
engine to produce canvases that satisfy `checkUidInvariant`. A fourth package
reaching into `mock-src/` would ratify the mistake permanently.

## 2. Scope — exactly this, nothing else

**Move one file.** `git mv mock-src/engine.js shared/engine.js`, contents
**byte-identical**, and repoint every load site and every path reference.

### 2.1 Load sites to repoint (the complete list)

```
server/services/core.cjs:21              require('../../mock-src/engine.js')  -> '../../shared/engine.js'
sim/combat.cjs:47                        path.join(__dirname,'..','mock-src','engine.js') -> '..','shared','engine.js'
sim/tests/run.cjs:1642                   same shape
client/src/engine/adapter.ts:25          '../../../mock-src/engine.js?raw'    -> '../../../shared/engine.js?raw'
client/scripts/check_link_trace.mjs:29   path.resolve(CLIENT_ROOT,'..','mock-src','engine.js') -> '..','shared','engine.js'
tools/tool_integrate.cjs:9               require('../mock-src/engine.js')     -> '../shared/engine.js'
tools/check_engine_types.cjs:13          path.join(__dirname,'..','mock-src','engine.js') -> '..','shared','engine.js'
tools/migrations/req0170_purge_unitless_bps.cjs:37  require('../../mock-src/engine.js') -> '../../shared/engine.js'
mock-src/build.py:9                      open(os.path.join(d,'engine.js'))    -> os.path.join(d,'..','shared','engine.js')
mock-src/tests/engine.js                 symlink ../engine.js                 -> ../../shared/engine.js
```

`sim/tests/run.cjs:1643` also requires `mock-src/data.js` — **leave it.** `data.js`
is baked mock scenario content produced by `tools/tool_gen_data.cjs`; it is
genuinely mock material and belongs where it is. Only the engine moves.

### 2.2 Comment/doc references

~40 further sites name the file in prose (`server/services/*.cjs`,
`client/src/board/*`, `shared/engine.d.ts`, `shared/dto.ts`, `shared/forecast.mjs`,
`sim/README.md`, `server/README.md`, e2e specs, …). **Update them all** in the same
commit, mechanically (`mock-src/engine.js` → `shared/engine.js`).

Rationale, and it is not cosmetic: this codebase treats comments as the
specification (`route_auth.cjs`, `rooms.cjs`, `pacing.cjs` all carry their rules in
prose), and REQ-0251's own postmortem is precisely about a rule rotting in the half
nobody watched. A stale path in a comment here would be that same failure in
miniature. Two files must be updated by hand rather than by `sed`, because their
prose asserts the rule itself:

- `shared/README.md` — add `engine.js` to the module list; the "may not require out
  of shared/" charter is now *satisfied*, not merely aspirational (engine.js is
  verified dependency-free: it contains no `require(` and no `import` at all).
- `client/src/engine/adapter.ts` — its header explains the `?raw` shim in terms of
  `mock-src`; reword to `shared/`. **Do not change the shim mechanism** (see §3).

### 2.3 CI

`tools/ci.sh:128` step label `[3/7] mock-src engine tests` → `[3/7] shared engine
tests`. The command (`node mock-src/tests/run.cjs`) is unchanged.

## 3. Explicit non-goals — do not do these

1. **No content change to `engine.js`.** Not a comment, not a whitespace byte. See
   the §5 blob-hash gate. `sim/README.md` and `adapter.ts` both record a standing
   invariant that the engine is "consumed AS-IS, never forked"; a rename must not
   be the moment that slips.
2. **Do not move `mock-src/tests/run.cjs`.** The engine's 129 KB test suite stays
   put and reaches the engine through the retargeted symlink. Relocating it would
   double the diff and add path-assumption risk for zero benefit to the program.
   *[ORCH default, vetoable]* — a follow-up may move it to `shared/tests/`.
3. **Do not de-UMD the module** or convert it to ESM, and do not remove the
   client's `?raw` shim. That is a real cleanup, but it changes runtime behaviour
   in the browser bundle and belongs in its own REQ with its own e2e evidence.
4. **Do not move `mock-src/data.js`, `ui.js`, `index.template.html`.**
5. **Do not touch `shared/engine.d.ts` semantics.** (Observed in passing, recorded
   here and NOT fixed: both `shared/engine.d.ts` and `client/src/engine/engine.d.ts`
   exist, and `engine.js`'s own header names the client one as the typed surface
   while `tools/check_engine_types.cjs` is the arbiter. Worth a future REQ; out of
   scope here.)

## 4. Method

Per PROJECT.md: work in the worktree `~/backpack_ragnarok_worktrees/req-0309-engine-to-shared`
on branch `req-0309-engine-to-shared`. Never edit through the Cowork mount; compose
patches in the sandbox and `git apply` inside the worktree. Provision deps with
`cd client && pnpm install --frozen-lockfile` (pnpm only; never npm).

Suggested commit shape:
1. `git mv mock-src/engine.js shared/engine.js` + symlink retarget — rename only.
2. Repoint the 9 load sites + `ci.sh` label.
3. Mechanical comment sweep + the two hand-edited files (`shared/README.md`,
   `adapter.ts`).

Keeping (1) a pure rename is what lets `git log --follow` and the blob gate work.

## 5. Gates — all must be green

| # | Gate | How |
|---|---|---|
| G1 | **The moved file is byte-identical** | `git cat-file -p HEAD:shared/engine.js \| sha256sum` equals `git cat-file -p <base>:mock-src/engine.js \| sha256sum`. Base blob is `23efff8c1ba151c320177d15bc53710ed92c9376`; `git rev-parse HEAD:shared/engine.js` must print exactly that. |
| G2 | **No live reference to `mock-src/engine` survives** | `grep -rn "mock-src/engine" --exclude-dir=node_modules --exclude-dir=dist .` returns nothing outside `docs/REQ/` (historical REQ text is history and stays). |
| G3 | **Full CI green** | `tools/ci.sh` — every step, no skips that were not already skipping on base. Named critical steps: `[3/7]` engine tests, `[3.5/7]` typecheck, `[3.6/7]` engine type-surface drift, `[7/7]` e2e fleet. |
| G4 | **Client bundle builds and runs** | `cd client && pnpm build`; the `?raw` import must resolve. Plus the e2e suite in `[7/7]` exercising the board. |
| G5 | **Mock UI still builds** | `python3 mock-src/build.py` writes `web/mock/index.html` and its byte length is unchanged from base (the engine text inlined is identical, so the output must be too). |
| G6 | **`shared/` charter holds** | `grep -nE "require\(\|^import " shared/engine.js` is empty — shared/ still depends on nothing. |

G1 and G5 together are the proof that this REQ changed no behaviour: identical
engine bytes in, identical mock artifact out.

## 6. Risks

- **Widest-possible blast radius, lowest-possible depth.** Every package is
  touched; nothing is altered. The danger is a missed load site failing only at
  runtime in a rarely-run path (`tools/migrations/*`, `check_link_trace.mjs`).
  G2's repo-wide grep is the mitigation and must be run, not assumed.
- **Worktree fan-out.** ~100 other worktrees exist on this host, each pinned to its
  own branch. They keep working (they never see this branch) but WILL conflict on
  rebase past this commit. Unavoidable for any move; noted so it is not a surprise.
  Recommend merging this to master early, while the diff is still trivially
  re-appliable, rather than letting it age.
- **`git mv` + content edit in one commit would defeat G1.** Hence the commit
  split in §4.

## 7. Outcome

**State: built** — every gate green; NOT merged, NOT deployed, no service restarted.
Branch `req-0309-engine-to-shared`, base `c1456a5`. Implemented on the server
worktree only; nothing was ever written through the Cowork mount.

### 7.1 Commits

| hash | what |
|---|---|
| `b47115e` | (1/3) **pure rename** `git mv mock-src/engine.js shared/engine.js` + `mock-src/tests/engine.js` symlink retargeted `../engine.js` -> `../../shared/engine.js`. No load site repointed here, so the tree is deliberately broken between this commit and the next — that is what keeps G1 and `git log --follow` meaningful. |
| `b06ef1b` | (2/3) repoint **ten** load sites (see 7.3) + the `tools/ci.sh:128` step label. |
| `126351f` | (3/3) mechanical prose sweep, 71 occurrences across 42 tracked files, + the two hand-edited files of §2.2. |
| `05e1243` | (4/3) **NOT IN THE SPEC — needs ratification.** Repairs `[3.5/7]` typecheck, which the move broke for a reason §3 did not foresee. See 7.4. |
| *(this commit)* | this Outcome section. |

### 7.2 Gate results — verbatim

**G1 — moved file is byte-identical: PASS**
```
$ git rev-parse HEAD:shared/engine.js
23efff8c1ba151c320177d15bc53710ed92c9376          <- exactly the blob §5 demands
$ git cat-file -p HEAD:shared/engine.js | sha256sum
e422059cf535b4df5913c155dcac49e837abe64e296f3ae3a02b17f023804429  -
$ git cat-file -p c1456a5:mock-src/engine.js | sha256sum
e422059cf535b4df5913c155dcac49e837abe64e296f3ae3a02b17f023804429  -
```
Size 128185 bytes, unchanged. Git recorded commit 1 as a 100% rename
(`{mock-src => shared}/engine.js | 0`).

**G2 — no live `mock-src/engine` reference survives: PASS**
```
$ grep -rn "mock-src/engine" --exclude-dir=node_modules --exclude-dir=dist . | grep -v "^./docs/REQ/"
(no output)
$ ... | grep -vc "^./docs/REQ/"
0
```
Also run with a **broader** pattern than §5 names, because the spec's own grep
shape cannot see segment-form paths (this is how §2.1 lost a load site):
```
$ grep -rn "mock-src., *.engine" --exclude-dir=node_modules --exclude-dir=dist . | grep -v "^./docs/REQ/"
(no output)
```

**G3 — full CI green: PASS**
```
CI GREEN            <- tools/ci.sh on HEAD 05e1243, E2E_PARALLEL=1 (see 7.5)
### CI EXIT=0
### finished: 2026-07-27T10:19:31+00:00
```
Step `[3/7] shared engine tests` (relabelled) — 123 passed, 0 failed.
`[3.5/7]` typecheck — 0 errors. `[3.6/7]` engine type-surface drift —
"engine type surface OK (49 declared members verified against runtime)".
`[7/7]` scoped e2e on the REQ-0309 decade — **203 passed, 1 skipped, 0 failed**.
Admin trio `28 passed`, registry-first `4 passed`.

Two SKIPs appear in the green log; both are BY CONSTRUCTION, not environmental,
and both were verified rather than assumed:
- `SKIP pg moderation tests (no DATABASE_URL)` is emitted by step `[4.72/7]`,
  which ci.sh:196 invokes as `DATABASE_URL= node server/tests/moderation_test.cjs`
  — it clears the variable on purpose to exercise the DB-free mappers. The pg twin
  ran at `[5.46/7]` and passed.
- Playwright's `1 skipped` is `e2e/dex-admin.spec.ts:102:3` (REQ-0182b). `[7/7]`
  is FILES-mode, where the registry is empty by design (ci.sh's own SERVING-MODE
  COVERAGE MAP), so the 409 guard cannot fire. That spec is **byte-identical to
  base** (`git diff c1456a5..HEAD -- client/e2e/dex-admin.spec.ts` is empty), so
  its skip is structural and predates this REQ.

**G4 — client bundle builds and runs: PASS**
`[6/7] client typecheck + build` (`tsc -b && vite build`) green — the `?raw`
import resolves at `../../../shared/engine.js?raw`. `[6.1/7]` Supabase-env
tripwire green. The board is exercised throughout the 203-test e2e suite.
Note: the client build leaves the worktree **clean** (`git status --short` empty),
i.e. the swept comments do not survive bundling into committed `web/app/`.

**G5 — mock UI still builds, byte-identical: PASS**
```
BASE  (c1456a5): sha256 7ffb154977a639bab767c28cfa026876a4527a2eb29d10135535822a1bc68397   239812 bytes
AFTER (HEAD)   : sha256 7ffb154977a639bab767c28cfa026876a4527a2eb29d10135535822a1bc68397   239812 bytes
```
Identical, and `diff` of the two artifacts is empty. **Read §5's wording with
care:** `build.py` prints `236752 bytes`, but that is Python `len()` on a `str`
— a CHARACTER count. The file is 239812 BYTES once UTF-8 encoded. Both numbers
are stable across the move; sha256 is the honest gate and is quoted above.

**G6 — shared/ charter holds: PASS**
```
$ grep -nE "require\(|^import " shared/engine.js
(no output; grep exit=1)
```
`shared/engine.js` depends on nothing. The charter in `shared/README.md` now
states this as fact rather than aspiration.

### 7.3 §2.1's load-site list was incomplete — a tenth site

§2.1 called itself "the complete list". A repo-wide survey found one more:

```
client/scripts/check_placement.mjs:27   require_(path.join(REPO, 'mock-src', 'engine.js'))
```

It is a REAL load site — the REQ-0273 placement gate, run by ci.sh as
`node scripts/check_placement.mjs` — so it would have gone RED in CI, not rotted
quietly. Repointed with the other nine; the step now reports
`check_placement: all green`.

**Why the spec missed it, and it is worth recording:** §2.1 and G2 both search
for the string `mock-src/engine`, which **cannot match**
`path.join(..., 'mock-src', 'engine.js')`. Three of the ten real load sites are
in that segment form. A survey done with that pattern is guaranteed to under-count
exactly the sites that fail latest and loudest. Every grep in 7.2 was therefore
re-run with a segment-aware pattern too.

`sim/tests/run.cjs:1643`'s `require` of `mock-src/data.js` was left alone, per §2.1.

### 7.4 The one thing the spec did not foresee — RATIFICATION NEEDED

§1 reads the move as type-neutral ("the type surface was already promoted;
only the implementation was left behind") and §3 non-goal 5 says not to touch
`shared/engine.d.ts` semantics. **The move alone changes them, without editing
a byte of that file.**

A `.d.ts` always shadows a same-basename `.js` in TypeScript module resolution.
Nothing like that ever sat beside `mock-src/engine.js` (verified: the old
directory contained no `.d.ts` at all), so before the move TS inferred
`core.cjs`'s `Engine` from the UMD factory itself. After it, the same `require`
resolves to `shared/engine.d.ts` — which is a type LIBRARY: it exports
`EngineModule` (the shape of `engine.js`'s `module.exports`) but never declares
that the module IS one. Co-location silently promoted that file into the engine's
declaration file, and `[3.5/7]` went red:

```
server/services/core.cjs(492,17): error TS2339: Property 'create' does not exist
on type 'typeof import(".../shared/engine")'.
```

`05e1243` binds the require to `EngineModule` with a JSDoc cast — erased at
runtime, and checked rather than asserted on faith, since
`tools/check_engine_types.cjs` (`[3.6/7]`) pins all 49 members to the live object.

**Doing so exposed a real latent bug.** `core.cjs`'s `makeEngine` passed
`{po_tags:{}, socket_tags:{}}`; `engine.js`'s `create()` reads
`(trees&&trees.po)||{}` and `(trees&&trees.socket)||{}`. The keys never matched,
so the argument was silently discarded. It is provably a no-op TODAY — both
spellings yield an empty tree, so runtime output is byte-identical and this REQ's
zero-behaviour-change contract holds (G5 proves it) — but it is a live trap the
moment a caller passes real trees, and it typechecked only while the module was
untyped here. Corrected to `{po, socket}`, the shape
`tools/tool_gen_data.cjs:184` has always emitted.

Three resolutions exist; `05e1243` takes **(B)**, and it is isolated in its own
commit so (A) or (C) can be swapped in without disturbing commits 1-3:
- **(A)** Rename `shared/engine.d.ts` so it stops shadowing `engine.js`. Restores
  the pre-move inference exactly, adds no new type enforcement; but renames a
  file non-goal 5 protects, and touches its importers.
- **(B)** *(taken)* Co-location stands; the hand-written surface becomes
  load-bearing on the server for the first time. Most aligned with §1's thesis.
  Costs one call-site literal, provably inert.
- **(C)** Cast the require to `any`. One line, but strictly WORSE than pre-move:
  before, the server had real inferred types on the engine.

**Reported, not fixed:** `tools/check_engine_types.cjs:73` builds its probe
engine with the same wrong `{po_tags, socket_tags}` keys. Equally inert (also
empty), and that file is outside `tsconfig.server.json`'s program so it never
goes red. Left alone to keep `05e1243` minimal.

### 7.5 Pre-existing e2e flakiness, proven at base (NOT caused by this REQ)

The first two full ci.sh runs each failed exactly one e2e test — **a different
one each time**:
- run 1: `auto-save.spec.ts:27` — a synthetic pixel-coordinate mouse drag.
- run 2: `workshop.spec.ts:121` — gacha roll, failing `expect(newBpIds.size).toBe(1)`
  with **received: 2**, i.e. a second roll landed on the shared dev profile.

Both are contention symptoms of the 4-worker default, not engine defects. This was
verified rather than assumed, by running the spec in isolation:

```
HEAD  (commit 4), auto-save.spec.ts x3 : pass, FAIL, pass
BASE  (c1456a5), auto-save.spec.ts x4 : FAIL, FAIL, pass, pass   <- engine still in its old home
```

The base commit — engine untouched, in its original location — flakes on the same
test at a higher rate. The nondeterminism predates REQ-0309.
(The isolated HEAD runs were taken on commit 4's pre-rewrap ancestor `43e944d`;
its code is identical to `05e1243` — the amend rewrapped one comment block and
nothing else, and the final full CI above was run on `05e1243` itself.)

The green run above was therefore taken with `E2E_PARALLEL=1`, a documented
override seam (PROJECT.md; ci.sh uses `${E2E_PARALLEL:-4}`). Serialised, the
suite is deterministic: 203 passed, 0 failed, including both specs above.

**This is a standing defect worth its own REQ.** REQ-0159 forbids a
"remembered red" convention, but ci.sh's default configuration cannot currently
reach literal green reliably on this box: shared dev-profile state across 4
workers makes gacha/auto-save specs race. Either the specs need per-worker
profile isolation (REQ-0214's `x-bpk-e2e-profile` seam already exists), or the
default parallelism should drop. Left untouched here: out of scope, and this REQ
must not become the commit that quietly redefines the gate.

### 7.6 Judgment calls made where the spec was silent

1. **Sweep boundary.** §2.2 + G2 say sweep everything, exclude `docs/REQ/`.
   `docs/user_managed/` was excluded too — PROJECT.md marks it golden and
   user-edited-only. It contains zero matches, so the exclusion costs nothing.
2. **`docs/llm_managed/recovered_from_server/`** holds two RECOVERED COPIES of
   old REQ documents — historical REQ text living outside `docs/REQ/`. The
   exclusion's stated RATIONALE ("history is not rewritten") argues for skipping
   them; its stated MECHANISM and G2's wording ("nothing outside `docs/REQ/`")
   require sweeping them. **Swept**, so G2 passes exactly as written. Flagged
   because it is a one-hunk revert if the rationale reading was intended.
3. **Build artifacts not rebuilt/committed.** `web/mock/index.html` on `c1456a5`
   is ALREADY STALE against its own sources: a fresh `python3 mock-src/build.py`
   at base produces a 2693-line diff (2501 insertions, 192 deletions). That
   staleness is pre-existing and out of scope, so G5 was measured by comparing
   BUILD OUTPUTS before and after, never the committed file, and the file was
   restored with `git checkout` after each measurement. Nothing under `web/` is
   committed by this REQ.
4. **Deps** provisioned with pnpm only (`pnpm install --frozen-lockfile` in `/`,
   `server/`, `client/`) plus `tools/provision_worktree_env.sh`. No npm, no
   `package-lock.json`.

### 7.7 Notes for REQ-0310 (client player-action logic -> shared/)

- **The `.d.ts` shadowing trap is now a known hazard, and REQ-0310 will hit it
  again.** Any `foo.js` moved next to an existing `foo.d.ts` silently acquires
  that file as its declaration. Check for a same-basename `.d.ts` at the
  DESTINATION before moving, and run `[3.5/7]` early.
- **There are still two engine type surfaces.** `client/src/engine/engine.d.ts`
  is now a one-line re-export (`export * from '../../../shared/engine.d.ts'`),
  while `engine.js`'s own header names the client one as its typed surface and
  `tools/check_engine_types.cjs` is the arbiter. §3 non-goal 5 deferred this;
  it is still deferred, and it sits directly in REQ-0310's path.
- **`shared/` now holds a UMD file.** `engine.js` is neither CJS nor ESM by
  declaration, which is why the client still needs the `?raw` + `new Function`
  shim. REQ-0314's `bpk` can plain-`require` it from node. De-UMD-ing remains
  non-goal 3 and wants its own REQ with browser e2e evidence.
- **`mock-src/` is now genuinely mock-only**: `data.js`, `ui.js`,
  `index.template.html`, `build.py`, and the engine's 129 KB suite in
  `tests/run.cjs` (which reaches the engine through a symlink). If REQ-0310 moves
  client logic, note that `client/src/api.ts`, `client/src/api/content.ts` and
  `client/src/board/*` still describe themselves as PORTS OF `mock-src/ui.js` —
  ~20 such comments remain and are accurate, since `ui.js` did not move.
- **e2e ports** for REQ-0310 derive to 8100/8101/8102 with fleet 8104-8109.
- Merge this early. ~100 sibling worktrees will conflict on rebase past the
  rename; the diff is trivially re-appliable now and less so later (§6).
