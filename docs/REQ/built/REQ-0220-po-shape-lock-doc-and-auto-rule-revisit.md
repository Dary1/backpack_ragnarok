# REQ-0220 — po-shape-lock-doc-and-auto-rule-revisit: fix misleading lock docs; re-decide auto's rule for full rectangles

**Status:** done — merged to master, deployed, live-verified (2026-07-17).
**Reserved:** 2026-07-16
**Ruled:** 2026-07-17 (user)
**Slug:** po-shape-lock-doc-and-auto-rule-revisit
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」. The proposal below was the agent's; the ruling in "Decision" is
the user's. This is the follow-up REQ that REQ-0187's verdict named.

## Why (REQ-0187 S7 verdict, V2 = AMBER)

REQ-0186 defaulted `shape_lock=auto`, resolving to `off` for full-rectangle footprints, on the
stated basis that strict "flattens the heater shield into a plain disc" — i.e. off preserves
subject character on rectangles. REQ-0187 tested exactly this on a 2x2 `round shield`
(3 seeds off, 3 seeds strict via one-shot override) and the pictures do NOT support the basis:

- strict OUT-FIT off (median fit 81.3 vs 71.8, worst-cell 0.21 vs 0.32, 3/3 PASS both), AND
- strict KEPT full subject character (boss/rim/planks visible) — it did not flatten anything;
  off merely produced heater silhouettes that underfill the square.

Evidence: `content/batches/req0187-shape-conditioning/findings.json` + the six illustrative
renders committed there; verdict tables in `docs/REQ/done/REQ-0187-po-shape-conditioning-s7-verification.md`.

The awkward half of auto's rule HELD (L-tromino: strict 68.3 vs off 32.5 median fit, off spilled
123 px deep-overflow) — nothing here questions auto→strict for non-rectangles.

## The cost argument also failed (found during implementation, 2026-07-17)

This REQ was drafted proposing that the owner could legitimately keep auto→off on cost grounds:
"off is cheaper: 15-50 s vs 76-130 s per render", citing V5. **That is wrong, and the draft was
wrong to offer it.** Those numbers are REQ-0153's — measured on the SPIKE route, which ran
matting co-resident on the GPU. REQ-0187 line 68 cites them only as the budget it set out to
confirm; REQ-0187's actual V5 measurement on the PRODUCTION route found the gap has since closed:

| route / lock                      | wall time (warm) | source                |
|-----------------------------------|------------------|-----------------------|
| spike, conditioned                | 76-130 s         | REQ-0153              |
| spike, plain                      | 15-50 s          | REQ-0153              |
| **production, conditioned 512x512** | **~60-150 s**  | REQ-0187 V5 (19 renders) |
| **production, plain off 512**       | **~90-120 s**  | REQ-0187 V5           |

The production ranges OVERLAP: there is no measured 2-5x asymmetry to defend. The reason is in
V5's own text — the production route runs matting as a separate CPU inspection job rather than
co-resident on the GPU (which is also why VRAM peak fell to ~5.5 GB from the spike's 6.7-6.8 GB).

So on a full rectangle, off lost on pictures (REQ-0187) and has no cost advantage (V5). Both of
its arguments were gone. Keeping auto→off would have required inventing a third rationale —
which is the exact failure mode this REQ exists to correct.

## Decision (user ruling, 2026-07-17)

**`auto` = strict on EVERY po shape.** The shape-dependent split is retired.

The user was presented with: keep auto→off as an admitted aesthetic preference; flip auto→strict;
or gather more rectangle evidence first. Ruling: **flip to strict** — the option the measurements
support, on both halves of the rule.

`auto` is KEPT as a distinct stored value (rather than migrating every artwork to `strict`), so a
future shape-dependent rule can re-enter `resolve_lock()` without a data migration or a caller
change. An operator who wants `off` on a given item sets the lock explicitly, or uses the
one-shot per-render override — which REQ-0187 V4 verified works and does not mutate the artwork.

## What was done

1. **Rule (`tools/art_shape.py`)** — `resolve_lock()` returns `strict` for `auto` on every shape.
   `fills_bounding_box()` deleted: it existed solely as the basis of the retired split, and its
   docstring asserted it. `mask` stays in `resolve_lock`'s signature (unused) to keep the seam
   and the callers stable. Python resolution is the single chokepoint — no JS duplicate exists
   (verified: no `resolveLock`/`fillsBoundingBox` in client/ or server/).
2. **Operator strings (`client/src/artadmin/artShared.ts`)** — `SHAPE_LOCK_HELP.auto` now states
   the real rule; `strict` no longer claims a generic legibility cost ("at some subject
   legibility") but reports what was measured: keeps subject detail on a 2x2 and out-fit off
   there (81 vs 72), reads a little abstract on L/T (REQ-0187's T-hammer note). The `off`/`guide`
   blurbs were already honest (REQ-0187 V3 = GREEN) and are untouched.
3. **Docs (`docs/llm_managed/item_content_pipeline.md`)** — §0.1 status line records
   `auto` = strict everywhere, plus a blockquote recording WHY the split died, with both
   refutations (pictures + cost) and their sources, so the disproven claim cannot quietly return.
4. **Regression guard (`server/tests/artwork_test.cjs`)** — the REQ-0186 auto-lock test flipped
   to assert `auto`→strict on the 2x2 (params + the edit-instruction prompt + default dilation),
   and is renamed to REQ-0220. The L half is unchanged and still asserts strict.

## Gates

- **`resolve_lock` behaviour (server-side):** auto→strict on L-tromino / 2x2 / 1x3 / T-tetromino;
  explicit `off`/`guide`/`strict` still honoured over auto; `None`→strict via the default path;
  bogus lock still raises. PASS.
- **`artwork_test.cjs` (pg backend, isolated namespace, ART_ROUTE_MOCK=1):** **11 passed, 0
  failed** — including `REQ-0220 auto lock: strict on EVERY shape` and the untouched
  `REQ-0186 explicit locks + one-shot override + validation`. PASS.
  (Pre-existing, unrelated: inspection kits log `No module named 'numpy'` under the default
  python; ci.sh passes `ART_KIT_PYTHON` pointing at the venv. Not a regression from this REQ.)
- **Client `tsc -b`:** exit 0. **oxlint** on the touched file: 0 warnings, 0 errors. PASS.
- **artadmin e2e (`tools/artadmin_e2e.sh`, REQ-0156 G2, post-rebase, per-REQ lock):**
  **7 passed, rc=0** — including `REQ-0191 cell backdrop (po renders draw over their
  footprint)` and `REQ-0216 true-scale thumbs`, the two po-rendering specs. PASS.
  First attempt on the same tree reported 2 failed / 5 passed; both were `page.goto:
  Timeout 20000ms` on the FIRST navigation (one of them on an `si` artwork, a kind this
  REQ cannot affect), under load 23 with a concurrent admin harness on the box. Re-run on
  a quieter box: all 7 green, same commit. Flake, not a regression — and precisely REQ-0234's
  audit finding F3 (wall-clock synchronisation + `retries:0` turns load into a red run).
- **A/B on one rectangle:** already satisfied by REQ-0187's 6 renders on the 2x2 `round shield`
  (3 off / 3 strict, same production route, same params, dilation 8, fit-meter v5): strict 3/3
  PASS median 81.3 vs off 3/3 PASS median 71.8, deep_overflow 0 on both. The rule now ships the
  arm that WON that A/B, so "no regression" is the measurement itself, not a prediction. No new
  GPU time was spent; re-running it would only reproduce `findings.json`.

## The e2e gate + the rebase (2026-07-17)

The artadmin e2e gate could not run on this REQ's original base, and the reason is worth
recording because it is not specific to REQ-0220.

The worktree was cut from master at `dd031d8`. While this REQ was being implemented, master
advanced **79 commits**, including `5e0703a` (REQ-0217 hermetic e2e) and `6cebf8a` (REQ-0234:
admin harnesses take **per-REQ locks**, `~/.cache/backpack/e2e.<req>.lock`, instead of the box
lock). Since the 2026-07-17 incident, a systemd user unit (`backpack-e2e-freeze`) holds
`~/.cache/backpack/e2e.box.lock` **indefinitely** on purpose, because the pre-0217 harness
reads/writes the LIVE dev profile, live content and the live api. See
`~/.cache/backpack/E2E_FREEZE_README.txt`.

So a pre-0217 worktree's `artadmin_e2e.sh` queues on a lock that is never released. Two
attempts stalled and died on their own timeouts (rc=124) — not a test failure, and not box
load (the box did hit load 46-67 from three concurrent sessions, which masked the real cause
for a while). The freeze was doing exactly its job: it stopped an old-harness run from
touching live state.

**Fix: rebased the branch onto master** (`6d0e3a0`). Master had touched **none** of this REQ's
six files, so the rebase was conflict-free, and `auto`->`off` was still present on master, so
the change still applies. On the rebased tree `artadmin_e2e.sh` takes `e2e.0156.lock` and
never reaches the frozen box lock. `artwork_test` was re-run on the new base: still 11/11.

Residual friction (NOT fixed here, belongs to REQ-0236 / REQ-0231): `artadmin_e2e.sh` derives
its ports from REQ-**0156** whatever worktree runs it, and the port preflight happens BEFORE
the per-REQ lock is taken. So two worktrees running the admin harness collide at bringup and
the loser exits 75 instead of queuing behind the lock that exists precisely to serialise them.
Observed live against `req-0232-artadmin-backdrop-legend`. The lock and the ports disagree
about what they are protecting.

## Out of scope
- Any change to strict/guide mechanics; monster/si/unit shapes; re-running the matrix.
- Retiring the `auto` value itself, or migrating stored `auto` rows to `strict`.

## Follow-ups this surfaced
- REQ-0186 (`done/`) and REQ-0187 line 68 still carry the spike-vs-production cost confusion in
  their prose. They are history and are left as written; the live surfaces (§0.1, the lock
  strings, `resolve_lock`'s docstring) now carry the corrected account. If any future REQ quotes
  "76-130 s vs 15-50 s" as a live cost, it is quoting the spike route.
- One shield remains one rectangle-subject data point. The ruling is that strict wins on the
  evidence available and off stays one explicit click away; a future REQ wanting the split back
  needs rectangle-subject evidence, not a rationale.

## Deploy (2026-07-17, user go-ahead "merge and deploy")

Rebased onto master twice during this REQ — master moved 79 commits, then a further 15 while
the ruling was being discussed. Both rebases were conflict-free (master never touched any of
this REQ's six files), and `artwork_test` was re-run green on each new base. Merged
**fast-forward** (no merge commit): `14215df` -> `9274da6`.

**No service restart was needed, and none was performed.** Established rather than assumed:
- `backpack-web` is `python3 -m http.server --directory ~/backpack_ragnarok/web` — it serves
  the docroot from disk, so a rebuilt bundle is live as soon as it lands.
- `backpack-api` **spawns** `tools/art_job.py` per job (`spawn`, art_jobs.cjs), so the next
  generation reads the new `art_shape.py`. Nothing about the rule is held in api memory.
This matters: REQ-0233 records that a `backpack-api` restart kills the in-flight art queue.
Not restarting avoided that hazard entirely. (ComfyUI's queue was empty at deploy time anyway.)

Deploy commit `9dfd9cf` — rebuild client dist. Only `web/app` was staged; unrelated untracked
leftovers in the main checkout (`content/art/`, `content/registry_exports/`, older stray
assets) were left alone.

**Live verification**
- `backpack-web` :8801 serves `assets/index-BteqOqyq.js`, which contains the new `auto` blurb
  ("strict on every shape") and **zero** occurrences of the retired rule string or the
  disproven "at some subject legibility" claim.
- api :8802 -> HTTP 200; public tunnel https://backpack-dev.qtie.jp/app/ -> HTTP 200;
  `backpack-api` / `backpack-web` / `backpack-tunnel` all active.
- `resolve_lock` in the DEPLOYED main checkout: auto -> strict on 2x2, 1x3, L and T;
  explicit `off` on a 2x2 still returns `off` (the operator's opt-out survives).

Not re-proved with a live GPU render: that would only re-exercise `resolve_lock` at the cost
of 60-150 s on the shared card plus a live artwork row. The full job path (queue ->
art_job.py -> art_shape.py -> recorded params + final_prompt) is covered by artwork_test's
REQ-0220 case, and the rectangle A/B is REQ-0187's six committed renders.
