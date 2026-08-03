# REQ-0363 — check_engine_types' member scanner silently skips documented members

**Status:** reserved — AGENT-PROPOSED, awaiting owner review. Not cleared to implement.
**Reserved:** 2026-08-03
**Slug:** engine-type-drift-comment-blindspot
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」.
**Found by:** REQ-0290, which added two exported engine members and noticed the drift
checker's verified-member count did not move.

## What is wrong

`tools/check_engine_types.cjs` is the mechanical guard for design rule 1 (the engine is
consumed AS-IS; `shared/engine.d.ts` must never drift from `shared/engine.js`). Its
`members()` scanner walks an interface body character by character and flushes at every
`;` found at brace-depth 0, then matches the flushed text with `/^(\w+)(\??):\s*(.+)$/`.

A member preceded by a `/** ... */` doc comment flushes as `"/** ... */\n  name: type"`,
which does not start with a word character, so the regex misses and the member is
**silently skipped** — no warning, no count, nothing. Verified 2026-08-03 on
`req-0290-locked-po-not-allowed-cursor` by replicating the scanner:

    parsed members: 44   skipped(comment-prefixed): 6
    poInBP seen? false          <- declared, uncovered
    canRotateBP seen? false     <- declared, uncovered

The failure mode is the bad one: the script's success line reads
`engine type surface OK (49 declared members verified against runtime)`, which invites
the reader to believe the surface is covered. The better-documented a member is, the
less likely it is to be checked — exactly backwards.

## Why it matters

REQ-0027 caught a real drift by manual re-reading, and this script exists so that
re-read is mechanical. Every doc-commented member is currently outside that guarantee,
including `poInBP`, `canRotateBP`, `rotateBP` and (as of REQ-0290) `poInLockedBP` /
`poInLockedBPIn`. REQ-0290 had to add its own suite coverage in `mock-src/tests/run.cjs`
to compensate; that should not have been necessary.

## What to do

1. Strip block/line comments from the interface body before scanning (or skip to the
   first word character after each flush). Prefer stripping — the depth counter also
   counts brackets that appear inside prose, which is a second latent way for the scan
   to desynchronise.
2. Make the count HONEST: print declared-vs-verified, and FAIL when they differ, so a
   future scanner regression cannot be silent again. This is the actual fix; (1) alone
   would leave the same class of bug reachable.
3. Re-run against today's `engine.d.ts` and fix whatever real drift the widened coverage
   surfaces — treat that as part of this REQ, not a follow-up.

## Out of scope
- Changing `shared/engine.d.ts`'s partial-by-coverage policy (declaring MORE of the
  surface is a separate decision).
- Any change to `shared/engine.js` itself (design rule 1).

## Gates
- A deliberately drifted doc-commented member (wrong arity, wrong kind, absent at
  runtime) is DETECTED — one negative test per failure mode, since today all three pass
  vacuously.
- Verified count == declared count, asserted by the script itself.
- `tools/ci.sh` GREEN.
