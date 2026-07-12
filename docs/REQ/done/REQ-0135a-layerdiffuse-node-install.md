# REQ-0135a — layerdiffuse-node-install

**Split:** 2026-07-12 from REQ-0135 (layerdiffuse-matting-spike) per PROJECT.md
multi-phase rule. This file records the COMPLETED install phase; the pending
evaluation phase is REQ-0135b-layerdiffuse-matting-eval.
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict ALL GREEN.
**Reference:** `docs/llm_managed/item_content_pipeline.md` (S5-4 matte),
`docs/llm_managed/unit_icon_pipeline.md` (S4 matte quality concern).

## Completed scope

- **ComfyUI-layerdiffuse installed** into `~/ComfyUI/custom_nodes/`
  (huchenlei/ComfyUI-layerdiffuse, shallow clone). Fresh user go-ahead for
  touching the HANDS-OFF art ComfyUI was obtained in-session 2026-07-12
  (install + process restart both explicitly approved).
- **Dependency fix:** the node requires `diffusers>=0.29.0`; latest
  diffusers 0.39.0 fails to import under the venv's `torch==2.4.1+cu121`
  (`diffusers/models/attention_dispatch.py` registers a flash-attn-3-style
  custom op; `torch.library.infer_schema` rejects its signature → node
  IMPORT FAILED). **Pinned `diffusers==0.31.0`** in `~/ComfyUI/venv` —
  satisfies the requirement, predates `attention_dispatch`. Import clean.
- **Verified live:** after restart, `/object_info` lists all 8
  `LayeredDiffusion*` nodes (Apply / CondApply / CondJointApply / Decode /
  DecodeRGBA / DecodeSplit / DiffApply / JointApply).
  `LayeredDiffusionApply` config `"SDXL, Attention Injection"` +
  `LayeredDiffusionDecodeRGBA` are the ones the spike uses. LD model
  weights (~1.5 GB) auto-download from HF on first use (not yet triggered).
- **Spike harness authored and staged** for 0135b — see that file's
  "Staged assets".

## Acceptance

User directive 2026-07-12 (mid-session, closing this matter): mark the
finished portion done, move the unfinished evaluation to a separate REQ
TODO. The install is deployed and live on the art ComfyUI.

## Incident log (why the evaluation did not run; feeds REQ-0139)

- A concurrent REQ-0136 bakeoff session shared the same ComfyUI/GPU during
  this REQ's window. Effects observed:
  - Its history clears erased my prompt's `/history` entry after execution,
    breaking `gen_item_icons.wait_done()` polling (output PNG existed,
    completion never observable) → route A run aborted.
  - Checkpoint swapping between the two workloads would have contaminated
    all timing/VRAM measurements.
  - Kernel OOM killed ComfyUI once (03:26 UTC, 12.5 GB RSS, 23 GB box),
    and a second thrash episode took sshd itself down for ~10 minutes.
- Takeaway for REQ-0139 (comfyui-service-provenance): single-owner queue /
  provenance is not cosmetic — concurrent agent sessions actively corrupt
  each other's runs and can take the whole box down.

## Outcome

Install phase complete and live. Evaluation (side-by-side, scoring,
gallery, verdict) = REQ-0135b, cleared and waiting in `todo/`, gated on a
quiet GPU box. Transition commits are the authoritative log (git history).
