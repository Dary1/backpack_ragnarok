#!/usr/bin/env bash
# REQ-0117 — serialize e2e runs on the shared box.
#
# The e2e suite is whole-box exclusive: all DATA is per-run throwaway
# (REQ-0217 hermetic harness), but runs still share the fixed proxy/fleet
# PORTS (8803, 8810+) and the /tmp/bp_e2e_workers tree, so two concurrent
# runs would fight over those. This wrapper
# takes an exclusive advisory lock held for the WHOLE run, so at most one
# run touches the box at a time.
#
#   - default:            QUEUE — wait up to E2E_LOCK_WAIT seconds (1800), then run.
#   - E2E_LOCK_NONBLOCK=1: FAIL FAST — exit 75 immediately if the box is busy.
#
# The lock lives on fd 9, which is inherited across the `exec` below and for
# the whole playwright process tree, so it releases automatically when the
# run ends OR the process dies (crash-safe — no stale lock to clean up).
#
# Run e2e ONLY through this script (pnpm run e2e routes here). A direct
# `playwright test` is caught by global-setup's in-harness safety net.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/../client"

LOCK_FILE="${E2E_LOCK_FILE:-$HOME/.cache/backpack/e2e.box.lock}"
mkdir -p "$(dirname "$LOCK_FILE")"

# fd 9 -> the lock file; survives exec, held for the whole run.
exec 9>"$LOCK_FILE"

# REQ-0234 (F2): if the lock is already held, say so IMMEDIATELY -- who holds
# it, and whether it is the REQ-0217 freeze -- instead of stalling silently
# for up to E2E_LOCK_WAIT seconds and dying with a bare exit 75.
if ! flock -n 9; then
  echo "[e2e-lock] $LOCK_FILE is HELD (holder pid(s):$(fuser "$LOCK_FILE" 2>/dev/null || echo ' unknown'))" >&2
  if [ "$LOCK_FILE" = "$HOME/.cache/backpack/e2e.box.lock" ] && [ -f "$HOME/.cache/backpack/E2E_FREEZE_README.txt" ]; then
    echo "[e2e-lock] the e2e BOX FREEZE is likely active (REQ-0217): see ~/.cache/backpack/E2E_FREEZE_README.txt" >&2
    echo "[e2e-lock] a rebased tree should run SCOPED instead -- tools/ci.sh [7/7] does this automatically from a req-NNNN worktree (REQ-0234)" >&2
  fi
fi

if [ "${E2E_LOCK_NONBLOCK:-0}" = "1" ]; then
  if ! flock -n 9; then
    echo "[e2e-lock] box busy: another e2e run holds $LOCK_FILE. E2E_LOCK_NONBLOCK=1 -> abort." >&2
    exit 75
  fi
else
  WAIT="${E2E_LOCK_WAIT:-1800}"
  if ! flock -w "$WAIT" 9; then
    echo "[e2e-lock] timed out after ${WAIT}s waiting for the box lock ($LOCK_FILE)." >&2
    exit 75
  fi
fi

echo "[e2e-lock] acquired box lock ($LOCK_FILE) — holder pid $$" >&2
export E2E_BOX_LOCK_HELD=1

cd "$CLIENT_DIR"
if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm exec playwright test "$@"
elif command -v pnpm >/dev/null 2>&1; then
  exec pnpm exec playwright test "$@"
else
  exec ./node_modules/.bin/playwright test "$@"
fi
