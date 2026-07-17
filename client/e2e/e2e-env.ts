// client/e2e/e2e-env.ts -- REQ-0083, rewritten by REQ-0217 (hermetic e2e).
// Single source of truth for e2e roots. The suite ALWAYS runs against
// per-worker isolated backends (tools/e2e_fleet.cjs) -- the old live
// fallback is gone: every file op targets a worker's own throwaway HOME.
// TEST_PARALLEL_INDEX is the stable 0..N-1 slot Playwright sets per worker
// process; the main process (globalSetup/globalTeardown) has none and maps
// to worker 0 (it must not touch backend data at all -- the mapping exists
// only so path CONSTRUCTION can never resolve to the live checkout).
import { join } from 'node:path';

const IDX = process.env.TEST_PARALLEL_INDEX ?? '0';
const FLEET_ROOT = process.env.E2E_FLEET_ROOT ?? '/tmp/bp_e2e_workers';
const workerHome = (): string => join(FLEET_ROOT, 'w' + IDX, 'home');

/** Worktree root -- where server/cli_invite.cjs and the rest of the CODE
 *  UNDER TEST live. Playwright always runs from client/ (tools/e2e_run.sh
 *  cd's there; config testDir is relative to it), so cwd/.. IS this
 *  worktree -- NEVER ~/backpack_ragnarok (the live checkout). */
export const E2E_CODE_ROOT = join(process.cwd(), '..');

/** Backend DATA root for THIS context: always the worker's isolated HOME. */
export const E2E_DATA_ROOT = join(workerHome(), 'backpack_ragnarok');

/** Env for spawning cli_invite so it WRITES into this worker's backend HOME. */
export const E2E_CLI_ENV: NodeJS.ProcessEnv = { ...process.env, HOME: workerHome() };
