# REQ-0342 — GPU is the e2e default, and the renderer check aborts

## Status
built — 2026-07-29. Awaiting user acceptance / merge.

Two lines of behaviour, both of them removing a thing someone had to remember.

---

## 1. Why

REQ-0331 found the box rendering on llvmpipe for four days: an apt driver
upgrade without a reboot, `--use-angle=vulkan` silently falling back to
software, ~25% of the suite's wall time and a load-dependent flake, with no
signal anywhere. It shipped two things: the repair, and a renderer assertion so
it could not happen silently again.

The assertion was built **opt-in and advisory**:

```ts
if (process.env.E2E_GPU !== '1') return;              // only when asked
...
if (process.env.E2E_REQUIRE_GPU === '1') throw ...;   // abort only when asked twice
console.warn(banner);                                 // otherwise, warn
```

Both defaults were wrong, and wrong in the same shape as the bug they guard:

- **Opt-in GPU.** `tools/ci.sh` passes `E2E_GPU=1`, but a hand-typed run — the
  recipe in PROJECT.md's e2e section is one, and it omits the flag — renders on
  llvmpipe and merely looks slow. The failure mode of forgetting the flag is
  identical to the failure mode of the driver drift.
- **Advisory abort.** A banner that prints on every run is a banner nobody
  reads. REQ-0331's own incident is the proof: had the assertion existed, it
  would have printed for four days and changed nothing.

The alternative considered and rejected was documenting `E2E_GPU=1` in
PROJECT.md. That is the shape this project has already established does not
work — see REQ-0340 for a gate that was *documented* as never being a free pass
while being one. A default is a fact; a doc line is a rule.

## 2. What changed

| | before | after |
|---|---|---|
| `client/playwright.config.ts` | `USE_GPU = E2E_GPU === '1'` | `USE_GPU = E2E_GPU !== '0'` |
| probe guard (`global-setup.ts`) | runs only when `E2E_GPU === '1'` | skipped only when `E2E_GPU === '0'` |
| CPU fallback detected | `console.warn` | **throw** |
| opt out of the abort | `E2E_REQUIRE_GPU=1` to opt IN | `E2E_ALLOW_CPU=1` to opt OUT |

`E2E_REQUIRE_GPU` is **removed**, not kept as an alias: it had no callers
outside its own definition, and abort is now what it used to request.

The two escape hatches are distinct on purpose and the abort message names both:
`E2E_GPU=0` means *"I intend to run on CPU"* (no probe, no complaint);
`E2E_ALLOW_CPU=1` means *"I asked for GPU, did not get it, and accept that for
this run"* (probe runs, warns loudly, proceeds). Neither is a fix, and the
message says so.

`tools/ci.sh`'s `E2E_GPU="${E2E_GPU:-1}"` is now redundant. It is kept, with a
comment saying it is redundant, because it still reads as the explicit statement
of intent it always was.

## 3. Verified — four behaviours, including watching the abort fire

| | run | result |
|---|---|---|
| T1 | no env at all | `GPU rendering CONFIRMED -- ANGLE (NVIDIA, Vulkan …RTX 2080…)`, 2 passed |
| T2 | `E2E_GPU=0` | probe skipped entirely, 2 passed on CPU, no complaint |
| T3 | GPU by default, **probe forced to software** | **abort**, `EXIT=1`, renderer reported as `ANGLE (Google, Vulkan … SwiftShader …)` |
| T4 | same forced software + `E2E_ALLOW_CPU=1` | `(E2E_ALLOW_CPU=1 -> proceeding on CPU by request)`, 2 passed, `EXIT=0` |

T3/T4 force the failure by temporarily swapping the probe's own launch args to
`--use-angle=swiftshader --disable-gpu`, i.e. the probe genuinely observes
software rendering rather than the assertion being tricked. Reverted and
re-typechecked afterwards.

**Full gate:** `tools/release.sh` **CI GREEN**, e2e **206 passed / 0 failed /
1 skipped**, admin trio 8/1/28, registry 4/4. `E2E_GPU` was deliberately **not**
exported for that run — the GPU came from the new default, and the CONFIRMED
line appears exactly once in the log. That is the claim, proven by the gate
itself rather than by a separate demo.

## 4. What this does NOT cover — the admin harnesses

`[6.5/8]` measured **191.0 s**, unchanged. The three admin configs
(`client/e2e/{artadmin,artinspect,contentadmin}.config.ts`) are **standalone**:
they do not import `playwright.config.ts`, and each sets `headless: true` with
no `launchOptions.args`. So this REQ does not reach them, and they have been
running on software rendering since they were written.

I expected GPU not to help them anyway — `tools/artadmin_e2e.sh` sets
`ART_MOCK_DELAY_MS=1500` deliberately so the queue UI has observable states, and
`ArtAdminPage.tsx` polls the queue every 2000 ms, so the cost is latency rather
than pixels. **That expectation is untested**: the stage is unchanged because
the configs never received the GPU args, not because the GPU failed to help.
Extending the args to those three configs and re-measuring is a small, separate,
falsifiable change. It is not folded in here because bundling an unproven
speed-up with a correctness default would make the gate result mean less.

## 5. Files

`client/playwright.config.ts` · `client/e2e/global-setup.ts` · `tools/ci.sh`
(comment only). No product code, no test assertions, no content, no dist.

## Log
- 2026-07-29 reserved as REQ-0342 on branch req-0342-e2e-gpu-default
  (off master 41f6514).
- 2026-07-29 implemented; T1-T4 verified including a forced-software abort;
  full gate green with E2E_GPU unset; reserved -> built.
