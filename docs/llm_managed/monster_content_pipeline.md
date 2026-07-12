# Monster Content Pipeline

**This document does not exist yet.** It is a stub. To be authored under
**REQ-0111** (draft).

> **EXECUTION STATUS (REQ-0148 scoping pass, 2026-07-13).** This is the
> inverse of every other pipeline: the TOOL exists and the DOCUMENT does not.
> `tools/gen_monster_art.py` is real, works, and is the parent from which
> `tools/gen_item_icons.py` was adapted (same ComfyUI submit → poll
> `/history/<prompt_id>` → copy from `~/ComfyUI/output` pattern; one static
> illustration per job, arbitrary size, optional hires-fix). Monster art HAS
> been produced with it in art sessions.
>
> But there is no written procedure. No stage ladder mapping, no `gen_*` field
> contract, no matte rule, no gate, no review surface. An operator handed this
> file can generate nothing, because this file tells them nothing. That is the
> finding, and REQ-0148 records what it costs.
>
> Anything you believe about the monster pipeline that is not in
> `gen_monster_art.py` or in a done REQ is folklore. Write REQ-0111.

Common principles, stages, infrastructure, and REQ workflow: see
`common_content_pipeline.md` (S5 art stage: §4, incl. the S5 execution-status
table).
