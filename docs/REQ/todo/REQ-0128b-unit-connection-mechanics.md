# REQ-0128b — unit-connection-mechanics (engine + client)

**Status:** todo — **all five open decisions are CLOSED** (user rulings 2026-07-13).
Ratified and cleared to implement.
**Split from:** REQ-0128 (2026-07-13), per the PROJECT.md multi-phase rule. The
vocabulary half shipped as **REQ-0128a** (`content/vocab.json`: `connection_shapes`,
`connection_model`, `orientation`). This file makes those entries do something.
**Slug:** unit-connection-mechanics
**Ordering:** independent of the rename program (user ruling 2026-07-12); lands after
REQ-0124 so it is built in the new vocabulary.

## The model (REQ-0128a, ratified 2026-07-13)

Engine compass, `mock-src/engine.js:571` — `[row, col]`, row increases **downward**:
`DIRS = {0:N[-1,0], 1:NE, 2:E[0,1], 3:SE, 4:S[1,0], 5:SW, 6:W[0,-1], 7:NW}`

**Board orientation:** 前方 = the battlefield cell with the **lower Y** (up)
→ **forward = row−1 = `DIRS[0]` = N.**

**Every shape is `{dirs, range, pierce}`.** `adjacency` is not a concept — it is a ray
with `range: 1`. `knight` is the sole offset shape (it jumps).

| shape | ja | dirs | range | pierce |
|---|---|---|---|---|
| `queen` | クイーン | `0-7` | ∞ | false |
| `queen_2` | クイーン(射程2) | `0-7` | **2** | false |
| `rook` | 飛車 | `0,2,4,6` | ∞ | false |
| `bishop` | 角 | `1,3,5,7` | ∞ | false |
| `lance` | 香 | `0` | ∞ | false |
| `backward_line` | 後方直線 | `4` | ∞ | false |
| `adjacency` | 隣接 | `0,2,4,6` | 1 | false |
| `forward_1` | 前方1マス | `0` | 1 | false |
| `knight` | 桂 | *(jumps)* | — | true |
| `none` | 接続なし | — | 0 | — |

## Rulings (user, 2026-07-13) — the five decisions, closed

1. **Ray occlusion — rays do NOT pierce.** A ray is stopped by an occupied cell. This
   **reverses the old Linker beam behaviour** (which passed over everything until the
   first Linker), so `traceBeams` must gain an occlusion mode — it is not a drop-in.
   `pierce` is a **field from day one** so a future piercing shape is a *data* change,
   not an engine change (*"あとで貫通するものが出るかもしれません"*).
2. **`adjacency` = a range-limited ray**, not an offset concept. This **deletes the
   whole offset-shape category** (and with it the unit-cell vs BP-footprint question,
   and the separate offset-rotation machinery). Only `knight` survives as an offset.
3. **Scope: canvas-local** — connections resolve within one Squad only.
4. **Kits** — not here. REQ-0149 owns them.
5. **Board orientation** — forward = lower Y = up = `DIRS[0]` = N.

## Scope

- **Engine.** Connection resolution in the sim:
  - **One walker for every shape.** `{dirs, range, pierce}` — step along each `dir`,
    stop after `range` cells (`null` = to the board edge), stop at an occupied cell
    unless `pierce`. Link if the landed cell holds a Unit (Unit-to-Unit).
  - `knight` — fixed-offset lookup, no walk, no occlusion.
  - Link-graph construction; mutual-link detection; one-sided links are legal.
  - **Occlusion:** what occupies a cell for the purpose of stopping a ray — any BP/PO
    cell, or only Units? The ruling says "does not pierce"; the *occluder set* is an
    implementation detail this REQ must state explicitly in code and tests, and it must
    be the same set the client overlay draws. **Do not leave this implicit.**
  - **Rotation.** `rotateBP` already rotates `linker.dirs` by `+2 (mod 8)` under the
    `[r,c] -> [c,-r]` transform (engine.js:230-256), so **every ray shape rotates for
    free** — a direct benefit of ruling 2 collapsing offsets into rays. **`knight`
    still needs its own rotation** (its 8 offsets are rotation-sensitive).
  - `range` is invariant under rotation; only `dirs` rotate.
- **Client.** Connection overlays: shape preview on placement, established-link
  rendering, and **the occlusion must be visible** — an opaque ray that silently stops
  behind a BP is a P2 disaster if the UI does not show where it died. Overlay art is
  data-driven (unit icon golden G2 — never baked into icons).
- **Content schema.** `connection_shape` on unit defs (schema only; def authoring is
  REQ-0130 / REQ-0149).

## Consequences flagged to other REQs

- **REQ-0149 Watcher — RESOLVED 2026-07-13.** Flagged as a range-1 problem; the user
  rerouted the kit to **`queen`, range 2**. `adjacency_lr` was removed from the
  dictionary (orphaned).
- **⚠ The same problem applies to the Squire (`forward_1`, range 1)** — it links only
  if a Unit sits in the single cell directly in front. Raised in REQ-0149; **not fixed
  by inference.**
- **Ray occlusion reverses shipped behaviour.** Any existing content or test that
  relies on beams passing over BPs/POs will change meaning. Audit before implementing.

## Rescued prior art (from REQ-0061, 供養 2026-07-12)

The pulse-walk law set of REQ-0048/0061 is the deterministic baseline this REQ must
either ADOPT for Unit Links or EXPLICITLY RETIRE, law by law — **silence is not
allowed**: `PULSE_CAP`; the visited-set; the hop budget. (REQ-0149 G6 — the Berserker's
uncapped +0.1%/stack — is the live instance of why `PULSE_CAP` exists.)

## Gates

- One walker implements all nine ray shapes from `{dirs, range, pierce}` — no
  per-shape special cases except `knight`.
- Unit tests per shape: rays, range limits, **occlusion**, `pierce` (via a test-only
  piercing shape, proving the flag works before a real one needs it), first-hit,
  one-sided vs mutual links, canvas-local scope.
- **Rotation tests:** all ray shapes under all four BP rotations, plus `knight`.
- The occluder set is stated explicitly and matches what the client overlay draws.
- The REQ-0061 law set is adopted or retired law by law, in writing.
- Engine tests + vocab self-test green; e2e green (`pnpm run e2e` / `tools/e2e_run.sh`).
- No def authoring in this REQ.
