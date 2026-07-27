# REQ-0309 — Move `mock-src/engine.js` to `shared/engine.js`

- **State**: todo
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

*(to be filled at build time: commit hashes, gate results, anything learned.)*
