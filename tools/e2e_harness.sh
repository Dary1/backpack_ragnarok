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
#   e2e_harness_name art_inspect_e2e
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

_E2E_H_NAME=""
_E2E_H_API_ENV=()

# ---------------------------------------------------------------- init --------
# e2e_harness_name <name>
# Leases the ports from the desk, builds the isolated namespace, arms the cleanup
# trap. Everything after this can assume WT/HOMEDIR/TMPROOT/MODELDIR/EXPORTDIR.
e2e_harness_name() {
  _E2E_H_NAME="${1:?e2e_harness_name needs a harness name}"

  : "${DATABASE_URL:?source server/.env first (DATABASE_URL required)}"

  WT="$(cd "$(dirname "${BASH_SOURCE[1]}")/.." && pwd)"

  # REQ-0133: Playwright chromium lives in the REAL home cache; the per-run HOME
  # remap below would hide it, so capture the real path NOW, before any remap.
  PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
  # The lock lives in the REAL home too, for the same reason -- resolve it here
  # rather than in the tail, where $HOME could read as the remapped one.
  _E2E_H_LOCK="${E2E_LOCK_FILE:-$HOME/.cache/backpack/e2e.${_E2E_H_NAME}.lock}"

  # REQ-0323: ports come from the rental port desk (tools/port_desk.sh), not the
  # REQ number. The helper leases a free decade and names static/api/proxy.
  # shellcheck source=/dev/null
  source "$(dirname "${BASH_SOURCE[0]}")/e2e_ports.sh"

  TMPROOT="$(mktemp -d)"
  MODELDIR="$(mktemp -d)"
  EXPORTDIR="$(mktemp -d)"
  HOMEDIR="$TMPROOT/w0/home"
  mkdir -p "$HOMEDIR"
  # REQ-0365: the home used to be `ln -s "$WT" .../backpack_ragnarok`, one
  # symlink to the whole checkout. That quietly included data/ -- and
  # server/admin.cjs anchors CONFIG_DIR at $HOME/backpack_ragnarok/data/config,
  # so every "isolated" admin harness was in fact reading the BOX's live
  # data/config/dev_user.json and taking its item_admin rights from that box's
  # dev_mode fallback.
  #
  # Found the moment it mattered: flipping the live box to dev_mode:false
  # (REQ-0365's whole point) turned [6.5/8] red -- 8 artadmin specs, POST
  # /api/art/artworks 403 and #/artadmin never rendering -- with no change to
  # the harnesses or the specs. The isolation claim in this file's header was
  # simply not true of data/.
  #
  # So the home is now a DIRECTORY of per-entry symlinks with data/ excluded and
  # replaced by a per-run real one, seeded from the committed fixtures. Same
  # shape as e2e_fleet.cjs's buildHome(), which had this right all along
  # (content/live copied, everything else symlinked). Code and content still
  # resolve to the worktree; the namespace hash still keys off
  # $HOME/backpack_ragnarok and is still unique per run.
  mkdir -p "$HOMEDIR/backpack_ragnarok"
  for _e in "$WT"/* "$WT"/.[!.]*; do
    [ -e "$_e" ] || continue
    case "$(basename "$_e")" in data) continue ;; esac
    ln -s "$_e" "$HOMEDIR/backpack_ragnarok/$(basename "$_e")"
  done
  mkdir -p "$HOMEDIR/backpack_ragnarok/data/config"
  # dev_mode is absent from this fixture, and server/admin.cjs's readDevUser()
  # reads absent as TRUE -- which is what these harnesses need: their specs call
  # item_admin-gated routes with no credential at all.
  cp "$WT/client/e2e/fixtures/config/dev_user.json" \
     "$HOMEDIR/backpack_ragnarok/data/config/dev_user.json"
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

  local log="/tmp/${_E2E_H_NAME}_e2e"
  echo "[${_E2E_H_NAME}] api :$APIPORT  proxy :$PROXYPORT"

  if declare -F e2e_h_seed_preboot >/dev/null; then
    echo "[${_E2E_H_NAME}] seeding before api boot"
    e2e_h_seed_preboot
  fi

  # REQ-0233: ART_FAMILY_BARRIER=0 -- see the isolation contract above. NOTE what
  # is deliberately NOT here: ALLOW_DEV_CLEAR. It ungates the destructive
  # clear-all/bump-kit dev seams (REQ-0156, added after a live-namespace wipe),
  # so a harness that needs it says so itself. A library default would hand it to
  # harnesses that never asked -- registry_first is one.
  env HOME="$HOMEDIR" PORT="$APIPORT" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" \
      ART_FAMILY_BARRIER=0 \
      ${_E2E_H_API_ENV[@]+"${_E2E_H_API_ENV[@]}"} \
      node "$WT/server/api.cjs" > "${log}_api.log" 2>&1 &
  PIDS+=($!)

  # REQ-0234 (F7): the REQ-0217 local-proxy serves /app + /preview from the
  # worktree ITSELF and routes headerless /api to E2E_FLEET_BASE_PORT+0. The old
  # E2E_STATIC_PORT/E2E_API_PORT knobs no longer exist, so the "fleet" base must
  # point at this harness's single api -- without it /api fell through to the
  # DEFAULT fleet base 8810 and every spec died on 502. (The python static server
  # this rig used to run went with those knobs: nothing routes to it any more,
  # and its single-threaded accept loop was the flake source in REQ-0222.)
  env E2E_PROXY_PORT="$PROXYPORT" E2E_FLEET_BASE_PORT="$APIPORT" \
      node "$WT/client/e2e/local-proxy.cjs" > "${log}_proxy.log" 2>&1 &
  PIDS+=($!)

  if ! _e2e_h_wait 80 "http://127.0.0.1:$APIPORT/api/content"; then
    echo "[${_E2E_H_NAME}] FATAL: api never came up on :$APIPORT -- see ${log}_api.log" >&2
    return 1
  fi
  if ! _e2e_h_wait 40 "http://127.0.0.1:$PROXYPORT/api/content" "http://127.0.0.1:$PROXYPORT/app/"; then
    echo "[${_E2E_H_NAME}] FATAL: proxy never came up on :$PROXYPORT -- see ${log}_proxy.log" >&2
    return 1
  fi

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
