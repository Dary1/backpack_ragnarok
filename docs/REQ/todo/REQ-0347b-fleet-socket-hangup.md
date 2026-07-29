# REQ-0347b — Unexplained `socket hang up` from a fleet worker api

## Status
todo — one occurrence, NOT reproduced, NOT diagnosed. The first hypothesis has
now been tested and **ruled out**; the REQ stays open, with a shorter list of
suspects and the instrumentation (REQ-0347a) in place for the next occurrence.

Split from REQ-0347 because its capture half could reach `built` and this half
cannot.

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

## 2. What was ruled out originally, and how much of it survives

- **Not the api crashing**: `w1-api.log` contains only its startup lines.
- **Not OOM**: no oom-kill entries; 12 G available.
- **Not REQ-0345**: that REQ changes board rendering only; this is a DELETE on
  the schedule API from the request fixture, not the page.

**The first bullet is worth less than it looked.** REQ-0347a established that
the harness logged nothing per-request anywhere: the proxy destroyed sockets in
`clientError` silently, its upstream error path wrote only into a 502 body, and
`playwright.config.ts` left `webServer` stdout/stderr at the default `'ignore'`.
A quiet api log was the harness's resting state, not a statement about the api.

## 3. The keep-alive race — tested, RULED OUT

### Why it looked so strong

`client/e2e/schedule.spec.ts:1181-1206`, the exact site of the failure:

```ts
const deadline = Date.now() + 5000;
while (Date.now() < deadline) {
  const bounds = await page.evaluate(...);   // page work only
  ...
  await page.waitForTimeout(300);
}
expect(checkedAtLeastOne).toBe(true);

await apiCancelRoom(page, player.token, roomId);   // <- line 1206, the DELETE
```

The DELETE is preceded by **exactly 5000 ms in which the request context issues
no API traffic at all** — and `http.Server.keepAliveTimeout` is **5000 ms**
(confirmed from the banner REQ-0347a added; `http.globalAgent.keepAlive` is
also `true`, node v24.18.0). A pooled connection going idle for precisely as
long as the server is willing to hold it, then being reused, is the textbook
shape of a one-off `socket hang up`: rare, load-dependent, green on re-run.

Two numbers that identical, arrived at independently, are exactly the kind of
coincidence that deserves to be tested rather than believed.

### The experiment

| probe | client | boundary | trials | hang-ups |
|---|---|---|---|---|
| node `http.Agent`, keep-alive, idle swept 1000/4800/4950/4990/5000/5010 ms | node | real 5000 ms | 36 | **0** |
| playwright `page.request`, same shape as :1181-1206 | the real one | real 5000 ms | 10 | **0** |
| playwright `page.request`, idle jittered ±20 ms around the boundary | the real one | compressed to 300 ms | 200 | **0** |
| same, 4 workers in parallel, 8 spinners pinning the box (load avg 7+) | the real one | compressed to 300 ms | 600 | **0** |

**836 straddling trials, zero hang-ups.** The compression is legitimate: the
race is the same code path at 300 ms as at 5000 ms, crossed ~17× more often.

**And the probe was not vacuous.** With `E2E_PROXY_TRACE=1` the proxy logged
every socket close: sockets serving **8-20 requests each over 6-51 s**. The
connections really were pooled and really were reused across the boundary —
playwright's client simply notices the server's close and opens a fresh socket.

Conclusion: this mechanism is not what routinely happens, and a future
investigator should not spend a day on it. It is not *impossible* — the true
race window is a few event-loop ticks wide and 836 trials do not exclude a
one-in-a-hundred-thousand event — but it is no longer the thing to look at
first. `E2E_PROXY_KEEPALIVE_MS` (REQ-0347a) is kept precisely so the experiment
is one command rather than a re-derivation.

## 4. What is left

In rough order of what the evidence permits:

- **A genuinely rare race** of the kind above, at a rate 836 trials cannot see.
- **Something specific to THAT request**, not to idle sockets generally: line
  1206 cancels a room with a **live run** attached, after a monitor stream has
  been open against the same worker api for seconds. Nothing here has looked at
  what `DELETE /api/schedule/rooms/:id` does to in-flight streams for that room.
  This is the least-explored direction and the most specific to the failure.
- **Something outside both processes** — the loopback, or the box, at a moment
  a full release gate had four browsers, four api workers and a GPU busy.

Explicitly NOT on the list any more: "the api was quiet so it must have been
the proxy" (§2), and the keep-alive race as a first guess (§3).

## 5. On recurrence — what to read, in order

1. the run report — the proxy's stderr is piped into it now, so any
   `[e2e local-proxy][REQ-0347]` line sits next to the failing test;
2. `${E2E_FLEET_ROOT}_proxy_anomalies.log` (or the harness's
   `<log>_proxy.log`), which survives teardown;
3. `${E2E_FLEET_ROOT}_logs_last/w<n>-api.log` as before.

Read the verdict directly off the line: `UPSTREAM-ERROR`/`UPSTREAM-ABORTED` =
the worker api; `CLIENT-ERROR` = the proxy; `DOWNSTREAM-CLOSED` = the client
socket died first; `SOCKET-ERROR-CLOSE` with a non-zero `served=` = the
keep-alive race after all, and §3 becomes wrong in a useful way. **No line at
all** = the socket died before any request was parsed, which excludes both
services. Every line carries the in-flight request list.

Then re-run with `E2E_PROXY_TRACE=1` for the full connection census.

## 6. What is NOT claimed

That it is fixed, or that anything here caused it. One green re-run is not a
diagnosis, and this project's REQ-0159 discipline says a red is either a real
defect or a stale gate. Nothing in §3 was *fixed* — a hypothesis was falsified,
which is cheaper and worth more than a speculative mitigation shipped as a
cure. This stays open so the second occurrence is recognised as a pattern —
exactly how `artadmin.spec.ts:124` was eventually root-caused (REQ-0344) after
being dismissed as noise.
