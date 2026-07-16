'use strict';
// server/services/art_jobs.cjs -- REQ-0151 single-GPU serialized job queue,
// EXTENDED by REQ-0152 with lower-priority CPU-only inspection jobs and by
// REQ-0156 with queue introspection (listJobs) + cancellation (cancelJob).
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
// REQ-0156: every generation job carries metadata (artwork system_name,
// seed, renderId, enqueued_at) and the in-flight one exposes started_at /
// elapsed. cancelJob(renderId): a PENDING job is spliced out of genQueue and
// its render marked failed 'canceled by user'; the RUNNING job's python
// child is killed (SIGTERM, SIGKILL fallback) -- the worker's close handler
// resolves as failed, processGenJob sees the canceled flag and records
// 'canceled by user', and the pump advances as always. Killing a real
// ComfyUI job leaves the ComfyUI-side prompt running to completion (accepted
// risk, REQ-0156); the worker exits and the queue moves on.
//
// This runner NEVER opens the DB: it reads/writes renders + render_inspections
// ONLY through storage.cjs.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');
const storage = require('../storage.cjs');
const { hashModelFiles } = require('./model_hash.cjs');
const kitReg = require('./kit_registry.cjs');

const ART_JOB_PY = path.join(__dirname, '..', '..', 'tools', 'art_job.py');
const INSPECT_JOB_PY = path.join(__dirname, '..', '..', 'tools', 'inspect_job.py');
const PACK_JOB_PY = path.join(__dirname, '..', '..', 'tools', 'pack_job.py');  // REQ-0192

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
let runningDesc = null;        // desc of the in-flight job (cancel target)
let runningChild = null;       // spawned python child of the in-flight job
let runningStartedAt = 0;      // Date.now() when the in-flight job started
const genQueue = [];           // GPU generation jobs (high priority)
const inspectQueue = [];       // CPU inspection jobs (low priority)
const packQueue = [];          // REQ-0192 repack jobs (user-initiated: highest waiting priority)

// REQ-0197: deferred-batch mode. While held, newly enqueued GENERATION jobs
// wait in heldQueue instead of starting immediately; executeBatch() releases
// everything held at once, grouped so same-prompt jobs run back to back --
// ComfyUI's node cache then reuses the text-encoder conditioning instead of
// swapping the 7.5 GB Qwen encoder in per item (art_route.py: a prompt change
// costs 30-170 s on this box). Hold gates ONLY generation: repacks stay
// interactive and inspections are cheap CPU work, so both keep flowing.
// Process-local (a restart falls back to auto-run); ART_QUEUE_HOLD=1 in the
// service environment starts the server already holding.
let held = process.env.ART_QUEUE_HOLD === '1';
const heldQueue = [];          // generation jobs awaiting executeBatch()

/** Run a Python worker (script), feeding jobSpec on stdin and parsing ONE
 * JSON result from stdout. Resolves to {status:'failed',error} rather than
 * rejecting, so the queue pump always advances. `onChild` (optional) hands
 * the spawned child to the caller -- the REQ-0156 cancel path needs a
 * handle to kill the in-flight worker. */
function runWorker(pythonBin, script, jobSpec, onChild) {
  return new Promise((resolve) => {
    const py = spawn(pythonBin, [script], { env: process.env });
    if (onChild) onChild(py);
    let out = '', err = '';
    py.stdout.on('data', (d) => { out += d; });
    py.stderr.on('data', (d) => { err += d; });
    py.on('error', (e) => resolve({ status: 'failed', error: 'spawn ' + pythonBin + ' failed: ' + e.message }));
    py.on('close', (code) => {
      try { resolve(JSON.parse(out)); }
      catch (e) { resolve({ status: 'failed', error: script + ' bad output (code ' + code + '): ' + (err || out).slice(0, 400) }); }
    });
    py.stdin.on('error', () => { /* child died before reading stdin (e.g. canceled) */ });
    py.stdin.write(JSON.stringify(jobSpec));
    py.stdin.end();
  });
}

/** Generation worker python: ART_JOB_PYTHON, else python3. (The e2e/tests
 * point this at the project venv because the mock render needs PIL, which
 * on this box lives in the user site-packages -- unreachable once HOME is
 * remapped for namespace isolation.) */
function jobPython() { return process.env.ART_JOB_PYTHON || 'python3'; }
function runPython(jobSpec, onChild) { return runWorker(jobPython(), ART_JOB_PY, jobSpec, onChild); }

async function processGenJob(desc) {
  const { renderId, artwork, seed, tiling, shapeOverride } = desc;
  await storage.setRenderStatus(renderId, 'running');
  const res = await runPython({
    kind: artwork.kind, main_object: artwork.main_object,
    prompt_template: artwork.prompt_template, style_override: artwork.style_override,
    width: artwork.gen_width, height: artwork.gen_height, seed, tiling: !!tiling,
    // REQ-0183: the artwork's shape reaches GENERATION, not just inspection.
    // Until now a po artwork's 5x5 mask was handed to the kits that judge the
    // finished render, but never to the route that makes it -- so the model was
    // asked to hit a silhouette nobody had told it about, and the awkward
    // shapes (L, T) missed. art_job.py turns the mask into the REQ-0153 Arm C
    // scaffold + noise mask; non-po kinds ignore it.
    shape: artwork.shape || null,
    // REQ-0186: the artwork's stored default, unless this render carries a
    // one-shot override (undefined = not overridden -> fall back to stored ->
    // NULL there = art_job.py's built-in auto/8).
    shape_lock: (shapeOverride && shapeOverride.shape_lock !== undefined)
      ? shapeOverride.shape_lock : artwork.shape_lock,
    shape_dilation_px: (shapeOverride && shapeOverride.shape_dilation_px !== undefined)
      ? shapeOverride.shape_dilation_px : artwork.shape_dilation_px,
    mode: 'generate',
  }, (child) => { runningChild = child; });
  // REQ-0156: a canceled job's child was killed -- whatever the worker
  // managed to emit before dying, the cancel verdict wins: record it and
  // run no kits.
  if (desc.canceled) {
    await storage.updateRenderResult(renderId, { status: 'failed', error: 'canceled by user' });
    return;
  }
  if (res.status !== 'ok' || !res.image_b64) {
    await storage.updateRenderResult(renderId, { status: 'failed', error: res.error || 'unknown generation error' });
    return;
  }
  const mh = await hashModelFiles({ unet: res.route_params.unet, clip: res.route_params.clip, vae: res.route_params.vae });
  const params = {
    steps: res.route_params.steps, cfg: res.route_params.cfg, sampler: res.route_params.sampler,
    seed, size: { width: res.width, height: res.height }, tiling: !!tiling,
    seed_default: res.route_params.seed_default, cell_px: res.route_params.cell_px,
    models: { unet: mh.unet, clip: mh.clip, vae: mh.vae },
  };
  if (res.bpskin_frame_report) params.bpskin_frame_report = res.bpskin_frame_report;
  // REQ-0183: provenance -- whether this render was shape-conditioned, and at
  // what dilation. A render's params are the record of HOW it was made, and
  // "was the shape enforced?" is now part of that.
  // REQ-0186: record the RESOLVED lock (auto already collapsed to off/guide/
  // strict), so the lightbox can tell the operator which setting produced which
  // render -- without that, comparing two locks side by side is guesswork.
  params.shape_lock = res.shape_lock || 'off';
  if (res.shape_conditioned) {
    params.shape_conditioned = true;
    if (res.shape_dilation_px != null) params.shape_dilation_px = res.shape_dilation_px;
  }
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
  // Priority: user-initiated repacks first (REQ-0192), then GPU generation,
  // then CPU inspection. Generation still always jumps ahead of inspections.
  let desc = packQueue.shift();
  let type = 'pack';
  if (!desc) { desc = genQueue.shift(); type = 'generate'; }
  if (!desc) { desc = inspectQueue.shift(); type = 'inspect'; }
  if (!desc) return;
  running = true; runningType = type; runningDesc = desc;
  runningChild = null; runningStartedAt = Date.now();
  const job = type === 'generate' ? processGenJob(desc)
    : type === 'pack' ? processPackJob(desc) : processInspectJob(desc);
  job
    .catch(async (e) => {
      if (type === 'generate') {
        const error = desc.canceled ? 'canceled by user' : String((e && e.message) || e);
        try { await storage.updateRenderResult(desc.renderId, { status: 'failed', error }); } catch (_) { /* best effort */ }
      } else if (desc.__pack) {
        const error = 'repack: ' + String((e && e.message) || e);
        console.error('[art_jobs] ' + error);
        try { await storage.updateRenderResult(desc.renderId, { status: 'failed', error }); } catch (_) { /* best effort */ }
      } else {
        console.error('[art_jobs] inspect job threw: ' + String((e && e.message) || e));
      }
    })
    .finally(() => {
      running = false; runningType = null; runningDesc = null; runningChild = null;
      setImmediate(pump);
    });
}

/** Enqueue a generation job for an already-created (status queued) render.
 * desc: {renderId, artwork, seed, tiling}; enqueued_at is stamped here
 * (REQ-0156 queue panel metadata). */
function enqueue(desc) {
  desc.enqueued_at = Date.now();
  if (held) { heldQueue.push(desc); return; }
  genQueue.push(desc);
  pump();
}

/** REQ-0197: prompt-affinity group key. The artwork id + the one-shot shape
 * override are what change the composed prompt/graph; two seeds of the same
 * artwork differ only in the RandomNoise node, which costs no re-encode. */
function groupKey(d) {
  return d.artwork.id + '|' + JSON.stringify(d.shapeOverride === undefined ? null : d.shapeOverride);
}

/** REQ-0197: move every held job into the live queue, grouped by prompt.
 * Groups run in first-enqueued order; enqueue order within a group (sort is
 * stable). Returns how many jobs were released. */
function releaseHeld() {
  if (!heldQueue.length) return 0;
  const first = new Map();
  heldQueue.forEach((d, i) => { const k = groupKey(d); if (!first.has(k)) first.set(k, i); });
  const batch = heldQueue.splice(0).sort((a, b) => first.get(groupKey(a)) - first.get(groupKey(b)));
  genQueue.push(...batch);
  pump();
  return batch.length;
}

/** REQ-0197: toggle deferred-batch mode. Turning hold ON also moves the
 * not-yet-started live pending jobs behind the gate (the in-flight job always
 * finishes -- killing it would waste a cold load). Turning it OFF releases
 * everything held, batch-sorted, and resumes auto-run. */
function setHold(v) {
  if (v && !held) {
    held = true;
    heldQueue.push(...genQueue.splice(0));
  } else if (!v && held) {
    held = false;
    releaseHeld();
  }
  return listJobs();
}

/** REQ-0197: run everything currently held (batch-sorted) while STAYING
 * held -- jobs enqueued during the run wait for the next executeBatch. */
function executeBatch() {
  return { released: releaseHeld() };
}

/** Enqueue a lower-priority inspection job {renderId, artworkId, kitId}. */
function enqueueInspection(desc) { inspectQueue.push(desc); pump(); }

/** REQ-0192: enqueue a repack job {renderId (TARGET row, already created
 * status 'queued'), artworkId, sourceRenderId}. Repack is a USER-INITIATED
 * interactive action, so it runs AHEAD of pending generation jobs (a large
 * fire-and-forget batch must not starve a button press for hours); it still
 * waits for the in-flight job. Cost is ~10-30 s of CPU + a short matte. */
function enqueuePack(desc) { desc.__pack = true; packQueue.push(desc); pump(); }

/** REQ-0192: run ONE repack -- matte the SOURCE render, search the best
 * feasible placement (tools/pack_job.py -> tool_cell_fit), and complete the
 * pre-created TARGET render row with the packed image. Full provenance goes
 * into params (derived_from_seed + exact transform + both fit scores), the
 * REQ-0186 posture: the lightbox must be able to say what made this image.
 * On any failure the target row goes status 'failed' (deletable in the UI). */
async function processPackJob(desc) {
  const { renderId, artworkId, sourceRenderId } = desc;
  const fail = async (error) => {
    try { await storage.updateRenderResult(renderId, { status: 'failed', error }); }
    catch (_) { /* best effort */ }
  };
  const artwork = await storage.getArtworkById(artworkId);
  const srcRender = await storage.getRenderById(sourceRenderId);
  const src = await storage.getRenderImageById(sourceRenderId);
  if (!artwork || !srcRender || !src || !src.image) { await fail('repack: source render/image missing'); return; }
  const res = await runWorker(kitPython(), PACK_JOB_PY, {
    png_b64: src.image.toString('base64'), shape: artwork.shape,
  });
  if (res.status !== 'ok') { await fail('repack: ' + (res.error || 'pack job failed')); return; }
  const image = Buffer.from(res.png_b64, 'base64');
  const sha = crypto.createHash('sha256').update(image).digest('hex');
  await storage.updateRenderResult(renderId, {
    status: 'ok', image, image_sha256: sha,
    final_prompt: srcRender.final_prompt || null,
    params: {
      derived: 'packed_placement',
      derived_from_seed: srcRender.seed,
      tool: 'tools/pack_job.py v1 (REQ-0192)',
      transform: res.transform,
      fit_score_identity: res.identity_score,
      fit_score_packed: res.packed_score,
    },
    error: null,
  });
  // The packed render is a first-class candidate: same advisory kits.
  for (const k of kitReg.kitsFor(artwork.kind)) {
    enqueueInspection({ renderId, artworkId: artwork.id, kitId: k.kit_id });
  }
}

/** GPU generation queue depth (waiting -- live or held -- plus the one in
 * flight) for the UI. Held jobs count: to the badge they are renders that
 * exist and have not run, wherever they wait (REQ-0197). */
function queueDepth() {
  return genQueue.length + heldQueue.length +
    (running && runningType === 'generate' ? 1 : 0);
}
/** CPU inspection queue depth (waiting + in flight); REQ-0192 repacks are
 * counted here too -- to the UI badge they are the same kind of background
 * CPU work, just higher priority. */
function inspectDepth() {
  return inspectQueue.length + packQueue.length +
    (running && (runningType === 'inspect' || runningType === 'pack') ? 1 : 0);
}

/** REQ-0156: queue snapshot for GET /api/art/queue -- the running generation
 * job (with elapsed), every pending generation job in order, and the
 * inspection backlog depth. Inspection jobs are advisory background work;
 * they are summarized by depth only (seconds of CPU, not minutes of GPU,
 * so they are not individually cancellable). */
function listJobs() {
  const isGen = running && runningType === 'generate' && runningDesc;
  return {
    running: isGen ? {
      renderId: runningDesc.renderId,
      artwork: runningDesc.artwork.system_name,
      seed: runningDesc.seed,
      started_at: runningStartedAt,
      elapsed_ms: Date.now() - runningStartedAt,
    } : null,
    pending: genQueue.map((d) => ({
      renderId: d.renderId, artwork: d.artwork.system_name,
      seed: d.seed, enqueued_at: d.enqueued_at,
    })),
    // REQ-0197: the gated set, listed apart from live pending so the panel
    // can label it; held is the mode flag itself.
    heldPending: heldQueue.map((d) => ({
      renderId: d.renderId, artwork: d.artwork.system_name,
      seed: d.seed, enqueued_at: d.enqueued_at,
    })),
    held,
    inspectDepth: inspectDepth(),
  };
}

/** REQ-0156: kill the in-flight worker child: polite SIGTERM first, SIGKILL
 * 2 s later if it ignores that. runWorker's close handler fires either way,
 * so the pump always advances (gate G3). */
function killRunningChild() {
  const child = runningChild;
  if (!child) return;
  try { child.kill('SIGTERM'); } catch (_) { /* already gone */ }
  const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* already gone */ } }, 2000);
  if (t.unref) t.unref();
}

/** REQ-0156: cancel one generation job by renderId.
 *  - pending: splice exactly that job out of genQueue and mark its render
 *    failed 'canceled by user' (no new status enum -- no migration).
 *  - running: flag the desc and kill the python child; processGenJob's
 *    canceled check records 'canceled by user' when the worker dies.
 * Throws code NOT_FOUND when the renderId is neither pending nor running
 * (e.g. it already finished). Returns {canceled:'pending'|'running'}. */
async function cancelJob(renderId) {
  const idx = genQueue.findIndex((d) => d.renderId === renderId);
  if (idx >= 0) {
    const d = genQueue.splice(idx, 1)[0];
    await storage.updateRenderResult(d.renderId, { status: 'failed', error: 'canceled by user' });
    return { canceled: 'pending', renderId };
  }
  // REQ-0197: a held job cancels exactly like a pending one.
  const hidx = heldQueue.findIndex((d) => d.renderId === renderId);
  if (hidx >= 0) {
    const d = heldQueue.splice(hidx, 1)[0];
    await storage.updateRenderResult(d.renderId, { status: 'failed', error: 'canceled by user' });
    return { canceled: 'pending', renderId };
  }
  if (running && runningType === 'generate' && runningDesc && runningDesc.renderId === renderId) {
    runningDesc.canceled = true;
    killRunningChild();
    return { canceled: 'running', renderId };
  }
  const e = new Error('no queued or running generation job for render ' + renderId);
  e.code = 'NOT_FOUND';
  throw e;
}

module.exports = { enqueue, enqueueInspection, enqueuePack, queueDepth, inspectDepth, runPython, listJobs, cancelJob, setHold, executeBatch };
