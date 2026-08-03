# Art pipeline session — 2026-07-17

LLM-managed operational log (scratch area; PROJECT.md is user-owned and was not
touched). Covers the art-generation drain, cutout sweep, art adoption, and the
REQ-0193 / REQ-0212 / REQ-0213 / REQ-0233 outcomes for this session.

## The freeze (root cause + mitigations)

**Symptom (recurred this session ~11:20–11:40 UTC):** llmlocal became
unresponsive — ssh banner/kex timeout, tunnel origin unreachable — for ~16 min,
then self-recovered without a reboot.

**Root cause (structural, per REQ-0233):** a warm ComfyUI holds ~11 GB host RSS
that REQ-0158's `/free` does NOT reclaim (GPU is 8 GB, so the flux2 weights live
mostly in RAM). Birefnet matte jobs (cutout + inspection kits) hold ~12 GB RSS
each. The art queue serialises JOBS but not resident RSS, so a generation stack
+ a matte stack = ~23 GB (the whole box). Any additional heavy load — this
session it was **a parallel session's full `tools/ci.sh`** (build + e2e) running
while my re-enqueued generations kept ComfyUI warm — tips it into swap-thrash
starvation (zero oom-kills; kernel just thrashes).

**Mitigations live (do not remove):**
- `comfyui.service` drop-in: `MemoryMax=14G`, `MemorySwapMax=1G` (bounds ComfyUI
  so it is reclaimed/killed inside its cgroup instead of thrashing the box).
- `comfyui-idle-free` drop-in: `RSS_RESTART_MB=6000` (restart ComfyUI when idle
  and bloated).
- These held this session: the box recovered on its own once the parallel
  `ci.sh` exited. No reboot was needed.
- **REQ-0233 (this session) is the structural fix**: family scheduling makes at
  most one model stack resident at a time (see below).

**Interim manual barrier used this session:** because REQ-0233 was not yet
deployed, a one-shot watcher (`/tmp/barrier_watch.py`) restarted
`comfyui.service` the instant the generation family drained, releasing ~10 GB
before the queued kit inspections (matte) ran. It fired correctly at 12:03:40
(available RAM jumped 10 GB → 20 GB).

## Sweep-and-regen recovery pattern (proven repeatedly today)

Parallel agent sessions deploy/restart `backpack-api` without warning, which
kills the in-memory art queue: in-flight generation children die and their rows
stay `running`/`queued`, or get marked `failed`. Recovery:
1. `GET /api/art/queue` (and per-artwork `GET /api/art/artworks/<name>`) to find
   renders stuck `queued`/`running`/`failed`.
2. For each, `DELETE /api/art/artworks/<name>/renders/<seed>` then re-POST
   `/api/art/artworks/<name>/generate {seed:<same>}`.
3. After ANY api restart, re-check the queue. All matte/generation work goes
   through the live API queue (127.0.0.1:8802) — never standalone birefnet.
This session: all 12 target renders (halberd 404–406, war_pick 4–6,
probe_lens 1–3, skeleton_key 1–3) had failed under service churn and were
swept-and-regenerated; all 12 then completed OK.

## Art adoption decisions (this session)

Judged from server-built contact sheets (raw renders + old-seed fallbacks):
- **items005_halberd → seed 405.** 405/406 both pass the "axe blade + spear tip
  on one continuous shaft" test; 405 is the cleanest halberd silhouette. Seed
  404 failed (floating head + disconnected shaft), as did old 101/202.
- **war_pick → seed 4.** Cleanest T-shaped head (sharp pick opposite a hammer
  poll); reads as a war pick, not a spear. Fallback seeds 1/2/3 are all spears.
- **probe_lens → seed 1.** Best brass rim + solid brass handle magnifier.
- **skeleton_key → seed 2.** Strongest skull-shaped bow on a robust iron key.
(Raw renders adopted; the cutout sweep then re-adopts each as its background
cutout.)

## Cutout sweep (REQ-0193) — batch outcome

Idempotent sweep over every adopted artwork via the live REQ-0193 cutout route
(POST cutout → wait ok → adopt cutout seed). **bpskin artworks were EXCLUDED**
(tiling textures whose fills must stay opaque — never cut out).

- Adopted artworks: 184 total (po 69, monster 62, unit 41, si 7, bpskin 5).
- Swept (non-bpskin): 179.
- - IN PROGRESS at handoff: 63/179 processed (20 new cutouts, 43
  already-cutout skips), **0 failures**. At sweep start 119 non-bpskin adopted
  artworks still needed a cutout (unit 21, monster 45, po 53); ~hours to finish
  at ~2 min/cutout under concurrent parallel-session load. Detached
  (`/tmp/cutout_sweep.py`); survives the session.  (done / skipped-already-cutout / failed — filled at close)
- Verification: PENDING sweep completion. `/tmp/verify_cutouts.py` is staged: it
  counts adopted renders with `params.derived == 'background_cutout'` by kind,
  lists exceptions, and does RGBA + genuine-transparency spot-checks per kind
  (with a bpskin opacity flag).  (adopted renders with params.derived ==
  'background_cutout'; RGBA + genuine-transparency spot checks).
- bpskin note: all 5 adopted bpskins already carry `background_cutout` from
  PRIOR runs (before this session). Per instruction they were left as-is and not
  re-swapped; flagged for user review (fills should stay opaque on tiling
  textures). Spot-check pending with the rest of verification.

## REQ states at end of session

- **REQ-0212** (3 charge verbs + 3 carrier units): DONE — merged, deployed,
  live-verified prior to this session.
- **REQ-0213** (9 art-first units + arsenal pack): DONE — merged, deployed,
  live-verified (54 units serving).
- **REQ-0193** (artadmin render cutout): BUILT (route deployed + working; exercised at scale by
  this sweep). Moves to DONE after the sweep completes + is verified: append the
  batch record in the req-0193 worktree, `git mv` built -> done, merge to master
  (docs-only). Currently in `docs/REQ/built/` on master.
- **REQ-0233** (art-queue family scheduling): BUILT (implemented, master merged clean, gate record
  appended, `git mv` todo -> built committed). DEPLOY (built -> done) is
  POST-sweep: merge to master, restart backpack-api, live-verify the barrier
  (journal shows comfyui restart between families, RSS <2 GB before first matte),
  delete the test renders.

## REQ-0233 summary (implemented this session)

`server/services/art_jobs.cjs` pump() now groups work into a **generation
family** (genQueue) and a **matte family** (packQueue + inspectQueue), drains the
in-flight family before switching, and on a **generation→matte switch** restarts
`comfyui.service` and awaits its health endpoint (the only lever that returns
RSS) before the first birefnet loads. Matte→generation needs no barrier.
`ART_FAMILY_BARRIER=0` disables the real restart (test seam + emergency lever;
default ON). Unit tests (`server/tests/artfamily_test.cjs`) cover family
grouping, inspections waiting for the switch, and the barrier firing exactly
once per gen→matte switch (barrier mocked). Gates all green: typecheck OK; artqueue 5/5; inspection 5/0;
artfamily 2/2; sim wildlands 13/0 (post master-merge). The only accepted
non-green is the documented `forecast_parity` perf-budget load-flake
(REQ-0222/0230), verified 3/3 in isolation.
