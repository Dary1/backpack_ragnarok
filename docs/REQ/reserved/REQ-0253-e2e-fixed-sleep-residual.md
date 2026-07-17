# REQ-0253 — e2e fixed-sleep residual: the suite is still wall-clock-bound after REQ-0234 (F3)

**Status:** reserved — evidence recorded 2026-07-18 by the REQ-0222 session; needs owner
triage. Not specced for implementation yet.
**Slug:** e2e-fixed-sleep-residual
**Filed under user directive** (2026-07-18, chat): split F3 out of REQ-0222 into its own REQ.
(The standing 2026-07-16 directive 「こうした方良かったと思う事はREQにしておいてください」 is
quoted in the REQ-0221/0222/0223 headers; it is NOT in PROJECT.md.)

## Why this exists

REQ-0234 identified F3 (wall-clock synchronization makes the suite load-sensitive) and
fixed THE headline item: `waitForAutoSave` now waits for the auto-save PUT response
instead of a fixed 1500 ms sleep (f6ddcb4). That fix is merged and was present in every
run below. It was not enough: the suite is still stochastically red.

## Evidence (2026-07-18, REQ-0222 gate runs, all on req-0222 @ 8d68dbd = master + REQ-0222)

- **QUIET box (loadavg1 4.25): 186 passed / 1 failed.** `long-press-rename.spec.ts:77`
  "a normal (short) click on a tab still switches, and does NOT arm rename":
  `expect(.inv-tab-active).toHaveText("2")` got `"1"` — the short click never switched
  the tab. This is NOT a loaded-box failure; it reds a quiet box.
- **Loaded (loadavg1 9-12): 185 / 2** — `auto-save.spec.ts:27` (`expect(po).toBeTruthy()`)
  and `bp-rotate.spec.ts:82` (`expect(bp.shape).toEqual(...)`). Both GREEN on a solo
  rerun (6/6), i.e. environmental, not regressions.
- **Loaded (loadavg1 up to 36, deliberate 8-way burn): 175 / 12** — same assertion
  signatures (`toBeTruthy`, `toBe`, `toHaveCount`, `toEqual`).
- Same family, different specs each time — the previous session (2026-07-17) recorded
  `long-press-rename` + `reference-model canvasYellow` from the identical pattern.
- NOTE: `auto-save.spec.ts` reds despite the REQ-0234 helper fix. Either the spec does not
  route through `waitForAutoSave`, or the helper's quiet-fallthrough path still races.
  Worth checking first — it is the one place F3 was supposedly already closed.

## Scope of the residual

- **83 `waitForTimeout` call sites across 18 spec files** (`client/e2e/`).
- Helper constants everything funnels through (`client/e2e/helpers.ts`): `drag` = 25 ms
  steps + 150/250 ms settles, `bootApp` = +400 ms, `longPress` = 750 ms hold.
- `longPress` is the sharpest case: the spec distinguishes a SHORT click from a LONG press
  purely by wall-clock, so timing jitter flips the assertion in either direction. An
  event/state-based arming signal is needed, not a longer sleep.

## Why it matters (the concrete cost)

`tools/e2e_known_flaky.tsv` (REQ-0222) deliberately does NOT carry this family, and must
not: its signature is a plain assertion failure, indistinguishable from a real regression.
A registry entry for it would make `tools/e2e_flaky_gate.sh` rerun — and therefore
potentially swallow — genuine regressions, violating the registry's own rule ("Never add a
family to make a red green"). So every occurrence correctly ABORTS the gate. That is the
right behaviour and it is why this REQ, not the flaky registry, is the remedy.

Consequence today: under REQ-0159 ("CI GREEN means LITERALLY green") no branch can reach a
literal-green full suite on demand; REQ-0222's own "full default suite green on quiet AND
loaded box" gate is delegated here for exactly this reason.

## Suggested direction (owner call — not ratified)

1. Start with `auto-save.spec.ts` (F3 was supposed to be closed there) and `longPress`
   (structural: wall-clock is load-bearing for the assertion itself).
2. Replace fixed settles in `helpers.ts` `drag`/`bootApp` with state/event waits
   (`expect.poll`, `waitForResponse`, `toHaveClass`), then sweep the 83 sites.
3. Gate: full default suite literally green N consecutive runs on a quiet box AND under a
   deliberate 8-way CPU burn (REQ-0230's burn recipe).

## Out of scope
- Weakening or deleting assertions; adding this family to `e2e_known_flaky.tsv`;
  raising timeouts (REQ-0222's load-seam already scales them — it does not help here,
  because these failures are ordering/jitter, not timeout).
