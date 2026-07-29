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

**Which test that is.** `:1206:3` is playwright's *test-declaration* coordinate
(`file:line:col` of the `test(` call, col 3 inside a describe), not the line
that threw. Line 1206 declares
`REQ-0045 (g): monitor Log tab … › the Log tab shows idx-prefixed humanized
lines …`, whose last statement is `await apiCancelRoom(...)` — the DELETE.
Worth stating because the neighbouring test (REQ-0045 (f), declared at 1134)
also ends in the same `apiCancelRoom` call, and reading 1206 as a throw site
lands on the wrong one — see §3.

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

### Why it looked strong — and the correction

The proxy holds an idle connection for `http.Server.keepAliveTimeout` = **5000
ms**, and `http.globalAgent.keepAlive` is `true` (node v24.18.0) — both read
off the banner REQ-0347a added. A pooled connection reused at the instant the
server drops it is the textbook shape of a one-off `socket hang up`: rare,
load-dependent, green on re-run. That much stands.

**The first version of this section then pinned it on the wrong test.** It
quoted the `deadline = Date.now() + 5000` polling loop that precedes
`apiCancelRoom` in the REQ-0045 (f) enemy-label test — 5000 ms of zero API
traffic against a 5000 ms timeout, a coincidence too neat to leave untested.
But that loop belongs to the test declared at **1134**, and the failure is the
test declared at **1206** (§1). The real prelude to the failing DELETE is:

```ts
await expect(page.locator(... 'monitor-feed-row').first()).toBeVisible({ timeout: 25000 });
… overflow menu → copy → clipboard read (page-only) …
await apiCancelRoom(page, player.token, roomId);   // the DELETE that hung up
```

— a long and *variable* page-only stretch, not a 5000 ms one. That change of
facts **weakens** the hypothesis on its own, before any experiment: after a gap
that long the request context's pooled socket is already gone, so playwright
opens a fresh connection and there is no reuse window to race. The 5000/5000
coincidence was never there.

The experiment below was run against the boundary directly, so it remains valid
either way — and it is what settles the question. Recorded rather than quietly
deleted because the misread is the kind a second investigator would repeat.

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

## 4. The failing test itself — 150 runs, and two leads closed

The direct attack: the actual test at `schedule.spec.ts:1206`, repeated, with
`E2E_PROXY_TRACE=1` and the same 4-worker parallelism and box load a release
gate has.

| run | repetitions | recurrences | anomaly lines |
|---|---|---|---|
| `--repeat-each=30`, 4 workers, loaded | 30 | **0** | **0** |
| `--repeat-each=120`, 4 workers, loaded | 120 | **0** | **0** |

**150 consecutive executions of the exact failing test, zero recurrences, zero
anomaly lines.** The trace shows the connections busy throughout (sockets
serving 1-18 requests over 0.6-7.5 s), so the runs were the real thing.

Two leads die here:

- **"The cancel disturbs an in-flight stream."** There is no stream. The monitor
  is a **poller** — `client/src/schedule/monitor/useRunPlayhead.ts`, a paced
  poll with a deliberate 2.5 s live lag. No `EventSource`, no `WebSocket`, no
  `text/event-stream` anywhere in `client/src` or `server/`. And the handler is
  ordinary: `DELETE /api/schedule/rooms/:id` → `loadAndSettleRoom` →
  `rooms.cancelRoom`, which sets a status, writes the room, returns it. It
  touches no socket, no timer, no other response.
- **"It is about the request context's idle socket."** §3: not at that gap
  length, and not in 836 straddling trials.

What that leaves, honestly:

- **A genuinely rare event** — 150 runs of the test and 836 boundary trials do
  not exclude something at one-in-a-few-thousand. The original was one in one
  full gate.
- **Something about the whole gate, not this test** — the failure happened as
  test #174 of 209 with three other workers, four api processes, chromium and a
  GPU all live. Every reproduction here ran this test *alone* (×4). The next
  cheap step, if it recurs, is a full `CI_SCOPE=both` gate with
  `E2E_PROXY_TRACE=1` rather than more repetitions of one spec.
- **Something outside both processes** — the loopback or the box itself.

Explicitly NOT on the list any more: "the api was quiet so it must have been
the proxy" (§2), the keep-alive race as a first guess (§3), and anything about
live streams or the cancel handler (this section).

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

Then re-run with `E2E_PROXY_TRACE=1` for the full connection census — and
make that a **full `CI_SCOPE=both` gate**, not a repeat of one spec: §4 already
spent 150 solo repetitions of the failing test for nothing, and the one thing
the original failure had that none of them did is the other 208 tests.

## 6. What is NOT claimed

That it is fixed, or that anything here caused it. One green re-run is not a
diagnosis, and this project's REQ-0159 discipline says a red is either a real
defect or a stale gate. Nothing in §3 was *fixed* — a hypothesis was falsified,
which is cheaper and worth more than a speculative mitigation shipped as a
cure. This stays open so the second occurrence is recognised as a pattern —
exactly how `artadmin.spec.ts:124` was eventually root-caused (REQ-0344) after
being dismissed as noise.
