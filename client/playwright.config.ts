// Playwright E2E config — REQ-0031 Phase A.
//
// baseURL is the PUBLIC Cloudflare tunnel hostname, NOT the local static
// port (8801). This is deliberate, not an oversight: backpack-web.service
// (8801) serves /app/ as plain static files with NO local proxy to
// backpack-api.service (8802) -- hitting http://127.0.0.1:8801/api/content
// 404s (confirmed via curl during rig setup). The ONLY place `/api/*`
// resolves to the API service is the tunnel hostname's Cloudflare ingress
// rule (see server/README.md's "Cloudflare tunnel ingress" section:
// `backpack-dev.qtie.jp path=/api/* -> :8802`, `backpack-dev.qtie.jp ->
// :8801` for everything else). client/src/api.ts does relative fetches
// (`fetch('/api/content')`) that only resolve correctly when the page
// itself was loaded from a host where that ingress split applies -- so
// every E2E test that boots the real app MUST navigate to a page under
// this baseURL, never localhost:8801 directly.
//
// Tests run ON the same box the app is served from (this is a
// server-side headless-Chromium rig, not a developer-machine rig) --
// globalSetup/globalTeardown below touch the live filesystem directly
// (~/backpack_ragnarok/data/profiles/default.json) to back up and restore
// the live profile around the whole run, since several tests PUT canvas
// state to the real API (there is no separate test/staging profile).
import { defineConfig, devices } from '@playwright/test';
import { resolveWorktreeDefaults } from './e2e/worktree-target';

// REQ-0225 (ratified option (b) default-flip): a LINKED WORKTREE with no
// explicit PLAYWRIGHT_BASE_URL now targets the LOCAL proxy + its own fleet
// (E2E_PARALLEL defaults to 4) instead of the deployed-master tunnel; the
// tunnel target requires an explicit PLAYWRIGHT_BASE_URL there. The MAIN
// checkout keeps the tunnel default described above (post-deploy
// verification unchanged). See e2e/worktree-target.ts.
const BASE_URL = resolveWorktreeDefaults();
// REQ-0080: when baseURL is local, a tiny reverse proxy (e2e/local-proxy.cjs)
// reproduces the tunnel's /api-vs-static ingress split so the app's relative
// fetches resolve, removing ~40ms/request of public-tunnel latency. The tunnel
// stays the default -- nothing changes unless PLAYWRIGHT_BASE_URL is set.
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
// Playwright in each worker process (config is re-evaluated per worker). Unset
// E2E_PARALLEL keeps the safe serial default against the single live API.
const PARALLEL = Number(process.env.E2E_PARALLEL || 0);
const WORKER_IDX = process.env.TEST_PARALLEL_INDEX; // 0..N-1 stable slot (NOT TEST_WORKER_INDEX, which increments per spawned worker and would exceed the fleet size)
const WORKER_HEADERS: Record<string, string> =
  PARALLEL > 0 && WORKER_IDX !== undefined ? { "X-E2E-Worker": WORKER_IDX } : {};

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
  workers: PARALLEL > 0 ? PARALLEL : 1,
  retries: 0,
  reporter: [['list']],
  // REQ-0080: auto-start the local ingress proxy, but only for a localhost baseURL.
  webServer: USE_LOCAL_PROXY ? {
    command: 'node e2e/local-proxy.cjs',
    url: BASE_URL + '/app/',
    reuseExistingServer: true,
    timeout: 15_000,
  } : undefined,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: WORKER_HEADERS,
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
