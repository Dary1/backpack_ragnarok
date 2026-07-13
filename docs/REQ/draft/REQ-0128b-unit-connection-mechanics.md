# REQ-0128b — unit-connection-mechanics (engine + client)

**Status:** draft — blocked on open decisions 1–3 below (user rulings needed).
Decisions 4 (kits) and 5 (board orientation) are CLOSED.
**Split from:** REQ-0128 (2026-07-13), per the PROJECT.md multi-phase rule. The
**vocabulary half shipped as REQ-0128a** (`content/vocab.json` v9:
`connection_shapes` + `orientation`). This file is the **implementation** REQ the
user asked for: it makes those ten dictionary entries actually do something.
**Slug:** unit-connection-mechanics
**Ordering:** independent of the rename program (user ruling 2026-07-12: this change
"could have happened under the old Linker system"); lands after REQ-0124 so it is
built in the new vocabulary.

## Background (user decisions, 2026-07-12)

Connections move from always-queen 8-direction beams to **per-unit connection
shapes**. Ratified rules:

- Links are **Unit-to-Unit**.
- Ray-type connections keep the **first-hit rule** (first Unit on the ray).
- One-sided connections are valid; mutual links remain possible.

## The dictionary this REQ implements (REQ-0128a, `vocab.json` v9)

Engine compass, `mock-src/engine.js:571` — `[row, col]`, row increases **downward**:
`DIRS = {0:N[-1,0], 1:NE, 2:E[0,1], 3:SE, 4:S[1,0], 5:SW, 6:W[0,-1], 7:NW}`

**Board orientation — RULED 2026-07-13 (user):** 前方 = the battlefield cell with the
**LOWER Y**, i.e. **up**. Reconciled: **forward = row − 1 = `DIRS[0]` = N.**

| shape | ja | resolution |
|---|---|---|
| `queen` | クイーン | rays `dirs [0..7]` |
| `rook` | 飛車 | rays `dirs [0,2,4,6]` |
| `bishop` | 角 | rays `dirs [1,3,5,7]` |
| `lance` | 香 | ray `dirs [0]` (forward) |
| `backward_line` | 後方直線 | ray `dirs [4]` (backward) |
| `knight` | 桂 | offsets, 8 chess-knight cells |
| `adjacency` | 隣接 | offsets `[-1,0] [0,1] [1,0] [0,-1]` — **see decision 2** |
| `adjacency_lr` | 左右隣接 | offsets `[0,-1] [0,1]` — REQ-0149 Watcher |
| `forward_1` | 前方1マス | offset `[-1,0]` — REQ-0149 Squire |
| `none` | 接続なし | no links |

## Scope

- **Engine.** Connection resolution in the sim:
  - **ray** shapes — reuse the shipped beam machinery (REQ-0048/0079 `traceBeams`,
    which already walks `DIRS` and already implements first-hit). The existing
    `bp.linker.dirs` path is the ancestor of `queen`; generalise it to read
    `connection_shape` from the unit def.
  - **offset** shapes (`knight`, `adjacency`, `adjacency_lr`, `forward_1`) — new.
    Fixed-cell lookup, no ray walk, no occlusion.
  - Link-graph construction; mutual-link detection.
  - **Rotation.** `rotateBP` already rotates `linker.dirs` by `+2 (mod 8)` under the
    `[r,c] -> [c,-r]` transform (engine.js:230-256). Ray shapes inherit this for free.
    **Offset shapes must rotate too** — `knight`, `adjacency_lr` and `forward_1` are
    all rotation-sensitive, and `forward_1` interacts with the orientation ruling.
    This is the sharpest new edge in the REQ; it needs its own tests.
- **Client.** Connection visualization overlays: shape preview on placement,
  established-link rendering. Overlay art is **data-driven** (unit icon golden G2 —
  never baked into icons).
- **Content schema.** `connection_shape` field on unit defs (schema only; def
  authoring is REQ-0130 / REQ-0149 territory).

## Open decisions (need user rulings before this can move to todo)

1. **Ray occlusion.** Old Linker beams passed over everything until the first Linker.
   Keep that (recommended: preserves first-hit semantics), or let BPs/POs block rays
   shogi-style (deeper P1, worse P2 legibility)?
2. **Knight / adjacency targeting.** `knight` = the exact target cell must contain a
   Unit (consistent with Unit-to-Unit)? `adjacency` = **unit-cell** adjacency, or
   **BP-footprint** adjacency? The Watcher's design note — *"you just drop it beside a
   tall or wide odd-shaped backpack and it does its job"* (REQ-0149 §2.11) — reads
   like **BP-footprint**, which would also change what `adjacency_lr` means. The
   dictionary currently assumes unit-cell. **This ruling changes the Watcher's kit.**
3. **Field scope.** Do connections resolve canvas-local (within one Squad) only, or
   may they cross Squad zones on the shared battle field?
4. ~~Per-unit kit ratification~~ — **CLOSED.** Kits live in REQ-0149; this REQ ships
   mechanics, not kits.
5. ~~Board orientation~~ — **CLOSED 2026-07-13** (user): forward = lower Y = up =
   `DIRS[0]` = N. Recorded in `vocab.json.orientation`.

## Rescued prior art (from REQ-0061, 供養 2026-07-12)

The pulse-walk law set of REQ-0048/0061 is the deterministic baseline this REQ must
either ADOPT for Unit Links or EXPLICITLY RETIRE, law by law — **silence is not
allowed**: `PULSE_CAP`; the visited-set; the hop budget. (REQ-0149 G6 — the
Berserker's uncapped +0.1%/stack — is the live instance of why `PULSE_CAP` exists.)

## Gates

- Every one of the 10 `connection_shapes` resolves in the engine, with unit tests per
  shape (rays, offsets, first-hit, one-sided vs mutual).
- **Rotation tests for offset shapes** — `knight`, `adjacency_lr`, `forward_1` under
  all four BP rotations.
- The REQ-0061 law set is adopted or retired law by law, in writing.
- Client overlay renders each shape; no shape is ever baked into an icon.
- Engine tests + vocab self-test green; e2e green (via `pnpm run e2e` / `tools/e2e_run.sh`).
- No def authoring in this REQ.
