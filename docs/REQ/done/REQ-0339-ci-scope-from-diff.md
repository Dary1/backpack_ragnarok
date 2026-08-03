# REQ-0339 — ci.sh computes its e2e scope from the diff (and a self-check so the table cannot rot)

## Status
built — implemented and gated 2026-07-29. Awaiting user acceptance / merge.

One line. An admin-surface change now runs ci.sh in **277 s** instead of 491 s;
a public-surface change in **287 s**; a shared change still pays the full
**491 s**. The scope is a function of `git diff`, not a question anyone answers.

---

## 1. Why

REQ-0334 instrumented every stage, and the first thing the numbers said is that
ci.sh is not slow in general — it is slow in three places. Measured again in
this worktree (2026-07-29, one session, one box, back to back):

| stage | wall | what it covers |
|---|---|---|
| `[7/7]` client e2e, default suite (205 tests, 4 workers) | **210.4 s** | the public app |
| `[6.5/8]` admin e2e trio (artadmin 8 + artinspect 1 + contentadmin 28) | **191.9 s** | the admin surfaces |
| `[6.6/8]` registry-first e2e (4 tests) | **11.8 s** | admin, pg registry path |
| the other 73 stages combined | ~76 s | everything else |

So **83% of the run is two e2e families**, and each of them is irrelevant to a
change on the other surface. Editing `client/src/artadmin/QueuePanel.tsx` cannot
break `landing.spec.ts`; editing `client/src/board/drag.ts` cannot break
`contentadmin.spec.ts`. The 40% of the run that is the admin trio is pure toll
on every public-side change, and vice versa.

That the split is *clean enough to act on* is a measurement, not an assumption.
Resolving every `data-testid` the three admin specs query back to the file that
defines it (re-measured on this tree, 2026-07-29):

| spec | -> `client/src/artadmin` | -> `client/src/contentadmin` | -> anywhere else in `client/src` |
|---|---|---|---|
| `artadmin.spec.ts` | 108 | 6 | **0** |
| `artinspect.spec.ts` | 13 | 2 | **0** |
| `contentadmin.spec.ts` | 12 | 108 | **0** |

**Not one resolves outside those two directories.** (Roughly a third of the
queries are template literals such as `render-status-${seed}` with no static
definition to match at all — the same limitation §5 is about, in miniature.)

### The constraint that shaped the design: COMPUTED, NEVER ASKED

The obvious implementation is to let whoever runs the gate say which tests are
relevant, or to add a `--only-admin` flag. That is the one thing this must not
do, and the reason is specific.

The owner's stated concern is not that an LLM agent will deliberately circumvent
a hard block — it will not. It is that an agent *asked to judge* "which tests
does my change need?" will drift, a little, every time, in the direction of the
cheaper answer, and that drift is invisible: the gate still prints CI GREEN. A
skipped stage looks exactly like a passed stage in a log you did not read.

So there is **no prompt, no flag anyone picks, and no judgement call**.
`tools/ci_scope.sh` reads `git diff` and prints one of `admin`, `public`, `both`;
`tools/ci.sh` only consumes the answer. The single seam is `CI_SCOPE`, and it can
only ever *add* work (`CI_SCOPE=both` is what `tools/release.sh` sets).

---

## 2. What was built

### `tools/ci_scope.sh` — the classifier, single source of truth

    tools/ci_scope.sh [<base-ref>]            -> prints admin | public | both
    tools/ci_scope.sh --explain [<base-ref>]  -> the per-path classification first
    tools/ci_scope.sh --selftest              -> red if the table has drifted

Input is the **union** of `git diff --name-only <base>...HEAD` (default base
`master`) and the uncommitted working tree (`git status --porcelain`, including
untracked files). The dirty tree is not an afterthought: running the gate before
committing is the normal case here, and a classifier that only sees commits
would silently return `both` for every pre-commit run — i.e. do nothing.

The bare token goes to **stdout** (ci.sh captures it with `$( )`); the human
banner and every warning go to **stderr**, so the two never collide.

### The classification table as shipped

Ordered, first match wins. `tools/ci_scope.sh:38` onward.

| # | pattern | class |
|---|---|---|
| 1 | `docs/*` `web/*` `data/*` `*.md` | **ignored** |
| 2 | `client/src/artadmin/*` `client/src/contentadmin/*` | admin |
| 3 | `client/e2e/{artadmin,artinspect,contentadmin}.spec.ts` | admin |
| 4 | `client/e2e/{artadmin,artinspect,contentadmin,registry}.config.ts` | admin |
| 5 | `server/routes/{art,content,admin}.cjs` | admin |
| 6 | `server/services/art_*` `server/services/kit_registry.cjs` | admin |
| 7 | `content/*` | admin |
| 8 | `tools/{artadmin_e2e,art_inspect_e2e,content_admin_e2e,registry_first_e2e}.sh` | admin |
| 9 | `tools/art_*` `tools/inspect_*` `tools/seed_registry_e2e.cjs` | admin |
| 10 | `client/e2e/dex-admin.spec.ts` `client/e2e/helpers.ts` `client/e2e/e2e-env.ts` | **both** |
| 11 | `client/playwright.config.ts` | both |
| 12 | `server/{storage,lib,tests,migrations}/*` | both |
| 13 | `server/{api,admin,schedule}.cjs` | both |
| 14 | `tools/{ci,ci_scope,release}.sh` `tools/e2e_*` | both |
| 15 | `client/src/*` | public |
| 16 | `client/e2e/*` | public |
| 17 | `server/routes/*` | public |
| 18 | `sim/*` `shared/*` `mock-src/*` `bot/*` | public |
| 19 | `server/services/*` | both (catch-all) |
| 20 | `server/*` | both (catch-all) |
| 21 | `client/*` | both (catch-all) |
| 22 | `tools/*` | both (catch-all) |
| 23 | `types/*` `deploy/*` `package.json` `pnpm-lock.yaml` `tsconfig.server.json` `.gitignore` | both |
| 24 | anything else | **unclassified → fail closed to both** |

Four rows are refinements on the table this REQ started from, each earned:

- **Row 10** is the one that matters, and the self-check (S6, below) found it,
  not a human. `client/e2e/dex-admin.spec.ts` is a member of the **default**
  suite *and* the spec `client/e2e/registry.config.ts` drives in `[6.6/8]`
  (`tools/registry_first_e2e.sh:43`). It imports `helpers.ts` and `e2e-env.ts`,
  and `tools/e2e_harness.sh:33-36` shapes the isolated HOME specifically so
  `e2e-env.ts`'s path construction resolves into it. Classifying any of the
  three `public` would have silently dropped `[6.6/8]` from admin-scoped runs —
  exactly the invisible failure this REQ exists to prevent. The other 39 specs
  and the rest of `client/e2e/` really are default-suite-only: the three admin
  specs import nothing but `@playwright/test`, and their configs declare no
  `globalSetup`/`webServer`.
- **Row 9** adds `tools/seed_registry_e2e.cjs`: it seeds the adopted def that
  `[6.6/8]` exists to exercise, and nothing else reads it.
- **Rows 19–22** are the catch-alls, and they are *decisions*, not fail-closed
  fallout. Left to fall through they would produce a permanently non-zero
  "unclassified" count on every run, and a warning that is always on is a
  warning nobody reads. `server/services/` is the shared business layer under
  both route families; `client/` outside `src/`+`e2e/` is build input for the
  whole client; `tools/` outside the named e2e/art scripts is generators and
  content gates whose blast radius is not confined to one surface.
- **Row 1** extends `web/app/` to all of `web/`. Everything under `web/` is
  build output or a static docroot — `app/` from the client build (which ci.sh
  rebuilds at `[6/7]` from `client/src` *before* any e2e runs), `preview/` from
  `tools/build_preview.py`, `mock/` from `mock-src/build.py`, `redesign/` static
  mockups. Nothing under it is an input to a gate. This also means the
  `dist rebuild (web/app/)` commit `release.sh` makes is not itself gate-relevant.

### Fail closed

Any path matching no rule counts as **both**, is listed on stderr by name, and
is counted in the banner:

    [ci-scope] 1 path(s) match NO rule in tools/ci_scope.sh -- FAILING CLOSED to both:
      quantum_widgets/thing.txt
    [ci-scope] both (admin+public) -- base=master, 3 path(s): 1 admin, 0 public, 1 shared, 0 ignored, 1 unclassified

The asymmetry is the whole point: a stale table must cost **time**, never
**coverage**. An unclassified path also overrides an otherwise admin-only diff
back up to `both` (asserted in the unit tests), so one unknown file cannot be
diluted by known ones.

An **empty diff** is `both` — someone running the gate with nothing to compare
gets the whole gate, never a reduced one.

An **all-ignored diff** (docs only, say) is also `both`. A fourth value `none`,
skipping every e2e family, was considered and **rejected**: the contract is
three values, and a scope that runs no e2e at all is precisely the state that
must not be reachable by accident. The cost is that a docs-only run still pays
the full gate; that is the right side to be wrong on.

### `tools/ci.sh` uses it

Computed **once**, immediately after the `cd`, before any stage
(`tools/ci.sh:97-129`), and echoed loudly:

    [ci-scope] admin -- computed from git diff vs master: [6.5/8]+[6.6/8] run, [7/7] SKIPPED

`[6.5/8]` + `[6.6/8]` are gated on the scope containing admin, `[7/7]` on the
scope containing public. A scope-skipped stage keeps the existing `… SKIPPED`
banner style **and says why, naming the scope**, so the two reasons a stage can
be absent never look alike:

    ==== [7/7] client e2e SKIPPED -- ci-scope is 'admin' (no public-surface path in the diff; CI_SCOPE=both forces) ====

Both `[6.5]` and `[6.6]` print their own skip banner rather than sharing one, so
"which stages ran" stays greppable from the log alone.

`CI_SCOPE=both|admin|public` overrides the computation (anything else is a hard
exit 2, not a silent fallback); `CI_SCOPE_BASE=<ref>` changes the base.

### `tools/release.sh` always runs the full gate

`tools/release.sh:7-16` exports `CI_SCOPE=both` before calling ci.sh, with the
reason stated in the file rather than implied:

> release.sh is the path that lets code OUT — it rebuilds and commits the dist
> the live services serve — and the whole scoping mechanism rests on a
> hand-written classification table. If that table is ever wrong, the run that
> must not be the one to find out is this one.

Scoping is a development-loop optimisation. It is not a release-path one.

---

## 3. The self-check — the actual point of this REQ

A hand-written map of a moving tree rots, and the failure mode here is the worst
kind: a stage quietly not running, on a gate that still prints CI GREEN. So the
mapping is not left as a rule someone must remember. New stage
**`[0.5/7]`** (418–433 ms measured) runs `tools/ci_scope.sh --selftest` plus
`tools/tests/ci_scope_test.py`, and it is **first** — a red there invalidates
every scoping decision made after it.

| check | asserts |
|---|---|
| **S1a/S1b** | the set of top-level repo entries equals `KNOWN_TOPLEVEL`, both directions, and each classifies |
| **S2a/S2b/S2c** | `client/src/` subdirectories equal `KNOWN_CLIENT_SRC`; each classifies; **exactly** `{artadmin, contentadmin}` classify admin |
| **S3a/S3b/S3c** | `server/routes/` files equal `KNOWN_SERVER_ROUTES`; each classifies; **exactly** `{admin,art,content}.cjs` classify admin |
| **S4** | every `client/e2e/*.spec.ts` classifies to a real surface, never `unclassified`/`ignored` |
| **S5** | the specs `client/playwright.config.ts` `testIgnore`s out of the default suite == the specs this table calls `admin` |
| **S6** | every spec an isolated harness actually drives (`tools/*_e2e.sh` → `--config=e2e/X.config.ts` → its `testMatch`) classifies admin or both — never public |

S1–S3 are deliberately **declared inventories** compared against the tree, not
"is it covered by some rule". With the `client/src/*` → public catch-all in
place, "covered by a rule" is vacuously true for every directory that will ever
exist; it would pass forever and prove nothing. Requiring the inventory to match
means adding `client/src/newsurface/` turns the build red until someone writes
one line and, in writing it, decides admin or public. That is the difference
between a comment and a gate.

S5 and S6 are cross-file: they check this table against two files maintained
independently of it. **S6 is not hypothetical — it is what found row 10.**

Each check was verified to actually fail, by drifting the tree on purpose and
reverting:

| injected drift | result |
|---|---|
| new top-level dir `quantum_widgets/` | S1a FAIL — *on disk but NOT declared: quantum_widgets* |
| new dir `client/src/zzz_probe/` | S2a FAIL — *on disk but NOT declared: zzz_probe* |
| a 4th spec added to `testIgnore` | S5 FAIL — *declared but GONE from disk: landing.spec.ts* |
| `registry.config.ts` retargeted at `market.spec.ts` | S6 FAIL — *registry.config.ts->market.spec.ts=public* |

### What the self-check deliberately does NOT do

It does not verify that a spec's *assertions* only touch its own surface. It
cannot: see §5. It checks the shape of the tree against the table, and the table
against the two other files that encode the same fact. Whether
`contentadmin.spec.ts` secretly depends on `client/src/board/` is outside what
any static check here can see, and pretending otherwise would be the same
mistake as asking an agent to judge relevance.

### Classifier unit tests

`tools/tests/ci_scope_test.py` — stdlib python3, assert-style, matching the
`tools/tests/*_test.py` convention. **20 assertions, all offline**, against a
**synthetic git repo** built in a temp dir from a copy of the real
`ci_scope.sh` plus empty files at the paths the table cares about. Synthetic on
purpose: tests that read the live worktree change meaning whenever someone edits
an unrelated file.

Covered: the table path by path (49 probes, including row 10); admin-only →
`admin`; public-only → `public`; shared → `both`; mixed → `both`; unknown path →
`both` **and named on stderr and counted** and **able to override an admin-only
diff**; empty diff → `both`; all-ignored diff → `both` with its reason; a dirty
worktree with nothing committed → `admin`; a dirty worktree including an
**untracked** file → `both`; stdout is exactly one bare token with the banner on
stderr; an explicit base ref; an unresolvable base ref → `both`, loudly.

---

## 4. Measured — three runs, one session, one box

`CI_STAGE_TIMINGS` (REQ-0334) captured stage wall times. Each run appended one
throwaway comment line to one file, ran `tools/ci.sh`, then `git checkout --` it;
the worktree was verified clean afterwards.

Base was `CI_SCOPE_BASE=HEAD`, not `master`, and that is worth recording: this
branch itself edits `tools/`, which the table classifies **both** *by design*, so
`master...HEAD` would return `both` on every run and would have measured
nothing. `HEAD...HEAD` is empty, leaving only the throwaway working-tree touch
to classify — which also exercises the dirty-worktree path end to end.

| # | touched | computed scope | wall | `[6.5/8]` | `[6.6/8]` | `[7/7]` | result |
|---|---|---|---|---|---|---|---|
| 1 | `client/src/artadmin/ArtAdminPage.tsx` | **admin** | **277 s** | 189.6 s | 11.1 s | **SKIPPED** | CI GREEN |
| 2 | `client/src/board/Board.tsx` | **public** | **287 s** | **SKIPPED** | **SKIPPED** | 209.9 s | CI GREEN |
| 3 | `server/lib/http_util.cjs` | **both** | **491 s** | 191.9 s | 11.8 s | 210.4 s | CI GREEN |

**Admin-only change: −214 s (−44%). Public-only change: −204 s (−42%).**

The classifier's own banner, verbatim from run 1:

    [ci-scope] admin (admin only) -- base=HEAD, 1 path(s): 1 admin, 0 public, 0 shared, 0 ignored, 0 unclassified
    [ci-scope] admin -- computed from git diff vs HEAD: [6.5/8]+[6.6/8] run, [7/7] SKIPPED

Test counts on run 3 (the full one) are unchanged from the pre-REQ baseline:
admin trio **8 / 1 / 28**, registry **4/4**, default e2e **204 passed / 0 failed
/ 1 skipped** over 205 tests.

> Honest note on absolutes. 491 s is ~13% above REQ-0335's 435 s figure for the
> same script: `[6.5]` measured 192 s here against 165 s there and `[7/7]` 210 s
> against 182 s, and the default suite has grown 198 → 205 tests since (REQ-0337
> added `troop-host.spec.ts`). The three runs above are back-to-back on one box
> in one session, so they are comparable **with each other**, which is what the
> claim needs; do not read 491 s as a new canonical baseline.

---

## 5. The honest limitation — read this before trying to make it finer

**This is an admin/public bit. Nothing finer is derivable, and the reason is
structural, not effort.**

Measured on this tree: **40 e2e specs. 22 of them drive the UI by pixel
coordinates** (`page.mouse.*` / `boundingBox()`), and **19 contain no
`data-testid` reference at all.** Those specs interact with a PixiJS canvas —
one DOM element — by computing coordinates from a bounding box at run time.
There is no import, no selector, no string constant that ties
`bp-transfer.spec.ts` to `client/src/board/drag.ts`. **The dependency edge does
not exist in the source.** No amount of parsing recovers it, because it is not
there to recover.

The admin/public bit survives this only because it does not need per-spec
resolution: the three admin specs are the ones that *do* address by testid, and
those testids resolve cleanly into two directories. That is a fact about those
three specs, not a technique that generalises.

**If per-spec scoping is ever wanted, the route is not a bigger table.** It is
**V8 coverage from an instrumented Playwright run** — record which modules each
spec actually executed, persist that map, and scope from it. That is a real
mechanism with real costs (the map must be regenerated, it goes stale silently,
and it must fail closed on any spec it has no entry for). Recording it here so
nobody re-derives the dead end: a hand-written per-spec table cannot work, and
the reason is the 19 specs with no static edge.

---

## 6. Deliberately NOT done

- **No per-spec scoping** — see §5.
- **No directory restructuring, no spec moves, no renames.** The measurement
  says the current structure is sufficient for the bit being computed; moving
  files to make classification prettier would be changing the subject.
- **No test's assertions changed.** Nothing was deleted, merged, or weakened.
  Every stage that runs, runs exactly what it ran before.
- **`release.sh` not weakened** — the opposite: it now *pins* the full gate.
- **No fourth `none` scope** — §2.
- **Not merged, not deployed.** Stops at `built/`.

---

## 7. Files

| file | change |
|---|---|
| `tools/ci_scope.sh` | **new** — classifier, `--explain`, `--selftest`, the table |
| `tools/tests/ci_scope_test.py` | **new** — 20 assertions on a synthetic git repo |
| `tools/ci.sh` | scope computed once at the top; `[0.5/7]` self-check stage; `[6.5]`/`[6.6]` gated on admin, `[7/7]` on public; skip banners name the scope |
| `tools/release.sh` | `export CI_SCOPE=both` + why |

No product code, no content, no test assertions.

## Log
- 2026-07-29 reserved as REQ-0339 on branch `req-0339-ci-scope-from-diff`
  (off master 44d19b1).
- 2026-07-29 implemented (5524cf2). S6 immediately found `dex-admin.spec.ts` /
  `helpers.ts` / `e2e-env.ts` shared between the default suite and `[6.6/8]`;
  table row 10 added. Each self-check verified to fail on injected drift and
  pass after revert. Three measured scoping runs, all CI GREEN. Full
  `tools/release.sh` gate. reserved -> built.

## Gate results (2026-07-29)
- Syntax: `bash -n tools/ci.sh`, `bash -n tools/ci_scope.sh`,
  `bash -n tools/release.sh` — all clean.
- `tools/ci_scope.sh --selftest` — 11/11 PASS.
- `python3 tools/tests/ci_scope_test.py` — **20 passed, 0 failed**.
- Three scoped runs — **CI GREEN** ×3; 277 s / 287 s / 491 s; §4.
- `tools/release.sh` — **CI GREEN**, 499 s wall (491.0 s summed over 76 stages),
  `dist unchanged -- nothing to commit`. It forced the full gate as designed:

      [ci-scope] admin+public (both) -- forced by CI_SCOPE env: admin e2e AND client e2e will run

  Counts: admin trio **8 / 1 / 28**, registry **4/4**, default e2e **204 passed
  / 0 failed / 1 skipped**. Top stages `[7/7]` 208.1 s, `[6.5/8]` 195.5 s,
  `[6.6/8]` 11.7 s, `[0.5/7]` 0.43 s.
- **First release.sh attempt was red, and it was a flake, recorded rather than
  quietly re-run.** `artadmin.spec.ts:124` (REQ-0191 cell backdrop) timed out
  after 15 s waiting for `getByTestId('art-select-e2e_axe')`; the other 7 passed.
  The same test passed at 20.0 s and 20.1 s in measurement runs 1 and 3 on this
  same worktree within the preceding hour, and passed again on the re-run
  (8/8, 2.0 m). Nothing in this REQ touches product code, a spec, a harness or
  the fleet, so it is pre-existing flake in that spec, not a regression here —
  but it is unresolved and belongs to whoever next looks at `artadmin.spec.ts`.

## Deploy record (2026-07-29)
- Merged to master 02d1cfe (--no-ff). Gate before the merge: `tools/release.sh` CI GREEN,
  499 s, dist unchanged.
- **No service restart, no dist change**: every path is tools/ or docs. Verified on
  master after the merge: `tools/ci_scope.sh --selftest` GREEN (S1-S6).
- built -> done.
