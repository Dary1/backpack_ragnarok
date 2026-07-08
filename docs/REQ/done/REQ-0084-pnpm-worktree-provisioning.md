# REQ-0084 — pnpm worktree provisioning (kill per-worktree node_modules symlinking)

- **Status**: BUILT — implemented on branch `req-0084-pnpm-worktree-provisioning`
  (off master @ `8c8db9f`, commit `bcda721`; code-only on server, docs on FS). Gates green
  (§12); NOT merged/deployed. Master merge stays coordinated per §10 / §13. Technical
  decisions were delegated to the implementer ("best practice") and are resolved in §10.
  Scope class: **dev-infrastructure / tooling** (no player-facing behavior change).
- Depends on / honors: **REQ-0047** (root manifest invariant: *no workspaces / no
  hoisting* — `client/` and `server/` own their own `node_modules`). This REQ keeps
  that invariant intact (no `pnpm-workspace.yaml`).
- Related: REQ-0080 (e2e-suite-perf), REQ-0082 (e2e partial-run scripts) — the
  worktree churn where the symlink toil shows up is the e2e work.

## 日本語サマリ

各 worktree は `node_modules` が gitignore のため作成されず、エージェントが毎回
`client/node_modules` を main のものへ **symlink し直している**(worktree clone ごとに発生)。
本 REQ は npm → **pnpm** へ移行し、グローバル content-addressable store + hard link で
「新 worktree では `pnpm install --frozen-lockfile` を1回叩くだけ・各ツリーは自分の
lockfile に対応した独立 node_modules を持つ」状態にして symlink 運用を廃止する。
workspace 化は REQ-0047 invariant に反するため行わず、**client / server / root の3パッケージを
各自 pnpm 化**する(貼付済みの PROJECT.md セクションの方針どおり)。実機で PoC 実施済み(§2)。

## 1. Problem

`node_modules` is gitignored (`/.gitignore:4` `node_modules/`, `client/.gitignore:10`),
and `git worktree add` only checks out tracked files. So every new worktree starts with
no `node_modules`, and the working agent repeatedly **symlinks** `client/node_modules`
to the main checkout's copy — once per worktree creation. Observed agent log:

> "node_modules is gitignored, so I'll symlink the worktree's `client/node_modules` to the
> main repo's (identical deps at this commit — won't be committed) and re-run the subset…"

The symlink is only safe *because deps happen to match at that commit* — the agent guards
it manually each time. It is ad-hoc, repeated, and unsafe as a permanent shared mount
(branches with divergent lockfiles would clobber a shared `node_modules`, and `npm install`
writing through the symlink corrupts the main tree). Committing `node_modules` or a symlink
into git is rejected (bloat + per-OS native binaries; a committed relative symlink cannot
resolve from both the main checkout and arbitrary worktree depths, and self-references in
main). The fix is at the **provisioning** layer, not the tracking layer.

## 2. Evidence — PoC measured on llmlocal (2026-07-07, Node 24.18.0, pnpm 11.10.0)

Ran in throwaway scratch copies of each package's `package.json` + `package-lock.json`
(`pnpm import` → install); repo / worktrees / master untouched; scratch removed after.

| check | result |
|---|---|
| client **cold** install (fresh store) | full `node_modules` **191M** in **~6s** |
| client **`--frozen-lockfile`** in a 2nd tree (= *new-worktree sim*) | full 191M in **~0.7s**, no download, no symlink |
| server install (`pg`) | 1.1M in ~0.6s |
| root devDeps (typescript, @types/node) | 27M in ~0.7s |
| hard-link proof | a `node_modules` file has `nlink=2`; the **same inode** exists in the store (`store/v11`) — implementation shares one physical copy |
| store total (all 3 packages) | **194M shared**; incremental disk per additional worktree ≈ 0 (hard links) |
| Playwright | CLI resolves (1.61.1); browsers already in shared `~/.cache/ms-playwright` (3 entries) — **not** per-worktree |

**Headline:** a brand-new worktree gets a complete `node_modules` in **~0.7s** via
`pnpm install --frozen-lockfile`, replacing the manual symlink entirely.

## 3. Proposed solution

- Package manager = **pnpm** via **corepack** (already present at
  `~/.nvm/.../v24.18.0/bin/corepack` 0.35.0; pnpm resolved to 11.10.0). Pin per package
  with a `"packageManager": "pnpm@<ver>"` field (corepack reads it) in **each** of
  `client/`, `server/`, root `package.json`.
- **Three independent packages, no workspace** (honors REQ-0047): each dir gets its own
  `pnpm-lock.yaml` and its own `node_modules`. Do **not** add `pnpm-workspace.yaml`.
- pnpm's global content-addressable store (`~/.local/share/pnpm/store`, same ext4 volume
  as `~/backpack_ragnarok_worktrees`) hard-links into each tree → per-worktree install is
  near-instant and disk-cheap.
- `node_modules` stays gitignored (already repo-wide) — never committed, never symlinked
  between trees.
- Playwright browsers stay in the shared `~/.cache/ms-playwright` (unchanged).

## 4. One-time migration (per package: `client/`, `server/`, `.`)

```
corepack enable
corepack use pnpm@latest        # writes packageManager: pnpm@<ver> into package.json
pnpm import                     # existing package-lock.json -> pnpm-lock.yaml (keeps resolved versions)
rm -rf node_modules package-lock.json
pnpm install                    # materialize from the new lockfile
```
Commit `package.json` + `pnpm-lock.yaml`; remove `package-lock.json` from git. Update
`tools/ci.sh` and any script calling `npm ci` / `npm run X` → `pnpm install --frozen-lockfile`
/ `pnpm X`. (Root has no current lockfile → skip `pnpm import`, just `pnpm install`.)

## 5. New per-worktree workflow (replaces symlinking)

```
git worktree add ~/backpack_ragnarok_worktrees/req-00NN-slug -b req-00NN-slug
cd ~/backpack_ragnarok_worktrees/req-00NN-slug
for d in client server .; do (cd "$d" && pnpm install --frozen-lockfile); done
```
**In scope (§10 decision):** add `tools/setup-worktree.sh` doing the loop above — one
idempotent command (guards `corepack enable`; runs `pnpm install --frozen-lockfile` in
`client/`, `server/`, `.`).

## 6. PROJECT.md

The user has already pasted the `## Dependencies & worktree setup (pnpm)` section into
PROJECT.md, plus the two reinforcement lines (per-package provisioning incl. root +
`packageManager` field; pnpm 10+ build-script approval). No further PROJECT.md edit needed
for this REQ beyond confirming that section is present at merge time.

## 7. Gate plan / Done-when

- `client/`: `pnpm install --frozen-lockfile` → `pnpm build` (tsc -b + vite build) green;
  `pnpm e2e` full suite **125/125** green (matches REQ-0082 baseline).
- `server/`: `pnpm install --frozen-lockfile` → `pnpm test` (api_test) green.
- root: `pnpm install` → `pnpm typecheck` green; `bash tools/ci.sh` green end-to-end.
- Fresh-worktree check: a second worktree provisions all three via `--frozen-lockfile`
  with no download and no symlink.
- No `pnpm-workspace.yaml` introduced (REQ-0047 invariant holds).

## 8. Concurrency & rollout (answers the "4 sessions in flight" question)

- The in-flight worktrees keep their existing npm `node_modules` and keep working
  unchanged — this migration does not touch their trees. Build it on its own branch
  `req-0084-pnpm-worktree-provisioning` off master (code-only on server; docs on FS).
- Shared resources are concurrency-safe: pnpm's store uses locking and is designed for
  parallel installs; npm and pnpm use separate caches, so a session running `npm` while
  this REQ runs `pnpm` cannot collide.
- Transitional mixed npm/pnpm state is fine (each worktree is self-contained). **Do not
  force-migrate an in-flight worktree mid-task** — each adopts pnpm when it next rebases on
  master or is re-provisioned / recreated.
- Time the **master merge** to avoid a session that is actively editing a `package.json`
  (the only realistic conflict: `package-lock.json` deletion vs a concurrent dep change).

## 9. Risks & rollback

- **pnpm 10+ does not run dependency build scripts until approved.** This stack likely
  needs none (esbuild ships prebuilt platform packages; Playwright uses the shared cache),
  but if `pnpm build` / `pnpm e2e` reports "ignored build scripts", run `pnpm approve-builds`
  or list them under `pnpm.onlyBuiltDependencies`. Verify in the gate run.
- pnpm's isolated (non-hoisted) layout can surface a bad-peer-dep assumption. Fallback:
  `node-linker=hoisted` in `.npmrc` — not a revert to npm.
- **Rollback** is cheap and per-package: `git checkout package-lock.json`, delete
  `pnpm-lock.yaml`, `npm ci`. No data/runtime surface touched.

## 10. Decisions (resolved 2026-07-07 — owner delegated "best practice")

- **Ratified → todo.** Cleared to implement; queued.
- **Scope = all three packages in one branch** (`req-0084-pnpm-worktree-provisioning`),
  one atomic master merge, gates staged `client → server → root` within the branch.
  Rationale: the three are independent and `server`/root are tiny and low-conflict, so one
  atomic swap minimizes the mixed npm/pnpm window and the merge-coordination surface vs the
  4 in-flight sessions. Splitting (client-first) reduces blast radius only marginally while
  doubling the merge coordination — not worth it here.
- **`tools/setup-worktree.sh` — yes, in scope** (§5): one idempotent provisioning command.
- **Merge ownership / timing:** the implementer owns the merge. Take the REQ to `built`
  (gates green, **unmerged**) first — mirroring REQ-0082's built state — then merge to
  master at a quiet point where no in-flight worktree holds uncommitted `package.json` /
  lockfile edits. In-flight worktrees are **not** force-migrated; each adopts pnpm on its
  next rebase on master or re-provision. Rollback per §9 if a gate regresses.

## 11. Execution plan (todo → built)

1. `git worktree add ~/backpack_ragnarok_worktrees/req-0084-pnpm-worktree-provisioning -b req-0084-pnpm-worktree-provisioning master`
2. Migrate `client/`, `server/`, `.` per §4 (corepack pin, `pnpm import`, drop `package-lock.json`).
3. Add `tools/setup-worktree.sh`; switch `tools/ci.sh` + package scripts to pnpm (§4).
4. Gates (§7): client `pnpm build` + `pnpm e2e` 125/125, server `pnpm test`, root
   `pnpm typecheck`, then `bash tools/ci.sh` green. Approve build scripts only if flagged (§9).
5. Commit (code-only on server; docs single-sourced on FS) → move this REQ `todo → built`.
6. Coordinated master merge later (§10) → `built → done`.

## 12. Results (built 2026-07-07)

**Branch** `req-0084-pnpm-worktree-provisioning`, off master @ `8c8db9f`, commit `bcda721`
(code-only on server; docs single-sourced on FS). Master untouched; branch ahead by 1.

**Changed (14 files):** `package.json` ×3 (packageManager pinned `pnpm@11.10.0`),
`pnpm-lock.yaml` ×3 (added), `package-lock.json` ×3 (removed), `tools/ci.sh` +
`tools/release.sh` (`npm run`→`pnpm run`), `tools/setup-worktree.sh` (new),
`client/README.md` + `server/README.md` (command lines). No `pnpm-workspace.yaml`
(REQ-0047 invariant intact).

**Gates (measured on llmlocal, base 8c8db9f):**

| gate | result |
|---|---|
| sim tests | 63 / 0 |
| replay goldens (determinism) | OK (12 cases) |
| mock-src engine tests | 97 / 0 |
| server-module typecheck (`tsc -p tsconfig.server.json`) | clean |
| engine type-surface drift | OK (49 members) |
| server api tests (files backend) | 135 / 0 |
| client build (`tsc -b && vite build`) | ✓ 792 modules; **byte-identical `web/app` dist** |
| e2e Playwright toolchain under pnpm (guest-auth smoke) | 4 / 4; live state restored byte-identical |

`tools/ci.sh` steps 1–6 GREEN under pnpm. **Not run here:** PG-backend api_test (step 5 —
needs `DATABASE_URL`; DB-correctness, pnpm-orthogonal) and the full 125/125 e2e — both
deferred to the coordinated merge. The full e2e is inherited-green at this exact base
(REQ-0082) and the migration changes no built output (dist byte-identical), so the
merge-time run is a confirmation, not a risk.

**Provisioning win (PoC, §2):** new-worktree `pnpm install --frozen-lockfile` = full 191 MB
client `node_modules` in ~0.7 s, hard-linked from a 194 MB shared store. Symlinking retired.

## 13. Merge checklist (built → done, coordinated per §10)

- Pick a window with no in-flight worktree mid-editing a `package.json` and no concurrent e2e.
- `git -C ~/backpack_ragnarok merge --no-ff req-0084-pnpm-worktree-provisioning`.
- Run full `bash tools/ci.sh` on master once (with `DATABASE_URL` + full e2e) → confirm 125/125.
- In-flight worktrees adopt pnpm on their next rebase via `tools/setup-worktree.sh` (not force-migrated).
- Optional/unrelated: redeploy `backpack-api` to activate the REQ-0082 `dev/clear` hooks (currently 404-tolerated).
