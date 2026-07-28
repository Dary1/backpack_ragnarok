#!/usr/bin/env bash
# tools/e2e_harness.sh -- REQ-0251. Shared bringup for the isolated admin e2e harnesses.
#
# WHY THIS EXISTS. art_inspect (0152), artadmin (0156), content_admin (0157) and
# registry_first (0221) were four ~90-line scripts that were ~85% byte-identical:
# the HOME remap, the temp dirs, the cleanup trap, the api + proxy spawn, the
# readiness poll and the lock+run tail were copy-pasted four ways. So was the
# PROSE: the REQ-0233 family-barrier paragraph and the REQ-0234 (F7) proxy-wiring
# paragraph existed in four copies. That is the real cost -- REQ-0234 had to fix
# the same proxy bug in every copy, and REQ-0233 had to add ART_FAMILY_BARRIER=0
# to every copy. A fix that must be applied four times gets applied three times.
#
# So the sequence lives HERE, once, and a harness declares only what makes it
# different: its REQ, its api env, its config, and (optionally) hooks.
#
# USAGE
#   source "$(dirname "$0")/e2e_harness.sh"
#   e2e_harness_req 0152 art_inspect_e2e
#   e2e_harness_api_env ART_ROUTE_MOCK=1 ART_MODEL_DIR="$MODELDIR"
#   e2e_harness_run --config=e2e/artinspect.config.ts
#
# HOOKS (define before e2e_harness_run; both optional)
#   e2e_h_seed_preboot   -- runs BEFORE the api boots (a lazily-built view is
#                           then always seeded on first request; no cache dance)
#   e2e_h_after_ready    -- runs AFTER api+proxy accept connections
#   Inside a hook, use e2e_harness_node <cmd...> to run in the isolated namespace.
#
# ISOLATION CONTRACT (REQ-0217: an e2e run never touches live services or data)
#   - HOME is remapped to a per-run temp dir whose backpack_ragnarok symlinks
#     back to THIS worktree, so storage_art/storage_content's NAMESPACE (a hash
#     of $HOME/backpack_ragnarok) is UNIQUE to the run while content and code
#     still resolve to the worktree.
#   - The home is shaped like a FLEET WORKER's (w0/home/...) so that the
#     spec-side path construction in client/e2e/e2e-env.ts resolves into it.
#     REQ-0221 needed that shape; the others do not care, so all four now share
#     one shape rather than two near-identical ones.
#   - ART_FAMILY_BARRIER=0 (REQ-0233) is set for EVERY harness here, not per
#     copy: the barrier restarts comfyui.service, a live box-global systemd unit
#     no hermetic harness has any business touching. It was the one thing in this
#     rig that reached out of the sandbox, so it is off by construction now.
#   - Each harness takes its OWN lock (REQ-0234 F2), never the box lock -- the
#     REQ-0217 freeze daemon holds that one indefinitely and it only ever guarded
#     the legacy shared-port path. Same-harness runs still queue.
set -euo pipefail

_E2E_H_REQ=""
_E2E_H_NAME=""
_E2E_H_API_ENV=()

# REQ-0323: source the port allocator from a ZERO-ARGUMENT function.
# `source file` without arguments does NOT clear the positional parameters --
# the sourced file sees the CALLER's "$@". Sourced straight from
# e2e_harness_req (which is called as `e2e_harness_req 0152 art_inspect_e2e`),
# e2e_ports.sh would see "0152" and correctly reject it as a pre-REQ-0323 call
# site passing a REQ number. Calling through a no-arg wrapper makes $# == 0.
_e2e_h_source_ports() {
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/e2e_ports.sh"
}

# Kill everything we spawned and WAIT for it, so the kernel has actually
# released the sockets before we probe or re-lease (REQ-0323 2.4).
_e2e_h_kill_pids() {
  local p
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  for p in "${PIDS[@]:-}"; do wait "$p" 2>/dev/null || true; done
  PIDS=()
}

# ---------------------------------------------------------------- init --------
# e2e_harness_req <id> <name>
# Leases a port block, builds the isolated namespace, arms the cleanup trap.
# Everything after this can assume WT/HOMEDIR/TMPROOT/MODELDIR/EXPORTDIR.
#
# <id> IS NO LONGER A PORT INPUT (REQ-0323). Ports are leased at run time from a
# pool; this argument now only names the harness's own advisory lock
# (~/.cache/backpack/e2e.<id>.lock, REQ-0234 F2) and its log files. It is kept
# as the REQ number so those names stay stable across worktrees that have not
# rebased yet -- renaming the lock would silently DE-serialize this harness
# against an older tree running the same one.
e2e_harness_req() {
  _E2E_H_REQ="${1:?e2e_harness_req needs a REQ number}"
  _E2E_H_NAME="${2:?e2e_harness_req needs a harness name}"

  : "${DATABASE_URL:?source server/.env first (DATABASE_URL required)}"

  WT="$(cd "$(dirname "${BASH_SOURCE[1]}")/.." && pwd)"

  # REQ-0133: Playwright chromium lives in the REAL home cache; the per-run HOME
  # remap below would hide it, so capture the real path NOW, before any remap.
  PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  # The lock lives in the REAL home too, for the same reason -- resolve it here
  # rather than in the tail, where $HOME could read as the remapped one.
  _E2E_H_LOCK="${E2E_LOCK_FILE:-$HOME/.cache/backpack/e2e.${_E2E_H_REQ}.lock}"

  # REQ-0323: ports are LEASED at run time from a pool -- the REQ-derived rule
  # (5000 + REQ*10 + index) is deleted. The allocator asks the OS which ports
  # are bindable, takes the lowest free block, records the lease, and prints the
  # numbers it handed out. Released by the cleanup trap below; a crashed run
  # leaves a lease whose pid is dead, reclaimed on the next allocation.
  export E2E_PORTS_CALLER="$_E2E_H_NAME"
  _e2e_h_source_ports

  TMPROOT="$(mktemp -d)"
  MODELDIR="$(mktemp -d)"
  EXPORTDIR="$(mktemp -d)"
  HOMEDIR="$TMPROOT/w0/home"
  mkdir -p "$HOMEDIR"
  ln -s "$WT" "$HOMEDIR/backpack_ragnarok"
  # Stand-ins: the api's model preflight only checks that these EXIST. With
  # ART_ROUTE_MOCK=1 nothing ever reads them, so a one-word file is enough --
  # and it keeps a hermetic run from needing 20 GB of real weights.
  for f in flux-2-klein-4b-Q8_0.gguf qwen_3_4b.safetensors flux2-vae.safetensors; do
    echo standin > "$MODELDIR/$f"
  done

  PIDS=()
  # shellcheck disable=SC2317
  _e2e_h_cleanup() {
    for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
    # REQ-0323: hand the port block back. This is the ORDINARY path only -- the
    # allocator never trusts it (a lease whose pid is dead, or whose block has
    # had nothing bound in it past the grace window, is reclaimed anyway).
    if declare -F e2e_ports_release >/dev/null 2>&1; then e2e_ports_release || true; fi
    rm -rf "$TMPROOT" "$MODELDIR" "$EXPORTDIR"
  }
  trap _e2e_h_cleanup EXIT

  export WT PW_CACHE TMPROOT MODELDIR EXPORTDIR HOMEDIR
}

# e2e_harness_api_env KEY=VAL ...   (repeatable; appends)
e2e_harness_api_env() { _E2E_H_API_ENV+=("$@"); }

# e2e_harness_node <cmd...> -- run a tool inside the isolated namespace.
e2e_harness_node() {
  env HOME="$HOMEDIR" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" \
      PLAYWRIGHT_BROWSERS_PATH="$PW_CACHE" "$@"
}

# _e2e_h_bringup <logprefix> <attempt> -- spawn api + proxy on the CURRENTLY
# LEASED block and wait for both. Returns non-zero if either never comes up, so
# the caller can release the block and try another one (REQ-0323 2.4).
_e2e_h_bringup() {
  local log="$1" attempt="$2" sfx=""
  [ "$attempt" -gt 1 ] && sfx=".try${attempt}"
  echo "[${_E2E_H_NAME}] api :$APIPORT  proxy :$PROXYPORT  (leased block ${E2E_PORT_BASE}-${E2E_PORT_BLOCK_END}, attempt ${attempt})"

  # REQ-0233: ART_FAMILY_BARRIER=0 -- see the isolation contract above. NOTE what
  # is deliberately NOT here: ALLOW_DEV_CLEAR. It ungates the destructive
  # clear-all/bump-kit dev seams (REQ-0156, added after a live-namespace wipe),
  # so a harness that needs it says so itself. A library default would hand it to
  # harnesses that never asked -- registry_first is one.
  env HOME="$HOMEDIR" PORT="$APIPORT" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" \
      ART_FAMILY_BARRIER=0 \
      ${_E2E_H_API_ENV[@]+"${_E2E_H_API_ENV[@]}"} \
      node "$WT/server/api.cjs" > "${log}_api.log${sfx}" 2>&1 &
  PIDS+=($!)

  # REQ-0234 (F7): the REQ-0217 local-proxy serves /app + /preview from the
  # worktree ITSELF and routes headerless /api to E2E_FLEET_BASE_PORT+0. The old
  # E2E_STATIC_PORT/E2E_API_PORT knobs no longer exist, so the "fleet" base must
  # point at this harness's single api -- without it /api fell through to the
  # DEFAULT fleet base and every spec died on 502. (The python static server
  # this rig used to run went with those knobs: nothing routes to it any more,
  # and its single-threaded accept loop was the flake source in REQ-0222.)
  env E2E_PROXY_PORT="$PROXYPORT" E2E_FLEET_BASE_PORT="$APIPORT" \
      node "$WT/client/e2e/local-proxy.cjs" > "${log}_proxy.log${sfx}" 2>&1 &
  PIDS+=($!)

  if ! _e2e_h_wait 80 "http://127.0.0.1:$APIPORT/api/content"; then
    echo "[${_E2E_H_NAME}] api never came up on :$APIPORT -- see ${log}_api.log${sfx}" >&2
    return 1
  fi
  if ! _e2e_h_wait 40 "http://127.0.0.1:$PROXYPORT/api/content" "http://127.0.0.1:$PROXYPORT/app/"; then
    echo "[${_E2E_H_NAME}] proxy never came up on :$PROXYPORT -- see ${log}_proxy.log${sfx}" >&2
    return 1
  fi
  return 0
}

_e2e_h_wait() {  # _e2e_h_wait <tries> <url...>
  local tries="$1"; shift
  local i url ok
  for ((i = 0; i < tries; i++)); do
    ok=1
    for url in "$@"; do
      curl -s -o /dev/null "$url" 2>/dev/null || ok=0
    done
    [ "$ok" = 1 ] && return 0
    sleep 0.5
  done
  return 1
}

# ----------------------------------------------------------------- run --------
# e2e_harness_run [--no-skip] --config=e2e/<name>.config.ts
#   --no-skip  turn a SKIPPED spec into a hard failure (REQ-0221: registry
#              coverage that silently skips is the bug it exists to catch)
e2e_harness_run() {
  local no_skip=0 args=()
  for a in "$@"; do
    case "$a" in
      --no-skip) no_skip=1 ;;
      *) args+=("$a") ;;
    esac
  done

  local log="/tmp/req${_E2E_H_REQ}_e2e"

  # Seeding is port-independent and can be expensive, so it happens ONCE,
  # outside the bringup retry loop below.
  if declare -F e2e_h_seed_preboot >/dev/null; then
    echo "[${_E2E_H_NAME}] seeding before api boot"
    e2e_h_seed_preboot
  fi

  # REQ-0323 (2.4): the lease shrinks the bind race but cannot erase it -- a
  # port can still be taken between the allocator's probe and our bind. So if
  # bringup fails to come up, give the block back, lease ANOTHER, and retry.
  # Bounded at 3 attempts, then fail loudly rather than loop.
  local attempt _max=3
  for ((attempt = 1; attempt <= _max; attempt++)); do
    if _e2e_h_bringup "$log" "$attempt"; then break; fi
    if [ "$attempt" -ge "$_max" ]; then
      echo "[${_E2E_H_NAME}] FATAL: services never came up on ${_max} different port blocks." >&2
      echo "[${_E2E_H_NAME}]   logs: ${log}_api.log* ${log}_proxy.log*   leases: tools/e2e_ports.sh --who" >&2
      return 1
    fi
    echo "[${_E2E_H_NAME}] bringup failed on block ${E2E_PORT_BASE}-${E2E_PORT_BLOCK_END} (attempt ${attempt}/${_max}) -- releasing it and leasing another" >&2
    _e2e_h_kill_pids
    e2e_ports_release
    _e2e_h_source_ports
  done

  if declare -F e2e_h_after_ready >/dev/null; then e2e_h_after_ready; fi

  local out rc
  set +e
  out="$(env E2E_LOCK_FILE="$_E2E_H_LOCK" E2E_FLEET_ROOT="$TMPROOT" \
        PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" \
        bash "$WT/tools/e2e_run.sh" "${args[@]}" 2>&1)"
  rc=$?
  set -e
  printf '%s\n' "$out"
  [ "$rc" -ne 0 ] && return "$rc"
  if [ "$no_skip" = 1 ] && printf '%s\n' "$out" | grep -qE '[0-9]+ skipped'; then
    echo "[${_E2E_H_NAME}] FATAL: a spec SKIPPED on the seeded pg harness -- this harness exists precisely so that coverage cannot skip (REQ-0221)" >&2
    return 1
  fi
  return 0
}
