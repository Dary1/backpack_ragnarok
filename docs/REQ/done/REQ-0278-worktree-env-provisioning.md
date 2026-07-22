# REQ-0278 - worktree client/.env.local provisioning guard

- **Status:** Spec. Branch `req-0278-worktree-env-provisioning` off master @ `00befdf`.
  Commissioned by the user 2026-07-22 (post-REQ-0273 review, sibling of the same-day
  workshop:361 fixture re-tune REQ). Scope class: **dev-infrastructure / deploy-integrity**
  (no player-facing behaviour change). NOT merged (user acceptance later).
- Honors: REQ-0118c (Supabase auth; the env values are PUBLIC client values but are
  gitignored by the project secret policy), REQ-0037 (guest/invite fallback when auth is
  unconfigured), REQ-0051 (the e2e proxy serves THIS worktree's web/app), REQ-0084 (pnpm
  worktree provisioning -- the provisioning layer this extends).

## 1. Problem (verified)

`client/.env.local` (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY -- public client values,
gitignored via `client/.gitignore`: `.env.local` / `.env*.local` / `*.local`) exists ONLY
in the main checkout `~/backpack_ragnarok`. `git worktree add` checks out tracked files
only, so every worktree starts WITHOUT it.

Consequence chain:
- Vite bakes `import.meta.env.VITE_SUPABASE_URL` at build time (`client/src/auth/client.ts`);
  absent env -> `createSupabaseClient()` returns null -> the sign-in UI degrades to "not
  configured" and falls back to the REQ-0037 invite/guest path (DESIGNED degradation,
  REQ-0118c).
- `[6/7]` (`cd client && pnpm run build`) writes `web/app/` (`vite.config.ts` outDir,
  emptyOutDir) IN THE SAME TREE; nothing compares it to an env-carrying reference, so a
  worktree that builds an env-LESS `web/app` passes every gate silently. The e2e proxy
  (`client/e2e/local-proxy.cjs`, REQ-0051) serves THIS worktree's `web/app`, so `[7/7]`
  runs against the degraded bundle too -- but no spec asserts the sign-in configured state
  (see 4), so it stays green.
- This bit the REQ-0266 deploy: the merged worktree's committed `web/app` lacked Supabase
  env; fixed ad hoc by `42238f8` ("rebuild web/app in main checkout ... fresh build is the
  serving invariant"). That rebuild-on-main step is an unwritten deploy tax this REQ retires.

## 2. Root cause

A provisioning gap, not a code bug. `.env.local` is main-only and no worktree-setup step
copies it. REQ-0084 solved the `node_modules` equivalent (per-worktree `pnpm install`); the
same layer must carry `.env.local`.

## 3. Ships

### 3.1 Provisioning -- `tools/provision_worktree_env.sh`
Idempotent copy of the main checkout's `client/.env.local` into a target worktree's `client/`:
- Locates the main checkout via `dirname "$(git -C <target> rev-parse --path-format=absolute
  --git-common-dir)"` (robust from any worktree; the common `.git` lives in the main checkout).
- No-op (with a clear line) when the source is absent, or already byte-identical in the target.
  Copies with `install -m 600` (the file is secret-policy-gitignored).
- Skips any `*-artsession` tree (forbidden zone) and refuses to write into the main checkout itself.
- NEVER prints the file contents.
- `--all` sweeps every `~/backpack_ragnarok_worktrees/*` (skipping `*-artsession`) for
  retro-provisioning; default target is the git worktree of `$PWD`, or an explicit path arg.
Existing live worktrees retro-provisioned via `--all` (see 6).

Discovery: worktree setup is manual (REQ-0084's `setup-worktree.sh` never merged to master;
the manual `pnpm install --frozen-lockfile` loop is the documented convention). This script is
the minimal single-purpose artifact; its invocation is documented in `client/README.md` and the
deploy note (see 4). No PROJECT.md edit (LLMs must not touch it).

### 3.2 CI tripwire -- adjacent to `[6/7]` in `tools/ci.sh` (labelled `[6/7b]`)
After the client build, when `client/.env.local` exists in the tree under test:
- Extract the VITE_SUPABASE_URL host from `client/.env.local` (host only, never echoed) and
  grep the freshly built `web/app/assets/*.js` for it.
- Marker present -> PASS. Marker absent -> FAIL (the build ran without env -- the REQ-0266 trap).
When `client/.env.local` is absent: report NOT APPLICABLE WITH A REASON -- "no client/.env.local
in this tree; web/app built WITHOUT Supabase env (REQ-0118c degradation); provision with
tools/provision_worktree_env.sh before a deploy build" (a reason, never a free PASS -- REQ-0159
discipline). Guarded by the same `SKIP_CLIENT` gate as `[6/7]` (needs the build output). No
secret is ever printed.

### 3.3 Spec/e2e absence check (commission item 3)
Grepped the guest-auth (REQ-0037) + supabase (REQ-0118 lineage) specs and the `[5.9/7]`
`check_auth.mjs` unit gate: NONE asserts the UNCONFIGURED sign-in state. `guest-auth.spec.ts`
drives the invite/guest path (independent of Supabase env); `check_auth.mjs` injects a fake
client (env-independent). Provisioning makes worktree bundles env-CARRYING = byte-identical to a
main rebuild; the main checkout's committed `web/app` is already env-carrying AND master CI is
green, so provisioning cannot introduce a new red and depends on no absent-state fixture. No
fixture-scoped env removal is needed or added.

## 4. Retires the 42238f8 deploy convention

Post-provisioning, a worktree's `[6/7]` build and its committed `web/app` carry Supabase env and
are byte-identical to a `tools/release.sh` rebuild on main. Merging a worktree's `web/app` to
master therefore yields an env-carrying committed bundle with no separate rebuild-on-main.
`tools/release.sh` (the ONE deploy path) still rebuilds `web/app` as the serving invariant, but
that rebuild is now an env-CONFIRMING no-op w.r.t. Supabase, not an env-INJECTING step. The
`[6/7b]` tripwire is the machine check that a deploy-bound worktree's bundle actually carries
env. Deploy note recorded here and in `docs/llm_managed/architecture.md`; NOT PROJECT.md.

## 5. Gates / done-when

- DB-free sweep (`SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh`) green.
- Full `tools/ci.sh` green under a `/tmp/h0278` HOME-remap bridge (DATABASE_URL from
  `server/.env`), scoped e2e at decade 278 (`e2e_ports.sh`: base 2780, proxy 2782, fleet 2784+).
  `workshop.spec.ts:361` red is REQ-0256-owned (the sibling fixture-re-tune REQ's subject) and
  NOT this REQ's -- expected while that REQ has not landed in this tree; recorded in the gate note.
- `[6/7b]` tripwire proven BOTH ways: PASS with `.env.local` present (marker in web/app),
  NOT-APPLICABLE-with-reason with it absent.
- Existing worktrees retro-provisioned (`--all`), `*-artsession` skipped.

---

## 6. Outcome -- built 2026-07-22

### 6.1 Commits (branch `req-0278-worktree-env-provisioning`, off master `00befdf`)

| commit | what |
|---|---|
| `a4c5b71` | reserve stub (allocator) |
| `9cbb5aa` | this spec |
| `ce10e17` | reserved -> todo (user commissioned 2026-07-22) |
| `1be0550` | implementation: provision_worktree_env.sh + check_bundle_env.sh + ci.sh [6.1/7] + client/README.md + architecture.md |

### 6.2 Ships delivered

- `tools/provision_worktree_env.sh` -- idempotent; `--all` retro-provisioned the live
  worktrees: **77 provisioned + 1 already-identical (this tree) = 78, 0 warnings, 0
  *-artsession** (none present). The copied `client/.env.local` is gitignored, so no live
  worktree`s git status is dirtied (spot-checked req-0266 / req-0256 / req-0073: identical
  to main, mode 600).
- `tools/check_bundle_env.sh` + `ci.sh [6.1/7]` -- proven ALL THREE branches:
  OK (env present -> host in web/app), NOT-APPLICABLE-with-reason (env absent),
  FAIL (env present but bundle built without it -- the REQ-0266 trap). No secret printed.
- `client/README.md` (Worktree env section) + `docs/llm_managed/architecture.md` (deploy
  note retiring the 42238f8 rebuild-on-main-for-env step). PROJECT.md untouched.
- Item-3: no e2e/unit spec asserts the UNCONFIGURED sign-in state; provisioning makes worktree
  bundles env-carrying = byte-identical to a main rebuild (verified: post-build `git status
  web/app` clean -> the rebuild matched master`s committed env-carrying dist). No new red.

### 6.3 Gate results (HOME-remap bridge /tmp/h0278; DATABASE_URL from main server/.env)

- **DB-free sweep** `SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1 tools/ci.sh` -> **CI GREEN**.
- **Full `tools/ci.sh`**: every step GREEN through [6.6/8] --
  sim / goldens / mock / typecheck / drift / DB-free; [5/7] pg api + registry + the full art
  suite ([5.1] artwork 16/0, [5.15] artqueue **incl. G5** 5/0, [5.16] artfamily 2/0, [5.2]
  inspection 5/0, [4.7] golden 36/0); **[6/7] client build**; **[6.1/7] bundle-env tripwire ->
  `OK -- freshly built web/app carries the configured Supabase host`**; [6.5/8] admin trio +
  [6.6/8] registry-first e2e.
- **[7/7] scoped fleet** (REQ-0278 decade: proxy 2782, fleet 2784+, GPU, 4 workers):
  **191 passed / 5 failed**. The 5:
  - `forecast.spec.ts:206`, `schedule.spec.ts:1451` -- the documented tolerable load flakes.
  - `workshop.spec.ts:361` -- **REQ-0256-owned (the sibling fixture-re-tune REQ`s subject),
    NOT this REQ**; deterministically red on this tree because that REQ has not landed here.
    Expected-and-not-mine.
  - `bp-transfer.spec.ts:164`, `long-press-rename.spec.ts:25` -- interaction-timing load
    flakes (drag-commit / long-press windows under 4-worker GPU load). **Signature-verified**:
    an isolated scoped re-run of both files was **10 passed / 0 failed**. REQ-0278 has ZERO
    server/sim/engine/client-src/e2e delta (git diff master...HEAD = ci.sh +8, 2 new tool
    scripts, 2 docs), so none of the fleet reds can originate here.

### 6.4 Bridge-provisioning note (reproducibility; NOT a code change)

A fresh worktree lacks the gitignored `.venv`, and the bridge`s system python3 has no PIL, so
the art pg tests need, from the MAIN checkout: `ART_JOB_PYTHON=<main .venv>` (the ART_ROUTE_MOCK
generation worker needs PIL) and `ART_KIT_MATTE_METHOD=borderkey` (pure-numpy matte; the default
"auto" loads the 972 MB birefnet per kit spawn and REQ-0233 family-grouping then blocks the next
generation past its 30 s test budget). `ART_KIT_PYTHON` must be left to ci.sh`s per-step default
(worktree `.venv` symlinked to the main `.venv` for the run, removed after) -- a GLOBAL export
leaks it to artwork/artqueue, whose auto-enqueued kits then occupy the worker and break artqueue
G5 "first group leader runs first". This is pre-existing bridge friction, orthogonal to REQ-0278.

### 6.5 Deploy note

Deliverable: `built`, worktree clean, NOT merged (user acceptance later). On merge, a worktree`s
committed `web/app` already carries Supabase env (provisioned), so the ad-hoc `42238f8`
rebuild-web/app-on-main step is retired; `tools/release.sh` rebuild stays the serving invariant
(now env-confirming, not env-injecting), with `ci.sh [6.1/7]` as the machine check.

## 7. State log

- 2026-07-22 built -> MERGED to master (merge `9e8cb5e`, --no-ff off `00befdf`; pre-merge
  master kept as branch `backup-pre-req0278-0279`), user accepted 2026-07-22. **master CI
  green modulo the documented artadmin goto-under-load family ([6.5/8] artadmin:124/273,
  REQ-0222 lineage, tolerated with evidence by the REQ-0266 and REQ-0273 deploy records; all
  other steps green individually).** Verified this session on the merged tree (/tmp/hmaster
  bridge): the artadmin red re-confirmed to family signature ONCE from the existing logs +
  error-context (rendered SPA snapshot present -- full nav + banner + live/saved -- with
  `page.goto` load-event timeout on the same two tests :124/:273; reproduced identically on an
  isolated re-run, 6/8). Other [6.5/8] members run individually: artinspect 1/1, contentadmin
  28/28. [6.6/8] registry-first 4/4. [7/7] quiet serial confirmation fleet (E2E_PARALLEL=0,
  GPU on, art queue verified empty): **194 passed / 2 failed / 1 skipped** -- the 2 are the
  documented tolerable load flakes `forecast.spec.ts:206` (slot-pressure toBeVisible timeout)
  and `schedule.spec.ts:1451` (apiAssignSlot 409-vs-200), signatures verified identical to the
  REQ-0266/REQ-0273 blocks; interaction flakes bp-transfer:164 + long-press-rename:25 both
  GREEN this run. No push (mirror timer handles it).
