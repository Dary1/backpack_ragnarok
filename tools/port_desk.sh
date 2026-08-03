#!/usr/bin/env bash
# tools/port_desk.sh -- the rental port desk.
#
# Anything that needs a TCP port asks here and is told a number. Nothing derives
# a port from a REQ number or a branch name, and nothing types a port literal.
#
#   PORT=$(tools/port_desk.sh)        # one free port
#   BASE=$(tools/port_desk.sh 10)     # base of 10 CONSECUTIVE free ports (BASE..BASE+9)
#   tools/port_desk.sh --busy         # show what is holding the pool right now
#
# The whole rule:
#   * Pool is 9000-9200.
#   * Scan from 9000 upward and hand out the LOWEST free port (or the lowest run
#     of N consecutive free ports).
#   * If the scan reaches 9200 and nothing is free, wrap back to 9000, kill
#     whatever process is holding the needed port(s), and hand those out. Every
#     listener in this range is one of our own test processes, so there is
#     nothing else it could be killing.
#
# There is no lease file, no ledger, no cursor and nothing to garbage-collect:
# the only thing that decides whether a port is free is the kernel's own answer
# to "is anything listening on it".
set -euo pipefail

# Pool. The two env vars exist ONLY so tests can shrink the pool; leave unset in
# normal use.
LO="${PORT_DESK_LO:-9000}"
HI="${PORT_DESK_HI:-9200}"

# --busy: list the pool's current occupants and exit.
if [ "${1:-}" = "--busy" ]; then
  ss -lntupHn 2>/dev/null | awk -v lo="$LO" -v hi="$HI" \
    '{ n = split($5, a, ":"); p = a[n] + 0; if (p >= lo && p <= hi) print }'
  exit 0
fi

count="${1:-1}"
case "$count" in ''|*[!0-9]*) echo "[port-desk] usage: port_desk.sh [count|--busy]" >&2; exit 64 ;; esac
[ "$count" -lt 1 ] && count=1
if [ "$count" -gt $((HI - LO + 1)) ]; then
  echo "[port-desk] pool $LO-$HI cannot hold $count consecutive ports" >&2
  exit 64
fi

# Every listening port on the box, as a padded string " 8801  8802  9000 " so a
# port can be tested with a simple substring match.
bound=" $(ss -lntuHn 2>/dev/null | awk '{ n = split($5, a, ":"); print a[n] }' | sort -un | tr '\n' ' ')"

# Find the base of the lowest run of $count consecutive free ports, or nothing.
pick=""
for ((p = LO; p + count - 1 <= HI; p++)); do
  ok=1
  for ((i = 0; i < count; i++)); do
    case "$bound" in *" $((p + i)) "*) ok=0; break ;; esac
  done
  if [ "$ok" = 1 ]; then pick="$p"; break; fi
done

# Nothing free in the whole pool: wrap to 9000 and evict the leftovers holding
# the lowest ports. A stuck test process is never worth more than the run asking
# for the port.
if [ -z "$pick" ]; then
  pick="$LO"
  for ((i = 0; i < count; i++)); do
    port=$((pick + i))
    pids="$(ss -lntupHn "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | tr '\n' ' ')"
    [ -z "$pids" ] && continue
    echo "[port-desk] pool $LO-$HI full -- killing pid(s) ${pids}on :$port" >&2
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  done
  sleep 0.3
fi

# Announce (to stderr, for the human/LLM reading the transcript) and print the
# base port to stdout (the block is base..base+count-1).
block=""; for ((i = 0; i < count; i++)); do block="$block $((pick + i))"; done
echo "[port-desk] handed out:${block}  (pool $LO-$HI)" >&2
printf '%s\n' "$pick"
