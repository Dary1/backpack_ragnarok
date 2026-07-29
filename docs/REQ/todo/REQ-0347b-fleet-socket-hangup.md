# REQ-0347b — Unexplained `socket hang up` from a fleet worker api

## Status
todo — **two** occurrences (see §6), NOT reproduced, NOT diagnosed. Four
hypotheses have been tested and ruled out, and the rate has been estimated well
enough to say that further reproduction attempts are a bad investment. The REQ
stays open with the instrumentation (REQ-0347a) in place, because one future
occurrence is now enough to name the closer.

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
  GPU all live, and every reproduction in this section ran the test *alone*
  (×4). **§5 then closed this one too**: six traced full-suite runs, 1 260
  executions, nothing.
- **Something outside both processes** — the loopback or the box itself.

Explicitly NOT on the list any more: "the api was quiet so it must have been
the proxy" (§2), the keep-alive race as a first guess (§3), and anything about
live streams or the cancel handler (this section).

## 5. The whole suite, six times — and a real proxy bug found on the way

§4 ended by naming the one condition every reproduction attempt had lacked: the
other 208 tests. So the full suite was run six times, traced.

| runs | tests each | failures | `socket hang up` | anomaly lines | socket closes traced |
|---|---|---|---|---|---|
| 6 (4 workers, `E2E_PROXY_TRACE=1`) | 210 | **0** | **0** | **0** | ~7 090 |

**1 260 test executions under the failure's own conditions, no recurrence.**
Runs 1-2 predate the header fix below, runs 3-6 include it; both halves are
clean, so that fix is also gated by 1 260 executions rather than by argument.

### The bug found on the way: hop-by-hop headers crossed the proxy

`local-proxy.cjs` copied headers verbatim in BOTH directions —
`{...creq.headers}` upstream and `pres.headers` straight into
`cres.writeHead()`. Hop-by-hop fields describe ONE connection and must not be
forwarded (RFC 9110 §7.6.1 / RFC 7230 §6.1), so the worker api's own connection
terms were being handed to playwright as though they were the proxy's.
Measured through a stub upstream, with the capitalisation as the tell:

```
before ->  connection: keep-alive    keep-alive: timeout=5     (lowercase --
           node lowercases parsed headers, so these are the API's own bytes)
after  ->  Connection: keep-alive    Keep-Alive: timeout=5     (node's own
           emission, describing THIS hop)
```

Fixed by stripping the standard set plus whatever the sender listed in its own
`Connection` header.

**What this is NOT.** It is not the cause, and it is not claimed to be. It does
not even remove the "both ends expire at 5000 ms" coincidence — after the fix
the client is still told `timeout=5`, only now truthfully, by the proxy about
itself, because node advertises exactly the `keepAliveTimeout` it enforces with
no safety offset (node's behaviour everywhere, not this file's invention). And
node's http *client* never parses `Keep-Alive: timeout=` at all — its
free-socket budget comes from its agent's options — so for playwright this
almost certainly changed no behaviour whatsoever. It is fixed because
forwarding another hop's connection terms is wrong, and because an unfixed
known-wrong proxy is a permanent confounder for every future investigation
here.

## 6. This is occurrence #2 — the pattern already existed in the record

This REQ was written "so the **second** occurrence is recognised as a pattern
rather than re-investigated from scratch". It turns out to be the second.
`docs/REQ/done/REQ-0142-link-trace-diagnostics.md`, filed **2026-07-13**:

> `reference-model:286` failed once on a **`socket hang up` from the local
> ingress proxy** and **passes 8/8 when its spec is re-run** (infrastructure
> flake, not a UI regression).

Same symptom, same component — `client/e2e/local-proxy.cjs` is the "local
ingress proxy" and has existed since **2026-07-07** (REQ-0080, commit
`4d913084`), so both occurrences are the same file — same disposition
(dismissed, green on re-run), 16 days apart.

**And a different spec.** `reference-model.spec.ts:286` then,
`schedule.spec.ts:1206` now. That is the most useful thing two data points can
say: it is not about a request, a handler, or a test. It is the **hop**. Every
"what is special about that DELETE" line of enquiry (§4) was aimed at the wrong
level, and so — in hindsight — were 150 solo repetitions of one spec.

**It also survived a rebuild of everything around it.** Between the two
occurrences the harness was substantially rewritten: REQ-0159 (default-suite
repair), REQ-0172 (the port-decade rule), REQ-0217 (the hermetic fleet),
REQ-0234 (the effectiveness audit), REQ-0339 (diff-scoped e2e). Whatever this
is, it is not a bug in any machinery added since 2026-07-13.

**The "infrastructure flake" label has a bad record in this project.** REQ-0159
class (B) set out to fix five named flakes, found none of them, and reported
that the two tests which *did* flake across six full runs "**both turned out to
be real defects, not flakiness**". REQ-0344 root-caused `artadmin.spec.ts:124`
after it had been dismissed as noise. That is two for two against the label —
which is exactly why REQ-0347 was filed instead of shrugged at, and why the
2026-07-13 line should have been a REQ too.

**Standing systemic context**, already audited: REQ-0234 finding F3 — the suite
is wall-clock-synchronised at ~76 fixed-sleep sites and **saturates the box it
runs on** (load hit 13.9 on 8 cores during that audit), while
`client/playwright.config.ts:76` sets `retries: 0`, so any transient at all
becomes an aborted cycle.

## 7. How rare, and why that ends the reproduction campaign

Every merge to master goes through `tools/release.sh` → the full `ci.sh` → the
210-test suite. Master took **192 merge commits between 2026-07-13 and
2026-07-29**. So the window holds on the order of **192 full-suite runs ≈ 40 000
test executions, with 2 recorded occurrences**:

> **≈ 1 per ~100 full-suite runs, ≈ 1 in 20 000 test executions.**

Against that rate, this REQ's reproduction campaign reads very differently:

| attempt | executions | chance of catching one at the estimated rate |
|---|---|---|
| 6 traced full-suite runs (§5) | 1 260 | **~6 %** |
| the whole campaign (§3 + §4 + §5) | ~2 250 | **~10 %** |
| what 50 % would need | ~70 full gates | ~4 h of box time |
| what 90 % would need | ~230 full gates | ~13 h |

The negatives were never likely to be anything else. They still earned their
keep — they falsified four *mechanisms* (§3, §4, §5), which repetition alone
could not have done — but "run it again" is now a measurably poor use of the
box, and that is a conclusion with a number behind it rather than a feeling.

Caveats, stated so the number is not over-read: 192 merges is an approximation
of gate runs in both directions (some merges may share a gate; some gates run
and are discarded), and 2 is the count of occurrences that reached a **written
record** — a flake dismissed in a terminal never became a line anywhere. Both
errors push the true rate **up**, i.e. reproduction is somewhat likelier than
the table says, but not by an order of magnitude.

## 8. On recurrence — what to read, in order

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

Then re-run with `E2E_PROXY_TRACE=1` for the full connection census. Note that
this has now been done six times over (§5) and §7 puts the odds of a seventh
attempt paying off at ~1 %: what is missing is a recurrence to look at, not
more attempts to manufacture one. The instrumentation exists precisely so that
one occurrence is enough.

**This is now automatic.** The connection census (one line per socket: requests
served, age, ports) is written to `${E2E_FLEET_ROOT}_proxy_anomalies.log` on
**every** run, with no flag to remember — ~1 200 lines a run, file only, so the
run report stays clean and anomalies still stand out in it. Given §7's rate,
nobody was ever going to have set a flag in advance for a 1-in-100-gates event;
the next natural occurrence now arrives with its own forensics already on disk.
`E2E_PROXY_TRACE=1` still mirrors the census to stderr for interactive work.

## 9. What is NOT claimed

That it is fixed, or that anything here caused it. One green re-run is not a
diagnosis, and this project's REQ-0159 discipline says a red is either a real
defect or a stale gate. Nothing in §3 was *fixed* — a hypothesis was falsified,
which is cheaper and worth more than a speculative mitigation shipped as a
cure. This stays open because the pattern is now recognised (§6) but not explained —
exactly the position `artadmin.spec.ts:124` was in before REQ-0344 root-caused
it, having been dismissed as noise first.
