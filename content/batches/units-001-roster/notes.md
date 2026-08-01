# units-001-roster — batch notes

Batch of the first unit-icon roster (REQ-0127). Route: **flux2** (FLUX.2 klein
4B Q8_0 GGUF, steps=4, cfg=1.0, euler), ratified in REQ-0136. Framing: **bust**,
roster-wide (`unit_icon_pipeline.md` v1.1 §3). Matte: rembg `birefnet-general`
with border-key fallback. Render constant 1x1: gen 1024x1024 -> Lanczos ->
target 256x256.

## Generation

- 11 units x 4 candidates = **44 candidates**, seeds 101 / 202 / 303 / 404.
- Gallery: `web/preview/units-001/` (every candidate at 256 px AND 64 px,
  numbered) — https://backpack-dev.qtie.jp/preview/units-001/
- Score filter (`tool_icon_score.py` rule, coverage >= 20%, FILTER ONLY —
  it never picks a winner): **0 auto-FAIL of 44**. Independent re-measure of
  the mattes: coverage 35.5% – 52.8%.

## S7 user review — 2026-07-13: ALL GREEN

Verdict given by the user against the numbered gallery. **Accepted seed per
unit** (the accepted candidate is copied to `selected/<id>.png`, RGBA 256x256):

| unit | accepted seed |
| --- | --- |
| unit-elf | 101 |
| unit-dwarf | 101 |
| unit-thief | 303 |
| unit-angel | 202 |
| unit-shieldmaiden | 202 |
| unit-priest | 101 |
| unit-princess | 303 |
| unit-lightcavalry | 303 |
| unit-berserker | 202 |
| unit-watcher | 202 |
| unit-squire | 303 |

11 of 11 units accepted; no unit needs a regeneration pass.

## Roster cut — unit-necromancer

The user cut **necromancer as a unit** at S7 (not merely its art). It is removed
from the wrapper roster table (the single source of truth), from the regenerated
`unit_defs.json` (12 -> 11 entries), and from the `style_guide.md` roster table.
Its 4 candidates were generated but are deliberately **not committed** — by user
ruling they do not enter the repository. The seed roster is therefore 11 units.

## S7 stop honored

Nothing from this batch enters `content/live/`. Unit def authoring (connection
shape, charge, effects, `i18n.ja`) is out of scope for REQ-0127 and gets its own
REQ (illustration-first: art precedes data).
