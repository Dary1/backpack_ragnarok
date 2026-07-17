#!/usr/bin/env bash
# tools/e2e_flaky_gate.sh -- REQ-0222: the release recovery convention, executable.
#
# REQ-0182b and REQ-0191 both had tools/release.sh aborted mid-deploy by a
# known-flaky e2e failure (goto-under-load); the recovery -- finish the e2e
# via the box-locked runner on the byte-identical tree, then continue -- was
# hand-run tribal knowledge. This wrapper IS that convention:
#
#   bash tools/e2e_flaky_gate.sh <tag> <command...>
#
#   - runs <command...> (an e2e step: an admin harness script or the default
#     suite), capturing output;
#   - on failure, parses the playwright failure blocks and matches EACH one
#     against tools/e2e_known_flaky.tsv (family registry with provenance);
#   - ALL failures known-flaky -> rerun ONCE (default: the same command,
#     which routes through tools/e2e_run.sh's box lock; E2E_FLAKY_RERUN
#     overrides with a narrower command, e.g. --last-failed);
#     rerun green -> the step passes (recovery); rerun red -> abort;
#   - ANY failure matching NO family -> abort immediately, no rerun (real
#     regression: behaviour identical to before this wrapper existed);
#   - failure with NO parsable playwright block (bring-up death, port rule
#     exit 75, ...) -> abort immediately, no rerun.
#
# Injection seams (REQ-0222 gates + tools/tests/flaky_gate_test.sh use these
# to demonstrate both paths through the REAL pipeline; never set in a normal
# run):
#   E2E_INJECT_FLAKE=<tag>       after a green run 1, append a synthetic
#                                goto-under-load failure -> exercises rerun.
#   E2E_INJECT_REGRESSION=<tag>  append a synthetic UNKNOWN failure
#                                -> exercises the abort path.
set -uo pipefail

TAG="${1:?usage: e2e_flaky_gate.sh <tag> <command...>}"; shift
[ $# -ge 1 ] || { echo "[flaky-gate:$TAG] no command given" >&2; exit 64; }
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIST="${E2E_KNOWN_FLAKY_LIST:-$TOOLS_DIR/e2e_known_flaky.tsv}"
LOG="/tmp/e2e_flaky_gate_${TAG}.$$.log"

echo "[flaky-gate:$TAG] run 1: $*"
"$@" 2>&1 | tee "$LOG"; RC="${PIPESTATUS[0]}"

# ---- injection seams (gate demo / self-test only) ---------------------------
if [ "${E2E_INJECT_FLAKE:-}" = "$TAG" ] && [ "$RC" -eq 0 ]; then
  echo "[flaky-gate:$TAG] E2E_INJECT_FLAKE: appending synthetic goto-under-load failure to run 1"
  printf '  1) [chromium] - e2e/injected.spec.ts:1:1 - synthetic injected flake\n     TimeoutError: page.goto: Timeout 20000ms exceeded.\n  1 failed\n' >> "$LOG"
  RC=1
  export E2E_INJECT_FLAKE=""   # never inject again into the rerun
fi
if [ "${E2E_INJECT_REGRESSION:-}" = "$TAG" ]; then
  echo "[flaky-gate:$TAG] E2E_INJECT_REGRESSION: appending synthetic unknown failure to run 1"
  printf '  1) [chromium] - e2e/injected.spec.ts:1:1 - synthetic injected regression\n     Error: expect(received).toBe(expected) -- synthetic real regression\n  1 failed\n' >> "$LOG"
  RC=1
fi
# ------------------------------------------------------------------------------

if [ "$RC" -eq 0 ]; then rm -f "$LOG"; exit 0; fi

echo "[flaky-gate:$TAG] run 1 FAILED (rc=$RC); classifying failures against $LIST"

# Playwright failure blocks: "  N) ..." starts one; it runs until the next
# start or a summary line. Each block is flattened to one line for grep -E.
mapfile -t BLOCKS < <(awk '
  /^[[:space:]]+[0-9]+\)[[:space:]]/ { if (blk != "") print blk; blk = $0; inblk = 1; next }
  inblk && (/^[[:space:]]*[0-9]+ (passed|failed|flaky|skipped|did not run)/ || /^={4,}/) { if (blk != "") print blk; blk = ""; inblk = 0; next }
  inblk { blk = blk " | " $0 }
  END { if (blk != "") print blk }
' "$LOG")

if [ "${#BLOCKS[@]}" -eq 0 ]; then
  echo "[flaky-gate:$TAG] failure has NO parsable playwright block (bring-up/tooling death) -> ABORT, no rerun."
  exit "$RC"
fi

ALL_KNOWN=1; FAMS=""
for blk in "${BLOCKS[@]}"; do
  matched=""
  while IFS=$'\t' read -r fam spec errpat prov; do
    case "$fam" in ''|\#*) continue;; esac
    if [ "$spec" != "-" ]; then printf '%s\n' "$blk" | grep -Eq "$spec" || continue; fi
    printf '%s\n' "$blk" | grep -Eq "$errpat" || continue
    matched="$fam"; break
  done < "$LIST"
  if [ -n "$matched" ]; then
    case " $FAMS " in *" $matched "*) ;; *) FAMS="$FAMS $matched";; esac
    echo "[flaky-gate:$TAG] known-flaky [$matched]: $(printf '%s' "$blk" | cut -c1-160)"
  else
    ALL_KNOWN=0
    echo "[flaky-gate:$TAG] UNMATCHED failure (real regression): $(printf '%s' "$blk" | cut -c1-200)"
  fi
done

if [ "$ALL_KNOWN" -ne 1 ]; then
  echo "[flaky-gate:$TAG] at least one failure matches NO known-flaky family -> ABORT (no rerun)."
  exit "$RC"
fi

echo "[flaky-gate:$TAG] ALL ${#BLOCKS[@]} failure(s) known-flaky ($FAMS) -> rerunning ONCE via the box-locked runner."
if [ -n "${E2E_FLAKY_RERUN:-}" ]; then
  echo "[flaky-gate:$TAG] run 2 (override): $E2E_FLAKY_RERUN"
  bash -c "$E2E_FLAKY_RERUN" 2>&1 | tee "$LOG.rerun"; RC2="${PIPESTATUS[0]}"
else
  echo "[flaky-gate:$TAG] run 2: $*"
  "$@" 2>&1 | tee "$LOG.rerun"; RC2="${PIPESTATUS[0]}"
fi
if [ "$RC2" -eq 0 ]; then
  echo "[flaky-gate:$TAG] rerun GREEN -- known-flaky recovery succeeded (families:$FAMS)."
  rm -f "$LOG" "$LOG.rerun"; exit 0
fi
echo "[flaky-gate:$TAG] rerun STILL RED (rc=$RC2) -> ABORT. Not a flake."
exit "$RC2"
