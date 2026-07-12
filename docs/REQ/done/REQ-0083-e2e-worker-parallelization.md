# REQ-0083 — E2E worker parallelization via per-worker isolated API fleet

Status: **done** — merged to master @ `d9723c8` (2026-07-07). Full `tools/ci.sh` CI GREEN with
`E2E_PARALLEL=4` default: e2e **125/125 in 2.8m (×2 stable)** vs 398s serial = **2.4× faster**;
serial default path unchanged (34/34 on the coupled specs). Branch `req-0083-e2e-worker-parallelization`.
Scope class: test-infrastructure.

## 1. Design

Per-worker isolated `backpack-api` fleet + header-routed proxy; file-level parallelism
(`fullyParallel:false`, `workers:N`); per-worker `X-E2E-Worker` from `TEST_PARALLEL_INDEX`
(stable 0..N-1 slot, NOT `TEST_WORKER_INDEX` which increments per spawned worker). Storage isolates
by `os.homedir()` (`server/storage.cjs` REPO_ROOT/NAMESPACE) → a distinct HOME per api = full isolation.

## 2. Proven (this session, `af9d458`)

`meta.cjs` PORT env; `tools/e2e_fleet.cjs` (isolated HOMEs + N apis on 8810+i, kills only its own
manifest PIDs); `local-proxy.cjs` header routing; config `E2E_PARALLEL` wiring; fleet start/stop.
**Isolation verified**: a room POSTed to worker 0 → w0=1, w1=0, live=162 unchanged; proxy routes by
header. `tsc` clean; serial default run green.

## 3. Exact coupling inventory (mechanical scan — EVERY touchpoint)

**A — Bundled test fixtures (NO change; backend-agnostic).** ~14 specs read
`new URL('./fixtures/*.json', import.meta.url)` (auto-save, baseline-smoke, bp-transfer, landing,
long-press-rename, nav-routing, preset-switch, reference-model, tab-reorder-trash + the SCHEDULE/
baseline fixtures in guest specs). Read-only test inputs → untouched.

**B — CLI code path (must stay LIVE).** `CLI_INVITE_PATH = join(REPO_ROOT,'server','cli_invite.cjs')`
— schedule:50, market:38, ragnarok:40, workshop:20, schedule-mjolnir:17, guest-auth:25. Fix: derive
from a live CODE root (this is the exact line that broke on the wholesale REPO_ROOT redirect).

**C — Guest CLI invocation (must run with worker HOME).** `execFileSync(node,[CLI_INVITE_PATH,name],
{cwd:REPO_ROOT,...})` — schedule:68, market:48, ragnarok:47, workshop:39, schedule-mjolnir:34,
guest-auth:61. Fix: add `env: {...process.env, HOME:<worker home>}`.

**D — Direct data-file paths (must be worker-aware), all under REPO_ROOT (~45 refs, 8 specs):**
- `data/profiles/dev.json`: market:37, ragnarok:39, workshop:21, warehouse-mjolnir:34,
  schedule:503/759/861/911/972.
- `data/config/dev_user.json`: dex-admin:23, workshop:22, warehouse-mjolnir:33, schedule:758/827/834.
- `content/live/live_items.json`: dex-admin:24/182/246.
- `data/schedule/rooms|runs` sweeps: schedule:614-622/1144-1155, schedule-mjolnir:179-190.
- `data/warehouse/<id>`, `data/gacha_pending/<id>`: schedule:78/611/790, schedule-mjolnir:44,
  workshop:49-50.

**E — global-setup/teardown constants.** PROFILE_PATH/LIVE_ITEMS_PATH/LIVE_SIS_PATH/PLAYERS_DIR/
PROFILES_DIR/GUEST_AUTH_TRACKED_FILES_PATH. Fix: derive from `E2E_DATA_ROOT`. In the MAIN process
(globalSetup's own live backup) index is unset → live (correct); imported into a WORKER → worker path.

**F — Fleet dev-profile seeding (BUG found this pass).** The dev player uses `data/profiles/dev.json`
(`storage.profilePath('dev')`); `default.json` is only a legacy migration seed. `e2e_fleet.cjs`
currently copies `default.json` only → must copy the whole `data/profiles/` (both files).

**G — Fleet lifecycle.** Start must reclaim stale fleet ports (a crashed run left apis on 8810+ →
new fleet 502s). Fix: at start, kill listeners on the fleet range 8810–88NN only (never live 8802).

## 4. Explicit risk assessment (evidence-based — not "danger" hand-waving)

The refactor is **broad but MECHANICAL** — one worker-aware helper + ~50 redirected refs + 6 CLI env
additions + 2 fleet fixes. It is NOT a deep unknown. Honest per-risk:

| Risk | Level | Why / mitigation |
|---|---|---|
| Missing a touchpoint | LOW | §3 is exhaustive (every fs/exec/homedir/REPO_ROOT ref). Prove with a residual grep after: zero `homedir()`/bare data-path outside the helper. |
| Per-worker module eval | LOW | Already demonstrated: config's per-worker `X-E2E-Worker` from `TEST_PARALLEL_INDEX` worked (proxy routed to fleet ports). One-line probe confirms `E2E_DATA_ROOT` differs per worker. |
| dev.json seeding | RESOLVED | Item F (copy whole `data/profiles/`). |
| Serial regression | VERY LOW | Helper serial branch byte-identical to today; gated by a serial run. |
| Within-worker accumulation | LOW | File-level parallelism reuses one backend sequentially = today's semantics; REQ-0082 already handles accumulation. |

**NOT risks (previously overstated as "dangerous"):** no architectural unknown, no product-code
change, no concurrency-correctness problem inside a single backend. The real cost is surface area +
a residual-grep proof, not fundamental uncertainty.

## 5. Plan

1. `client/e2e/e2e-env.ts`: `E2E_CODE_ROOT` (live), `E2E_DATA_ROOT` (worker-aware), `E2E_CLI_ENV`.
2. Redirect B/C/D/E through it (8 specs + global-setup). 3. Fleet F+G fixes. 4. Probe per-worker root.
5. Gate: `E2E_PARALLEL=4` full run **125/125, ≥2× stable, < 398s**; serial still green; residual grep clean.

## 6. Results (done)

Commits: `af9d458` (groundwork) · `ed0f060` (harness refactor + CI default) → merged @ `d9723c8`.

| | serial (REQ-0080) | parallel (REQ-0083, `E2E_PARALLEL=4`) |
|---|---|---|
| e2e wall | 398 s (6.6 m) | **~166 s (2.8 m) — 2.4×** |
| result | 125/125 | **125/125 (×2 stable)** |
| full `tools/ci.sh` | — | **CI GREEN (all 7 stages)** |

Files: `client/e2e/e2e-env.ts` (new roots helper) · `tools/e2e_fleet.cjs` (isolated api fleet;
seeds whole `data/profiles`; reclaims stale ports) · `client/e2e/local-proxy.cjs` (X-E2E-Worker
routing) · `server/lib/meta.cjs` (PORT env) · `playwright.config.ts` (E2E_PARALLEL wiring) ·
`global-setup/teardown` (fleet lifecycle) · 8 coupled specs redirected · `tools/ci.sh`
([7/7] default `E2E_PARALLEL=4`, overridable; `=0` → serial). Residual `homedir()`-in-code: 0.

Cumulative on `npm test`: original ~11.4 m → **~3.3 m** (REQ-0080 proxy+GPU, REQ-0082 green,
REQ-0083 parallel). Follow-ups (not blocking): tune worker count vs GPU contention; the
`waitForTimeout`/pg-test items from REQ-0080 §2 remain open.
