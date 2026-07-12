#!/usr/bin/env bash
# tools/offsite_mirror.sh -- REQ-0132: offsite backup mirror to GitHub.
#
# Pushes every branch and tag of the main checkout to the `offsite` remote
# (github.com:Dary1/backpack_ragnarok, private; deploy key
# ~/.ssh/backpack_github_ed25519 via ~/.ssh/config). Deletion-safe by design:
# no --mirror, no --prune, no --force -- local damage never propagates
# deletions to the mirror.
#
# Also keeps a daily on-box tarball of ~/backpack_ragnarok_state (REQ counter;
# policy: never committed to git). Off-box counter recovery after total loss:
# tools/touch_next_req_reserved.py --seed-only (see REQ-0132 recovery notes).
#
# Runs via systemd --user timer backpack-mirror.timer (every 15 min).
# Manual run: tools/offsite_mirror.sh
set -euo pipefail

REPO="$HOME/backpack_ragnarok"
STATE_SRC="$HOME/backpack_ragnarok_state"
OUT="$HOME/.local/state/backpack_mirror"
LOCK="$OUT/.lock"
KEEP_TARBALLS=14

mkdir -p "$OUT"
exec 9>"$LOCK"
flock -n 9 || { echo "another mirror run holds the lock; exiting"; exit 0; }

cd "$REPO"
git push --quiet offsite --all
git push --quiet offsite --tags

# Daily state-dir tarball (on-box convenience; survives repo damage, not box loss)
today="$(date +%Y%m%d)"
tarball="$OUT/backpack_state_$today.tar.gz"
if [ ! -e "$tarball" ] && [ -d "$STATE_SRC" ]; then
  tar -czf "$tarball.tmp" -C "$(dirname "$STATE_SRC")" "$(basename "$STATE_SRC")"
  mv "$tarball.tmp" "$tarball"
  ls -1t "$OUT"/backpack_state_*.tar.gz 2>/dev/null | tail -n +$((KEEP_TARBALLS+1)) | xargs -r rm --
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/last_success"
echo "mirror OK: master=$(git rev-parse --short master), $(git for-each-ref refs/heads | wc -l) branches pushed"
