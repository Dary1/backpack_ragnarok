#!/usr/bin/env bash
# tools/e2e_harness_lib.sh -- REQ-0248. The shared rig behind every isolated
# pg e2e harness (art_inspect / artadmin / content_admin / registry_first).
#
# WHY. The four harnesses were copy-descendants of one another: each carried
# its own byte-identical HOME remap, PIDS/trap cleanup, api + local-proxy
# bringup, two curl readiness loops and e2e_run.sh invocation -- ~60 lines of
# rig around ~10 lines of actual difference. That shape has already cost us:
# a fix had to be applied four times or not at all (REQ-0234's F7 fleet-base
# fix and REQ-0233's ART_FAMILY_BARRIER=0 were each pasted into three files),
# and the ONE line that was not pasted uniformly is exactly where the bugs
# lived. The rig is now written once, here; a harness declares only what makes
# it different.
#
# A harness is expected to read, top to bottom:
#   source "$(dirname "$0")/e2e_ports.sh" 0NNN      # REQ-0172: derived ports
#   source "$(dirname "$0")/e2e_harness_lib.sh"
#   e2e_harness_init my_name
#   e2e_harness_home                                 # isolated pg namespace
#   e2e_harness_start_api FOO=1 BAR=2
#   e2e_harness_start_proxy
#   e2e_harness_wait
#   e2e_harness_run e2e/my.config.ts
#
# NOTE the ports helper is still sourced BY THE HARNESS, not from here: the
# REQ-0172 gate (tools/check_e2e_ports.cjs) greps each harness for its own
# `source .../e2e_ports.sh 0NNN` line, so the REQ number a harness claims stays
# visible in the harness itself rather than hiding behind an argument.
#
# Every harness that sources this is HERMETIC (REQ-0217): it never touches the
# live services, the live rows, or the live checkout's data.

[ -n "${_E2E_HARNESS_LIB:-}" ] && return 0
_E2E_HARNESS_LIB=1

# Captured BEFORE any HOME remap: the per-run remap below would otherwise hide
# the real home, and two things must keep resolving to it --
#   - the serialization lock (a per-run lock file would serialize nothing);
#   - REQ-0133: Playwright's chromium lives in the REAL home's cache.
_E2E_REAL_HOME="$HOME"
_E2E_PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

_E2E_TMPDIRS=()
_E2E_PIDS=()

# Root of the worktree UNDER TEST. Derived from this file's own location, so it
# is the tree the harness was invoked from -- never ~/backpack_ragnarok.
E2E_WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

_e2e_harness_cleanup() {
  local p d
  for p in "${_E2E_PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  for d in "${_E2E_TMPDIRS[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done
}

e2e_harness_say()   { echo "[${E2E_HARNESS_NAME:-e2e}] $*"; }
e2e_harness_fatal() { echo "[${E2E_HARNESS_NAME:-e2e}] FATAL: $*" >&2; exit 1; }

# e2e_harness_init <name>
# Names the harness (log prefix + derived paths), enforces the DATABASE_URL
# precondition every pg harness shares, and arms the cleanup trap. Must be
# called AFTER e2e_ports.sh has been sourced -- E2E_PORT_REQ names the decade
# this harness owns, and the derived log/lock paths are keyed off it.
e2e_harness_init() {
  E2E_HARNESS_NAME="${1:?e2e_harness_init needs a harness name}"
  : "${DATABASE_URL:?source server/.env first (DATABASE_URL required)}"
  : "${E2E_PORT_REQ:?source e2e_ports.sh <REQ> BEFORE e2e_harness_lib.sh}"
  E2E_REQ4="$(printf '%04d' "$E2E_PORT_REQ")"
  WT="$E2E_WT"
  trap _e2e_harness_cleanup EXIT
  export E2E_HARNESS_NAME E2E_REQ4 WT
}

# e2e_harness_mktemp <varname>
# mktemp -d, remembered so the EXIT trap removes it. A harness never writes its
# own rm -rf: forgetting one leaks a temp tree per CI run.
e2e_harness_mktemp() {
  local __var="${1:?e2e_harness_mktemp needs a variable name}" __d
  __d="$(mktemp -d)"
  _E2E_TMPDIRS+=("$__d")
  printf -v "$__var" '%s' "$__d"
}

# e2e_harness_home [--fleet]
# The isolation primitive. HOME is remapped to a throwaway dir whose
# backpack_ragnarok symlinks BACK to the worktree, so storage's NAMESPACE
# (a hash of $HOME/backpack_ragnarok) is unique to this run while code and
# content still resolve to the code under test. Exports HOMEDIR.
#
#   (default)  $tmp/home/backpack_ragnarok
#   --fleet    $tmp/w0/home/backpack_ragnarok, plus E2E_FLEET_ROOT=$tmp
#              -- the shape client/e2e/e2e-env.ts builds from
#              (FLEET_ROOT/w<IDX>/home), so a FLEET-SHAPED spec's own path
#              construction lands in this same namespace instead of a
#              /tmp/bp_e2e_workers tree nobody seeded (REQ-0221).
e2e_harness_home() {
  local root
  e2e_harness_mktemp root
  if [ "${1:-}" = "--fleet" ]; then
    HOMEDIR="$root/w0/home"
    E2E_FLEET_ROOT="$root"
    export E2E_FLEET_ROOT
  else
    HOMEDIR="$root/home"
  fi
  mkdir -p "$HOMEDIR"
  ln -s "$WT" "$HOMEDIR/backpack_ragnarok"
  export HOMEDIR
}

# e2e_harness_node <log> <KEY=VAL>... -- <node args>
# Run a node process inside this harness's isolated namespace, with output to
# <log>. Used for the seeds/backfills a harness runs before its specs.
e2e_harness_node() {
  local log="${1:?e2e_harness_node needs a log path}"; shift
  local env_kv=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do env_kv+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  env HOME="$HOMEDIR" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" \
    PLAYWRIGHT_BROWSERS_PATH="$_E2E_PW_CACHE" "${env_kv[@]}" \
    node "$@" > "$log" 2>&1
}

# e2e_harness_start_api [KEY=VAL]...
# Boots THIS worktree's api on $APIPORT inside the isolated namespace. Extra
# env is passed as KEY=VAL args. Log -> $E2E_API_LOG.
#
# ART_FAMILY_BARRIER=0 is set for EVERY harness (REQ-0233): the family barrier
# restarts comfyui.service -- a LIVE, box-global systemd unit no hermetic
# harness has any business touching (REQ-0217). A harness that wants it can
# still pass ART_FAMILY_BARRIER=1, since later KEY=VAL args win.
e2e_harness_start_api() {
  E2E_API_LOG="/tmp/req${E2E_REQ4}_e2e_api.log"
  env HOME="$HOMEDIR" PORT="$APIPORT" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" \
    ART_FAMILY_BARRIER=0 "$@" \
    node "$WT/server/api.cjs" > "$E2E_API_LOG" 2>&1 &
  _E2E_PIDS+=($!)
  export E2E_API_LOG
}

# e2e_harness_start_proxy
# The REQ-0217 local proxy serves /app + /preview from the worktree ITSELF and
# routes headerless /api to E2E_FLEET_BASE_PORT+0 -- so the "fleet" base is
# pointed at this harness's single api. REQ-0234 (F7): without this, /api fell
# through to the DEFAULT fleet base 8810 and every spec died on 502. The python
# static server the harnesses used to run is gone with the old
# E2E_STATIC_PORT/E2E_API_PORT knobs: nothing routes to it any more, and its
# single-threaded accept loop was the goto-under-load flake source (REQ-0222).
e2e_harness_start_proxy() {
  E2E_PROXY_LOG="/tmp/req${E2E_REQ4}_e2e_proxy.log"
  env E2E_PROXY_PORT="$PROXYPORT" E2E_FLEET_BASE_PORT="$APIPORT" \
    node "$WT/client/e2e/local-proxy.cjs" > "$E2E_PROXY_LOG" 2>&1 &
  _E2E_PIDS+=($!)
  export E2E_PROXY_LOG
}

# e2e_harness_wait
# Block until the api and then the proxy accept connections. Bounded: a service
# that never binds must fail as a harness error, not as forty specs dying on
# ECONNREFUSED with no hint of the cause.
e2e_harness_wait() {
  local i
  for i in $(seq 1 80); do
    if curl -s -o /dev/null "http://127.0.0.1:$APIPORT/api/content" 2>/dev/null; then break; fi
    sleep 0.5
  done
  for i in $(seq 1 40); do
    if curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/api/content" 2>/dev/null \
       && curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/app/" 2>/dev/null; then break; fi
    sleep 0.5
  done
}

# e2e_harness_api_json <path> <node-expr-over-`d`>
# GET <path> off this harness's api and reduce the JSON body with a node
# expression. Lets a harness assert its OWN preconditions (the seed took, the
# registry actually serves) before paying for a spec run.
e2e_harness_api_json() {
  local path="${1:?}" expr="${2:?}"
  curl -s "http://127.0.0.1:$APIPORT$path" \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);console.log(eval(process.argv[1]))})' "$expr"
}

# e2e_harness_run <config> [--forbid-skip]
# Runs <config> through tools/e2e_run.sh under this harness's OWN serialization
# lock. REQ-0234 (F2): these harnesses share nothing box-global (own HOME
# remap, own REQ decade), so the box lock -- which the REQ-0217 freeze daemon
# holds indefinitely, and which only guards the legacy shared-port path -- would
# deadlock them for no benefit. Same-harness runs still queue on the REQ lock.
#
# --forbid-skip captures the output and turns a SKIPPED spec into a hard
# failure. For a harness whose entire reason to exist is that a spec must RUN
# (REQ-0221), a skip is the failure mode, and playwright reports it as success.
e2e_harness_run() {
  local config="${1:?e2e_harness_run needs a config}" forbid_skip=0 out rc
  [ "${2:-}" = "--forbid-skip" ] && forbid_skip=1
  local lock="${E2E_LOCK_FILE:-$_E2E_REAL_HOME/.cache/backpack/e2e.${E2E_REQ4}.lock}"

  if [ "$forbid_skip" -eq 0 ]; then
    E2E_LOCK_FILE="$lock" PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" \
      bash "$WT/tools/e2e_run.sh" --config="$config"
    return $?
  fi

  set +e
  out="$(E2E_LOCK_FILE="$lock" PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" \
    bash "$WT/tools/e2e_run.sh" --config="$config" 2>&1)"
  rc=$?
  set -e
  printf '%s\n' "$out"
  if [ "$rc" -ne 0 ]; then exit "$rc"; fi
  if printf '%s\n' "$out" | grep -qE '[0-9]+ skipped'; then
    e2e_harness_fatal "a spec SKIPPED on this harness -- its coverage must never skip here"
  fi
}
