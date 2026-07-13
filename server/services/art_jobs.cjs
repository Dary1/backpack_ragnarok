'use strict';
// server/services/art_jobs.cjs -- REQ-0151 single-GPU serialized job queue,
// EXTENDED by REQ-0152 with lower-priority CPU-only inspection jobs.
//
// The box has ONE GPU; generation jobs are strictly serialized (one Python
// art_job.py subprocess at a time). The UI polls render.status async. A cold
// FLUX load costs 450-540 s (REQ-0150), so nothing here imposes a short local
// timeout (the 300 s bug lesson): art_route.wait_done owns the ComfyUI wait,
// and in mock mode (gate G4) there is no ComfyUI wait at all.
//
// REQ-0152: after a render generates OK, one inspection job per kit in
// kits_for(kind) is enqueued on the SAME worker, but on a LOWER-priority
// queue -- the pump always drains pending GPU generation jobs before any
// CPU-only inspection job, so kits never delay a waiting GPU job. Inspection
// jobs spawn tools/inspect_job.py under the kit python (numpy/scipy/rembg);
// generation stays on plain python3 (mock needs only PIL).
//
// This runner NEVER opens the DB: it reads/writes renders + render_inspections
// ONLY through storage.cjs.
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const storage = require('../storage.cjs');
const { hashModelFiles } = require('./model_hash.cjs');
const kitReg = require('./kit_registry.cjs');

const ART_JOB_PY = path.join(__dirname, '..', '..', 'tools', 'art_job.py');
const INSPECT_JOB_PY = path.join(__dirname, '..', '..', 'tools', 'inspect_job.py');

// Kit python: kits need numpy/scipy/rembg/skimage, which the generation
// python3 (mock: PIL only) may lack. Resolve ART_KIT_PYTHON, else the project
// venv (~/backpack_ragnarok/.venv), else fall back to python3.
function kitPython() {
  if (process.env.ART_KIT_PYTHON) return process.env.ART_KIT_PYTHON;
  const venv = path.join(os.homedir(), 'backpack_ragnarok', '.venv', 'bin', 'python');
  try { fs.accessSync(venv, fs.constants.X_OK); return venv; } catch (_) { /* fall through */ }
  return 'python3';
}

let running = false;
let runningType = null;        // 'generate' | 'inspect'
const genQueue = [];           // GPU generation jobs (high priority)
const inspectQueue = [];       // CPU inspection jobs (low priority)

/** Run a Python worker (script), feeding jobSpec on stdin and parsing ONE
 * JSON result from stdout. Resolves to {status:'failed',error} rather than
 * rejecting, so the queue pump always advances. */
function runWorker(pythonBin, script, jobSpec) {
  return new Promise((resolve) => {
    const py = spawn(pythonBin, [script], { env: process.env });
    let out = '', err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('error', (e) => resolve({ status: 'failed', error: 'spawn ' + pythonBin + ' failed: ' + e.message }));
    py.on('close', (code) => {
      try { resolve(JSON.parse(out)); }
      catch (e) { resolve({ status: 'failed', error: script + ' bad output (code ' + code + '): ' + (err || out).slice(0, 400) }); }
    });
    py.stdin.write(JSON.stringify(jobSpec));
    py.stdin.end();
  });
}

/** Generation worker python: ART_JOB_PYTHON, else python3. (The e2e/tests
 * point this at the project venv because the mock render needs PIL, which
 * on this box lives in the user site-packages -- unreachable once HOME is
 * remapped for namespace isolation.) */
function jobPython() { return process.env.ART_JOB_PYTHON || 'python3'; }
function runPython(jobSpec) { return runWorker(jobPython(), ART_JOB_PY, jobSpec); }

async function processGenJob(desc) {
  const { renderId, artwork, seed, tiling } = desc;
  await storage.setRenderStatus(renderId, 'running');
  const res = await runPython({
    kind: artwork.kind, main_object: artwork.main_object,
    prompt_template: artwork.prompt_template, style_override: artwork.style_override,
    width: artwork.gen_width, height: artwork.gen_height, seed, tiling: !!tiling,
    mode: 'generate',
  });
  if (res.status !== 'ok' || !res.image_b64) {
    await storage.updateRenderResult(renderId, { status: 'failed', error: res.error || 'unknown generation error' });
    return;
  }
  const mh = hashModelFiles({ unet: res.route_params.unet, clip: res.route_params.clip, vae: res.route_params.vae });
  const params = {
    steps: res.route_params.steps, cfg: res.route_params.cfg, sampler: res.route_params.sampler,
    seed, size: { width: res.width, height: res.height }, tiling: !!tiling,
    seed_default: res.route_params.seed_default, cell_px: res.route_params.cell_px,
    models: { unet: mh.unet, clip: mh.clip, vae: mh.vae },
  };
  if (res.bpskin_frame_report) params.bpskin_frame_report = res.bpskin_frame_report;
  await storage.updateRenderResult(renderId, {
    status: 'ok', image: Buffer.from(res.image_b64, 'base64'),
    image_sha256: res.image_sha256, final_prompt: res.final_prompt, params, error: null,
  });
  // REQ-0152: auto-enqueue the type-appropriate inspection kits at lower
  // priority (do not delay pending GPU jobs).
  for (const k of kitReg.kitsFor(artwork.kind)) {
    enqueueInspection({ renderId, artworkId: artwork.id, kitId: k.kit_id });
  }
}

/** Run ONE inspection kit over a render and persist the row. Pure best-effort:
 * a runner failure logs + leaves the render "not inspected" for that kit (the
 * UI offers a re-run) rather than wedging the pump. */
async function processInspectJob(desc) {
  const { renderId, artworkId, kitId } = desc;
  const render = await storage.getRenderById(renderId);
  if (!render || render.status !== 'ok') return;            // only inspect OK renders
  const artwork = artworkId != null ? await storage.getArtworkById(artworkId)
    : await storage.getArtworkById(render.artwork_id);
  if (!artwork) return;
  const img = await storage.getRenderImageById(renderId);
  if (!img || !img.image) return;
  const kitVer = kitReg.kitVersion(kitId);
  if (!kitVer) return;
  const res = await runWorker(kitPython(), INSPECT_JOB_PY, {
    mode: 'inspect', kit_id: kitId, kind: artwork.kind, shape: artwork.shape,
    gen_width: artwork.gen_width, gen_height: artwork.gen_height,
    params: render.params || {}, image_sha256: img.image_sha256,
    png_b64: img.image.toString('base64'),
  });
  if (res.status !== 'ok') {
    console.error('[art_jobs] inspection ' + kitId + ' render ' + renderId + ' failed: ' + (res.error || 'unknown'));
    return;
  }
  const kis = kitReg.kitInputSha256(img.image_sha256, kitId, kitVer, artwork);
  await storage.upsertRenderInspection({
    render_id: renderId, kit_id: kitId, kit_version: kitVer,
    verdict: res.verdict, metrics: res.metrics, checks: res.checks, notes: res.notes,
    kit_input_sha256: kis,
  });
}

function pump() {
  if (running) return;
  // GPU generation jobs ALWAYS jump ahead of CPU inspection jobs.
  let desc = genQueue.shift();
  let type = 'generate';
  if (!desc) { desc = inspectQueue.shift(); type = 'inspect'; }
  if (!desc) return;
  running = true; runningType = type;
  const job = type === 'generate' ? processGenJob(desc) : processInspectJob(desc);
  job
    .catch(async (e) => {
      if (type === 'generate') {
        try { await storage.updateRenderResult(desc.renderId, { status: 'failed', error: String((e && e.message) || e) }); } catch (_) { /* best effort */ }
      } else {
        console.error('[art_jobs] inspect job threw: ' + String((e && e.message) || e));
      }
    })
    .finally(() => { running = false; runningType = null; setImmediate(pump); });
}

/** Enqueue a generation job for an already-created (status queued) render. */
function enqueue(desc) { genQueue.push(desc); pump(); }

/** Enqueue a lower-priority inspection job {renderId, artworkId, kitId}. */
function enqueueInspection(desc) { inspectQueue.push(desc); pump(); }

/** GPU generation queue depth (waiting + the one in flight) for the UI. */
function queueDepth() { return genQueue.length + (running && runningType === 'generate' ? 1 : 0); }
/** CPU inspection queue depth (waiting + in flight). */
function inspectDepth() { return inspectQueue.length + (running && runningType === 'inspect' ? 1 : 0); }

module.exports = { enqueue, enqueueInspection, queueDepth, inspectDepth, runPython };
