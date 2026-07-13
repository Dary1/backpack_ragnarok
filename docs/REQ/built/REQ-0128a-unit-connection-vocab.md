# REQ-0128a — unit-connection-shape vocabulary (dictionary)

**Status:** built — `content/vocab.json` v9 carries `connection_shapes`; vocab
self-test ALL GREEN, engine tests 101/101. Not merged/deployed.
**Split from:** REQ-0128 (2026-07-13), per the PROJECT.md multi-phase rule.
**Slug:** unit-connection-vocab

## Why this is its own REQ

User ruling, 2026-07-13: *"飛車、角等はとりあえず辞書として登録してください。
実装はREQを作って別にしましょう。"* — register the shape names as a dictionary
now; the mechanics ship separately. The two phases can hold different statuses,
so they are two files. Mechanics = **REQ-0128b**.

## What shipped

`content/vocab.json` **v8 → v9**, new top-level key `connection_shapes` (10
entries), plus a `provenance` entry. **Dictionary only — nothing is wired to the
engine.** The validator can now recognise a `connection_shape` value; it cannot
yet resolve one.

| key | ja | dirs | range | pierce |
|---|---|---|---|---|
| `queen` | クイーン | `0-7` | ∞ | false |
| `rook` | 飛車 | `0,2,4,6` | ∞ | false |
| `bishop` | 角 | `1,3,5,7` | ∞ | false |
| `lance` | 香 | `0` (N/forward) | ∞ | false |
| `backward_line` | 後方直線 | `4` (S) | ∞ | false |
| `adjacency` | 隣接 | `0,2,4,6` | **1** | false |
| `adjacency_lr` | 左右隣接 | `2,6` (E/W) | **1** | false |
| `forward_1` | 前方1マス | `0` (N) | **1** | false |
| `knight` | 桂 | *(offsets — jumps)* | — | true |
| `none` | 接続なし | — | 0 | — |

## The shape model collapsed — user ruling 2026-07-13

> *"adjacency は、隣接としてとらえるのではなく、ray の距離が1しかない、2しかないと判断してください"*

**`adjacency` is not a concept. It is a ray with a range limit.** That one ruling
deletes the entire "offset shapes" category the earlier draft invented — and with it
the `adjacency` vs `BP-footprint-adjacency` question, the separate offset-rotation
machinery, and two of the three "PROVISIONAL" flags.

Every shape is now **`{dirs, range, pierce}`**:
- `range`: `null` = unlimited, `N` = the ray reaches **at most N cells**.
- `pierce`: `false` by default — **rays do NOT pass through** (user ruling). The field
  exists from day one so a future piercing shape is a **data** change, not an engine
  change (*"あとで貫通するものが出るかもしれません。どちらでもよいようにしておいてください"*).

**`knight` is the sole survivor of the offset category** — it *jumps*, so occlusion
cannot apply to it, and it cannot be written as `{dirs, range}`. It is marked
`pierce: true` for exactly that reason.

**Scope:** connections resolve **canvas-local** (within one Squad) — user ruling.

## What this REQ deliberately does NOT do

- No engine resolution, no link-graph construction, no client overlays — **REQ-0128b**.
- No engine wiring. The dictionary now carries concrete `dirs` / `offsets` for every
  shape, but **nothing reads them yet** — resolution, the link graph and the overlays
  are all REQ-0128b.

## Board orientation — RULED 2026-07-13 (this REQ raised it; the user settled it)

The directed shapes (`lance`, `backward_line`, `forward_1`) presupposed a board
orientation for Units that **had never been defined anywhere in this repo** —
`backward-line` shipped in the ratified vocabulary carrying the assumption unexamined.

**User ruling: 前方 = the battlefield cell with the LOWER Y — i.e. up.**

Reconciled against the engine, which is `[row, col]` with **row increasing downward**
and an 8-point compass `DIRS[0] = [-1,0] = N` (`mock-src/engine.js:571`):

> **forward = row − 1 = `DIRS[0]` = N.**

Recorded in `vocab.json` as a top-level `orientation` key so it cannot be lost again.
All ten shapes now have concrete `dirs` / `offsets`.
- No def authoring — REQ-0149 / REQ-0130.

## Gates

- [x] `connection_shapes` registered in `content/vocab.json` (v9).
- [x] `node tools/self_test_vocab.cjs` — ALL GREEN, 0 failures.
- [x] `node mock-src/tests/run.cjs` — 101 passed, 0 failed.
- [ ] Merged to master.

## Outcome

Vocabulary registered as a dictionary, per the user's ruling, without pretending the
semantics are settled. The two provisional shapes (`adjacency_lr`, `forward_1`) exist
because the REQ-0149 roster demands them — they are flagged as demands on 0128b rather
than silently given a meaning.
