#!/usr/bin/env bash
# tools/release.sh -- REQ-0047 (h): the ONE deploy path. Runs the full
# gate, rebuilds the committed dist (web/app/), and commits it only if
# everything is green and the dist actually changed.
set -euo pipefail
cd "$(dirname "$0")/.."

# REQ-0339: THE FULL GATE, ALWAYS. ci.sh scopes its two e2e families from the
# diff (tools/ci_scope.sh) so an admin-only change does not pay 182 s for the
# client e2e suite and vice versa. That trade is fine for the many runs during
# development; it is NOT fine here. release.sh is the path that lets code OUT --
# it rebuilds and commits the dist that the live services serve -- and the whole
# scoping mechanism rests on a hand-written classification table. If that table
# is ever wrong, the run that must not be the one to find out is this one.
# So: no scoping on the release path, stated in one obvious line, not implied.
export CI_SCOPE=both
bash tools/ci.sh
(cd client && pnpm run build)
if git status --porcelain web/app | grep -q .; then
  git add web/app
  git commit -m "dist rebuild (web/app/) via tools/release.sh -- CI green"
  echo "dist committed."
else
  echo "dist unchanged -- nothing to commit."
fi
echo "release checks complete. Restart the service to pick up server changes:"
echo "  systemctl --user restart backpack-api"
