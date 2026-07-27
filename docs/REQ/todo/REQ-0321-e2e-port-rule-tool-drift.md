# REQ-0321 — The e2e port rule is documented one way and implemented another

- **State**: todo
- **Filed**: 2026-07-27, orchestrator, during REQ-0310's gate run.
- **Filed under the standing user directive** (2026-07-16): 「あなたが作業している中で、
  こうした方が良かったと思う事はREQにしておいてください」.
- **Size**: S-M. The fix is small; the audit of what it moves is the work.

## The drift

PROJECT.md — the user-maintained golden — states the rule as:

    PORT = 5000 + <REQ number> * 10 + <index>
    Valid REQ range: 0001-2775.   REQ-0380 and REQ-0381 are POISONED (exit 64).

The tools implement something else:

- `tools/e2e_ports.sh:4`   — `PORT = <REQ number> * 10 + <index>` (no 5000 base)
- `tools/e2e_ports.sh:32`  — caps at REQ 6552
- `tools/check_e2e_ports.cjs:6,46` — enforces `req * 10`, the same old formula

Observed, not inferred: `source tools/e2e_ports.sh 0310` prints
`[e2e-ports] REQ-310 -> static:3100 api:3101 proxy:3102`, and `0309` prints 3090/3091/3092.

## Why it matters — PROJECT.md already wrote the postmortem

PROJECT.md gives two reasons for the 5000 base and the 2775 ceiling, and the tools
violate both:

1. **The ceiling is the kernel's ephemeral floor, not 65535.**
   `/proc/sys/net/ipv4/ip_local_port_range` is `32768 60999` on llmlocal. A harness
   binding inside that range works most days and then, once in fifty, loses a race
   to an outgoing connection and dies on `EADDRINUSE` with nothing to point at.
   Under the implemented rule every REQ from **3277** upward lands there. We are at
   0321; at the current rate that is not far off.
   The tool's own comment still reasons "6553*10+9 = 65539 would overrun, so cap at
   6552" — which is verbatim the mistake PROJECT.md postmortems as *"a bound that
   asked what the port NUMBER FIELD allows and never what the kernel will let us
   bind."*
2. **Base 5000 clears the low registered ports.** PROJECT.md's own example: the old
   rule put REQ-0152's api on **1521**, Oracle's TNS listener.

## What to do

1. **Decide which document is right.** PROJECT.md is user-maintained and the LLM
   may not edit it, so the default assumption is that the tools are behind and must
   be brought up to the documented rule. Confirm with the owner before moving a
   single port — this is not a code question.
2. If the tools move: update `e2e_ports.sh` (base 5000, range 0001-2775, reject
   0380/0381 with exit 64) and `check_e2e_ports.cjs` to match, then re-derive every
   harness and every `client/e2e/*.config.ts` baseURL default. `check_e2e_ports.cjs`
   runs as ci step `[0/8]`, so it will name every site that has drifted.
3. Sweep for hardcoded ports that the old rule made legal and the new one does not.

## Gate

`tools/ci.sh` green, with `[0/8]` passing under the NEW formula, and a spot-check
that each harness binds where PROJECT.md says it should.

## Note

This is the same failure shape REQ-0251 recorded: *"A gate that watches one half of
a rule watches none of it."* Here the gate and the rule agree with each other and
both disagree with the documentation — which is worse, because the green tick is
actively reassuring.

---

## Owner ruling (2026-07-27) — PROJECT.md wins; bring the tools up to it

*「はい、それでお願いします。」* — the tools are to be corrected to the documented
rule. This REQ is cleared to implement.

## Correction to my own "Why it matters" — reason 1 was overstated

The owner's response: *「3277は遠い話しです。その時がきたら、-3000した数字で展開したら
いいだけです。」* — and that is right. The project is at REQ-0321; reaching 3277 is
many years of work away, and if it ever arrives the remedy is arithmetic (offset the
decade). **Reason 1 above is withdrawn as a motivation.** It describes a real
property of the implemented formula, but it is not a reason to act now, and
presenting it as one was an argument from urgency that the numbers do not support.

The remaining case stands on its own and is enough:

- **Base 5000 clears the low registered ports.** Under the implemented rule
  REQ-0152's api lands on **1521**, Oracle's TNS listener — PROJECT.md's own
  worked example, and a concrete collision, not a hypothetical.
- **PROJECT.md is the user-maintained golden and the LLM may not edit it.** When
  the documentation and the implementation disagree, the implementation is what
  moves. That alone settles it.
- **The failure shape is the dangerous one.** The gate (`check_e2e_ports.cjs`, ci
  step `[0/8]`) and the rule (`e2e_ports.sh`) agree with *each other* and both
  disagree with the document. A green tick that is actively reassuring while the
  documented invariant is unmet is worse than a visibly missing check.
