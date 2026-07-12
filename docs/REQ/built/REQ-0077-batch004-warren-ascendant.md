# REQ-0077: Batch-004 — "The Warren Ascendant" (starter bestiary, 10 enemies)

> **Status update 2026-07-09 — S7 reviewed (approved), S8 paused mid-flight,
> split into two follow-up REQs. Moved back to `built/` (was found sitting
> in `done/`, apparently moved there before S8 actually happened — see
> below; `done/` per PROJECT.md's own policy means "merged, deployed, and
> accepted (live)," which this REQ is not yet).** User asked this session
> to perform the S7 sign-off ("レビューOKしたつもりでした。あなたが代わりに
> できますか？"). Reviewed `notes.md` (all 3 revisions), `enemies.json`/
> `skills.json` structurally cross-checked against the notes, and the live
> preview (restored after an incidental stash side-effect; HTTP 200, 10/10
> enemy cards + art rendering). **Verdict: approved**, all open items (art
> field, `cooldown_role`/`pair` fields, rarity casing, footprint scale vs.
> batch-002, empty items/entities, minimal dungeon.json, not in
> `registry.json`) accepted as-is or already correctly deferred as future
> work per the notes' own framing.
>
> One item was NOT waved through unilaterally: `on_hp_below`'s re-opening of
> `combat_spec_draft.md`'s **[LOCKED OQ2]** ("dynamic buffs = minimal").
> User's ruling: accept, and widen the proposed `EnemySkill`-only domain to
> `["PO", "EnemySkill"]` (see REQ-0121).
>
> Attempting S8 ("merge into `content/live/`") immediately surfaced that
> this instruction was based on a mistaken premise: **no such enemy merge
> point exists.** `content/live/` has no enemy/skill/dungeon file or
> promotion path; the live game is hardcoded to
> `content/batches/batch-002-dungeon-pilot/` in exactly two places
> (`server/services/core.cjs`, `sim/dungen.cjs`), which also doubles as the
> real dungeon layout (traps/doors/chest/rewards) and a live item overlay —
> not just an enemy roster. Naively swapping the hardcode to batch-004
> would have **downgraded the live game** (batch-004 has no real
> `dungeon.json`/`items.json` of its own — deliberately, per this REQ's own
> scope). Flagged to the user rather than silently worked around or
> silently skipped.
>
> **User's call: stop here.** Two follow-up REQs filed and queued in
> `todo/` rather than continuing ad hoc:
> - **REQ-0121** — sim implementation for `buff_self`/`damage_reduction`/
>   `on_hp_below` (currently authored but functionally inert — will render
>   in previews/tooltips but do nothing in actual combat until this lands;
>   `status_immune`/`bonus_vs_status`, the other two REQ-0077 Rev.2 verbs,
>   are ALREADY implemented and live via REQ-0093).
> - **REQ-0122** — dynamic enemy/dungeon content loading, i.e. retiring the
>   batch-002 hardcode so batch-004 (or any future batch) can actually
>   become playable, not just previewable. Explicitly scoped as "build the
>   pipe," not "also pour batch-004 through it."
>
> `content/batches/batch-004-warren-ascendant/` and the related vocab/tool
> changes remain uncommitted, parked at `stash@{0}` on the main checkout
> (`~/backpack_ragnarok`) — see REQ-0093's own file for the exact stash
> message. This REQ moves back to `todo/` (or straight to a fresh S8
> attempt) once REQ-0121 and/or REQ-0122 land.

> Renumbered 2026-07-07 from a mistaken "REQ-0075" (this session claimed 0075 without
> re-reading PROJECT.md fresh; a concurrent/other session had, on the same day,
> already renumbered its own redesign-dex-port REQ to 0075 and workshop-port to 0076).
> `docs/REQ/REQ-0075-batch004-warren-ascendant.md` is the dead duplicate — content
> replaced with a pointer to this file, safe to delete.

- **Status**: S1 drafted (Rev.2 adds 10 passive/reactive skills + 4 new verbs/1
  new trigger, pending sign-off), preview live, **awaiting S7 user review**
- **Date**: 2026-07-07
- **Owner**: orchestrator (Sonnet, this session) + Content Designer (Opus 4.8, S1 draft)
  + Pipeline research (Sonnet subagent: server/vocab archaeology; Sonnet subagent:
  Backpack Hero genre research)

## What was built
- `content/batches/batch-004-warren-ascendant/` on the server: `enemies.json` (10
  entries), `skills.json` (13 entries), `items.json` (0, empty by design),
  `entities.json` (0, empty by design), `formations.json` (4 entries, reused verbatim
  from batch-002 — system-level geometry, not new design), `dungeon.json` (5-step
  illustrative encounter sequence), `notes.md` (full per-monster design rationale +
  flagged open items).
- Preview live: **https://backpack-dev.qtie.jp/preview/batch-004/** via
  `tools/build_dungeon_preview.py` (confirmed render: 10 enemies, 13 skills, 0
  entities, 4 formations, 5 encounter steps; HTTP 200).

## Selection
10 of 95 monsters from `content/proposals/monster_footprint_manifest.json` (the
user-curated tier gallery at `/preview/monster_images_samples/`), spanning tier 0
through tier 5: green_slime, goblin, skeleton, orc, dire_wolf, lich (`lich_2.png`),
minotaur, ogre, griffin, behemoth (`behimoth.png`). Footprints taken verbatim from the
manifest (already fit-checked against the 26x18 field; not re-derived).

## Process notes
- **No enemy schema validator exists anywhere in the project** (confirmed by direct
  server inspection: no `tool_validate.cjs` at all; no enemy-kind support in
  `shared/content_validate.cjs`, `tool_integrate.cjs`, or `tool_gen_data.cjs`) — this
  batch was checked by hand against `content/vocab.json` and batch-002's real
  `enemies.json`/`skills.json` shape instead of a script gate. Same caveat batch-002
  itself carries.
- S1 drafting delegated to an **Opus 4.8** subagent per `content_pipeline.md` §4;
  orchestrator handled the S0 brief (monster/tier selection, rarity curve, role
  assignment) and S6/S8-adjacent assembly + QA — including fixing a schema-key
  mismatch in the Opus draft (`"enemies"`/`"skills"` array keys → corrected to
  `"entries"` per the real batch-002 precedent, which my own S0 brief had failed to
  spell out explicitly).
- `content/vocab.json` (v5) and batch-002's real `enemies.json`/`skills.json`/
  `formations.json` were fetched live via SSH (`qtie@192.168.0.6` — **`ssh.qtie.jp`
  is Cloudflare-proxied and does not carry port 22; the direct LAN IP is required**,
  matching this doc's own Infrastructure note; confirmed empirically this session).
- Genre research (Backpack Hero wiki, via a Sonnet subagent) informed design choices
  — debuting a new status (Poison) on the cheapest enemy, pairing same-tier monsters
  as deliberate mechanical opposites, reserving Stun exclusively for the boss —
  translated into the **existing closed vocab only**; no new triggers/verbs/statuses
  introduced.

## Open items (full detail in notes.md)
1. New `"art"` field on every enemy entry — **proposal, needs sign-off** (no enemy
   ever had this field before; also **not rendered** by the current preview tool —
   `build_dungeon_preview.py`'s enemy cards have no `<img>` support yet, so the
   gallery shows stats/skills/telegraphs only, not the actual artwork).
2. `rarity` casing (lowercase `common/uncommon/rare/relic` vs. `vocab.json`'s
   Title-case canonical list) — **pre-existing unresolved inconsistency**, flagged
   again (not introduced by this batch).
3. Footprint scale vs. batch-002 is much larger (the new tier system derives
   footprint from measured art content-aspect per tier; batch-002 used ad hoc hand
   sizes). HP/damage numbers here are internally consistent within this batch only —
   no cross-batch balance pass exists (`tools/simulate.cjs`/S4 is still unbuilt).
4. `items.json`/`entities.json` empty; `formations.json`/`dungeon.json` are minimal
   wrappers, not real dungeon design — done only so `build_dungeon_preview.py` (which
   requires the full 6-file set, no optional-file handling) has valid input. A real
   dungeon layout (traps/doors/chest/rewards/level-scaling) was out of scope for
   "select 10 monsters + batch note" and is flagged as separate future work.
5. **Not added to `content/registry.json`** — per convention, only batches that clear
   real S2-S7 gates get registered (same status as batch-002/batch-003 today).
6. New batch-004 files are **uncommitted/untracked in git** on the server (alongside
   several other already-in-flight monster-pipeline files) — left for the user to
   review/commit.

## Next
- S7: user reviews https://backpack-dev.qtie.jp/preview/batch-004/ + `notes.md`;
  verdicts per entry or per-rule (e.g. "art field: yes/rename/no").
- On green: S8 merge into `content/live/` — **this would be the first enemy content
  ever merged there** (no enemy file currently exists in `content/live/`).

## Revision 1 (2026-07-07, same day — user feedback after first look)
- Every monster now has ≥2 skills (13→23 total), each guaranteed one SHORT- and one
  LONG-cooldown skill (griffin/behemoth also get a "medium" for 3-4 total). No new
  vocab; Stun still exclusive to `dread_bellow`. New non-functional annotation
  fields `cooldown_role`/`pair` added to skills.json — second schema-additive
  proposal, same posture as the `art` field.
- `tools/build_dungeon_preview.py` extended (additive/backward-compatible: gated on
  the `art` field, so batch-002/003 render unchanged) to show each enemy's reference
  image composited under a footprint-shaped cell-grid overlay, in a self-contained
  `web/preview/batch-004/img/` subtree. Also added a `relic` color to `RARITY_COLOR`
  (previously undefined, fell back to gray). Original tool backed up server-side as
  `build_dungeon_preview.py.bak-pre-req0077-art`.
- Full detail + per-skill design intent in `notes.md`'s "Revision 1" section.
  Re-rendered and verified live (HTTP 200 page + sampled image).

## Revision 2 (2026-07-07, same day — user request: passive skills)

User: most things pass, but skills needed another pass -- wanted **passive
skills**, had started adding verbs. Asked this session to research first
(reported separately in-chat), then add whatever verbs seemed necessary,
picked for what's fun/natural per monster name. Full design rationale and
per-monster writeup in `notes.md`'s "Revision 2" section; summary:

- **`content/vocab.json` v6 -> v7**: +1 trigger (`on_hp_below`, fires once on
  first HP-threshold crossing -- **reopens combat_spec_draft.md's [LOCKED
  OQ2] "dynamic buffs minimal" default**, flagged vetoable) + 4 verbs
  (`buff_self`, `status_immune`, `bonus_vs_status`, `damage_reduction`), all
  flagged as a vocab-growth proposal pending sign-off, same posture as the
  `art` field. 2 of the 10 new skills (green_slime, lich) needed **zero new
  vocab** -- `OnSquadBeenHit`/`OnHit` + `apply_status`/`lifesteal` already
  existed and were already `EnemySkill`-legal, just never used by an enemy.
- **10 new skills** (one passive/reactive add-on per monster, +1 each to
  `skills.json`/`enemies.json`, 23 -> 33 total): green_slime Corrosive Touch,
  goblin Mob Bravado, skeleton Bloodless, orc Bloodlust, dire_wolf Pack
  Instinct, lich Life Drain, minotaur Unstoppable, ogre Thick Hide, griffin
  Opportunist, behemoth Last Stand. Orc/behemoth share the new `on_hp_below`
  enrage pattern at common vs. relic scale; dire_wolf/griffin share
  `bonus_vs_status` (pack-assisted vs. self-combo); skeleton/minotaur share
  `status_immune` (Poison vs. Chill).
- **Unrelated drift found and fixed in `tools/build_dungeon_preview.py`**:
  the live script was byte-identical to the pre-Revision-1 backup -- the
  art-overlay feature and `relic` rarity color Revision 1 described had been
  silently reverted server-side after generating the deployed page (cause
  unknown; no git commit touches this file since REQ-0041). Re-applied both,
  plus a `cooldown_role` badge (also never actually rendered before) and
  display support for the new verbs/trigger. Verified no regression by
  re-rendering batch-002 to a scratch file and diffing against its live
  page (only new, empty-gated CSS rules differ; 0 `enemy-art-wrap` divs for
  batch-002, confirming the feature stays off for content with no `art`
  field). Fresh backups (`*.bak-pre-req0077-rev2`) taken of all 4 touched
  files before editing.
- Re-rendered and verified live (cache-busted fetch, HTTP 200): 10 enemies,
  **33 skills**, 4 formations, 5 steps; all 10 reference images and all 10
  new passive/reactive rows confirmed rendering.
- **Not re-run**: `self_test_vocab.cjs` (no `node` on this session's PATH).
  REQ-0081 already tracks that gate as pre-existing red for unrelated
  reasons; this revision shifts its trigger-count denominator (10 -> 11) but
  breaks nothing that was previously passing.
- Still uncommitted in git on the server, same as Revision 0/1 -- left for
  the user, now alongside the vocab/tool changes too.

## Revision 3 (2026-07-07, same day — user caught a design flaw in Rev.2)

User: goblin's `battle_start` + `buff_self(damage)` passive is pointless --
an unconditional, folded-once buff is mechanically identical to just raising
the active skills' base damage directly, so it teaches/changes nothing.
Correct catch. **Fix**: swapped for `goblin_cornered_snarl` (Cornered Snarl /
窮鼠の逆襲, named for the idiom "a cornered mouse bites the cat") --
`OnSquadBeenHit` + `strike[2,4]`, a reactive counter-strike, genuinely
event-driven and therefore not reducible to a static number tweak. No new
vocab (3rd reactive proc in the batch, each using a different verb:
apply_status / lifesteal / strike). The other 3 unconditional battle_start
passives (2x `status_immune`, 1x `damage_reduction`) were re-examined against
the same critique and kept as-is -- immunity has no equivalent numeric stat,
and flat damage_reduction behaves non-linearly vs. multi-hit sources unlike a
flat HP increase would, so both survive on their own logic; not changed
since the user only flagged goblin specifically.

Also answered two clarifying questions (recorded in `notes.md`'s Revision 3
section for future reference against the preview labels): "on landing a hit"
= the `OnHit` trigger; "bonus vs Weakness" = the new `bonus_vs_status` verb
(bonus damage vs. a target already carrying Weakness, from any source).

Re-rendered and verified live: Cornered Snarl present, Mob Bravado gone.
Fresh backups (`*.bak-pre-req0077-rev3`) taken before editing.
