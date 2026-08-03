// client/e2e/artinspect.config.ts -- REQ-0152 G4 isolated run config.
// Mirrors artadmin.config.ts (no fleet globalSetup/teardown, no webServer -> the
// live profile/content/api are never touched). The api + static + proxy are
// started manually against an isolated (HOME-namespaced) pg instance of THIS
// worktree by tools/art_inspect_e2e.sh. baseURL = the local proxy.
// REQ-0344: it now has ONE globalSetup, e2e/gpu-setup.ts, which asserts the
// WebGL renderer and nothing else -- no fleet, no state, no lock. The
// isolation claim above is unchanged.
import { defineConfig, devices } from '@playwright/test';
import { GPU_ARGS, GPU_HEADLESS } from './gpu';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:6522';
export default defineConfig({
  testDir: '.',
  testMatch: '**/artinspect.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // REQ-0344: assert the GPU flags below actually reached the NVIDIA GPU.
  // This is the ONLY globalSetup these configs have -- it boots no fleet,
  // clears no state and takes no lock (see e2e/gpu-setup.ts).
  globalSetup: './gpu-setup.ts',
  use: {
    baseURL: BASE_URL,
    // REQ-0344: was `headless: true` -- i.e. chrome-headless-shell on
    // SwiftShader -- from this config's first day, and REQ-0342's
    // GPU-by-default never reached it because this file does not import
    // playwright.config.ts. App.tsx's REQ-0034 rule keeps both PixiJS
    // Applications mounted on EVERY route, so even a DOM-only admin
    // console drove two WebGL scenes in software: the chromium
    // --type=gpu-process measured 500-660% CPU of 8 cores while the RTX
    // 2080 idled. See e2e/gpu.ts for the numbers.
    headless: GPU_HEADLESS,
    launchOptions: { args: GPU_ARGS },
    viewport: { width: 1400, height: 1000 },
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 1000 } } }],
});
