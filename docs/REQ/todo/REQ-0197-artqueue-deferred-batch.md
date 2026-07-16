# REQ-0197 — artqueue-deferred-batch

Status = this file's folder (REQ Management Policy). No status field here.

## Requirement (user, 2026-07-16)

The art admin generation queue must support a DEFERRED-BATCH mode: enqueuing a
render does NOT start it; an explicit "execute batch" starts everything queued
so far. Motivation: the box (RTX 2080 8 GB / 23 GB RAM) shares RAM with the
alpha web+DB stack, and per-item model swapping (FLUX.2 klein <-> Qwen3-4B,
which cannot co-reside in 8 GB) costs 30-170 s per PROMPT CHANGE
(art_route.py, measured in REQ-0150). Releasing a batch with same-prompt jobs
adjacent lets ComfyUI's node cache reuse the text-encoder conditioning
(the measured 2-20 s path) instead of re-encoding per item.

Ratified scope cut (user, 2026-07-16 chat): full stage-level batching (ALL
text-encodes for the batch first, then ALL samplings) is NOT built. ComfyUI
has no core conditioning save/load between workflows, and the incoming NVMe
(PCIe 3.0 x4 on the i7-9700, so ~3.3 GB/s -- against today's 41 MB/s USB-2
attached disk holding the models) collapses the very reload cost that
stage-batching would save. Revisit only if the swap overhead still dominates
after the SSD migration (companion doc:
docs/llm_managed/2026-07-16-ssd-comfyui-migration-playbook.md).

## Design

- server/services/art_jobs.cjs: process-local `held` flag + `heldQueue`.
  - enqueue() while held -> heldQueue; the render row stays status 'queued'.
  - setHold(true) also moves the not-yet-started live pending jobs behind the
    gate; the in-flight job always finishes (killing it wastes a cold load).
  - executeBatch() releases the held set and STAYS held: jobs enqueued during
    the batch wait for the next execute. setHold(false) releases + auto-runs.
  - Release order: groups keyed by (artwork id, one-shot shapeOverride) in
    first-enqueued group order; enqueue order within a group (stable sort).
    Two seeds of one artwork share the composed prompt, so adjacency =
    conditioning cache hits, no encoder swap.
  - Hold gates GENERATION only: repacks (user-interactive, REQ-0192) and
    inspections (CPU, REQ-0152) keep flowing.
  - queueDepth() counts held + live + running: to the badge a held job is
    still a render that exists and has not run.
  - cancelJob() cancels a held job exactly like a pending one.
  - ART_QUEUE_HOLD=1 starts the service already holding. Otherwise a restart
    falls back to auto-run -- deliberate: in-memory flag, no schema change,
    and identical default behavior for every existing caller/test.
- server/routes/art.cjs: POST /api/art/queue/hold {held:bool},
  POST /api/art/queue/execute; admin-gated like the queue panel. GET
  /api/art/queue payload gains {held, heldPending[]} (additive).
- client: QueuePanel hold toggle + "Execute batch (N)" + labeled held list
  (cancelable); ArtAdminPage wires setArtQueueHold / executeArtQueueBatch.

## Gates

- G1 hold gates generation: nothing starts while held; renders stay 'queued';
  depth badge counts held jobs.                    [artqueue_test.cjs G5]
- G2 executeBatch releases everything held, grouped by prompt (interleaved
  a,b,a,b -> a,a,b), stays held; a post-execute enqueue waits for the next
  execute.                                         [artqueue_test.cjs G5]
- G3 held cancel = pending cancel semantics (failed / 'canceled by user').
                                                   [artqueue_test.cjs G5]
- G4 setHold(false) releases and restores auto-run.[artqueue_test.cjs G5]
- G5 default behavior unchanged when never held: the pre-existing REQ-0156
  queue suite passes untouched.
- ci.sh green.

## Outcome

(filled at built)
