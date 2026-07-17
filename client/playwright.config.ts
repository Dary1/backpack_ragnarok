// Playwright E2E config — REQ-0031 Phase A.
//
// baseURL DEFAULTS to the local hermetic proxy (client/e2e/local-proxy.cjs,
// auto-started below): /app/* is the worktree's built client, /api/* is the
// per-worker fleet (tools/e2e_fleet.cjs). The public tunnel -- which fronts
// the LIVE services -- is opt-in via PLAYWRIGHT_BASE_URL for manual smoke
// runs only (REQ-0214's x-bpk-e2e-profile header still confines those).
//
// Tests run ON the same box the app is served from (a server-side
// headless-Chromium rig) -- but as of REQ-0217 the run is HERMETIC:
// globalSetup boots a per-worker fleet of throwaway backends (worktree code
// + committed fixtures) and the proxy never routes to the live services, so
// no live file, profile, or DB row is ever read or written by a run.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8803';
// REQ-0080: when baseURL is local, a tiny reverse proxy (e2e/local-proxy.cjs)
// reproduces the tunnel's /api-vs-static ingress split so the app's relative
// fetches resolve, removing ~40ms/request of public-tunnel latency. The local
// proxy IS the default (REQ-0217); a non-local base URL skips it.
const USE_LOCAL_PROXY = BASE_URL.includes('127.0.0.1') || BASE_URL.includes('localhost');
// REQ-0080: E2E_GPU=1 renders PixiJS WebGL on the box's real GPU (ANGLE/Vulkan ->
// NVIDIA) instead of CPU SwiftShader. Verified renderer string on llmlocal:
// "ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA GeForce RTX 2080), NVIDIA)". Needs the
// full chromium in --headless=new mode (hence headless:false + the explicit flag).
const USE_GPU = process.env.E2E_GPU === '1';
const GPU_ARGS = USE_GPU
  ? ['--headless=new', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist',
     '--enable-features=Vulkan', '--ozone-platform=headless', '--no-sandbox']
  : [];

// REQ-0083: E2E_PARALLEL=N runs the suite across N workers, each backed by its
// OWN isolated backpack-api instance (tools/e2e_fleet.cjs, started in
// global-setup). Each worker tags requests with X-E2E-Worker:<index> so the
// local proxy routes /api to that worker's backend. TEST_WORKER_INDEX is set by
// Playwright in each worker process (config is re-evaluated per worker).
// REQ-0217: unset E2E_PARALLEL now means a fleet of ONE -- there is no
// "single live API" mode anymore.
const PARALLEL = Math.max(1, Number(process.env.E2E_PARALLEL || 1));
const WORKER_IDX = process.env.TEST_PARALLEL_INDEX; // 0..N-1 stable slot (NOT TEST_WORKER_INDEX, which increments per spawned worker and would exceed the fleet size)
const WORKER_HEADERS: Record<string, string> =
  { "X-E2E-Worker": WORKER_IDX !== undefined ? WORKER_IDX : "0" }; // REQ-0217: always tagged; main process -> w0
// REQ-0214 e2e profile isolation: EVERY e2e request (page fetches and the
// request fixture alike -- both inherit use.extraHTTPHeaders) carries
// x-bpk-e2e-profile, so the live api's dev_mode no-token fallback resolves
// to the dedicated e2e_ci profile instead of the dev player's own rows
// (see server/admin.cjs resolveAuthFromRequest).
const E2E_PROFILE_HEADERS: Record<string, string> = { 'x-bpk-e2e-profile': 'ci' };

export default defineConfig({
  testDir: './e2e',
  // REQ-0159 (class C): the three ADMIN specs are harness-only and must NOT
  // be members of the default suite. They REQUIRE the isolated HOME-remap
  // harnesses (tools/artadmin_e2e.sh, tools/art_inspect_e2e.sh,
  // tools/content_admin_e2e.sh), each of which drives them through its OWN
  // config (e2e/{artadmin,artinspect,contentadmin}.config.ts) against an
  // isolated api on spare ports with a unique storage NAMESPACE.
  //
  // In the DEFAULT suite they can never pass again, BY DESIGN: each opens by
  // calling the dev/clear-all seam, which REQ-0156 hardened behind
  // ALLOW_DEV_CLEAR after that seam wiped the live registry on 2026-07-13
  // (see REQ-0145a's incident log). Un-ignoring them here, or re-opening that
  // gate to make them green, would re-arm exactly that incident -- the gate is
  // untouchable. They are NOT skipped coverage: tools/ci.sh runs all three
  // harnesses as its own explicit step (see "[6.5/8] admin e2e harnesses").
  testIgnore: ['**/artadmin.spec.ts', '**/artinspect.spec.ts', '**/contentadmin.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // REQ-0083: file-level parallelism (each file -> one worker/backend), respects within-file order
  workers: PARALLEL,
  retries: 0,
  reporter: [['list']],
  // REQ-0080: auto-start the local ingress proxy, but only for a localhost baseURL.
  webServer: USE_LOCAL_PROXY ? {
    command: 'node e2e/local-proxy.cjs',
    url: BASE_URL + '/app/',
    reuseExistingServer: false, // REQ-0217: NEVER adopt a foreign proxy (another session's stale/old-code instance) -- fail loudly instead
    timeout: 15_000,
  } : undefined,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: { ...E2E_PROFILE_HEADERS, ...WORKER_HEADERS },
    headless: !USE_GPU, // REQ-0080: GPU path drives --headless=new via GPU_ARGS
    launchOptions: { args: GPU_ARGS },
    // REQ-0031 Phase B: the 8x8 grid widened each board from ~556px to
    // 716px (PAD*2 + COLS*CELL = 38*2 + 8*80); at the old 1400x1000
    // viewport, two 738px-wide .board-column boxes (716 + 10px padding *
    // 2 from .board-wrap) plus the 420px-max item-panel overflow the
    // viewport width and .app-main's flex-wrap stacks Canvas above
    // Inventory instead of side by side -- this does not affect
    // correctness (both boards still render/function) but DOES move
    // board-canvas/inventory-board-canvas far enough apart vertically
    // that fixed-viewport pixel-coordinate drags (grab/drop points
    // computed from each board's own boundingBox(), same technique every
    // spec uses) can land outside the viewport entirely. 1500 width is
    // comfortably enough for both columns + the item panel side by side
    // (738*2 + 420 + gaps ~= 1914 needs more, so height stacking may
    // still occur at moderate widths -- 2000x1400 leaves generous margin
    // for both the side-by-side layout AND enough vertical room that even
    // a stacked fallback keeps every element within the viewport).
    viewport: { width: 2000, height: 1400 },
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // NOTE: devices['Desktop Chrome'] itself sets viewport:{width:1280,
      // height:720} -- spreading it AFTER the top-level `use` block's own
      // viewport (which Playwright does deep-merge, but per-key, and this
      // spread order means devices[...]'s viewport wins) silently
      // overrode the 2000x1400 viewport set above. Re-specify it
      // explicitly here so the actual effective viewport is NOT the
      // devices preset's 1280x720 (confirmed via a live re-run: the
      // top-level viewport alone was NOT enough -- REQ-0031 Phase B fix).
      use: { ...devices['Desktop Chrome'], viewport: { width: 2000, height: 1400 } },
    },
  ],
});
