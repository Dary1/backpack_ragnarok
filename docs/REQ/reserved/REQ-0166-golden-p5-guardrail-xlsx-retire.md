# REQ-0166 — golden P5 guardrail + formation.xlsx retirement

**Status:** built — applied on branch; awaiting merge.
**Reserved:** 2026-07-14
**Slug:** golden-p5-guardrail-xlsx-retire
**Follows:** REQ-0165 (user_managed doc audit) — the two items that REQ-0165
deliberately left to the user.

## Trigger

User, 2026-07-14 chat, on REQ-0165's two open questions: **"game_golden追記で。
formation.xlsx は削除で。"** The user_managed edit authorization from REQ-0165 carries
over to this REQ (PROJECT.md's standing no-edit rule on `docs/user_managed` is
otherwise unchanged).

## Applied

1. **`docs/user_managed/game_golden.md`** — the pivot-session guardrail is added as a
   sub-bullet under **P5: The Unreplicable Self**:

   > A Unit is the vessel; strength always derives from the pack's contents and
   > arrangement, never from the Unit alone.

   This is the design law that keeps the Unit/Squad pivot from turning the game into a
   character-collector: a Unit contributes identity and connection topology, never raw
   power. It belongs in the pillars, not in a spec.

2. **`docs/user_managed/formation.xlsx` — DELETED** (`git rm`). It was the origin of the
   `J11:Q19` row-19 overrun that `backpack_battle_spec.md` carried as a "likely sheet
   error" for months, and it still used pre-pivot Unit1–Unit4 labels. Keeping a stale
   binary that no code reads is a standing trap.

   **Sole authority for formation data is now `content/live/dungeon/formations.json`**
   (mirrored byte-for-byte by `sim/lib/formation.cjs`, which asserts every box is 8×8 at
   load time). The file is recoverable from git history if ever needed.

3. **`docs/user_managed/backpack_battle_spec.md`** — the `source:` field no longer names
   the sheet; it names `formations.json` and records the retirement. formation4's
   `resolved_data_issue` note updated to match.

4. **`docs/llm_managed/user_managed_rename_suggestions.md`** — §5 rewritten from "fix or
   demote the sheet" to "RETIRED (REQ-0166)".

## Gates

- `docs/user_managed/` contains no `.xlsx` and no reference to `formation.xlsx` outside
  the retirement note.
- `backpack_battle_spec.md`'s YAML block still parses; formation4 still reads `J11:Q18`.
- Docs-only change: no source file touched, no code gate applies, no service restart.
