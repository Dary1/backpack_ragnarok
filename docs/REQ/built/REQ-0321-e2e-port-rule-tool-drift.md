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

---

## Outcome

Implemented 2026-07-27 on branch `req-0321-e2e-port-rule`, off master `9379ba0`.
Not merged, not deployed. `tools/ci.sh` green on the first run. (Status is the
folder, per PROJECT.md — this file moves to `docs/REQ/built/` in its own commit;
the stale `State: todo` line at the top is left untouched because PROJECT.md
forbids editing a status field.)

### Commits

- `f25ea54` — **the rule change**. `tools/e2e_ports.sh` + `tools/check_e2e_ports.cjs`
  to base 5000 / range 0001-2775 / 0380-0381 poisoned, the four Playwright config
  baseURL defaults re-derived, three harness doc comments corrected, and
  `docs/llm_managed/e2e_harness.md`'s scoped-run recipe de-staled. 10 files,
  +165/-42. `web/app` deliberately not in it.
- (this Outcome, and the `todo -> built` move, follow as their own commits.)

### The finding that changed the shape of the work

**This REQ's premise — "the tools rotted" — is wrong, and the correction matters.**
The work already exists: branch `req-0251-e2e-harness-dedupe`, commit `23a2325`
(2026-07-17, "extract tools/e2e_harness.sh; 5000-base port rule; gate the
configs"), whose message states the 5000 base, the REQ-2775 ephemeral-floor
ceiling and the 0380/0381 poisoning in the same words PROJECT.md uses. Its REQ
file sits in `docs/REQ/built/` **on that branch**, marked "not merged, awaiting
acceptance". The branch is 534 commits behind master and was never merged.

So PROJECT.md is not ahead of the implementation by neglect — it documents a
branch that never landed. Two things PROJECT.md describes as existing therefore
do not exist on master at all:

- `tools/e2e_harness.sh` (the shared bringup, with `e2e_harness_req` /
  `e2e_harness_api_env` / `e2e_harness_run`) — **absent**. The four harnesses are
  still the ~85% byte-identical clones REQ-0251 was filed to dedupe.
- the config half of `check_e2e_ports.cjs` — **was absent**; restored by this REQ.

Because of that, `tools/e2e_ports.sh` and `tools/check_e2e_ports.cjs` here are
taken **verbatim from `23a2325`** rather than rewritten, so REQ-0251's eventual
merge is a no-op on both files. The only deviation is two residual stale header
examples inside `e2e_ports.sh` that `23a2325` left pointing at the pre-5000 base
(`1562 -> REQ-0156`, and `-> STATICPORT=1560 APIPORT=1561 PROXYPORT=1562`);
shipping a derivation helper whose own worked example contradicts its formula is
the exact defect this REQ exists to remove, so they are corrected here and will
present as a two-line comment conflict if REQ-0251 is later merged as-is.

**The harness dedupe (`e2e_harness.sh`) was deliberately NOT ported.** It is
REQ-0251's scope, not this REQ's, and it rewrites all four harnesses.

### Every site that moved

| # | Site | Before | After | Why |
|---|------|--------|-------|-----|
| 1 | `tools/e2e_ports.sh` | `base=$((req*10))`, range 103-6552 | `base=$((5000+req*10))`, range 1-2775, poisoned `380 381` | the rule |
| 2 | `tools/check_e2e_ports.cjs` | `lo = req*10`, harnesses only | `PORT_BASE=5000`, + CONFIGS half, fleet exemption 100 -> 10 ports | the gate |
| 3 | `client/e2e/artinspect.config.ts:7` | `127.0.0.1:8913` | `127.0.0.1:6522` | REQ-0152 proxy |
| 4 | `client/e2e/artadmin.config.ts:7` | `127.0.0.1:8903` | `127.0.0.1:6562` | REQ-0156 proxy |
| 5 | `client/e2e/contentadmin.config.ts:7` | `127.0.0.1:8923` | `127.0.0.1:6572` | REQ-0157 proxy |
| 6 | `client/e2e/registry.config.ts:9` | `127.0.0.1:2212` | `127.0.0.1:7212` | REQ-0221 proxy |
| 7 | `tools/art_inspect_e2e.sh:24-25` | `PORT = REQ*10`, "owns 1520..1529" | `5000 + REQ*10`, "owns 6520..6529" | doc comment stating the old formula |
| 8 | `tools/artadmin_e2e.sh:27-28` | same, "owns 1560..1569" | "owns 6560..6569" | same |
| 9 | `tools/content_admin_e2e.sh:29-30` | same, "owns 1570..1579" | "owns 6570..6579" | same |
| 10 | `docs/llm_managed/e2e_harness.md:21-27,75` | `E2E_PROXY_PORT=<NNNN>2`, "decades unchanged" | `source tools/e2e_ports.sh`, 5000 base named | the shorthand IS the old formula |

Sites 3-6 are the ones the REQ predicted but nobody had audited. Three of them
(8903/8913/8923) were never even on the *old* rule — they are the pre-REQ-0172
hand-picked 89xx values, unchanged since REQ-0159, exactly as PROJECT.md's
postmortem says. Only `registry.config.ts` (2212) was correctly derived under the
old rule. They survived because the harnesses always pass `PLAYWRIGHT_BASE_URL`,
so the default only bites a hand-run `playwright test --config=...`.

Site 10 was found by reading, not by the gate: the "authoritative usage doc" told
the reader to build a port by **concatenating** the REQ number (`<NNNN>2`), which
is the old formula written as a string operation. Under the new rule that lands
on an unowned port in another REQ's decade.

### Deliberately NOT moved — verified shared/permanent, per PROJECT.md

`8801` web, `8802` api, `8803` e2e proxy, `8810+` REQ-0083 fleet are **not
REQ-scoped**. So these stay, and each was checked individually:
`client/e2e/local-proxy.cjs:79,80` (8803/8810 defaults), `tools/e2e_fleet.cjs:32`
(8810), `client/playwright.config.ts:16`, `client/e2e/global-setup.ts:74`, and
`tools/ci.sh:378` (the legacy non-scoped `[7/7]` path). Those two decades are
*precisely why* REQ-0380/0381 are poisoned. `docs/REQ/done/**` and
`docs/REQ/built/**` port references are history and were left alone.

### Gate: `tools/ci.sh`, worktree, DATABASE_URL sourced read-only from `~/backpack_ragnarok/server/.env`

    ==== [0/8] e2e harness port rule (REQ-0172) ====
    check_e2e_ports: 4 harnesses + 4 configs, all ports derived from their REQ number (base 5000), no collisions
    ...
    ==== [6.5/8] admin e2e harnesses ====   artadmin 8 passed (1.7m)
                                            artinspect 1 passed (19.3s)
                                            contentadmin 28 passed (41.6s)
    ==== [6.6/8] registry-first serving e2e ====   4 passed (8.1s)
    ==== [7/7] client e2e (SCOPED, REQ-0321 decade) ====   196 passed (4.4m)
    CI GREEN
    CI_EXIT=0

Green on the **first** run at the default `E2E_PARALLEL=4`; the known `[7/7]`
4-worker flake did not reproduce, so no serial re-run was needed. `[0/8]` went
from "4 harnesses" to "4 harnesses + 4 configs" — the config half of the rule is
now machine-checked for the first time on master.

### Proof the guards actually fire

`source tools/e2e_ports.sh <n>`, clean env:

| input | rc | result |
|-------|----|--------|
| 0321 | 0 | `static:8210 api:8211 proxy:8212` |
| 0152 / 0156 / 0157 / 0221 | 0 | 6520-2 / 6560-2 / 6570-2 / 7210-2 |
| **0380** | **64** | "decade collides with the PERMANENT shared services (8801 web / 8802 api / 8803 proxy / 8810+ fleet)" |
| **0381** | **64** | same |
| 0001 | 0 | `static:5010` — the 5000 base removes the old 0103 floor |
| **2775** | 0 | `static:32750 api:32751 proxy:32752` — last safe, `32759 < 32768` |
| **2776** | **64** | "outside the derivable range 1-2775: above it the decade overlaps the kernel ephemeral range (32768+)" |
| 9999 | 64 | same |
| 0000 | 64 | rejected, but via the "not a REQ number" path (leading zeros strip to empty), not the range message |

The ceiling was checked against the real kernel, not the comment:
`cat /proc/sys/net/ipv4/ip_local_port_range` on llmlocal = `32768	60999`,
matching PROJECT.md exactly.

Gate negative tests (planted, then reverted):

- `artadmin.config.ts` default put back to 8903 -> **caught**, "baseURL default is
  8903, but REQ-0156 owns 6560-6569 -> proxy is 6562".
- a new undeclared `client/e2e/rogue.config.ts` pinning `127.0.0.1:9999` ->
  **caught**, "pins a host:port but is not declared in CONFIGS".
- `STATICPORT=8921` / `PROXYPORT=8921` / `MYPORT=${MYPORT:-8921}` / a literal
  `http://127.0.0.1:8921` in a harness -> all **caught**.

**And binding, not just deriving**: during `[6.5]`/`[6.6]`/`[7/7]` the harnesses
printed `[artadmin_e2e] api :6561 static :6560 proxy :6562`,
`[art_inspect_e2e] ... 6521/6520/6522`, `[content_admin_e2e] ... 6571/6570/6572`,
`[registry_first_e2e] api :7211 proxy :7212` (+ "registry serves 1 item(s)"), and
`ss -lnt` taken mid-run showed REQ-0321's decade holding **8212** (proxy) and
**8214/8215/8216/8217** (the four fleet workers, index 4..7) — inside 8210-8219,
exactly the index convention PROJECT.md specifies. Concurrently the 8800-8819
block held only 8801/8802, the live services: nothing leaked into the poisoned
decades.

### Defect found, NOT fixed here (needs its own REQ)

`check_e2e_ports.cjs`'s port-site patterns are `\b[A-Z_]*PORT[A-Z_]*\s*=\s*...` —
**no digits in the character class**. Any variable whose name contains a digit
evades the check when assigned a bare literal, and that is every `E2E_*` port
variable this project actually uses. Measured on the post-change tree:

    STATICPORT=8921            -> CAUGHT
    PROXYPORT=8921             -> CAUGHT
    MYPORT=${MYPORT:-8921}     -> CAUGHT
    http://127.0.0.1:8921      -> CAUGHT
    E2E_PROXY_PORT=8921        -> *** NOT CAUGHT ***
    E2E_FLEET_BASE_PORT=8921   -> *** NOT CAUGHT ***

A harness hardcoding `E2E_PROXY_PORT=8921` — the very line the harnesses do write,
and the very number REQ-0159 died on — passes `[0/8]` silently. Pre-existing:
written by REQ-0172, carried unchanged through `23a2325`. Untouched here because
it is a detection defect orthogonal to the port base, and widening the pattern
could newly red unrelated code; that belongs in its own change with its own gate
run. `[A-Z0-9_]*` on both sides is the likely one-line fix.

### Other observations, no action taken

- **PROJECT.md contradicts itself** (reported, not edited — LLMs may not edit it).
  Its "test-game note (e2e)" section still prescribes
  `E2E_PROXY_PORT=<NNNN>2 E2E_FLEET_BASE_PORT=<NNNN>4` and
  "(REQ-decade ports: index 2 = proxy, 4..9 = fleet workers)" — the same
  concatenation shorthand corrected in `e2e_harness.md` at site 10, and it encodes
  the pre-5000 rule. The "E2E / harness port allocation" section (the one this REQ
  implements) is the correct one. **Owner action needed**, one line.
- `server/README.md:946,963` documents `E2E_STATIC_PORT` (default 8801) and
  `E2E_STATIC_PORT=8851`. That knob was deleted by REQ-0217/0234; the harnesses'
  own comments say so. Stale, but about a removed env var, not the port rule.
- ~50 `[art_jobs] inspection ... failed: No module named 'numpy'` lines in the
  `[5.1]/[5.15]` pg artwork stages: those stages do not set `ART_KIT_PYTHON`, so
  the api's background inspection renders fall back to a bare `python3`. The
  suites themselves report `artwork_test: 19 passed, 0 failed` and
  `inspection_test: 7 passed / 0 failed`. Pre-existing, unrelated to ports.
