#!/usr/bin/env bash
# tools/provision_worktree_env.sh -- REQ-0278: carry client/.env.local into a worktree.
#
# client/.env.local (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY -- PUBLIC client
# values, but gitignored by the project secret policy: client/.gitignore) exists
# ONLY in the main checkout. `git worktree add` checks out tracked files only, so a
# fresh worktree builds an env-LESS web/app: sign-in silently degrades to "not
# configured" (REQ-0118c) and no gate sees it (the [6/7] build and the e2e proxy
# both use the SAME tree). This bit the REQ-0266 deploy (42238f8 rebuilt web/app on
# main to re-inject env). Fixed at the provisioning layer, like REQ-0084 did for
# node_modules: copy the file from the main checkout into the worktree.
#
# Idempotent. Never prints the file contents. Skips *-artsession trees and refuses
# to write the main checkout.
#
# Usage:
#   tools/provision_worktree_env.sh          # provision the worktree containing $PWD
#   tools/provision_worktree_env.sh <path>   # provision a specific worktree
#   tools/provision_worktree_env.sh --all    # sweep ~/backpack_ragnarok_worktrees/*
set -euo pipefail

REL="client/.env.local"

# The common .git dir lives in the main checkout; its parent is the main root.
main_checkout_of() {
  dirname "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)"
}

provision_one() {
  local target="$1" name src dst main
  name="$(basename "$target")"
  case "$name" in
    *-artsession) echo "[provision-env] skip $name (artsession -- forbidden zone)"; return 0 ;;
  esac
  if [ ! -e "$target/.git" ]; then
    echo "[provision-env] skip $target (not a git worktree)"; return 0
  fi
  main="$(main_checkout_of "$target")"
  if [ "$(readlink -f "$target")" = "$(readlink -f "$main")" ]; then
    echo "[provision-env] skip $name (this IS the main checkout -- nothing to copy)"; return 0
  fi
  if [ ! -d "$target/client" ]; then
    echo "[provision-env] skip $name (no client/ dir)"; return 0
  fi
  src="$main/$REL"; dst="$target/$REL"
  if [ ! -f "$src" ]; then
    echo "[provision-env] $name: main checkout has no $REL -- nothing to provision (build uses the REQ-0118c fallback)"; return 0
  fi
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    echo "[provision-env] $name: $REL already present + identical -- ok"; return 0
  fi
  install -m 600 "$src" "$dst"
  echo "[provision-env] $name: $REL provisioned from main checkout"
}

main() {
  if [ "${1:-}" = "--all" ]; then
    local root="$HOME/backpack_ragnarok_worktrees" d
    [ -d "$root" ] || { echo "[provision-env] no $root"; return 0; }
    for d in "$root"/*/; do
      [ -d "$d" ] || continue
      provision_one "${d%/}" || echo "[provision-env] WARN: ${d%/} failed -- continuing"
    done
    return 0
  fi
  local target
  if [ -n "${1:-}" ]; then
    target="$1"
  else
    target="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$target" ] || { echo "[provision-env] not in a git worktree; pass a path or --all" >&2; return 1; }
  fi
  provision_one "$target"
}

main "$@"
