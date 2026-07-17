# REQ-0235 — artadmin REQ-0216 true-scale spec deterministically RED on master (env-coupled)

**Status:** reserved — evidence recorded 2026-07-17 by the REQ-0222 session; needs owner
triage. Not specced for implementation yet.

## Symptom
`client/e2e/artadmin.spec.ts` "REQ-0216 true-scale thumbs: constant px-per-cell across
footprints" fails deterministically: `render-cb-1` computed width **212px**, expected
**42px** (1 cell x 42). Stable across the full expect retry window (24-63 polls); the
snapshot shows the render present and INSPECTED (`img "seed 1"` + `text: fit 95`).

## Evidence (all 2026-07-17)
- 09:52 UTC: PASSED in REQ-0234's FULLCI2 (admin trio 7/1/28) on worktree
  `req-0234-e2e-effectiveness-audit` @ master a7b0724.
- 10:30-10:52 UTC: FAILS 5/5 runs on the same box:
  - REQ-0222 merged tree (gotoReady): loaded box, twice.
  - REQ-0222 tree A/B with the ORIGINAL `page.goto` restored: same failure ->
    NOT caused by REQ-0222's goto change.
  - Pristine master tree (`req-0234-...`, zero local changes): loaded AND
    solo-quiet (load ~2) -> NOT load, NOT cross-session concurrency, NOT REQ-0222.
- Trace kept: `req-0234-.../client/test-results/artadmin-REQ-0216-true-sca-*/trace.zip`
  (+ error-context.md with the DOM snapshot).

## Analysis so far
- The thumb IS a CellStage (`aa-cb is-keyed aa-cb--thumb`) which always receives
  inline `width: thumbBb.cols * 42 px` (client/src/artadmin/Workspace.tsx:201,
  CellBackdrop.tsx:161). A computed width of 212px alongside inline 42px points at a
  min-content stretch: `.aa-card-thumb img { max-width: 212px }` — the inner img can
  force the stage wide when the keyed-render path lets it participate in layout.
- The DOM snapshot shows **fit 95**: the fit-check inspection ran and returned a
  sub-100 score. The passing 09:52 run predates ~an hour of the in-flight art
  session's changes to the untracked `content/art` mirror (already flagged by
  REQ-0234's deploy record as the pre-existing [3.8] red). Hypothesis: the fit-check
  reference consumed from content/ changed under the running art session, moving the
  fit result onto a render path whose layout breaks the true-scale width — i.e. the
  spec may be correctly detecting a real UI regression under new content state, not
  flaking.
- Separate hygiene note (may or may not be related): every harness run logs 3x
  `[art_jobs] inspect job threw: ... render_inspections_render_id_fkey` — in-harness
  race where a test's clear-all cascades a render away while its inspect job is still
  in the python worker; insert then FK-fails. Benign-looking but noisy; deserves a
  guard (skip insert if render gone).

## Impact
- `tools/ci.sh` [6.5/8] admin trio is RED on master for every session -> no branch can
  produce a literal CI GREEN (REQ-0159 rule) until triaged. Blocks REQ-0222's
  remaining gates (release.sh demos, full ci) among others.

## Next steps (owner call)
1. Confirm whether the art session's content/art mirror is expected to move the
   fit-check reference; if yes, decide whether the UI (true-scale width under
   sub-100 fit) or the reference pipeline is the defect.
2. Root-cause the 212px layout path (trace.zip has the full DOM/CSS).
3. Add the FK-race guard in art_jobs inspect insert (small, independent).
