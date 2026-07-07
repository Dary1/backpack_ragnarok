// client/e2e/e2e-env.ts -- REQ-0083. Single source of truth for e2e roots so the
// suite runs either SERIALLY against the live backend or in PARALLEL against
// per-worker isolated backends (tools/e2e_fleet.cjs).
//
// In parallel mode each Playwright worker's out-of-band file ops (guest cli_invite,
// direct data/content reads, cleanup sweeps) must target THIS worker's backend HOME,
// while the CLI *code* path stays on the real repo (worker HOMEs hold data/content
// only, never server/). TEST_PARALLEL_INDEX is the stable 0..N-1 slot Playwright sets
// per worker process; unset (serial, or the main process) falls back to the live repo.
import { homedir } from 'node:os';
import { join } from 'node:path';

const PARALLEL = Number(process.env.E2E_PARALLEL || 0) > 0;
const IDX = process.env.TEST_PARALLEL_INDEX;
const workerHome = (): string => join('/tmp', 'bp_e2e_workers', 'w' + IDX, 'home');

/** Real repo root -- where server/cli_invite.cjs and other CODE live. Always live. */
export const E2E_CODE_ROOT = join(homedir(), 'backpack_ragnarok');

/** Backend DATA root for THIS context: the worker's isolated HOME in parallel mode,
 *  else the live repo. Main process (globalSetup) has no index -> live (correct:
 *  globalSetup backs up the LIVE profile). */
export const E2E_DATA_ROOT =
  PARALLEL && IDX !== undefined ? join(workerHome(), 'backpack_ragnarok') : join(homedir(), 'backpack_ragnarok');

/** Env for spawning cli_invite so it WRITES into this worker's backend HOME. */
export const E2E_CLI_ENV: NodeJS.ProcessEnv =
  PARALLEL && IDX !== undefined ? { ...process.env, HOME: workerHome() } : process.env;
