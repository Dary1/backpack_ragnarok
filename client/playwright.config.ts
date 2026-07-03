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

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'https://backpack-dev.qtie.jp',
    headless: true,
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
