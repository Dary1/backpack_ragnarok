// client/e2e/gpu-setup.ts -- REQ-0344: globalSetup for the four STANDALONE
// admin/registry configs. It does exactly ONE thing: assert that the GPU flags
// those configs now carry actually reached the NVIDIA GPU.
//
// Deliberately NOT e2e/global-setup.ts. That one boots the fleet, clears shared
// dev state and takes the box lock -- everything the standalone configs exist to
// avoid, because their api/proxy are brought up by tools/e2e_harness.sh against
// an isolated HOME-remapped pg namespace. This file touches no profile, no
// content, no api and no lock; it launches one throwaway browser, reads
// UNMASKED_RENDERER_WEBGL and exits.
//
// It exists because a silent CPU fallback is worth ~65% of these stages' wall
// time (REQ-0344 (A)) and, on a loaded box, the difference between green and the
// REQ-0344 (C) flake. REQ-0331 already proved that letting that fall back
// unannounced costs days.
import { assertGpuRenderer } from './gpu';

export default async function globalSetup(): Promise<void> {
  await assertGpuRenderer();
}
