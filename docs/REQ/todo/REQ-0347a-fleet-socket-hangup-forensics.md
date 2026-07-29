# REQ-0347a — Name whoever closes an e2e socket

## Status
built — 2026-07-29. Implemented, verified against synthetic failures, awaiting
user acceptance / merge.

Split from REQ-0347 (see REQ-0347b, which keeps the unresolved observation).
REQ-0347 asked for one thing to happen before the next occurrence: *"the thing
to capture is whether the proxy or the worker api closed the socket, and what
else the box was doing at that moment."* This is that capture. It diagnoses
nothing on its own and claims nothing about the original failure.

---

## 1. Why the first occurrence left no trace

Not bad luck. Three separate reasons the evidence could not have existed:

1. **`client/e2e/local-proxy.cjs`'s `clientError` handler was
   `(_e, sock) => { try { sock.destroy(); } catch {} }`** — the socket is
   destroyed and the error discarded, unnamed and uncounted. A client that had
   its socket destroyed by this line sees precisely `socket hang up`. This was
   the single most likely producer of the reported symptom and it was, by
   construction, invisible.
2. **The upstream error path logged nothing either.** `preq.on('error')` put
   the message in a 502 body and nowhere else — so "the api reset us" was
   knowable only by the client that received the 502. (Worth noting: that path
   always *answers*, so a bare hang-up almost certainly did not come through
   it — but until now that was unprovable rather than merely unproven.)
3. **The proxy's stdout/stderr were thrown away.** `playwright.config.ts`'s
   `webServer` block set no `stdout`/`stderr`, and Playwright's default for
   both is `'ignore'`. Even the proxy's startup banner never reached a run
   report. Nothing this process could have said would have been kept.

`/tmp/bp_e2e_workers_logs_last/w1-api.log` holding "only its startup lines" was
therefore not evidence that the api was healthy. It was evidence that nothing
in the harness was watching.

## 2. What was added

All of it in `client/e2e/local-proxy.cjs`, plus two lines of
`client/playwright.config.ts`. Pure observation: no routing, timing, pooling or
lifecycle behaviour changes.

| line | fires when | answers |
|---|---|---|
| `UPSTREAM-ERROR` | `preq` errors (`ECONNRESET`, `ECONNREFUSED`, …) | the worker api closed/refused the upstream socket |
| `UPSTREAM-ABORTED` | the api answered, then dropped the body | the api died mid-response |
| `CLIENT-ERROR` | `server.on('clientError')`, **before** the destroy | THIS proxy killed the client socket |
| `DOWNSTREAM-CLOSED` | `cres` closes without `finish` | the client socket died before we answered |
| `SOCKET-ERROR-CLOSE` | a client socket closes with `hadError` | the keep-alive race — carries the socket's served-request count and age |

Every line carries the method, URL, `X-E2E-Worker`, upstream port, elapsed ms,
and **the full in-flight request list at that instant** — the REQ's second ask
("what else the box was doing"). Only anomalies are logged, so a clean run
writes nothing beyond its banner.

The banner now records `keepAliveTimeout`, `headersTimeout`, `requestTimeout`,
`http.globalAgent.keepAlive` and the node version, because the keep-alive
hypothesis (see REQ-0347b §3) is only testable against the values actually in
force, and node has moved these defaults between majors.

**And a silent run is itself a result.** If a future hang-up produces no line
here, the socket died between Playwright and this proxy without a request ever
being parsed — which excludes both services and points at the box/loopback.
That is why the banner is written to the log file even on a clean run: an
otherwise-empty file is the positive statement "this proxy saw nothing
abnormal", which is exactly what the first occurrence could not make.

### Where it lands

- stderr — under `tools/e2e_harness.sh` the whole process is already redirected
  into that harness's `<log>_proxy.log`; under Playwright's `webServer` it is
  now piped into the run report, next to the failing test (`stdout: 'pipe'`,
  `stderr: 'pipe'`).
- `${E2E_FLEET_ROOT}_proxy_anomalies.log` — a per-run file, sibling to the
  fleet's own `${ROOT}_logs_last/`, so it survives teardown the same way and is
  scoped to one run. REQ-0234 (F4) already paid for the global-path version of
  this mistake: run B's teardown ate run A's forensics.

## 3. Verified against real failures, not by inspection

Instrumentation that has never fired is a second thing to debug during an
incident. Each path was driven synthetically (proxy on :9500, fleet base
:9599):

```
# upstream refused
UPSTREAM-ERROR   GET /api/content w- -> :9599 after 4ms ECONNREFUSED
                 connect ECONNREFUSED 127.0.0.1:9599 inflight=1 [GET /api/content w- 4ms]
# malformed request line -- the previously silent destroy
CLIENT-ERROR     HPE_INVALID_METHOD Parse Error: Invalid method encountered
                 served=0 bytesRead=11 inflight=0
# client gives up on a hanging upstream
DOWNSTREAM-CLOSED GET /api/content w- -> :9599 after 1004ms
                 upstreamAnswered=false headersSent=false inflight=1 [GET /api/content w- 1004ms]
```

And the banner, from a normal scoped e2e run on this box:

```
[e2e local-proxy] http://127.0.0.1:9002 (/api -> fleet :9004+w, /app -> worktree static, else 404)
  [REQ-0347 keepAliveTimeout=5000ms headersTimeout=60000ms requestTimeout=300000ms
   upstreamKeepAlive=true node=v24.18.0 log=/tmp/bp_e2e_workers_<pid>_proxy_anomalies.log]
```

## 4. Files

| file | change |
|---|---|
| `client/e2e/local-proxy.cjs` | the forensics block, per-request and per-socket bookkeeping, the five anomaly lines, the banner |
| `client/playwright.config.ts` | `webServer.stdout`/`stderr` `'pipe'` — the proxy could not be heard at all before |

## 5. Gates

| gate | result |
|---|---|
| `node --check` + `oxlint` on the proxy | clean, 0 warnings |
| `tsc -b` (client) | clean |
| synthetic anomaly probes | 3/3 lines produced (§3) |
| `tools/ci.sh CI_SCOPE=both` | shared with REQ-0346 — same branch, same run |

Carried on branch `req-0346-claim-pulse` alongside REQ-0346: one e2e-harness
change and one client change, both gated by the same run.
