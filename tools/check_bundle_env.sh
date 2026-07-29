#!/usr/bin/env bash
# tools/check_bundle_env.sh -- REQ-0278, repaired by REQ-0340.
#
# web/app is a TRACKED build artifact whose contents depend on a GITIGNORED
# input (client/.env.local, main-checkout-only). Vite inlines VITE_* at build
# time (client/src/auth/client.ts), so a build in a worktree that never got
# .env.local bakes an env-LESS bundle and sign-in silently degrades to
# "not configured" (REQ-0118c). Committing that bundle ships dead auth.
#
# That has now happened TWICE: REQ-0266 (fixed by rebuilding on main, 42238f8)
# and REQ-0337 (bundle merged in 2517c83, hotfixed in e8f2b77). REQ-0278 built
# this tripwire after the first one. It did not stop the second, for two
# reasons that REQ-0340 fixes:
#
#   1. FREE PASS. The check `exit 0`-ed whenever client/.env.local was absent
#      -- which is EXACTLY the condition under which the accident happens. The
#      header claimed "REQ-0159: never a free PASS" while being one.
#   2. WRONG SUBJECT. It only inspected the tree's freshly built output. What
#      ships is whatever web/app is COMMITTED, and nothing looked at that.
#
# The three checks below replace it. (A) is env-independent and therefore runs
# in EVERY tree, including the worktrees where the accident occurs; it is the
# one that would have caught 2517c83 directly.
#
# ---------------------------------------------------------------------------
# A NOTE ON DETECTION, because it burned an hour of a session:
# minified output writes these as BARE identifier keys with BACKTICK values --
#
#     {BASE_URL:`/app/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,
#      VITE_SUPABASE_URL:`https://...`,VITE_SUPABASE_ANON_KEY:`eyJ...`}
#
# not `"VITE_SUPABASE_URL": "..."`. Any probe that assumes double quotes reports
# a correctly-configured bundle as broken. Equally, grepping for the literal
# string VITE_SUPABASE_URL is USELESS as a gate: client.ts calls
# readEnv('VITE_SUPABASE_URL'), so that string survives into an env-LESS bundle
# too and such a grep always passes. Match on the KEY-COLON-VALUE shape with a
# quote-agnostic value, or on the host value itself as a fixed string.
# ---------------------------------------------------------------------------
#
# The host and key values are PUBLIC (client/.env.example) but are never echoed.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="client/.env.local"
WEB_APP="web/app"
fail=0

if [ ! -d "$WEB_APP/assets" ]; then
  echo "[bundle-env] FAIL -- $WEB_APP/assets missing; run the client build ([6/7]) before this check." >&2
  exit 1
fi

# ---- (A) the COMMITTED bundle must carry both VITE_SUPABASE_* with non-empty
#          values. Env-independent: no client/.env.local needed, so this runs
#          in every worktree. This is the check the accident needed.
_check_committed_bundle() {
python3 - "$1" <<'PY'
import glob, re, sys
web = sys.argv[1]
files = sorted(glob.glob(web + '/assets/index-*.js'))
if not files:
    print('[bundle-env] (A) FAIL -- no index-*.js under %s/assets' % web); raise SystemExit(1)
missing = []
for key in ('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'):
    # bare key, then ANY of the three JS quote styles, then a non-empty value
    pat = re.compile(re.escape(key) + r'\s*:\s*([\'"`])((?:(?!\1).)+)\1')
    if not any(pat.search(open(f, encoding='utf-8', errors='ignore').read()) for f in files):
        missing.append(key)
if missing:
    print('[bundle-env] (A) FAIL -- the built bundle has no non-empty ' + ', '.join(missing) + '.')
    print('[bundle-env]     This is the REQ-0266 / REQ-0337 trap: a build without client/.env.local.')
    print('[bundle-env]     Rebuild where .env.local exists, or run tools/provision_worktree_env.sh first.')
    raise SystemExit(1)
print('[bundle-env] (A) OK -- bundle carries non-empty VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.')
PY
}

# ---- --selftest: prove check (A) actually rejects an env-less bundle.
# REQ-0340: the reason this file needed repairing is that its predecessor was
# ASSUMED to be a gate for four weeks while being a free pass. A gate nobody has
# watched fail is a claim, not a check -- so this mode builds both bundle shapes
# in a temp dir and asserts the verdicts, in ci.sh, on every run.
if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/good/assets" "$tmp/bad/assets"
  # Shapes copied from real minified output: BARE keys, BACKTICK values.
  printf '%s\n' 'let t={BASE_URL:`/app/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,VITE_SUPABASE_ANON_KEY:`eyJhbGciOi`,VITE_SUPABASE_URL:`https://example.supabase.co`};' \
    > "$tmp/good/assets/index-aaaa.js"
  # The env-LESS bundle still contains the literal 'VITE_SUPABASE_URL' as the
  # argument to readEnv() -- which is exactly why a naive grep for that string
  # is not a gate. The check must require KEY:VALUE, and reject this.
  printf '%s\n' 'let t={BASE_URL:`/app/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1};return t?t[e]:void 0}Ex("VITE_SUPABASE_URL");' \
    > "$tmp/bad/assets/index-bbbb.js"
  st=0
  if _check_committed_bundle "$tmp/good" >/dev/null 2>&1; then
    echo "[bundle-env] selftest OK   -- an env-BEARING bundle passes (A)"
  else
    echo "[bundle-env] selftest FAIL -- an env-bearing bundle was rejected by (A)" >&2; st=1
  fi
  if _check_committed_bundle "$tmp/bad" >/dev/null 2>&1; then
    echo "[bundle-env] selftest FAIL -- an env-LESS bundle PASSED (A) -- the free pass is back" >&2; st=1
  else
    echo "[bundle-env] selftest OK   -- an env-less bundle is rejected (A), despite carrying the literal key name"
  fi
  exit "$st"
fi

if _check_committed_bundle "$WEB_APP"; then :; else fail=1; fi

# ---- (B) an env-LESS tree must not be about to COMMIT a bundle. Closes the
#          free pass: "no .env.local" is fine only while web/app is untouched.
if [ ! -f "$ENV_FILE" ]; then
  if [ -n "$(git status --porcelain -- "$WEB_APP" 2>/dev/null)" ]; then
    echo "[bundle-env] (B) FAIL -- no $ENV_FILE in this tree, yet $WEB_APP has uncommitted changes." >&2
    echo "[bundle-env]     A tree without the env MUST NOT produce a bundle for commit (REQ-0266/0337)." >&2
    echo "[bundle-env]     Run tools/provision_worktree_env.sh, rebuild, or discard the web/app changes." >&2
    fail=1
  else
    echo "[bundle-env] (B) n/a -- no $ENV_FILE, and $WEB_APP is unchanged (nothing being shipped from here)."
  fi
else
  # ---- (C) with the env present, the built bundle must carry THIS tree's host
  #          (the original REQ-0278 assertion; fixed-string, quote-agnostic).
  host="$(sed -n 's#^VITE_SUPABASE_URL=https\?://\([^/[:space:]]*\).*#\1#p' "$ENV_FILE" | head -n1)"
  if [ -z "$host" ]; then
    echo "[bundle-env] (C) FAIL -- $ENV_FILE present but has no parseable VITE_SUPABASE_URL host." >&2
    fail=1
  elif grep -rFq -- "$host" "$WEB_APP/assets" 2>/dev/null; then
    echo "[bundle-env] (C) OK -- built bundle carries THIS tree's configured Supabase host."
  else
    echo "[bundle-env] (C) FAIL -- $ENV_FILE is present but the built $WEB_APP does not contain its host." >&2
    echo "[bundle-env]     The build ran without the env. Rebuild with $ENV_FILE present." >&2
    fail=1
  fi
fi

exit "$fail"
