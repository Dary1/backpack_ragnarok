#!/usr/bin/env bash
# tools/install_push_gate.sh -- REQ-0343. Install (or verify) tools/pre_receive_gate.sh
# as the pre-receive hook of the bare repo this tree pushes to.
#
# The hook body is TRACKED here and merely COPIED into the bare repo. The copy
# is deliberate and the asymmetry is the point:
#
#   * the CLASSIFIER the hook uses is read out of the PUSHED tree, so it always
#     matches the code being judged (see tools/pre_receive_gate.sh);
#   * the HOOK ITSELF is the installed copy, never the pushed one, because a
#     hook that came from the push it is judging is not a hook. Installing is
#     therefore an out-of-band act by a person, exactly once per repo, and
#     `--check` is how you find out it has drifted.
#
# USAGE
#   tools/install_push_gate.sh [<bare-repo>]           install / overwrite
#   tools/install_push_gate.sh --check [<bare-repo>]   compare, exit 1 on drift
# <bare-repo> defaults to remote.origin.url when that is a local path.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MODE=install
if [ "${1:-}" = "--check" ]; then MODE=check; shift; fi

BARE="${1:-}"
if [ -z "$BARE" ]; then
  BARE="$(git config --get remote.origin.url 2>/dev/null || true)"
fi
case "$BARE" in
  /*) ;;
  '') echo "[push-gate] no remote 'origin' and no path given" >&2; exit 2 ;;
  *)  echo "[push-gate] origin '$BARE' is not a local path -- pass the bare repo path" >&2; exit 2 ;;
esac
if [ ! -d "$BARE" ]; then
  echo "[push-gate] '$BARE' does not exist (external disk not mounted?)" >&2; exit 1
fi
if [ "$(git --git-dir="$BARE" rev-parse --is-bare-repository 2>/dev/null || echo no)" != true ]; then
  echo "[push-gate] '$BARE' is not a bare repository" >&2; exit 1
fi

SRC=tools/pre_receive_gate.sh
DST="$BARE/hooks/pre-receive"

if [ "$MODE" = check ]; then
  if [ ! -f "$DST" ]; then
    echo "[push-gate] NOT INSTALLED: $DST is missing -- the gate is OFF" >&2; exit 1
  fi
  if ! cmp -s "$SRC" "$DST"; then
    echo "[push-gate] DRIFT: $DST differs from $SRC" >&2
    diff -u "$SRC" "$DST" >&2 || true
    exit 1
  fi
  if [ ! -x "$DST" ]; then
    echo "[push-gate] $DST matches $SRC but is NOT EXECUTABLE -- git will ignore it" >&2; exit 1
  fi
  echo "[push-gate] installed and identical to $SRC ($(sha256sum "$SRC" | cut -c1-16)...)"
  exit 0
fi

mkdir -p "$BARE/hooks"
install -m 0755 "$SRC" "$DST"
mkdir -p "$BARE/ci-receipts"
echo "[push-gate] installed $SRC -> $DST"
echo "[push-gate] receipts:  $BARE/ci-receipts"
