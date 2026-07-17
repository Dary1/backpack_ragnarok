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

---

## UPDATE 2026-07-18 — the symptom is GONE; hypothesis confirmed (REQ-0222 session)

The spec now **PASSES** on req-0222 @ 8d68dbd (= master with REQ-0193/0212/0213/0233 merged):
- 7/7 on a quiet box; the true-scale spec itself 10.0 s.
- 7/7 again under a deliberate 8-way CPU burn (loadavg1 12->24); true-scale 20.9 s.
- Re-checked across the whole session — never reproduced once, where 2026-07-17 was 5/5 red.

This **confirms this file's own leading hypothesis**: the failure was coupled to the state of
the in-flight art session's untracked `content/art` mirror (the `fit 95` path), not to any
branch's code. That work has since landed on master (REQ-0193's live cutout sweep, 185/185
adopted renders -> cutouts, + REQ-0233), and the red went with it. Nothing was fixed by hand.

Consequences:
- The claim in "Impact" — "ci.sh [6.5/8] is RED on master for every session -> no branch can
  produce a literal CI GREEN" — **no longer holds**. [6.5] is green.
- REQ-0222's remaining gates were unblocked and run; REQ-0222 is now `built/`.
- Next steps 1 and 2 (art-mirror/fit-check coupling; the 212px layout path) are **moot as a
  live defect** — but the underlying question stands and is worth an owner call: a spec that
  goes red purely because an untracked content mirror moved is an env-coupling the suite
  should not have. Keep or close as the owner sees fit.
- Next step 3 (**the FK-race guard**: `[art_jobs] inspect job threw:
  render_inspections_render_id_fkey`, a test's clear-all cascading a render away while its
  inspect job is still in the python worker) is **independent and still open** — it was still
  logging 3x per harness run today. That is the only actionable remnant here.
