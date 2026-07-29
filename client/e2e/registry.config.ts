// client/e2e/registry.config.ts -- REQ-0221 registry-first serving coverage.
// No fleet globalSetup/webServer: api + proxy are started by
// tools/registry_first_e2e.sh against an isolated pg namespace SEEDED with
// one adopted def, so the registry-guard tests in dex-admin.spec.ts (the
// REQ-0182b 409 on a registry-served id) actually RUN instead of skipping --
// the files-backed default fleet can never exercise them (REQ-0234 F1), and
// the harness fails the stage if anything skips.
// REQ-0344: it now has ONE globalSetup, e2e/gpu-setup.ts, which asserts the
// WebGL renderer and nothing else -- no fleet, no state, no lock. The
// isolation claim above is unchanged.
import { defineConfig, devices } from '@playwright/test';
import { GPU_ARGS, GPU_HEADLESS } from './gpu';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:7212';
export default defineConfig({
  testDir: '.',
  testMatch: '**/dex-admin.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
    // REQ-0214: e2e traffic self-identifies even on an isolated namespace.
    extraHTTPHeaders: { 'x-bpk-e2e-profile': 'ci' },
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
    viewport: { width: 2000, height: 1400 },
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 2000, height: 1400 } } }],
});
