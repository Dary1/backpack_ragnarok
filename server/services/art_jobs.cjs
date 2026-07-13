'use strict';
// server/services/art_jobs.cjs -- REQ-0151 single-GPU serialized job queue.
//
// The box has ONE GPU; jobs are strictly serialized (one Python art_job.py
// subprocess at a time). The UI polls render.status async. A cold FLUX load
// costs 450-540 s (REQ-0150), so nothing here imposes a short local timeout
// (the 300 s bug lesson): art_route.wait_done owns the ComfyUI wait, and in
// mock mode (gate G4) there is no ComfyUI wait at all.
//
// This runner NEVER opens the DB: it reads/writes renders ONLY through
// storage.cjs, and builds prompts / picks sampler settings ONLY through the
// Python worker that imports art_route/art_style. art_job.py is resolved
// relative to THIS module (worktree-local), not via os.homedir(), so it
// works from any worktree.
const { spawn } = require('child_process');
const path = require('path');
const storage = require('../storage.cjs');
const { hashModelFiles } = require('./model_hash.cjs');

const ART_JOB_PY = path.join(__dirname, '..', '..', 'tools', 'art_job.py');

let running = false;
const queue = [];

/** Run one art_job.py generate, feeding the job spec on stdin and parsing
 * the single JSON result from stdout. Resolves to {status:'failed',error}
 * rather than rejecting, so the queue pump always advances. */
function runPython(jobSpec) {
  return new Promise((resolve) => {
    const py = spawn('python3', [ART_JOB_PY], { env: process.env });
    let out = '', err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('error', (e) => resolve({ status: 'failed', error: 'spawn python3 failed: ' + e.message }));
    py.on('close', (code) => {
      try { resolve(JSON.parse(out)); }
      catch (e) { resolve({ status: 'failed', error: 'art_job.py bad output (code ' + code + '): ' + (err || out).slice(0, 400) }); }
    });
    py.stdin.write(JSON.stringify(jobSpec));
    py.stdin.end();
  });
}

async function processJob(desc) {
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
  // Model-file content hashes (cached by path,size,mtime) added HERE on the
  // Node side (ruling 4). Filenames come straight from the route via the
  // Python worker's route_params.
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
}

function pump() {
  if (running) return;
  const desc = queue.shift();
  if (!desc) return;
  running = true;
  processJob(desc)
    .catch(async (e) => {
      try { await storage.updateRenderResult(desc.renderId, { status: 'failed', error: String((e && e.message) || e) }); } catch (_) { /* best effort */ }
    })
    .finally(() => { running = false; setImmediate(pump); });
}

/** Enqueue a generation job for an already-created (status queued) render. */
function enqueue(desc) { queue.push(desc); pump(); }

/** Jobs waiting + the one in flight -- surfaced to the UI for queue depth. */
function queueDepth() { return queue.length + (running ? 1 : 0); }

module.exports = { enqueue, queueDepth, runPython };
