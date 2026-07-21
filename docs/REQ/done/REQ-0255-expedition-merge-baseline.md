# REQ-0255 — expedition-merge-baseline: one baseline for the expedition program

**Status:** done — EXECUTED 2026-07-19, verified and closed 2026-07-21 on the user's direction.
The runbook ran in full on `master` (§12); the baseline is merged, rebuilt, deployed and live.
Was: draft — spec written, blocked on user review, 2026-07-18. The intermediate `todo/` and
`built/` states never actually held: the runbook was executed straight off the spec on 2026-07-19
and the file was simply never moved. Recording those states retroactively would be fiction, so
this REQ moves draft -> done in one step; §12 is the honest log.
**Reserved:** 2026-07-18
**Slug:** expedition-merge-baseline
**Branch:** req-expedition-spec (spec only; the merge runbook executes on `master`)
**Requested by:** user, 2026-07-18 — ruling Q2 (see §2).
**Depends on:** nothing. This is the ROOT of the expedition program.
**Blocks:** REQ-0256 (battle-tick-core), REQ-0258 (formation-map-padding), REQ-0260
(expedition-fullscreen-route) — every downstream REQ branches from the merged baseline.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §5.

## 1. Goal

Merge the four impacted built-but-unmerged branches into `master` so the expedition program
(REQ-0255..0265) has ONE baseline to branch from, instead of eleven REQs each rebasing across
four unmerged trees.

## 2. The ruling that authorizes this

`master` and the live services `backpack-api` / `backpack-web` / `backpack-tunnel` are
HANDS-OFF per PROJECT.md ("coordinate before any edit, merge, or restart") without explicit,
fresh user go-ahead. The user gave that go-ahead on 2026-07-18, ruling Q2, verbatim:

> 影響があるモノを全てマージして、それをmasterとして新規。e2eを通す必要はない。

("Merge everything that is impacted and make that the new master. It is not necessary to pass
e2e.") This authorizes the MERGE. It does NOT authorize a DEPLOY — see §8.

## 3. Measured ancestry (verified 2026-07-18, not taken from the brief)

Every number below was measured with `git rev-list` / `git merge-base`, not copied.

- **master tip = `f918a65`** ("docs: REQ-0223a+b built -> done (merged 8e77828, deployed,
  live-verified)", 2026-07-17). CONFIRMS the brief.
- **All four branches share ONE merge-base with master: `cc575e2`** ("docs: REQ-0234 built ->
  done"). All four are **79 commits BEHIND** master. The brief does not mention this; it
  matters, because every merge below is a real 3-way merge across 79 commits of master drift,
  not a fast-forward.

| branch | tip | ahead of master | contains |
|---|---|---|---|
| `req-0211-gimic-content-kind` | `e4c4666` | **+10** | — |
| `req-0185-dungeon-content-kind` | `b591420` | **+19** | ALL of 0211 (`--is-ancestor` = true) |
| `req-0239-sortie-squad-board` | `5848c9d` | **+24** | 0211, and 0185 **only up to `ce78af5`** |
| `req-0240-monitor-redesign-pacing` | `d691325` | **+24** | 0211, and 0185 **only up to `ce78af5`** |

**Union of all four = 31 distinct commits** (`git rev-list master..A master..B master..C
master..D | sort -u | wc -l` = 31).

### 3.1 CORRECTION to the brief — the counts are NESTED, not additive

The brief §5 lists "(+10)", "(+19)", "(+24)", "(+24)" as if they were four independent
contributions. They are not:

- `req-0211` IS AN ANCESTOR of `req-0185` (`git merge-base --is-ancestor` = true). 0185's +19
  **includes** 0211's +10; 0185 contributes only **9 commits of its own**.
- 0239's +24 = 0185-through-`ce78af5` (18) + **6 of its own**. 0240's +24 = the same 18 + **6 of
  its own**.
- So the merge lands 10 + 9 + 6 + 6 = **31**, which is exactly the measured union. Merging 0185
  alone would already drag 0211 in; the explicit 0211-first step is for a readable history, not
  because it adds anything 0185 lacks.

### 3.2 CORRECTION to the brief — the `ce78af5` caveat applies to 0239 TOO, not just 0240

The brief flags this for 0240 only:

> `req-0240` … contains 0185's built state as of `ce78af5` but the `req-0185` BRANCH has since
> advanced, so 0185 must be merged EXPLICITLY, not assumed.

and describes 0239 without the caveat, as simply "Contains 0185+0211 built". **Measured, the
caveat applies identically to both:**

```
git merge-base --is-ancestor req-0185-dungeon-content-kind req-0239-sortie-squad-board     -> NO
git merge-base --is-ancestor req-0185-dungeon-content-kind req-0240-monitor-redesign-pacing -> NO
git merge-base --is-ancestor ce78af5 req-0239-sortie-squad-board                            -> YES
git merge-base --is-ancestor ce78af5 req-0240-monitor-redesign-pacing                       -> YES
```

The single 0185 commit that neither 0239 nor 0240 carries is **`b591420`** — "REQ-0185: correct
stale REQ metadata + record post-reboot re-verification", a docs-only commit touching exactly
one file (`docs/REQ/built/REQ-0185-dungeon-content-kind.md`, +49/-4). It is not code, but it is
the commit that fixes a REQ header that "actively misled the PROJECT.md recovery read". It must
land. The brief is right that 0185 needs an explicit merge; it is wrong about which branches
need the warning.

### 3.3 Note on the throwaway branch

The task brief referenced an existing `tmp-mergetest` branch as precedent. **No such branch
exists.** The only tmp branch in the repo is `tmp-r215-e2e-on-0217` (tip `4e9bad9`, a REQ-0215
e2e merge), which was inspected read-only and left undisturbed. The conflict evidence in §5 was
produced on a fresh `tmp-expedition-mergetest` worktree off `master` at `/tmp/bp_mergetest`, and
both the worktree and the branch were destroyed afterwards (`git worktree remove --force` +
`git branch -D`). `master` was never checked out for writing and is still `f918a65`.

## 4. Merge order, and what each branch contains

Order: **0211 -> 0185 -> 0239 -> 0240**. It follows the ancestry: 0211 is contained by all three
others; 0185 is contained (to `ce78af5`) by 0239 and 0240; 0239 and 0240 are siblings (6 commits
each, neither an ancestor of the other — `git rev-list --left-right --count` = 6 / 6).

| # | branch | what it contains |
|---|---|---|
| 1 | `req-0211-gimic-content-kind` | The `gimic` content kind + art kind. Migrates the legacy trap / treasure / hidden-door entities out of `entities.json` into `gimics.json` (a git RENAME, 55% similarity). Adds migrations 020/021. Art kind `gimic` == `monster` sizing. |
| 2 | `req-0185-dungeon-content-kind` | Dungeon as pre-generated content (`dungeon/1` kind): roller, validator, authored defs, registry integration, serving repoint, client wiring (dungeon DEF picker, forecast by dungeonId, contentadmin). Adds migration 022. |
| 3 | `req-0239-sortie-squad-board` | The SORTIE page (`#/sortie`) + the SQUAD STATUS BOARD on `#/schedule`, atomic `/sorties`, rooms `lastRun`, deferred-cancel sortie default. Retires the old create-room-form e2e flow. |
| 4 | `req-0240-monitor-redesign-pacing` | The current Battle Monitor (six-zone layout) + the server presentation-pacing layer (`pt`/coalesce/clamp), `ApiRunView` roster + `pacingVersion`. This is the monitor the expedition 全画面 button will hang off (REQ-0260). |

## 5. Conflicts — MEASURED, not predicted

Produced by actually running the four merges in `tmp-expedition-mergetest` off `master`
(`--no-ff --no-edit`), recording `git diff --name-only --diff-filter=U` at each step.

| # | merge | exit | conflicts |
|---|---|---|---|
| 1 | `master` <- 0211 | **0** | **NONE.** Clean. |
| 2 | +0185 | 1 | **13 files — ALL of them the committed `web/app` bundle.** ZERO source conflicts. |
| 3 | +0239 | **0** | **NONE.** Clean. |
| 4 | +0240 | 1 | **2 SOURCE files** + 10 bundle files. |

### 5.1 Merge 2 (0185): a pure built-bundle collision

Verified: `git diff --name-only --diff-filter=U | grep -v "^web/app/"` returned **nothing**.
Every conflict is Vite content-hashed output that both sides rebuilt:

```
CONFLICT (rename/rename): web/app/assets/browserAll-Fc3VWJAB.js -> browserAll-DmkOHUUB.js (HEAD)
                                                                -> browserAll-B1lRUI7q.js (0185)
CONFLICT (rename/rename): web/app/assets/index-CsxwC_kA.css / index-DRqz3ZN3.js / init-Tu0j7bJL.js  (same shape)
CONFLICT (content):       web/app/index.html   (the script/link tags naming those hashes)
```

`shared/content_validate.cjs` and `tools/ci.sh` **auto-merged cleanly** — the real source of
0185 does not fight master.

### 5.2 Merge 4 (0240): the only two real source conflicts

**`client/src/api.ts` — 1 conflict, purely additive on both sides.** One long
`export type { … } from '../../shared/dto'` re-export line. 0239 added `ApiRoomLastRun`,
`ApiSortieBody`; 0240 added `ApiRunRoster`, `ApiRunRosterSlot`, `ApiRunRosterEnemy`.
**Resolution: UNION.** This is provably safe, not a guess: `shared/dto.ts` itself merged with
**zero** conflicts and the merged file carries all five type declarations. Take HEAD's line and
insert the three roster types after `ApiRunView,`:

```
… ApiRoom, ApiRoomLastRun, ApiCreateRoomBody, ApiSortieBody, ApiRunEvent, ApiRunView,
  ApiRunRoster, ApiRunRosterSlot, ApiRunRosterEnemy, ApiSealMeta, …
```

`pnpm build` (`tsc -b`) is what proves this resolution; a dropped type is a compile error, not a
silent bug.

**`client/e2e/schedule.spec.ts` — 2 tangled conflicts. DO NOT resolve by naive union.**
Both branches appended a `test.describe` block at EOF (both at base line 1535), and git's diff
aligned spurious common Playwright boilerplate (`await page.goto('/app/#/invite/…')`,
`.nav-link Schedule`) BETWEEN the two blocks, splitting each side across both conflict regions.
Deleting the markers would interleave two unrelated describes and unbalance the file.

Neither side is a pure append (measured against the merge base `ce78af5`):
- 0239 side: **+93 / -165** — it DELETES the create-room-form tests (retired by the sortie flow)
  across hunks at base lines 139 / 181 / 289, and appends 93 lines at EOF.
- 0240 side: **+106 / -52** — it rewrites monitor tests in place (six-zone layout) across hunks
  at 433 / 1080 / 1247 / 1294 / 1328 / 1344 / 1360 / 1408, and appends 72 lines at EOF.

All of those in-place edits **auto-merge**; only the EOF append collides. Correct resolution —
keep the auto-merged prefix, then concatenate the two appended blocks whole, 0239 first:

```
prefix = working-tree lines 1 .. (first "<<<<<<<" - 1)      # all auto-merged content
b239   = the "+" lines of the LAST hunk of: git diff <base> HEAD           -- 93 lines
b240   = the "+" lines of the LAST hunk of: git diff <base> req-0240-...   -- 72 lines
result = prefix + b239 + b240 + (lines after the last ">>>>>>>")
```

Verified before applying: each block is a single self-contained `test.describe`
(`REQ-0239: sortie page + squad status board` / `REQ-0240: monitor six zones, feed filters,
ro…`) with brace/paren balance **(0, 0)**. After applying: **0 conflict markers remain**, and
the two suites sit side by side as independent describes.

### 5.3 The bundle rule: rebuild, never hand-merge

`web/app/` is committed BUILD OUTPUT. Its filenames are content hashes, so any two branches that
both ran `pnpm build` collide by construction, and the collision carries no information. Never
hand-merge it. Take one side wholesale to clear the index, then **rebuild from the merged
source** and commit the result — the precedent is 0185's own `b8182b3` ("rebuild web/app from
merged source (post-0217 rebase; stale bundle dropped from client-wiring commit)").

```
rm -rf web/app && git checkout <branch> -- web/app && git add -A web/app   # clear the conflict
# ... after ALL four merges land:
cd client && pnpm install --frozen-lockfile && pnpm build                  # tsc -b && vite build
git add -A web/app && git commit -m "expedition baseline: rebuild web/app from merged source"
```

The bundle that ships must be built from the FINAL merged source, not inherited from whichever
branch merged last. Merge 4 leaves 0240's bundle in the tree; it is stale the moment 0239's
source is also present. This rebuild is not optional bookkeeping — `web/app` is the docroot
`backpack-web` serves.

## 6. The runbook

Run on `master` in the MAIN checkout `~/backpack_ragnarok` — the one place a merge to master can
happen, and HANDS-OFF territory: do not start without the fresh go-ahead (§2). No service is
restarted; merging does not deploy.

```
cd ~/backpack_ragnarok
git status --porcelain          # MUST be empty before starting
git log -1 --format=%H          # MUST be f918a65... ; if master moved, RE-MEASURE §3 first
git branch backup/master-pre-expedition-baseline master    # cheap, reversible undo point

git merge --no-ff req-0211-gimic-content-kind       # expect: CLEAN
git merge --no-ff req-0185-dungeon-content-kind     # expect: 13 bundle conflicts -> §5.3
git merge --no-ff req-0239-sortie-squad-board       # expect: CLEAN
git merge --no-ff req-0240-monitor-redesign-pacing  # expect: api.ts + schedule.spec.ts -> §5.2, bundle -> §5.3

cd client && pnpm install --frozen-lockfile && pnpm build && cd ..
git add -A web/app && git commit -m "expedition baseline: rebuild web/app from merged source"
```

`--no-ff` is deliberate: four named merge commits make the baseline bisectable per branch. If a
merge goes wrong, `git merge --abort`; if the whole run goes wrong,
`git reset --hard backup/master-pre-expedition-baseline`.

## 7. Gates — E2E is NOT one of them

**Q2 states it plainly: 「e2eを通す必要はない」 — e2e is not a gate for this program.** Do not
block the baseline on it. That is a deliberate user trade: the sortie flow (0239) and the monitor
(0240) both rewrote large parts of `schedule.spec.ts`, and REQ-0256/0257 are about to rebaseline
every golden anyway, so paying for a green e2e suite on a baseline that is about to move is waste.

What IS checked instead — all of these were RUN against the fully merged tree during the conflict
test, so the expected values are measured, not hoped for:

| gate | command | measured on the merged tree |
|---|---|---|
| sim unit tests | `CONTENT_ROOT=$PWD/content node sim/tests/run.cjs` | **117 passed, 0 failed** |
| sim replay goldens | `node sim/tests/goldens.cjs` (**no CONTENT_ROOT** — §7.1) | `goldens OK (12 cases, replay determinism intact)` |
| forecast parity | `CONTENT_ROOT=$PWD/content node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** |
| client typecheck + build | `cd client && pnpm build` (`tsc -b && vite build`) | green — this is what proves the §5.2 `api.ts` union |
| lint | `cd client && pnpm lint` (`oxlint`) | green |

### 7.1 The CONTENT_ROOT trap — read this before believing a gate

`server/lib/content_files.cjs:19` and `sim/dungen.cjs:63` anchor content at **`os.homedir()`**,
not at the tree under test:

```
const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(os.homedir(), 'backpack_ragnarok', 'content');
```

`content_files.cjs`'s own header documents why this is a hazard (REQ-0145a): "a worktree-launched
server read the MAIN checkout's content, never its own tree's." **`tools/ci.sh` never sets
`CONTENT_ROOT`.** Consequences for this merge, both MEASURED:

- Running `sim/tests/run.cjs` from a worktree WITHOUT `CONTENT_ROOT` gives **13 FAILures**, all
  `ENOENT … /home/qtie/backpack_ragnarok/content/live/dungeon/gimics.json` (and `dungeons.json`)
  — the tests read MASTER's content, which has neither file until this REQ's merge lands. The
  failures are an artifact of the harness, NOT of the merge. With `CONTENT_ROOT=$PWD/content` the
  same tree is **117/0 green**.
- Conversely, `sim/tests/goldens.cjs` **must NOT** get `CONTENT_ROOT`. It pins its own batch-002
  roster by remapping `os.homedir()` to a fixture home; setting `CONTENT_ROOT` takes the
  `process.env` branch in `liveDungeonDir()`, bypasses the pin, sends it at the real corpus, and
  it dies with `Error: compileEnemyPack: missing enemy def ghost`. Measured.

So the two gates want OPPOSITE invocations. Once the merge is ON master this stops mattering (the
main checkout IS the tree), which is why the honest verification order is: merge on master, then
run the gates there. A worktree dry-run must use the split invocation above or it will report
failures that do not exist and hide ones that do.

## 8. Deploy is NOT part of this REQ — and merging does not trigger it

REQ-0211 and REQ-0185 each carry DB ENUM migrations and a live registry backfill. **Merging does
NOT run them.** They are deploy steps, gated separately on the user, exactly as both REQs already
record ("NOT run (deploy steps …): … the live migration … + live backfill"). Listed here so a
deploy cannot surprise anyone — found by reading the two REQ files on their branches:

| REQ | migration | what it does |
|---|---|---|
| 0211 | `server/migrations/020_content_kind_gimic.sql` | `ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'gimic';` |
| 0211 | `server/migrations/021_artwork_kind_gimic.sql` | `ALTER TYPE artwork_kind ADD VALUE IF NOT EXISTS 'gimic';` |
| 0185 | `server/migrations/022_content_kind_dungeon.sql` | `ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'dungeon';` |

All three are idempotent (`ADD VALUE IF NOT EXISTS`) and bare top-level statements
(`ALTER TYPE … ADD VALUE` cannot run inside a transaction block). Applied as the postgres
superuser, per the header of each file:
`docker exec -i supabase-db psql -U postgres < server/migrations/0NN_*.sql`.

Backfills (`tools/backfill_content_registry.cjs`, new sources `gimic <- gimics.json` and
`dungeon <- dungeons.json`): REQ-0211 records **`gimic` = 4** records (all PASS, all adopted);
REQ-0185 records **`dungeon` = 3** (adopted).

Migration-first is safe on a live deploy (old code never emits `gimic`/`dungeon`; new code does),
but that is the DEPLOY REQ's argument to make, not this one's. This REQ ends at the merge commit.

**Migration-number collision, flagged.** After merge 1 the tree carries **two `020_` migrations**:
`020_content_kind_gimic.sql` (REQ-0211) and `020_render_variant.sql` (landed on master after
`cc575e2`). Both survive the merge — verified with `git ls-tree`. This is the known hazard
REQ-0184 documented ("Migration numbers are hand-claimed and DO collide (the tree already carries
two `016_`s)"), and it is benign here: the two 020s are independent DDL and neither depends on the
other's ordering. Do NOT renumber — the numbers are historical, and 021/022 already reference
"001..020" in their headers. Note for the deploy operator: apply by explicit filename, never by a
glob that assumes numeric uniqueness.

> A `git diff master req-0211-gimic-content-kind -- server/migrations/` shows
> `D 020_render_variant.sql`. That is a TIP-DIFF ARTIFACT, not a deletion: 0211 branched at
> `cc575e2`, before that file existed on master. The MERGE keeps it (verified). Do not "restore"
> anything, and do not read tip-diffs as merge previews — this is precisely the class of mistake
> that a measured merge test exists to prevent.

## 9. docs/REQ folder-state consequence (REQ policy)

PROJECT.md: "a REQ's status IS its folder … never let a REQ exist in two folders." Measured
folder state per branch (`git ls-tree -r --name-only <branch> docs/REQ`):

| branch | REQ-0185 | REQ-0211 | REQ-0239 | REQ-0240 |
|---|---|---|---|---|
| `master` | `draft/` | — | — | — |
| `req-0211` | `draft/` | `built/` | — | — |
| `req-0185` | `built/` | `built/` | — | — |
| `req-0239` | `built/` | `built/` | `built/` | — |
| `req-0240` | `built/` | `built/` | — | `built/` |

After the merge all four land in `built/`, which is CORRECT: all four are implemented with gates
green and none is deployed — precisely PROJECT.md's definition of `built/`. Master showing 0185 in
`draft/` is not a disagreement; master is simply 79 commits behind the move.

**The `draft/` -> `built/` move for REQ-0185 is a git RENAME and merges cleanly** — verified:
master has not touched `docs/REQ/draft/REQ-0185-dungeon-content-kind.md` since the merge-base
(`git log cc575e2..master -- <path>` is empty), so there is no rename/modify conflict, and no
duplicate arises from these four merges.

It must still be CHECKED, not assumed, because a rename/modify conflict resolved carelessly
(`git add` on both paths) is exactly how a REQ ends up in two folders, and the resulting board is
silently wrong — `ls docs/REQ/*/` is the whole status board, so a duplicate makes the board lie.
Verification step, to run after the last merge:

```
ls docs/REQ/*/ | grep -oE 'REQ-[0-9]{4}[a-z]?' | sort | uniq -d     # MUST print nothing
```

If it prints anything, the REQ is in two folders: `git rm` the copy in the WRONG folder (the
less-complete state loses; `built/` beats `draft/`) in its own commit, message
`docs: REQ-NNNN <- remove duplicate <state>/ copy left by the expedition baseline merge`.
Per PROJECT.md a folder move is its own commit — never bundled with code.

## 10. Acceptance criteria

1. `master` contains all 31 commits: `git rev-list master..<each of the four>` is empty for all four.
2. `git log --oneline --merges -4 master` shows the four named merge commits in order 0211, 0185, 0239, 0240.
3. `docs/REQ/built/` holds REQ-0185, REQ-0211, REQ-0239, REQ-0240; the §9 duplicate check prints nothing.
4. Gates §7 green ON master (where the CONTENT_ROOT trap is moot): sim 117/0, goldens 12 OK, forecast 18/0, `pnpm build` + `pnpm lint` green.
5. `web/app` rebuilt from the merged source in its own commit.
6. NO migration applied, NO backfill run, NO service restarted. `backpack-api` / `backpack-web` / `backpack-tunnel` untouched.
7. The four source branches still exist and are untouched (they are the rollback path).

## 11. Out of scope

- **Deploy.** Migrations 020/021/022 + the two backfills + any service restart. User-gated, separate (§8).
- **E2E.** Explicitly not a gate (Q2, §7). Repairing `schedule.spec.ts` beyond making it a syntactically correct union of the two suites is REQ-0260+'s problem, if those tests are still wanted after the tick rewrite.
- **An e2e harness.** This REQ adds none and needs none: it ships no runtime surface, and e2e is
  not a gate (Q2). Its decade **7550 / 7551 / 7552** (`5000 + 255*10 + {0,1,2}` = static / api /
  proxy, per PROJECT.md's derived-port rule) is reserved-by-numbering and left unused. A later
  REQ in this program derives its own decade from its own number; it may not borrow 0255's.
- **Any behaviour change.** This REQ merges; it does not fix. The formation4 bug is REQ-0258; the tick rewrite is REQ-0256/0257.
- **Rebasing the four branches onto master.** They stay as they are; `--no-ff` merges preserve their history verbatim.

## 12. Outcome — EXECUTED 2026-07-19, verified 2026-07-21

Written 2026-07-21, after the fact. The runbook was executed on `master` on 2026-07-19 without
this file ever leaving `draft/`, so the board said "blocked on review" for two days while the
baseline it describes was already live underneath every branch. This section closes that gap.

### 12.1 What ran

Pre-merge `master` tip was **`f918a65`** — exactly what §3 measured three days earlier, so the
ancestry the plan was built on did not drift before it executed.

| # | commit | time (2026-07-19) | what |
|---|---|---|---|
| 1 | `198a859` | 02:36 | `Merge branch 'req-0211-gimic-content-kind'` |
| 2 | `e409aac` | 02:37 | `Merge branch 'req-0185-dungeon-content-kind'` |
| 3 | `e9076e7` | 02:37 | `Merge branch 'req-0239-sortie-squad-board'` |
| 4 | `b1d2572` | 02:40 | `Merge branch 'req-0240-monitor-redesign-pacing'` |
| 5 | `fb6cff6` | 02:42 | `expedition baseline: rebuild web/app from merged source` (criterion 5) |
| 6 | `2088c34` | 02:46 | `expedition baseline: fix schedule.spec.ts EOF` — the stray describe-close left by the 0239/0240 union; syntax only, e2e is not a gate (§7, §11) |

Merge order is exactly the §6 runbook order: 0211, 0185, 0239, 0240. **`2088c34` is THE baseline
commit** — REQ-0256 branches from it by name, so it is the anchor for the whole expedition
program, not just this REQ.

### 12.2 Acceptance criteria — all seven, re-verified 2026-07-21

| # | criterion | result |
|---|---|---|
| 1 | all 31 commits on master | PASS — `git rev-list master..<branch>` empty for all four (ahead=0) |
| 2 | four named merges, in order | PASS — 0211, 0185, 0239, 0240 (§12.1) |
| 3 | `built/` holds 0185/0211/0239/0240; no duplicate | PASS — all four in `built/`; `ls docs/REQ/*/ \| grep -oE 'REQ-[0-9]{4}[a-z]?' \| sort \| uniq -d` prints nothing |
| 4 | gates green ON master | PASS — re-run 2026-07-21: sim **117 passed / 0 failed**, goldens **OK (12 cases, replay determinism intact)**, forecast parity **18 passed / 0 failed**, `pnpm lint` **0 errors** (43 warnings, pre-existing). All three match §7's measured values exactly. `pnpm build` deliberately NOT re-run — it would dirty the HANDS-OFF main checkout; buildability is evidenced instead by `fb6cff6` (rebuild from merged source) and `42238f8` (fresh rebuild + deploy, 2026-07-21) |
| 5 | `web/app` rebuilt in its own commit | PASS — `fb6cff6` |
| 6 | no migration / backfill / restart | PASS **at execution time**. See §12.3 — they happened later, under a different REQ |
| 7 | four source branches intact | PASS — all four still exist, ahead=0/behind, untouched; the rollback path survives |

### 12.3 The deploy this REQ deliberately did not do — and who did it

§8/§11 kept deploy out of scope, and criterion 6 held on 2026-07-19: nothing was migrated,
backfilled or restarted by this REQ. That work landed independently on **2026-07-21 under
REQ-0266** — commit `5066b2a` records "020-022 + backfill applied", and `42238f8` / `a3aaf66`
record the fresh `web/app` rebuild, the api restart and live verification.

The consequence matters for this REQ's own state: the baseline is not merely merged, it is
DEPLOYED AND LIVE. That is why this file goes to `done/` and not `built/`. It got there by
riding another REQ's deploy rather than by its own, which is worth knowing when reading the
history — the three ENUM migrations (§8) are applied, so a future reader must not re-apply them
believing this REQ left them pending.

### 12.4 Consequence still outstanding

REQ-0185, REQ-0211, REQ-0239 and REQ-0240 remain in `docs/REQ/built/` on master. §9 was right
that `built/` was correct the moment the merge landed — but they are now merged AND deployed AND
live (§12.3), which is `done/` by PROJECT.md's definition. Four folder moves are owed, one commit
each, gated on user acceptance. This REQ does not make them: it merges, it does not curate other
REQs' states.
