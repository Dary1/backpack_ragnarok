# REQ-0347 — Unexplained `socket hang up` from a fleet worker api

## Status
todo — one occurrence, evidence preserved, NOT reproduced.

## What happened

`tools/release.sh` on master (2026-07-29, the REQ-0345 merge gate) failed at
`client/e2e/schedule.spec.ts:1206`:

```
Error: apiRequestContext.delete: socket hang up
  → DELETE http://127.0.0.1:8803/api/schedule/rooms/room_194eb1a829bf5a0c
    X-E2E-Worker: 1
```

Test #174 of 209 — not at teardown. The immediate re-run of the identical tree
was **CI GREEN** and pushed.

## What was ruled out

- **Not the api crashing**: `/tmp/bp_e2e_workers_logs_last/w1-api.log` contains
  only its startup lines. No stack trace, no `ECONNRESET`, no `EADDRINUSE`
  across any of the four worker logs.
- **Not OOM**: no oom-kill entries; 12 G available at the time.
- **Not REQ-0345**: that REQ changes board rendering only; this is a DELETE on
  the schedule API from the request fixture, not the page.

## What is NOT claimed

That it is fixed. One green re-run is not a diagnosis, and this project's
REQ-0159 discipline says a red is either a real defect or a stale gate. This is
recorded so the **second** occurrence is recognised as a pattern rather than
re-investigated from scratch — which is exactly how `artadmin.spec.ts:124` was
eventually root-caused (REQ-0344) after being dismissed as noise.

If it recurs, the thing to capture is whether the proxy
(`client/e2e/local-proxy.cjs`) or the worker api closed the socket, and what
else the box was doing at that moment.
