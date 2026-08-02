# REQ-0359 -- e2e freeze: documentation truth-up + premise verification

- State: built (docs-only; stacked on req-0358-guardrail-cleanup)
- Origin: guardrail audit 2026-08-02 flagged "freeze premise likely dead --
  verify, then lift".

## Finding
The lift ALREADY happened under REQ-0236: `backpack-e2e-freeze` is inactive
AND disabled; the pre-rewrite PROJECT.md header said "freeze lifted REQ-0236";
104 pre-harness worktrees were removed 2026-07-27. Only the docs still claimed
an armed freeze. No operational change was made or needed by this REQ.

## Evidence (2026-08-02, read-only)
- `systemctl --user is-active/is-enabled backpack-e2e-freeze` -> inactive / disabled
- Ancestor check of all 13 worktrees vs the REQ-0214+0217 merge `35a8edce`:
  12 `req-*` trees OK; `monsters-002-style-bakeoff` pre-harness (HANDS-OFF art
  WIP, kept deliberately at the 0236 sweep -- accepted residual).
- `~/.cache/backpack/e2e.box.lock`: 0-byte, holderless (advisory; inert).

## Changes
- `docs/llm_managed/e2e_harness.md`: freeze section rewritten as closed;
  Premise/Expires-when header updated.
- `~/.cache/backpack/E2E_FREEZE_README.txt` rewritten as a tombstone
  (out-of-repo file, never in git; its operative content is quoted by REQ-0217/0234/0236).

## Note for the next auditor
REQ-0236's file (in done/) still carries "Status: draft" prose from its
draft era -- the FOLDER is authoritative per policy; done/ is immutable, left as is.
