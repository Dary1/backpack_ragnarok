# REQ-0107 — pnpm lockfile formalization (commit pnpm-lock.yaml, drop package-lock.json)

Opened 2026-07-09. Surfaced during REQ-0094 (UnitTest Analysis) worktree
provisioning: an agent ran `npm ci` at the repo root without friction because
the root is de-facto npm-managed — directly contradicting PROJECT.md's pnpm rule.

## Problem
PROJECT.md ("Dependencies & worktree setup (pnpm)") mandates: pnpm via corepack;
the `packageManager` field pins the version; "Never use npm/yarn here and never
create package-lock.json/yarn.lock"; "Commit only pnpm-lock.yaml." The committed
tree on master is the inverse of every clause:

| dir      | committed lockfile   | pnpm-lock.yaml            | packageManager |
|----------|----------------------|---------------------------|----------------|
| (root)   | package-lock.json ✗  | none                      | none           |
| server/  | package-lock.json ✗  | none                      | none           |
| client/  | package-lock.json ✗  | present but **untracked** | none           |

Also: no `packageManager` pin in any package.json; `.gitignore` has no rule
guarding against `package-lock.json`, so npm lockfiles keep re-entering the tree.
Net: the rule is documented but wholly unenforced, and provisioning silently
drifts to npm (as REQ-0094 hit).

## Scope / changes (root, server/, client/)
1. Generate `pnpm-lock.yaml` (`pnpm install`) and commit it.
2. `git rm` the committed `package-lock.json`.
3. Add `"packageManager": "pnpm@<pinned>"` to each package.json.
4. Add `package-lock.json` and `yarn.lock` to `.gitignore` as a guard.

Confined to lockfile/manifest hygiene — no dependency version bumps; resolved
versions must match what is installed today.

## Done-when
- `git ls-files` shows `pnpm-lock.yaml` in root + server/ + client/, and NO
  `package-lock.json` anywhere.
- `pnpm install --frozen-lockfile` succeeds from clean in each dir.
- `SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh` → `CI GREEN` (root typecheck
  still resolves tsc from the pnpm store).
- Every package.json carries a `packageManager` pin; `.gitignore` blocks
  `package-lock.json`.

## Open questions
- pnpm version to pin. corepack is the intended launcher; the current node
  (nvm v24.18.0) ships pnpm 11.10.0. Pin to that, or to a corepack-managed version?
- client/ overlaps REQ-0084 (pnpm-worktree-provisioning); confirm the client
  lockfile generated here matches that workflow (node-linker etc.).
- Should this REQ also flip the root/server from their npm layout in the running
  main checkout, or only fix the committed tree (main-checkout re-provision is a
  hands-off, coordinate-first action)?

## Related
- REQ-0084 — pnpm-worktree-provisioning.
- REQ-0094 — pg_sync typecheck green; provisioning that exposed this.
- PROJECT.md "Dependencies & worktree setup (pnpm)".

## Outcome (built 2026-07-09)
Branch `req-0107-pnpm-lockfile-formalize`, commit **7d3f8f0** (off master e30ac8a).
Merged to master as **2db0a50** and accepted 2026-07-09 (see below). (Renumbered from
a transient REQ-0106 claim that raced with the unrelated live
done/REQ-0106-styleguide-sfx-wav.)

Changes (lockfile/manifest hygiene only; no dependency version bumps):
- Committed `pnpm-lock.yaml` for root, server/, client/ (generated `--lockfile-only`).
- `git rm` package-lock.json in all three.
- Pinned `"packageManager": "pnpm@11.10.0"` in each package.json (corepack 0.35.0,
  node nvm v24.18.0 ships pnpm 11.10.0).
- Added a root `.gitignore` guard blocking `package-lock.json` / `yarn.lock`.

Gates (green):
- `pnpm install --frozen-lockfile` passes in root, server/ and client/ (client also
  "passes supply-chain policies"). Confirms each lock matches its manifest.
- `SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh` → `CI GREEN`; the root
  typecheck resolves `tsc` from the pnpm store (no npm).
- `git ls-files` now lists pnpm-lock.yaml ×3 and zero package-lock.json.

Open-question resolutions / notes:
- pnpm pinned to 11.10.0 (what corepack/nvm provide today); adjust if a different
  corepack version is standardized.
- Scope limited to the committed tree. Re-provisioning the running MAIN checkout
  (root/server still have npm-layout node_modules there) is hands-off /
  coordinate-first and was NOT touched.
- Full client `pnpm run build` (SKIP_CLIENT) not exercised here; the client lock is
  verified consistent (frozen), but the heavier client build gate is left to the
  user / REQ-0084 flow.

## Merged & deployed (2026-07-09)
State: **done** — merged to master (explicit user go-ahead 2026-07-09).
- Merge commit **2db0a50** (`git merge --no-ff req-0107-pnpm-lockfile-formalize`,
  on top of the REQ-0094 merge bcf4824); `git merge-tree` preview showed zero
  conflicts. Master now tracks `pnpm-lock.yaml` ×3 and **no** `package-lock.json`;
  post-merge `ci.sh` (SKIP_PG/CLIENT/E2E) → CI GREEN.
- No service deploy/restart required: lockfile/manifest hygiene has zero runtime
  effect, and the running services keep their existing node_modules. The committed
  pnpm locks govern the NEXT clean provision. Re-provisioning the running main
  checkout to a pnpm node_modules layout remains a separate, coordinate-first step
  (intentionally not done here).
