#!/usr/bin/env bash
# tools/release.sh -- REQ-0047 (h): the ONE deploy path. Runs the full
# gate, rebuilds the committed dist (web/app/), and commits it only if
# everything is green and the dist actually changed.
set -euo pipefail
cd "$(dirname "$0")/.."

REL_T0=$(date +%s)

# REQ-0339: THE FULL GATE, ALWAYS. ci.sh scopes its two e2e families from the
# diff (tools/ci_scope.sh) so an admin-only change does not pay 182 s for the
# client e2e suite and vice versa. That trade is fine for the many runs during
# development; it is NOT fine here. release.sh is the path that lets code OUT --
# it rebuilds and commits the dist that the live services serve -- and the whole
# scoping mechanism rests on a hand-written classification table. If that table
# is ever wrong, the run that must not be the one to find out is this one.
# So: no scoping on the release path, stated in one obvious line, not implied.
# REQ-0353 (section 6, choice (a)): the content drift gate, ACTUALLY RUN.
# tools/verify_content_registry_parity.cjs has described itself as "the standing
# drift check the deploy runs on LIVE" since REQ-0178 -- but no deploy path ever
# ran it, so its STOP printed to nobody: 44 monsters shipped without their
# REQ-0299 flavor skills (REQ-0353) and monster_pack drifted unseen (REQ-0352).
# It runs HERE, against the live DB (server/.env), and DRIFT fails the release.
# A missing server/.env also fails the release, deliberately: a gate that is
# skipped when credentials are absent is exactly the not-run gate this fixes.
# REQ-0354 section 6: --strict makes this THE served-set==passing-set gate --
# MISSING-IN-REGISTRY and UNADOPTED now block the release too, not just DRIFT
# (a served entity with no passing adopted variant IS a set mismatch). Landed
# UNFLAGGED: REQ-0352/0353 reconciled the corpus first (MATCH=413, all other
# counts 0), so the gate is green on the tree it ships with.
echo "[release] content registry drift gate (REQ-0353; --strict: REQ-0354 section 6)"
(
  set -a; . server/.env; set +a
  export STORAGE_BACKEND=pg
  node tools/verify_content_registry_parity.cjs --strict
)

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

# REQ-0343: re-issue the CI receipt for the tree AS IT NOW STANDS.
#
# ci.sh already wrote one, for the tree at the moment the gate finished. The
# rebuild+commit above can move the tree (web/app), and a receipt for a tree
# nobody is pushing is no receipt at all -- the push gate would reject the very
# commit release.sh just made, which is the one case it must not.
#
# Re-issuing is honest here, and only here, for two specific reasons:
#   * the only thing that changed is web/app, which tools/ci_scope.sh classifies
#     `ignored` (row 1), so it cannot change the required scope; and
#   * since REQ-0341 the bundle is a pure function of client/src -- it reads no
#     VITE_* env -- and ci.sh built and e2e-tested exactly that source at [6/7].
# So the same gate covers the same code. If either of those stops being true,
# this line stops being honest and must go.
#
# The scope is `both` because line 15 forced the full gate; it is written
# literally rather than read back from anywhere, so weakening the gate above
# cannot silently weaken the claim down here.
bash tools/ci_receipt.sh write both "$(( $(date +%s) - REL_T0 ))" tools/release.sh \
  || echo "[ci-receipt] NOT WRITTEN (see above) -- the push gate will reject this tree." >&2

echo "release checks complete. Restart the service to pick up server changes:"
echo "  systemctl --user restart backpack-api"
