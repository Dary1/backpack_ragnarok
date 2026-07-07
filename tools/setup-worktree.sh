#!/usr/bin/env bash
# tools/setup-worktree.sh (REQ-0084) -- provision a fresh git worktree's dependencies.
#
# node_modules is gitignored and per-package (REQ-0047: no workspaces / no hoisting;
# client/, server/ and root each own their own). pnpm's global content-addressable
# store hard-links into each tree, so on a warm store this is near-instant. This
# replaces the old ad-hoc "symlink client/node_modules to the main checkout" step.
#
# Usage: tools/setup-worktree.sh   (run once, from anywhere in the worktree)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
if command -v pnpm >/dev/null 2>&1; then PNPM="pnpm"
elif command -v corepack >/dev/null 2>&1; then PNPM="corepack pnpm"   # reads packageManager field
else echo "setup-worktree: need pnpm or corepack on PATH" >&2; exit 1; fi
for d in client server .; do
  echo "==== ${PNPM} install --frozen-lockfile: ${d} ===="
  ( cd "$d" && $PNPM install --frozen-lockfile )
done
echo "worktree provisioned: client + server + root (no symlinking)."
