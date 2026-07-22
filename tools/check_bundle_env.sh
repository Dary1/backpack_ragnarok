#!/usr/bin/env bash
# tools/check_bundle_env.sh -- REQ-0278: prove the freshly built client bundle
# (web/app) carries the Supabase env when THIS tree has client/.env.local.
#
# Vite bakes VITE_SUPABASE_URL into web/app at build time (client/src/auth/client.ts).
# A worktree missing client/.env.local (gitignored, main-only) builds an env-LESS
# bundle and sign-in silently degrades to "not configured" (REQ-0118c) -- the exact
# REQ-0266 deploy trap. The committed-bundle path never had a machine check for this;
# this tripwire is it, run adjacent to ci.sh [6/7] on the freshly built output.
#
#   .env.local PRESENT -> the built bundle MUST contain the configured host, or FAIL.
#   .env.local ABSENT  -> NOT APPLICABLE, with a reason (REQ-0159: never a free PASS),
#                         pointing at tools/provision_worktree_env.sh.
#
# The host is a PUBLIC value (client/.env.example) but is never echoed regardless.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="client/.env.local"
WEB_APP="web/app"

if [ ! -f "$ENV_FILE" ]; then
  echo "[bundle-env] NOT APPLICABLE -- no $ENV_FILE in this tree; web/app was built WITHOUT"
  echo "[bundle-env]   Supabase env (the REQ-0118c 'not configured' degradation is expected here)."
  echo "[bundle-env]   A DEPLOY-BOUND tree must run tools/provision_worktree_env.sh first (REQ-0278)."
  exit 0
fi

# Host only (scheme + path stripped); never printed.
host="$(sed -n 's#^VITE_SUPABASE_URL=https\?://\([^/[:space:]]*\).*#\1#p' "$ENV_FILE" | head -n1)"
if [ -z "$host" ]; then
  echo "[bundle-env] FAIL -- $ENV_FILE present but has no parseable VITE_SUPABASE_URL host." >&2
  exit 1
fi
if [ ! -d "$WEB_APP/assets" ]; then
  echo "[bundle-env] FAIL -- $WEB_APP/assets missing; run the client build ([6/7]) before this check." >&2
  exit 1
fi

# Fixed-string, quiet, recursive over the built JS. Host value never echoed.
if grep -rFq -- "$host" "$WEB_APP/assets" 2>/dev/null; then
  echo "[bundle-env] OK -- freshly built web/app carries the configured Supabase host (env baked in)."
  exit 0
fi
echo "[bundle-env] FAIL -- $ENV_FILE is present but the built web/app does NOT contain its Supabase host." >&2
echo "[bundle-env]   The build ran without the env (the REQ-0266 trap). Rebuild client with client/.env.local present." >&2
exit 1
