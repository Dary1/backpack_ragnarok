// client/e2e/worktree-target.ts -- REQ-0225.
//
// A bare `pnpm run e2e` from a FEATURE WORKTREE used to inherit the tunnel
// default baseURL and silently test the DEPLOYED master bundle + api (the
// REQ-0208 incident: three new branch tests "failed" against code that simply
// predates the branch, wasting a full box-locked run with nothing in the
// output hinting the target was wrong). Two defenses, per the ratified
// option (b) "default-flip":
//
//   1. resolveWorktreeDefaults() (playwright.config.ts): a LINKED worktree
//      with no explicit PLAYWRIGHT_BASE_URL now defaults to the LOCAL proxy
//      (http://127.0.0.1:8803 -- the ci.sh [7/7] target, which serves THIS
//      worktree's web/app build and routes /api to THIS worktree's isolated
//      fleet), and defaults E2E_PARALLEL=4 so the fleet -- not the live
//      :8802 -- backs /api. The tunnel target now requires an explicit
//      PLAYWRIGHT_BASE_URL. The MAIN checkout keeps the tunnel default, so
//      the post-deploy verification habit there is unchanged.
//   2. assertWorktreeTarget() (global-setup): when the target is still the
//      tunnel/live ports, compare THIS tree's built bundle name against the
//      served /app/assets/index-*.js (cheap: the hashed filename). On
//      mismatch print a loud banner naming the canonical worktree
//      invocation; from a linked worktree (or under E2E_REQUIRE_WORKTREE=1)
//      FAIL FAST instead of running 20+ minutes against master. The main
//      checkout keeps a warn-only banner (its tunnel run IS the legitimate
//      post-deploy verification; a mismatch there just means the deploy
//      lags the tree).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// cwd is client/ for every supported entrypoint (tools/e2e_run.sh cds there;
// playwright.config.ts already resolves './e2e/...' against it).
const REPO_ROOT = join(process.cwd(), '..');

export const LOCAL_PROXY_URL = 'http://127.0.0.1:8803';
export const TUNNEL_URL = 'https://backpack-dev.qtie.jp';

/** True when this repo root is a LINKED git worktree: its .git is a
 *  `gitdir:` pointer FILE, where a main checkout has a .git DIRECTORY. */
export function isLinkedWorktree(): boolean {
  try {
    return statSync(join(REPO_ROOT, '.git')).isFile();
  } catch {
    return false;
  }
}

export function isLocalTarget(url: string): boolean {
  return url.includes('127.0.0.1') || url.includes('localhost');
}

/** REQ-0225 default-flip. Returns the effective baseURL for
 *  playwright.config.ts, mutating process.env on the flip path so
 *  global-setup, e2e-env.ts and spawned workers all see the same target. */
export function resolveWorktreeDefaults(): string {
  const explicit = process.env.PLAYWRIGHT_BASE_URL;
  if (explicit) return explicit;
  if (!isLinkedWorktree()) return TUNNEL_URL; // main checkout: unchanged
  process.env.PLAYWRIGHT_BASE_URL = LOCAL_PROXY_URL;
  if (process.env.E2E_PARALLEL === undefined) process.env.E2E_PARALLEL = '4';
  if (process.env.TEST_PARALLEL_INDEX === undefined) {
    // main process only (workers re-evaluate the config; keep the notice single)
    console.warn(
      `[worktree-target] REQ-0225 default-flip: linked worktree detected -- targeting the local proxy (${LOCAL_PROXY_URL}, E2E_PARALLEL=${process.env.E2E_PARALLEL}). ` +
        `The deployed-master tunnel now requires an explicit PLAYWRIGHT_BASE_URL=${TUNNEL_URL} (post-deploy verification, main checkout).`,
    );
  }
  return LOCAL_PROXY_URL;
}

// The built bundle's hashed filename is target identity: vite emits
// web/app/index.html referencing exactly one assets/index-<hash>.js.
const BUNDLE_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;

function localBundleName(): string | undefined {
  const indexHtml = join(REPO_ROOT, 'web', 'app', 'index.html');
  if (!existsSync(indexHtml)) return undefined;
  return readFileSync(indexHtml, 'utf8').match(BUNDLE_RE)?.[0];
}

async function servedBundleName(baseURL: string): Promise<string | undefined> {
  try {
    const res = await fetch(baseURL + '/app/', { signal: AbortSignal.timeout(10_000) });
    return (await res.text()).match(BUNDLE_RE)?.[0];
  } catch {
    return undefined; // unreachable target reads as a mismatch below -- correct
  }
}

/** Guard: refuse (worktree) or loudly warn (main checkout) when the run
 *  would exercise a served bundle that is NOT this tree's build. */
export async function assertWorktreeTarget(phase: string): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || TUNNEL_URL;
  const local = localBundleName();
  if (isLocalTarget(baseURL)) {
    // The local proxy serves THIS tree's web/app directly (REQ-0051) -- the
    // target cannot be wrong, but it CAN be empty: fail with the fix rather
    // than letting the webServer probe time out cryptically.
    if (local === undefined) {
      throw new Error(
        `[${phase}] REQ-0225: ${baseURL} serves THIS tree's web/app, but web/app/index.html has no built bundle -- build first (cd client && pnpm run build), or run bash tools/ci.sh.`,
      );
    }
    return;
  }
  const served = await servedBundleName(baseURL);
  if (local !== undefined && served !== undefined && local === served) return; // deployed == this tree
  const bar = '='.repeat(74);
  const banner = [
    bar,
    `[${phase}] REQ-0225: TARGET MISMATCH -- ${baseURL} serves the DEPLOYED`,
    `master bundle + live api, NOT this tree's code.`,
    `  this tree's bundle: ${local ?? '(web/app not built)'}`,
    `  served bundle:      ${served ?? '(target unreadable)'}`,
    `canonical worktree invocation (= ci.sh [7/7]; a bare pnpm run e2e now`,
    `defaults to it from a worktree):`,
    `  PLAYWRIGHT_BASE_URL=${LOCAL_PROXY_URL} E2E_GPU=1 E2E_PARALLEL=4 pnpm run e2e`,
    bar,
  ].join('\n');
  if (isLinkedWorktree() || process.env.E2E_REQUIRE_WORKTREE === '1') {
    throw new Error(
      banner +
        '\nFAIL FAST (linked worktree / E2E_REQUIRE_WORKTREE=1): refusing to burn a box-locked run against the deployed master. An explicit tunnel PLAYWRIGHT_BASE_URL is for post-deploy verification from the MAIN checkout only.',
    );
  }
  console.warn(
    banner +
      '\nWARN-ONLY (main checkout): continuing -- the tunnel run is the post-deploy verification path; a mismatch here means the deploy lags this tree, so expect failures on undeployed changes.',
  );
}
