# REQ-0250 - ci.sh step-label denominator drift

**Reserved:** 2026-07-18
**Slug:** ci-step-label-denominator-drift

## Status

draft - AGENT-FILED (2026-07-18, chat). Cosmetic only; no behavioral defect.
Blocked on an owner decision before work may start: the disposition is a
judgement call (fix vs. delete vs. accept as debt), and one option is "do
nothing". Needs ratification of the disposition, not just of the problem.

## Provenance

Found during a read-only structure review of the e2e rig (2026-07-18 chat).
That review produced two findings; the other one (admin `*.config.ts`
BASE_URL fallbacks sitting outside their REQ decade, unscanned by
`check_e2e_ports.cjs`) was reserved as REQ-0249, then found to be the same
defect REQ-0251 already owns and dropped -- 0249 is a burned number. This
finding is unclaimed by any REQ or session.

## Problem

`tools/ci.sh` labels each stage `==== [N/D] ... ====`. D disagrees with
itself: of 61 stage labels, 6 say `/8` and the rest say `/7`.

| label | D | introduced by |
|---|---|---|
| `[0/8]` | 8 | REQ-0172 (`022edea`, 2026-07-14) |
| `[1/7]` .. `[6/7]`, `[7/7]` | 7 | pre-REQ-0159 |
| `[6.5/8]` | 8 | REQ-0159 (`085b691`, 2026-07-14) |
| `[6.6/8]` | 8 | REQ-0231/0234/0221 (`3cc6ff0`, 2026-07-17) |

The run prints `[6.6/8]` and then `[7/7]`, asserting two different stage
inventories four lines apart.

**Mechanism.** REQ-0159 added the admin-harness stage, correctly counted 8
top-level stages, and renumbered only its OWN label. REQ-0172 and REQ-0231
followed that `/8` precedent for the stages they added. Every pre-existing
label kept `/7`. No edit was wrong when written; they simply never converged.
D is a GLOBAL fact that every LOCAL edit has to remember -- the same class of
rule PROJECT.md's port-decade lesson exists to stop relying on.

## Impact

Cosmetic, and only that. Stated plainly so this is not over-bought:

- No stage is skipped, misordered, or unguarded. Every label is a literal
  inside an `echo`; **nothing parses them** (verified by grep across
  `tools/`, `server/`, `client/scripts/`).
- The whole cost is reader trust in the log, in the exact artifact (a ci
  run's tail) a person reads while already debugging something else.

## Options (owner decision)

- **(a) Renumber to one honest D.** Requires defining "stage": integer majors
  are 0-7 (=8), but fractional stages (`2.5`, `4.655`, `6.6`, ...) are stages
  too, which argues D=61 -- and the next fractional stage re-breaks it. Keeps
  the trap.
- **(b) Drop denominators** -- `==== [4.65] content backfill ... ====`.
  Ordering still reads off N; there is no global fact left to maintain, so a
  new stage cannot invalidate anything.
- **(c) Accept as cosmetic debt**, record here, close. Defensible: impact is
  a rounding error against any real gate work.

**Recommendation: (b)**, else (c). (a) buys correctness that decays on the
next commit.

## Scope / frozen contract

- `tools/ci.sh` **echo text only**. No stage added, removed, reordered, or
  otherwise changed; no gate's command or exit-code behavior touched.
- Two prose references would go stale under (a)/(b) and must be updated in
  the same commit:
  - `tools/e2e_run.sh:38` -- "tools/ci.sh [7/7] does this automatically ..."
  - `server/tests/backfill_content_registry_test.cjs:10` -- "([4.65/7])"
- PROJECT.md is user-owned and stays untouched.
- Not a licence to tidy ci.sh generally. Labels, nothing else.

## Acceptance criteria

- `bash tools/ci.sh` exits 0, and a diff of the stage-label sequence before
  vs. after shows **label text changes only** -- same stages, same order.
- Under (a): no label contradicts any other. Under (b): zero `/D` remain in
  `tools/ci.sh`.
- The two prose references above resolve to something that exists.
- Under (c): this file moves to `done/` with the decision recorded, and no
  code changes at all.
