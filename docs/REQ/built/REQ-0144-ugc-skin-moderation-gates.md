# REQ-0144 — ugc-skin-moderation-gates

**Status:** built
**Reserved:** 2026-07-12
**Slug:** ugc-skin-moderation-gates
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/backpack_skin_pipeline.md` §0 (skins not for
sale; likely UGC source; Nightmare Forge validator discipline), §6 (every S3
gate must be a machine gate), §7.1 (UGC scope — OPEN).

## Goal

Player-authored skin images without automated moderation is a non-starter
(2026 legal/operational reality). Before ANY UGC skin intake exists, the
machine-gate suite must include content moderation, not just technical
validation.

## Scope

- Gate 0: the S3 technical harness (seams, clip-mask leakage, shape suite) —
  already specified by the skin pipeline; reused as-is.
- Gate 1: NSFW/CSAM classifier on every submitted bitmap (local, deterministic
  threshold policy; no LLM approval — "LLMs draft; scripts judge").
- Gate 2: best-effort IP/logo-likeness screen (perceptual-hash match against a
  curated denylist + logo detector); document known limits honestly.
- Reject/appeal flow definition (automated verdict + stored evidence, user-
  operator override path).
- Research/select the local classifier stack; record model choices + hashes.

## Non-goals

- The friends-only vs global rollout decision stays the USER's open item
  (§7.1) — this REQ builds gates, not policy.
- No market/tradability design (skin doc §7.2, still open).
- No skin system implementation (REQ-0126) and no UGC submission UI.

## Gates

- Adversarial test set (benign / NSFW / IP-lookalike / technically-broken)
  passes with documented precision; zero false-negatives on the NSFW set.
- Gate list ratified by the user BEFORE any UGC intake ships.

---

## Implementation record (2026-07-14, REQ-0144 built)

**Status flip:** todo -> built. Branch `req-0144-ugc-skin-moderation` (off
master 815b1dd; re-synced to 8ec0d32 via merge `7e60c73`). Implementation
commit `acb5f48`. NOT merged to master, NOT deployed (a separate integration
owner handles that).

### What was built
A three-gate machine-moderation pipeline for UGC skin bitmaps + an automated
verdict/stored-evidence/operator-override (appeal) schema + their ci gates.
Tools/server-side only -- no skin-system change, no UGC submission UI, no
rollout-policy decision (all non-goals / the user's open items).

- **Gate 0 (technical) -- reused AS-IS.** `client/scripts/bpskin_harness.mjs`
  (the REQ-0126 S3 machine gate: seams, clip-mask leakage, shape suite) is
  reused unchanged and already runs as its own ci step `[5.9c]`. The pipeline
  records Gate 0 as `DELEGATED` (attesting the committed harness golden
  gridHash) by default, or executes it and records PASS/REJECT with
  `--technical=run`. Per-bitmap technical validation of arbitrary UGC bitmaps
  binds to this harness once a UGC skin-def ingestion format exists (a non-goal
  here); the harness and skin system were untouched.

- **Gate 1 (NSFW) -- local, deterministic, no LLM.** Model
  **AdamCodd/vit-base-nsfw-detector** (ViT-base, 2-class sfw/nsfw), ONNX fp32,
  run on **onnxruntime CPUExecutionProvider** single-threaded + sequential.
    - file `onnx/model.onnx`
    - revision `8587de998f441aac03fdd57a85d2e4cb808c7d64`
    - sha256 `dce8f5af8509fee39c453b78a66076ead5c97321ddcee0ddfa16f67dc8286384`
    - preprocess: RGB -> 384x384 bilinear -> /255 -> normalize mean/std 0.5 -> NCHW
  **Rationale:** ships a ready fp32 ONNX export + `preprocessor_config.json`, so
  it runs on the stack already in the repo `.venv` (onnxruntime 1.27, numpy,
  pillow) with NO torch/transformers and NO GPU -- CPU inference is
  deterministic (same bytes -> same score), the REQ's hard requirement.
  (Falconsai/nsfw_image_detection ships no ONNX export -> rejected: would have
  pulled in torch.) The 344 MB weight is cached out of tree like rembg's u2net
  (`~/.cache/backpack_moderation/...`), pinned by the sha256 + revision above in
  `tools/moderation_gates.json`; nothing large is committed.
  **Threshold policy (fixed, recorded):** `P(nsfw) >= 0.70 -> REJECT`;
  `0.30 <= P(nsfw) < 0.70 -> ESCALATE` (human operator); `< 0.30 -> PASS`. A
  classifier that cannot run = **ESCALATE (fail-safe; never fail-open to PASS)**.
  "LLMs draft; scripts judge" -- the verdict is a pure threshold decision.

- **Gate 2 (IP/logo-likeness) -- best-effort, honest limits.** 64-bit DCT
  perceptual hash (`tools/moderation_phash.py`) vs a curated denylist
  (`tools/moderation_ip_denylist.json`): Hamming distance <= per-entry
  `max_hamming` (default 10) -> REJECT. The denylist ships as mechanism + seed
  structure, sparsely populated with TWO abstract procedural emblems (resemble
  no real logo) that drive the self-test; operators add real marks later, as
  pHash values only. **Logo detector: NOT shipped** -- a general logo/brand
  detector needs trained weights (e.g. an ONNX YOLO-logo net) and no sound
  torch-free local option is vetted in this stack; recorded as a known limit,
  with a seam for a future detector behind the same Gate-2 interface. Known
  limit: pHash catches near-duplicate reproductions, not stylistic homage,
  crops, recolors, or novel infringing art.

### CSAM -- honest limit + operational policy
A local image classifier CANNOT certify the ABSENCE of CSAM. Gate 1 is an NSFW
filter, not a CSAM detector. Operational policy (documented, not "solved"): the
NSFW gate + **mandatory human-operator escalation on every REJECT/ESCALATE**,
and reporting to authorities per jurisdiction on any suspected CSAM. No
CSAM-specific model is trained or shipped and no CSAM material was sourced --
all test fixtures are benign procedural (numpy) images.

### Verdict / evidence / appeal schema (through the established DB chokepoint)
Migration `server/migrations/015_ugc_moderation.sql` (mirrors the REQ-0151/0152
relational profile), three tables behind `server/storage.cjs` via
`server/storage_moderation.cjs` (async pg pool, same pattern as
`storage_art.cjs`):
- `ugc_submissions` -- one row per distinct bitmap, dedup by `input_sha256`.
- `moderation_verdicts` -- verdict + `verdict_sha256` + full per-gate evidence
  jsonb (gate_id, gate_version, verdict, score, threshold, model, model_sha256,
  evidence); UNIQUE(submission, pipeline_version, verdict_sha256) makes
  re-recording idempotent.
- `moderation_overrides` -- operator UPHOLD / OVERRIDE_APPROVE / OVERRIDE_REJECT
  + reason (the reject/appeal path, append-only audit).
The verdict pipeline tool (`tools/moderation_gate.py`) is storage-agnostic and
emits exactly the JSON `storage_moderation.verdictToRow()` ingests (proven by a
ci contract test).

### Determinism
Same input bytes + same manifest + denylist + model -> byte-identical verdict:
`verdict_sha256 = sha256(canonical(pipeline_version, input_sha256, verdict,
gates))`; the informational `decided_at` is EXCLUDED from the hash. A ci test
runs the pipeline twice and asserts identical `verdict_sha256` + gates.

### Gate results (exact)
- `tools/tests/moderation_gate_test.py`: **18 passed, 0 failed** (benign PASS;
  NSFW threshold stand-in REJECT; ESCALATE band; pHash-hit REJECT; double-run
  determinism; fail-safe ESCALATE; real-model smoke -- benign fixture below
  reject + deterministic + full pipeline runs).
- `server/tests/moderation_test.cjs`: DB-free **7 passed** + pg **12 passed**
  (chokepoint persist, evidence round-trip, override/appeal path, idempotent
  re-record, cascade cleanup, python->verdictToRow contract).
- `flock /tmp/backpack_ci.lock bash tools/ci.sh`: **CI GREEN**, e2e default
  suite **172/172**. New ci steps: `[4.71]` DB-free python pipeline, `[4.72]`
  DB-free storage validators, `[5.46]` pg storage + appeal path.

### Files touched
New: `tools/moderation_gate.py`, `tools/moderation_nsfw.py`,
`tools/moderation_phash.py`, `tools/moderation_fixtures.py`,
`tools/moderation_gates.json`, `tools/moderation_ip_denylist.json`,
`tools/tests/moderation_gate_test.py`, `tools/tests/emit_sample_verdict.py`,
`server/migrations/015_ugc_moderation.sql`, `server/storage_moderation.cjs`,
`server/tests/moderation_test.cjs`.
Modified: `server/storage.cjs` (re-export the moderation store), `tools/ci.sh`
(3 gate steps).

### Decisions (conservative; [vetoable])
1. **[vetoable] NSFW model = AdamCodd/vit-base-nsfw-detector fp32 ONNX** -- ready
   ONNX export + torch-free deterministic CPU inference on the existing venv.
   Swappable behind `tools/moderation_gates.json` (bump gate_version on change).
2. **[vetoable] Thresholds 0.30 / 0.70 with a human-escalation grey band** --
   conservative: favors escalate-over-pass to minimise false-negatives without
   over-rejecting benign art (benign real fixture scores well under 0.30).
3. **[vetoable] Gate 0 recorded as DELEGATED by default** (attest the committed
   harness golden) rather than re-run per verdict, since the S3 harness already
   runs as its own ci gate and per-bitmap technical binding awaits a UGC intake
   format (non-goal). `--technical=run` executes it inline.
4. **[vetoable] Denylist at `tools/moderation_ip_denylist.json`** (not `data/`,
   which is .gitignored) so the seed structure is version-controlled.
5. **[vetoable] Logo detector deferred** -- no vetted torch-free local weights;
   mechanism seam left in place.
6. **Fail-safe posture:** an unrunnable classifier ESCALATES, never PASSES.

### Still open (NOT decided here -- the user's items)
Friends-only vs global UGC rollout (§7.1); market tradability of UGC skins
(§7.2); ratification of this gate list before any UGC intake ships.

---

## Wave-7 merge/deploy record (2026-07-14)

- Merged to master via `--no-ff` **80b21f3** (branch `req-0144-ugc-skin-moderation`, tip b66031c). No code conflicts. Two byte-identical untracked `web/preview/bpskins-req0126/{grid.png,verdict.json}` files (md5-matched to the committed versions) were cleared from the working tree pre-merge and restored identically by the merge. Stale dist deltas were deferred to the release rebuild.
- Migration `015_ugc_moderation.sql`: number **015 was free** (master carried 001..014). The migration declares **no named CHECK constraints** (only inline UNIQUE/FK), so there was no constraint-name collision and nothing to renumber. Re-applied idempotently to the deploy DB (`supabase-db`); all three tables (`ugc_submissions`, `moderation_verdicts`, `moderation_overrides`) present with FK/UNIQUE/ON DELETE CASCADE and the `backpack` GRANTs.
- **NSFW model cache verified** out-of-tree at `~/.cache/backpack_moderation/vit-base-nsfw-detector/model.onnx` (329M): sha256 `dce8f5af...8384` and revision `8587de99...` both match `tools/moderation_gates.json`. The `.venv` python carries onnxruntime 1.27.0 + numpy + PIL, so ci step **[4.71]** ran the real-model NSFW gate (not skipped).
- Full gate `flock /tmp/backpack_ci.lock bash tools/release.sh`: **CI GREEN** incl. the new steps **[4.71]** (py NSFW pipeline), **[4.72]** (DB-free storage validators), **[5.46]** (pg storage + override/appeal path -- contract, idempotent re-record, cascade cleanup all pass); default e2e **177/0**. Dist committed **5535b45**. Services active + HTTP 200 post-restart.
- **Disposition: STAYS built.** The REQ Gates include "Gate list ratified by the user BEFORE any UGC intake ships," restated under "Still open ... the user's items." Built->done is withheld pending the user's gate-list ratification. (The §7.1 friends-only-vs-global rollout policy also remains the user's open item, explicitly out of this REQ scope.) Worktree retained.
