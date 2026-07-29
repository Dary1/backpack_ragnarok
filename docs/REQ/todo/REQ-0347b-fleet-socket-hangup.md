# REQ-0347b — Unexplained `socket hang up` from a fleet worker api

## Status
todo — one occurrence, NOT reproduced, NOT diagnosed. Open deliberately, so the
**second** occurrence is recognised as a pattern instead of re-investigated from
scratch. The evidence capture it asked for now exists: REQ-0347a (built).

Split from REQ-0347: the capture work could reach `built` while this cannot, and
PROJECT.md's REQ policy says phases that hold different statuses become
independent files.

---

## 1. What happened

`tools/release.sh` on master (2026-07-29, the REQ-0345 merge gate) failed at
`client/e2e/schedule.spec.ts:1206`:

```
Error: apiRequestContext.delete: socket hang up
  → DELETE http://127.0.0.1:8803/api/schedule/rooms/room_194eb1a829bf5a0c
    X-E2E-Worker: 1
```

Test #174 of 209 — not at teardown. The immediate re-run of the identical tree
was **CI GREEN** and pushed.

## 2. What was ruled out

- **Not the api crashing**: `/tmp/bp_e2e_workers_logs_last/w1-api.log` contains
  only its startup lines. No stack trace, no `ECONNRESET`, no `EADDRINUSE`
  across any of the four worker logs.
- **Not OOM**: no oom-kill entries; 12 G available at the time.
- **Not REQ-0345**: that REQ changes board rendering only; this is a DELETE on
  the schedule API from the request fixture, not the page.

**Weakened by REQ-0347a**: the first bullet is worth less than it looked. The
worker api log is quiet because nothing in the harness logged per-request
events at all — and the proxy, the other candidate, was configured so that its
output was discarded outright and its `clientError` destroy was silent. "No
trace" was the harness's default state, not a finding about the api.

## 3. Leading hypothesis, now named

`http.Server.keepAliveTimeout` is **5000 ms** and the proxy's upstream agent
pools (`http.globalAgent.keepAlive === true`, node v24.18.0) — both confirmed
from the banner REQ-0347a added. That is the standing shape of a one-off
`socket hang up`: a pooled idle connection is closed by one end at the instant
the other reuses it, on a box busy enough to lose the race occasionally. Test
#174 of 209 in a parallel run is exactly when that becomes likely, and a
green immediate re-run is exactly what it looks like.

This is a hypothesis. Nothing here tests it, and it is written down to be
falsified, not believed. `SOCKET-ERROR-CLOSE` (with the socket's served-request
count and age) is the line that would confirm or kill it.

## 4. On recurrence — what to read, in order

1. the run report — the proxy's stderr is piped into it now, so any
   `[e2e local-proxy][REQ-0347]` line appears next to the failing test;
2. `${E2E_FLEET_ROOT}_proxy_anomalies.log` (or the harness's
   `<log>_proxy.log`), which survives teardown;
3. `${E2E_FLEET_ROOT}_logs_last/w<n>-api.log` as before.

Read the anomaly line's verdict directly: `UPSTREAM-ERROR`/`UPSTREAM-ABORTED`
= the worker api; `CLIENT-ERROR` = this proxy; `DOWNSTREAM-CLOSED` = the client
socket died first; `SOCKET-ERROR-CLOSE` with a non-zero `served=` = the
keep-alive race. **No line at all** = the socket died before any request was
parsed, which excludes both services. Every line carries the in-flight request
list, which is the "what else was the box doing" the first occurrence lacked.

## 5. What is NOT claimed

That it is fixed. One green re-run is not a diagnosis, and this project's
REQ-0159 discipline says a red is either a real defect or a stale gate. This is
recorded so the second occurrence is recognised as a pattern — which is exactly
how `artadmin.spec.ts:124` was eventually root-caused (REQ-0344) after being
dismissed as noise.
