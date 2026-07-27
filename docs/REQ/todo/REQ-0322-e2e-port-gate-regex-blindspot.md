# REQ-0322 — The port gate cannot see the variable names harnesses actually use

- **State**: todo
- **Filed**: 2026-07-27, during REQ-0321's implementation. Found and measured by
  the implementer, deliberately left unfixed there as orthogonal to the port base.
- **Size**: XS to fix, S to prove.

## The defect

`tools/check_e2e_ports.cjs` finds candidate port assignments with a pattern of the
shape `\b[A-Z_]*PORT[A-Z_]*` — a character class with **no digits in it**. Measured
on the post-REQ-0321 tree:

```
STATICPORT=8921           -> CAUGHT
PROXYPORT=8921            -> CAUGHT
E2E_PROXY_PORT=8921       -> *** NOT CAUGHT ***
E2E_FLEET_BASE_PORT=8921  -> *** NOT CAUGHT ***
```

`E2E_` contains a digit, so the class breaks before `PORT` and the match never
starts.

## Why this matters more than its size suggests

`E2E_PROXY_PORT=` and `E2E_FLEET_BASE_PORT=` are **the exact line shapes a harness
writes** — they are the env vars `tools/e2e_harness.sh` and every scoped run set.
So the gate reliably catches the spellings nobody uses and misses the two that
everybody uses.

And the number in the demonstration is not arbitrary: **8921 is the port REQ-0159
died on**. PROJECT.md's own "Why" for the whole port rule is that
`artadmin_e2e.sh` and `content_admin_e2e.sh` both hand-picked 8921-8923, which was
invisible while each ran alone and fatal once `ci.sh` chained them. A harness
hardcoding `E2E_PROXY_PORT=8921` today passes `[0/8]` in silence.

This is the same shape REQ-0251 recorded — *"a gate that watches one half of a rule
watches none of it"* — and it has now been found twice in the same file in one day
(REQ-0321 restored the configs half, which had been missing entirely). The lesson
is starting to look structural: **this gate keeps being written to match what its
author remembered writing, not what the tree contains.**

## What to do

1. Widen the class on both sides to `[A-Z0-9_]*`, or match on `PORT` with
   word-boundary-aware prefixes.
2. **Do not stop at the regex.** Re-run the gate over the whole tree afterwards: a
   wider net will newly catch sites that have been invisible, and some may be
   legitimate (the permanent non-REQ-scoped services 8801/8802/8803/8810+, which
   PROJECT.md exempts by name). Every new red is either a real hardcode to fix or
   an exemption to state explicitly — resolve each one, do not blanket-suppress.
3. Add the planted-negative cases as a self-test so the blind spot cannot silently
   return. REQ-0321's implementer planted and reverted five; make them permanent.

## Gate

`tools/ci.sh` green, and a self-test proving each of `STATICPORT=`, `PROXYPORT=`,
`E2E_PROXY_PORT=`, `E2E_FLEET_BASE_PORT=`, and a bare `http://127.0.0.1:<port>`
literal is detected when out-of-decade.
