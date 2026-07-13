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

| key | ja | kind | note |
|---|---|---|---|
| `queen` | クイーン | ray | 8-direction rays. The pre-pivot Linker default. |
| `rook` | 飛車 | ray | Orthogonal rays. |
| `bishop` | 角 | ray | Diagonal rays. |
| `lance` | 香 | ray | Single forward ray. **Depends on the board orientation 0128b owes.** |
| `knight` | 桂 | offset | Chess-knight fixed offsets. |
| `backward_line` | 後方直線 | ray | Single backward ray. **Same orientation dependency.** |
| `adjacency` | 隣接 | offset | All adjacent cells. |
| `adjacency_lr` | 左右隣接 | offset | **PROVISIONAL** — REQ-0149 Watcher. May instead become an axis parameter on `adjacency`. |
| `forward_1` | 前方1マス | offset | **PROVISIONAL** — REQ-0149 Squire. **Meaningless until 0128b defines "forward".** |
| `none` | 接続なし | none | Unit forms no links. |

## What this REQ deliberately does NOT do

- No engine resolution, no link-graph construction, no client overlays — **REQ-0128b**.
- No semantics. `forward_1` and `lance` and `backward_line` all presuppose a **board
  orientation for Units that has never been defined anywhere in this repo.** The
  dictionary registers the *names*; 0128b owes the *meaning*. This is recorded so the
  gap cannot be lost again.
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
