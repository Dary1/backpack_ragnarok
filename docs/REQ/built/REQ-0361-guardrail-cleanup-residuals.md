# REQ-0361 - Guardrail cleanup residuals (REQ-0358 review follow-up)

- Origin: chat review of REQ-0358 on 2026-08-03 verified all of its claims and
  found three residuals; the user granted these fixes in the same chat.

## Changes
- ea6e26c6 draft banner dedupe: REQ-0067 / REQ-0068 / REQ-0098 each carried the
  duplicated terminology banner whose second copy was corrupted
  ("Unit = ex-Unit"). Corrupt copy dropped, correct copy kept. REQ-0358
  deduped live docs only; draft/ is a live working set, so the corruption
  would have been read at pickup.
- 8c66b35b done/REQ-0358: dropped the stale "State: built (awaiting user
  inspection/merge)" line. The folder IS the status (board doctrine); the
  line contradicted done/ placement after merge + acceptance. Deliberate
  single-line edit to a done/ file under explicit user grant 2026-08-03;
  done/ immutability otherwise preserved.
- 737c8474 common_content_pipeline.md promotion mechanics (step 2): the candidate
  list is now named as a fresh user_managed_rename_suggestions.md with the
  original cited at archive/user_managed_rename_suggestions.md (the text
  previously pointed at the archived file as if live).

## Gates
- Docs-only: no code, content, or service touched; no restarts.
- Post-edit sweep: "Unit = ex-Unit" absent from the live tree (REQ/done/,
  archive/, and this file's own quotations excepted); no remaining live
  pointer treats
  the archived rename-suggestions list as current.
- done/ untouched except the single granted State-line edit above.

## Outcome
- User acceptance in chat 2026-08-03 (the grant covered exactly these three
  fixes). Merge to master is recorded by the built -> done transition commit.
