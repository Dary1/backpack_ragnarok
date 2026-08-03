// client/signedout.config.ts -- REQ-0365 signed-out (dev_mode OFF) run.
//
// The default suite CANNOT host this spec: its fleet workers all seed
// dev_mode:true, so /api/me answers with the dev player and there is no
// signed-out state to assert. This config reuses the standard rig verbatim --
// same globalSetup (the fleet), same local proxy webServer, same GPU flags --
// and changes exactly two things: it runs ONLY signed-out.spec.ts, and it is
// invoked (by tools/signed_out_e2e.sh) with E2E_DEV_MODE_OFF=0, which makes
// tools/e2e_fleet.cjs seed worker 0 with dev_mode:false.
//
// IT LIVES BESIDE playwright.config.ts, NOT IN e2e/, AND THAT IS LOAD-BEARING.
// Every relative path in the spread base -- testDir './e2e', globalSetup
// './e2e/global-setup.ts', and the webServer command's `node e2e/local-proxy.cjs`
// -- resolves against the CONFIG FILE's own directory. From e2e/ they would all
// resolve one level too deep (e2e/e2e/...). The sibling admin configs get away
// with sitting in e2e/ because they redefine those paths from scratch instead of
// inheriting them.
//
// Worker 0 is not a coincidence: playwright.config.ts tags every request with
// X-E2E-Worker:<index> and the run is single-worker, so the browser and the
// request fixture both already address worker 0. No header override is needed
// and none should be added -- the pinning is the `workers: 1` below.
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  // The base config ignores the admin specs AND signed-out.spec.ts; this run
  // narrows to the one spec that needs a dev_mode:false backend, and must
  // therefore drop the inherited ignore of it.
  testIgnore: ['**/artadmin.spec.ts', '**/artinspect.spec.ts', '**/contentadmin.spec.ts'],
  testMatch: '**/signed-out.spec.ts',
  fullyParallel: false,
  workers: 1,
});
