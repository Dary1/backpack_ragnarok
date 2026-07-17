#!/usr/bin/env bash
# tools/tests/flaky_gate_test.sh -- REQ-0222: DB-free, playwright-free
# self-test of tools/e2e_flaky_gate.sh (the executable release recovery
# convention). Stub commands emit canned playwright-shaped output, so the
# whole test costs milliseconds and runs as an early ci.sh step. Paths:
#   1  green command                      -> pass, no rerun
#   2  known-flaky fail, then green       -> rerun path -> pass
#   3  unknown failure                    -> abort, NO rerun
#   4  mixed known + unknown failures     -> abort, NO rerun
#   5  known-flaky fail on BOTH runs      -> abort after exactly one rerun
#   6  unparsable failure (no pw block)   -> abort, no rerun
#   7  E2E_INJECT_FLAKE seam              -> rerun path -> pass
#   8  E2E_INJECT_REGRESSION seam         -> abort
#   9  E2E_FLAKY_RERUN override is used for run 2
set -euo pipefail
TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE="$TOOLS/e2e_flaky_gate.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAILED=0

FLAKY_BLOCK='  1) [chromium] - e2e/artadmin.spec.ts:113:1 - loads the console\n     TimeoutError: page.goto: Timeout 20000ms exceeded.\n  1 failed'
UNKNOWN_BLOCK='  1) [chromium] - e2e/dex.spec.ts:10:1 - shows the card\n     Error: expect(received).toBe(expected)\n  1 failed'
MIXED_BLOCK='  1) [chromium] - e2e/artadmin.spec.ts:113:1 - loads the console\n     TimeoutError: page.goto: Timeout 20000ms exceeded.\n  2) [chromium] - e2e/dex.spec.ts:10:1 - shows the card\n     Error: expect(received).toBe(expected)\n  2 failed'

mkstub() { # $1 name, $2 first-run printf body, $3 first-run rc, $4 second-run body, $5 second-run rc
  local n="$1"
  cat > "$TMP/$n.sh" <<EOS
#!/usr/bin/env bash
if [ -e "$TMP/$n.marker" ]; then printf '$4\n'; exit $5; fi
touch "$TMP/$n.marker"; printf '$2\n'; exit $3
EOS
  chmod +x "$TMP/$n.sh"
}

ck() { # $1 name, $2 want-zero(y/n), $3 got-rc, $4 log, $5 must-contain ("" = skip), $6 must-NOT-contain ("" = skip)
  local ok=1
  if [ "$2" = "y" ] && [ "$3" -ne 0 ]; then ok=0; fi
  if [ "$2" = "n" ] && [ "$3" -eq 0 ]; then ok=0; fi
  if [ -n "$5" ] && ! grep -qF "$5" "$4"; then ok=0; fi
  if [ -n "$6" ] && grep -qF "$6" "$4"; then ok=0; fi
  if [ "$ok" -eq 1 ]; then PASS=$((PASS+1)); echo "ok   $1"; else FAILED=$((FAILED+1)); echo "FAIL $1 (rc=$3, log=$4)"; fi
}

# 1 green
mkstub t1 '  5 passed (1.0s)' 0 '  5 passed (1.0s)' 0
rc=0; bash "$GATE" t1 "$TMP/t1.sh" > "$TMP/t1.out" 2>&1 || rc=$?
ck "green passes, no rerun" y "$rc" "$TMP/t1.out" "" "run 2"

# 2 known-flaky then green -> recovered
mkstub t2 "$FLAKY_BLOCK" 1 '  5 passed (1.0s)' 0
rc=0; bash "$GATE" t2 "$TMP/t2.sh" > "$TMP/t2.out" 2>&1 || rc=$?
ck "known-flaky reruns then passes" y "$rc" "$TMP/t2.out" "rerun GREEN" ""

# 3 unknown -> abort, no rerun
mkstub t3 "$UNKNOWN_BLOCK" 1 '  5 passed (1.0s)' 0
rc=0; bash "$GATE" t3 "$TMP/t3.sh" > "$TMP/t3.out" 2>&1 || rc=$?
ck "unknown failure aborts without rerun" n "$rc" "$TMP/t3.out" "ABORT (no rerun)" "run 2"

# 4 mixed -> abort, no rerun
mkstub t4 "$MIXED_BLOCK" 1 '  5 passed (1.0s)' 0
rc=0; bash "$GATE" t4 "$TMP/t4.sh" > "$TMP/t4.out" 2>&1 || rc=$?
ck "mixed known+unknown aborts without rerun" n "$rc" "$TMP/t4.out" "ABORT (no rerun)" "run 2"

# 5 flaky both runs -> abort after one rerun
mkstub t5 "$FLAKY_BLOCK" 1 "$FLAKY_BLOCK" 1
rc=0; bash "$GATE" t5 "$TMP/t5.sh" > "$TMP/t5.out" 2>&1 || rc=$?
ck "still-red rerun aborts" n "$rc" "$TMP/t5.out" "rerun STILL RED" ""

# 6 unparsable -> abort, no rerun
mkstub t6 'segfault before playwright even started' 70 '  5 passed' 0
rc=0; bash "$GATE" t6 "$TMP/t6.sh" > "$TMP/t6.out" 2>&1 || rc=$?
ck "unparsable failure aborts without rerun" n "$rc" "$TMP/t6.out" "NO parsable playwright block" "run 2"

# 7 injection: flake seam on a green command -> rerun path -> pass
mkstub t7 '  5 passed (1.0s)' 0 '  5 passed (1.0s)' 0
rc=0; E2E_INJECT_FLAKE=t7 bash "$GATE" t7 "$TMP/t7.sh" > "$TMP/t7.out" 2>&1 || rc=$?
ck "E2E_INJECT_FLAKE demonstrates rerun path" y "$rc" "$TMP/t7.out" "rerun GREEN" ""

# 8 injection: regression seam -> abort
mkstub t8 '  5 passed (1.0s)' 0 '  5 passed (1.0s)' 0
rc=0; E2E_INJECT_REGRESSION=t8 bash "$GATE" t8 "$TMP/t8.sh" > "$TMP/t8.out" 2>&1 || rc=$?
ck "E2E_INJECT_REGRESSION demonstrates abort path" n "$rc" "$TMP/t8.out" "ABORT (no rerun)" ""

# 9 E2E_FLAKY_RERUN override used for run 2
mkstub t9 "$FLAKY_BLOCK" 1 "$FLAKY_BLOCK" 1
echo '#!/usr/bin/env bash' > "$TMP/t9_narrow.sh"; echo 'printf "  1 passed (0.1s)\n"' >> "$TMP/t9_narrow.sh"; chmod +x "$TMP/t9_narrow.sh"
rc=0; E2E_FLAKY_RERUN="$TMP/t9_narrow.sh" bash "$GATE" t9 "$TMP/t9.sh" > "$TMP/t9.out" 2>&1 || rc=$?
ck "E2E_FLAKY_RERUN override drives run 2" y "$rc" "$TMP/t9.out" "run 2 (override)" ""

echo "flaky_gate_test: $PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
