#!/usr/bin/env bash
# Concurrency stress test for touch_next_req_reserved.py.
# Usage: bash req_alloc_selftest.sh [WORKDIR] [SCRIPT_PATH] [N] [WORKTREES]
# Proves: N fully-concurrent reservations across several worktrees sharing one
# counter yield unique, contiguous, monotonic numbers with zero duplicates.
set -u
WORK="${1:-/tmp/req_selftest}"
SCRIPT="${2:-$(dirname "$0")/touch_next_req_reserved.py}"
N="${3:-100}"
M="${4:-4}"
SEED_MAX="${SEED_MAX:-93}"

rm -rf "$WORK"; mkdir -p "$WORK"; STATE="$WORK/state"
for i in $(seq 1 "$M"); do
  for s in reserved draft todo built done; do mkdir -p "$WORK/wt$i/docs/REQ/$s"; done
done
echo "seed marker" > "$WORK/wt1/docs/REQ/done/REQ-$(printf '%04d' "$SEED_MAX")-seed.md"

python3 "$SCRIPT" --seed-only --state-dir "$STATE" \
  $(for i in $(seq 1 "$M"); do printf ' --reconcile-root %s' "$WORK/wt$i/docs/REQ"; done) >/dev/null

for k in $(seq 1 "$N"); do
  wt=$(( (k % M) + 1 ))
  python3 "$SCRIPT" "selftest-$k" --req-dir "$WORK/wt$wt/docs/REQ" \
    --state-dir "$STATE" --no-commit >/dev/null 2>&1 &
done
wait

nums=$(find "$WORK"/wt*/docs/REQ/reserved -name 'REQ-*.md' \
       | grep -oE 'REQ-[0-9]+' | grep -oE '[0-9]+' | sort)
count=$(printf '%s\n' "$nums" | wc -l | tr -d ' ')
uniq=$(printf '%s\n' "$nums" | sort -u | wc -l | tr -d ' ')
lo=$((SEED_MAX + 1)); hi=$((SEED_MAX + N))
expected=$(seq "$lo" "$hi" | awk '{printf "%04d\n",$1}')

echo "requested=$N  created=$count  unique=$uniq"
echo "range=$(printf '%s\n' "$nums" | head -1)..$(printf '%s\n' "$nums" | tail -1)  counter=$(cat "$STATE/counter")  markers=$(ls "$STATE/issued" | wc -l | tr -d ' ')"
rc=0
[ "$count" = "$N" ] && [ "$uniq" = "$N" ] && echo "NO DUPLICATES: PASS" || { echo "NO DUPLICATES: FAIL"; rc=1; }
[ "$(printf '%s\n' "$nums")" = "$expected" ] && echo "CONTIGUOUS $(printf '%04d' "$lo")..$(printf '%04d' "$hi"): PASS" || { echo "CONTIGUOUS: FAIL"; rc=1; }
exit $rc
