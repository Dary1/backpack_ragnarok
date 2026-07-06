#!/usr/bin/env bash
# tools/release.sh -- REQ-0047 (h): the ONE deploy path. Runs the full
# gate, rebuilds the committed dist (web/app/), and commits it only if
# everything is green and the dist actually changed.
set -euo pipefail
cd "$(dirname "$0")/.."
bash tools/ci.sh
(cd client && npm run build)
if git status --porcelain web/app | grep -q .; then
  git add web/app
  git commit -m "dist rebuild (web/app/) via tools/release.sh -- CI green"
  echo "dist committed."
else
  echo "dist unchanged -- nothing to commit."
fi
echo "release checks complete. Restart the service to pick up server changes:"
echo "  systemctl --user restart backpack-api"
