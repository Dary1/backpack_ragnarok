// client/e2e/gpu.ts -- REQ-0344: the ONE definition of the e2e GPU launch
// flags, plus the probe that proves they took.
//
// WHY THIS EXISTS. Before this file the flag list existed TWICE
// (playwright.config.ts's GPU_ARGS and global-setup.ts's GPU_PROBE_ARGS) and
// the four STANDALONE configs -- client/e2e/{artadmin,artinspect,contentadmin,
// registry}.config.ts -- had neither. Those four do not import
// playwright.config.ts; each is a self-contained defineConfig that set
// `headless: true` and no launchOptions. So REQ-0342's "GPU is the DEFAULT"
// was true of the main suite and silently false for every admin harness. That
// is exactly the failure tools/e2e_harness.sh's header names: a change that has
// to be applied in six places gets applied in one.
//
// REQ-0342 4 recorded the expectation that the flags would NOT help the admin
// configs -- "their cost is queue latency, not pixels" -- and flagged it as
// untested. Measured on llmlocal 2026-07-29, that expectation is WRONG, and the
// reason is App.tsx's REQ-0034 rule: BOTH PixiJS Applications stay mounted on
// EVERY route (a route switch only adds .route-hidden, i.e. display:none), so a
// console whose visible surface is pure DOM still builds and drives two live
// WebGL scenes. Under SwiftShader the chromium --type=gpu-process sat at
// 500-660% CPU of this 8-core box while the RTX 2080 idled at 0%, and
// tools/artadmin_e2e.sh ran 120 s; with these flags, 72 s. The stall it removes
// is also the mechanism behind the REQ-0344 (C) flake -- see that REQ.
const GPU_ARGS_ON = [
  '--headless=new', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist',
  '--enable-features=Vulkan', '--ozone-platform=headless', '--no-sandbox',
];

/** REQ-0342: GPU is the default; only an explicit E2E_GPU=0 opts out. */
export const USE_GPU = process.env.E2E_GPU !== '0';
export const GPU_ARGS = USE_GPU ? GPU_ARGS_ON : [];
/** Playwright's `headless: true` selects chrome-headless-shell, which cannot
 * reach ANGLE/Vulkan. The GPU path needs the full chromium driven by the
 * explicit --headless=new above, hence headless:false whenever USE_GPU. */
export const GPU_HEADLESS = !USE_GPU;

// REQ-0331 (F1), moved here verbatim from global-setup.ts by REQ-0344 so the
// four standalone configs can share it. E2E_GPU=1 is a REQUEST, not a
// guarantee. If the box's nvidia KERNEL module and its USERSPACE libraries
// drift apart -- which is what an apt driver upgrade without a reboot does --
// ANGLE cannot reach the GPU and silently falls back to llvmpipe/SwiftShader.
// Nothing anywhere says so: the vulkan flags are still on the command line, the
// suite still passes, it just renders on the CPU. That is exactly what happened
// between 2026-07-24 (driver 595.71.05 -> 595.84, box not rebooted) and
// 2026-07-28, and it cost ~25% of the suite's wall time plus a load flake,
// unnoticed, for four days.
//
// One probe launch per run (~0.5 s) converts that silent tax into a printed
// line. REQ-0342: ABORTS by default; E2E_ALLOW_CPU=1 downgrades it to a warning.
export async function assertGpuRenderer(): Promise<void> {
  // REQ-0342: only an explicit E2E_GPU=0 ("I mean to run on CPU") skips it.
  if (!USE_GPU) return;
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: false, args: GPU_ARGS_ON });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="gpu-probe"></canvas>');
    const renderer: string = await page.evaluate(() => {
      const c = document.getElementById('gpu-probe') as HTMLCanvasElement | null;
      const gl = (c?.getContext('webgl2') ?? c?.getContext('webgl')) as WebGLRenderingContext | null;
      if (!gl) return 'NO WEBGL CONTEXT';
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (!dbg) return 'NO WEBGL_debug_renderer_info';
      return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
    });
    if (/NVIDIA/i.test(renderer)) {
      console.log('[gpu-check] REQ-0331: GPU rendering CONFIRMED -- ' + renderer);
      return;
    }
    const msg =
      '[gpu-check] REQ-0331: E2E_GPU=1 but WebGL is NOT on the NVIDIA GPU.\n' +
      '  renderer: ' + renderer + '\n' +
      '  expected: ANGLE (NVIDIA, Vulkan ..., NVIDIA GeForce RTX 2080)\n' +
      '  This run will render on the CPU: roughly +25% wall time on the default\n' +
      '  suite and +65% on the admin harnesses (REQ-0344), and the box saturates\n' +
      '  at 4 workers (REQ-0331 F2), which turns load into flakes.\n' +
      '  Usual cause -- kernel/userspace driver drift after an unrebooted apt\n' +
      '  upgrade. Check:  nvidia-smi   (an NVML "version mismatch" here is the\n' +
      '  tell)  and  cat /proc/driver/nvidia/version  vs  dpkg -l | grep nvidia-driver.\n' +
      '  Fix -- stop every GPU holder (e.g. systemctl --user stop comfyui), then\n' +
      '  sudo rmmod nvidia_uvm nvidia_drm nvidia_modeset nvidia && sudo modprobe nvidia\n' +
      '  (or reboot the box), and restart the holders.';
    // REQ-0342: ABORT is the default now. REQ-0331 shipped this as a warning
    // and the warning worked exactly as well as no check at all -- the box
    // rendered on llvmpipe for four days with the banner printing on every
    // run. A gate whose failure mode is 'scrolls past' is not a gate.
    // E2E_ALLOW_CPU=1 is the deliberate, named way to proceed anyway.
    if (process.env.E2E_ALLOW_CPU === '1') {
      console.warn('\n' + '='.repeat(78) + '\n' + msg +
        '\n  (E2E_ALLOW_CPU=1 -> proceeding on CPU by request)\n' + '='.repeat(78) + '\n');
      return;
    }
    throw new Error(msg +
      '\n  Set E2E_GPU=0 to run on CPU deliberately, or E2E_ALLOW_CPU=1 to accept this' +
      '\n  fallback for one run. Neither is a fix -- see the repair steps above.');
  } finally {
    await browser.close();
  }
}
