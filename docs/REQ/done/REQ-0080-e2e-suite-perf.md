# REQ-0080 — Full Test Suite (E2E) performance: local ingress proxy + GPU rendering

Branch: `req-0080-e2e-suite-perf` (off `master` @ 52da31d; code-only after the
server `docs/` removal, master @ bc45ddd — this doc now lives on the Cowork FS).
Renumbered 0079 -> 0080 (0079 was taken by the merged REQ-0079-linker-destination-triggers).
Scope class: **test-infrastructure only**. No product code, no external behavior,
no data-format change. `sim`/`mock-src` untouched (dependency-free invariant kept).

## 日本語サマリ

「Full Test Suite」(`npm test` = `bash tools/ci.sh`) を実機で計測したところ、全体 約11.4分
のうち **97%(11.1分)が最終ステージ [7/7] の Playwright E2E(125件)**。E2E が遅い主因は3つ:

1. **直列実行**(`workers:1`, `fullyParallel:false`)。全 spec が単一のライブプロファイル
   `data/profiles/default.json` を書き換えるため、安全上わざと直列にしてある(構造的制約)。
2. **WebGL がソフト描画**。アプリは PixiJS 8。だが headless Chrome が `--use-angle=
   swiftshader-webgl` で動き、RTX 2080 が 0% で遊休のまま CPU で描画(1 spec で約4.5コア消費)。
3. **baseURL が公開 Cloudflare トンネル**。1リクエスト 約42ms、localhost 直の約1msに対し ~40倍。

本 REQ は **製品コードを一切触らない安全な 2・3 のみ**を対象:E2E 実行時だけ
ローカルの経路分割プロキシ(`/api/*`→:8802, その他→:8801)を立てて baseURL を
localhost 直に、かつ headless Chrome を GPU 描画へ切替える。いずれも既定値は現状維持
(env オプトイン)にし、計測で明確な改善かつ緑を確認できたものだけ既定化する。
**1(直列解消=テスト分離による並列化)は影響範囲が大きいため別 REQ**(§3)に切り出す。

## 1. Evidence (measured on `llmlocal`, live `tools/ci.sh` run, 2026-07-06)

Whole-suite stage breakdown (wall time):

| Stage | What | Time | Share |
|---|---|---|---|
| 1 | sim tests (60) | 0.11s | |
| 2 | sim replay goldens | 0.07s | |
| 3 | mock-src engine tests (97) | 0.07s | |
| 3.5 | tsc typecheck | 0.98s | |
| 3.6 | engine type-drift | 0.03s | |
| 4 | server api tests, files backend (134) | 0.51s | |
| 5 | server api tests, **pg** backend (134) | 14.2s | ~2% |
| 6 | client typecheck + build | 3.8s | <1% |
| 7 | **client e2e (125)** | **666s / 11.1 min** | **~97%** |
| | **total** | **~686s / 11.4 min** | |

E2E internals: 125 tests, **1 worker**, mean **5.3s/test**, slowest 24.4s. The sum of
per-test durations (660s) ≈ the stage wall time (666s), i.e. **~0% parallelism** today.
Heaviest specs: `reference-model` 110s/8, `schedule` 85s/24, `bp-transfer` 62s/6,
`tab-reorder-trash` 62s/8. ~90 render-bearing tests take multiple seconds; 11 pure-API
tests are sub-second.

Latency (curl, 5 samples): app via tunnel `https://backpack-dev.qtie.jp` **~42ms**
(connect 10 + TLS 20 …) vs `http://127.0.0.1:8801` **~0.8ms**; `/api` tunnel 43ms vs
`127.0.0.1:8802` 1.3ms. Specs issue **34 `page.goto`** (each a full bundle reload) plus
many `/api/*` fetches, all currently through the tunnel.

Rendering: live chrome args include `--use-angle=swiftshader-webgl
--enable-unsafe-swiftshader`; top showed the chrome gpu-process at **448% CPU** while
`nvidia-smi` showed the **RTX 2080 at 0% / 9 MiB**. GPU EGL/Vulkan stack is installed
(`libEGL_nvidia.so.595.71.05`, `libGLX_nvidia.so.595.71.05`).

Note: that run ended **123 passed / 2 failed** — the 2 failures are `schedule.spec.ts`
REQ-0043 dungeon auto-gen (a **correctness** issue, pre-existing, unrelated to perf and
out of scope here; now tracked by **REQ-0082**). Success criterion below is measured
against that baseline.

## 2. Root causes (ranked by leverage)

1. Serial execution forced by a single shared live profile (no staging profile).
   Biggest lever but requires per-worker data isolation → **separate REQ**.
2. Software WebGL (SwiftShader) on CPU while the GPU is idle → this REQ §4b.
3. Public-tunnel baseURL: ~40× per-request latency on every nav + API call → this REQ §4a.
4. 71 hardcoded `waitForTimeout` (~20.3s of fixed sleeps) → separate REQ.
5. pg-backend api tests 14.2s (28× the files backend) → separate REQ.

## 3. Scope

**In scope (this REQ):**
- §4a Local ingress-split proxy + env-selectable `baseURL` (default preserved).
- §4b GPU-accelerated headless rendering (env-selectable; default preserved unless proven).

**Out of scope — recommended follow-up REQs (documented, not started):**
- E2E worker parallelization via per-worker profile/data isolation (the #1 lever).
- Replace `waitForTimeout` sleeps with assertion/event waits.
- pg-backend api-test speedup (batch/transaction fixtures).

## 4. Design

### 4a. Local ingress-split proxy (`client/e2e/local-proxy.cjs`)
A dependency-free `node:http` reverse proxy on `127.0.0.1:${E2E_PROXY_PORT:-8803}`:
`/api/*` → `127.0.0.1:8802`, everything else → `127.0.0.1:8801`. This reproduces the
Cloudflare ingress split locally, so the app can be loaded from the proxy origin and its
relative `fetch('/api/...')` calls resolve without going out to the internet. Specs already
navigate only with **relative** paths (`.goto('/app/...')`), so no spec change is needed.

`playwright.config.ts`: `baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://backpack-dev.qtie.jp'`
(tunnel remains the default/fallback). Playwright `webServer` launches the proxy and health-
checks it only when `PLAYWRIGHT_BASE_URL` points at localhost. `tools/ci.sh` opts in by
exporting `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8803` for the e2e stage.

### 4b. GPU-accelerated headless rendering
Opt-in launch args (`E2E_GPU=1`) on the chromium project drive the full chromium in
`--headless=new` mode with the **Vulkan** ANGLE backend:
`--headless=new --use-angle=vulkan --enable-gpu --ignore-gpu-blocklist
--enable-features=Vulkan --ozone-platform=headless --no-sandbox`.
(`--use-angle=gl`/EGL was tried first but fell back to SwiftShader; **Vulkan** is the
backend that actually reaches the NVIDIA GPU on this box.) Verified live renderer string:
`ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA GeForce RTX 2080), NVIDIA)`.

## 5. Gate plan
`bash tools/ci.sh` (with `SKIP_PG` unset). Success = **no new failures** vs the 123/125
baseline (the 2 REQ-0043 failures may persist; they are out of scope) **and** a measured
reduction in stage-[7/7] wall time.

## 6. Results (built)

**Branch:** `req-0080-e2e-suite-perf`, off master @ `52da31d` (see `git log`).
Code-only on the server after the `docs/` removal (master @ bc45ddd); this doc is on the FS board.

**Files:** `client/e2e/local-proxy.cjs` (new, 39 LOC, dependency-free) ·
`client/playwright.config.ts` (baseURL env + `webServer` proxy + `E2E_GPU` args) ·
`tools/ci.sh` (stage [7/7] defaults to proxy + GPU, both env-overridable).

**Validation (llmlocal, full 125-test e2e, workers:1 — still serial):**

| | baseline (tunnel + SwiftShader) | this REQ (localhost proxy + GPU) |
|---|---|---|
| e2e stage wall | **666 s (11.1 min)** | **398 s (6.6 min)** — **−40%, 1.67×** |
| result | 123 passed / 2 failed | 123 passed / 2 failed (**identical**) |
| mean per test | 5.3 s | ~3.2 s |
| per-request latency | ~42 ms (tunnel) | ~1.5 ms (localhost) |
| WebGL renderer | ANGLE SwiftShader (CPU) | ANGLE NVIDIA Vulkan RTX 2080 |

Representative render-heavy tests: `baseline-smoke` PO-drag 16.5 s → **7.1 s**;
`reference-model` #4 22.6 s → **10.9 s**. Proxy verified independently: `/api/health`
76 ms (tunnel) → 1.5 ms (proxy); 9/9 auth+render subset green over http-localhost
(guest-auth token/cookie flow works without the tunnel).

**Gate:** the 2 failures are `schedule.spec.ts:274` and `:333` (REQ-0043 dungeon
auto-gen) — **pre-existing and unchanged** (user-confirmed 123/125 baseline), now owned
by **REQ-0082**. No new failures introduced. Whole `npm test`: ~11.4 min → ~6.9 min.

**State:** built — green modulo the pre-existing REQ-0043 failures; branch
`req-0080-e2e-suite-perf`, merged to master @ 661b384 (2026-07-07); accepted -> done.

**Deferred (bigger lever, separate REQ):** E2E worker parallelization needs per-worker
profile/data isolation (today all specs mutate the single live `default.json`, forcing
workers:1). On 8 cores + GPU, that would stack multiplicatively on this REQ's gains.
