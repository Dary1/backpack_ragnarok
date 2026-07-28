# REQ-0335 — artwork_test was restarting the live ComfyUI on every CI run

## Status
built — 2026-07-28. Awaiting user acceptance / merge.

One line. `server/tests/artwork_test.cjs` runs **70.1 s → 2.8 s** (25×) and stops
bouncing the box's art server.

Found by following up REQ-0334's first measurement, which named
`artwork_test.cjs` as the most expensive *unit* file in the repo (19 tests,
70.3 s, ci.sh stage `[5.1/7]`, 14% of the whole run). The user's question was the
right one — *"does it actually need to execute? couldn't it start and cancel
immediately?"* — and the answer turned out to be better than that: **the render
was never the cost.**

---

## 1. What was actually happening

`artwork_test.cjs` sets `ART_ROUTE_MOCK=1`, so generation is a synthetic PNG and
`art_job.py` costs ~70 ms of Python startup. The auto-inspection kits fail fast
in CI (`No module named 'numpy'`). Neither is where the time went.

The time went into `familyBarrier()` — `server/services/art_jobs.cjs`, REQ-0233:

```js
const p = spawn('systemctl', ['--user', 'restart', 'comfyui.service'], { env });
…
awaitComfyHealth()   // GET 127.0.0.1:8188/system_stats, retry every 1000ms, 60s deadline
```

That is a **genuine restart of the running ComfyUI service**, fired on every
generation→matte family switch, followed by a 1-second-granularity poll until a
FLUX-loading ComfyUI answers again. In production that is exactly right: it
returns host RSS so a single model stack is resident before the first birefnet
matte loads.

In a test it is neither wanted nor asserted. **Every sibling already opts out:**

| file | |
|---|---|
| `server/tests/artfamily_test.cjs:22` | `ART_FAMILY_BARRIER = '0'` — *"count barrier fires; never restart comfyui"* |
| `server/tests/artqueue_test.cjs:22` | `ART_FAMILY_BARRIER = '0'` |
| `server/tests/inspection_test.cjs:22` | `ART_FAMILY_BARRIER = '0'` |
| `tools/e2e_harness.sh:146` | sets it for **every** admin harness |
| **`server/tests/artwork_test.cjs`** | **missed** |

So the convention was established, documented in three places, applied
everywhere — and this one file fell through. Nothing pointed at it, because a
test that is merely slow looks like a test that is doing a lot of work.

### Confirmed live, not inferred

    $ systemctl --user show comfyui.service -p ActiveEnterTimestamp
    ActiveEnterTimestamp=Tue 2026-07-28 13:42:20 UTC
    $ date
    Tue Jul 28 01:42:21 PM UTC 2026     # one second after the test fired

ComfyUI had been up since a manual restart at ~10:20. Launching
`artwork_test.cjs` bounced it. `NRestarts=0`, i.e. systemd did not do this —
the test did.

**This is a side effect on the box, not only a slow gate.** Every `tools/ci.sh`
run — which the project requires before every commit that touches code — killed
whatever the user's art session had resident and waited for it to reload.

## 2. The fix

```js
process.env.ART_ROUTE_MOCK = '1';
process.env.ART_FAMILY_BARRIER = '0';   // + the reasoning, in the file
```

**Coverage is not reduced.** This file gates REQ-0151 G1/G2/G3 — storage
chokepoint, sizing law, provenance — and asserts nothing about the barrier. The
barrier's *logical* firing is still counted with the flag off (that is the whole
design of the seam), so `artfamily_test.cjs`, which does assert barrier
behaviour, keeps its coverage untouched.

## 3. Measured

| | before | after |
|---|---|---|
| `node server/tests/artwork_test.cjs` | **70.1 s** | **2.84 s** |
| result | 19 passed / 0 failed | 19 passed / 0 failed |
| slowest single test | 12.6 s | 0.64 s |
| ComfyUI `ActiveEnterTimestamp` across the run | **changes** | **unchanged** |
| ci.sh stage `[5.1/7]` | 70.3 s (14% of the run) | ~3 s |

Whole-suite effect: ci.sh ~505 s → ~438 s, **−13% for one line**, and the art
server survives CI.

## 4. What this does NOT explain

The user also asked about `artadmin.spec.ts` (8 tests, ~100 s, 12.5 s/test — the
most expensive tests in the repo per test). **Different cause, and it is already
doing the right thing**: `tools/e2e_harness.sh` sets `ART_FAMILY_BARRIER=0` for
every admin harness, so no restart happens there. Its cost is the admin UI's own
polling cadence — `ArtAdminPage.tsx` polls the queue every **2000 ms** and the
list every **10000 ms** — and the spec honestly waits for the polled DOM to
reflect a finished render (`render-status-<seed>` → `[ok]`, 90 s budget). Each
wait therefore costs up to a poll interval, several times per test.

That is not waste in the same sense: the test is waiting for real UI state. The
fix shape is different (wait on the network response rather than the polled DOM,
or make the interval configurable under e2e) and belongs in its own REQ, with
REQ-0334's tooling to show the before/after.

## 5. Files

`server/tests/artwork_test.cjs` — one env line plus the reasoning. No product
code, no other test, no content.

## Log
- 2026-07-28 reserved as REQ-0335 on branch req-0335-artwork-test-family-barrier
  (off master 097ae1a).
- 2026-07-28 fixed; 19/0 in 2.84 s with ComfyUI's start timestamp unchanged
  across the run; full gate; reserved -> built.

## Gate results (2026-07-28)
- `tools/release.sh` **CI GREEN**, `dist unchanged`.
- **ci.sh wall 504.9 s -> 435.1 s (-14%)** for this one line. Stage `[5.1/7]`
  70,254 ms -> 2,847 ms and fell out of the top five stages entirely.
- Everything else unchanged: admin trio 8/1/28, registry 4/4, scoped e2e
  197 passed / 0 failed / 1 skipped.
