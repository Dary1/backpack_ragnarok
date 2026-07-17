#!/usr/bin/env bash
# tools/release.sh -- REQ-0047 (h): the ONE deploy path. Runs the full
# gate, rebuilds the committed dist (web/app/), and commits it only if
# everything is green and the dist actually changed.
set -euo pipefail
cd "$(dirname "$0")/.."
# REQ-0222: the e2e steps inside ci.sh run through tools/e2e_flaky_gate.sh.
# A failure whose EVERY red matches tools/e2e_known_flaky.tsv (the
# provenance-carrying known-flaky registry) is rerun ONCE via the box-locked
# runner before this deploy can abort; any unknown failure aborts
# immediately. This codifies the REQ-0182b/REQ-0191 manual recovery
# convention -- no more hand-run e2e + hand-committed dist after a
# goto-under-load flake.
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
