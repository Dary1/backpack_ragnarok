# REQ-0267 — sis005 si content batch (20 socket items)

## Summary
The `sis005_*` artwork batch (20 si-kind artworks, 256x256) existed in the artwork
registry with **no renders and no content defs**. This REQ runs the art seed for
them, cuts out their backgrounds, adopts them, and authors the matching `si/2`
content entries so the batch is a usable content kind rather than 20 orphan names.

Live `si` content before this REQ: **6 entries** (`acc_*`). After: **26**.

## Decisions

1. **One seed per artwork, no candidate sweep.** The user's instruction was to run
   *the* seed, not to hold a bake-off. Base render = seed 1 for every artwork.
2. **All 20 adopted** (user ruling: "一種類しかないので全adopt"). The adopted render is
   the **background cutout** (derived seed 100001), matching the REQ-0193 sweep
   convention — the raw render is kept but not adopted.
3. **id == artwork system_name.** `resolveItemArtNames` binds si art by
   `artwork_ref` first, then **exact name**. Naming each entry `sis005_<thing>`
   makes the art bind with no `artwork_ref` field and no client-side join.
4. **Slots split 5/5/5/5** across the four `socket_tags` slots, by physical nature
   of the object: gem = gems/cores, edge = sharp, coat = applied liquids,
   bond = fastenings. This keeps every slot draftable from this batch alone.
5. **`icon` reuses existing sprite symbols.** `icon === 'icon-' + id` is DEAD
   (REQ-0149); icon is only the SVG fallback for the files backend, so each entry
   points at an existing, thematically-near symbol present in BOTH
   `sprite_all_v10.svg` and `v12.svg`. Art proper comes from `art_urls` (pg).
6. **Effect grammar kept inside what `eff_render.cjs` renders.** Every
   trigger/verb pair was smoke-rendered in EN and JA before authoring; combos that
   fall through to a raw token (`on_kill`, `bonus_vs_status`/`status_immune`
   without a `status` param) were rejected at design time, not at gate time.
7. **Power budget anchored to the attested `acc_*` ranges** ([2,4] Common,
   [4,8] Uncommon). The single Rare outlier is `dragon_claw` at buff_host [6,12] —
   si had no Rare tier before this batch.

## Content shipped

| slot | entries |
| --- | --- |
| gem  | emerald_gem (lifesteal), sapphire_gem (damage_reduction), ember_core (Burn), thunder_core (haste), moon_pearl (grant_shield) |
| edge | serrated_fang (bonus_vs_blocked), dragon_claw (buff_host), bone_spike (Spikes), obsidian_shard (buff_host), iron_caltrop (reflect_damage) |
| coat | flame_oil (Burn), frost_rime (Chill), venom_flask (Poison), holy_water (Weakness), tar_pot (slow_enemy) |
| bond | leather_grip (haste), silver_chain (reflect_damage), golden_thread (Regen), hemp_rope (block), iron_rivet (damage_reduction) |

Rarity: Common 9 / Uncommon 7 / Rare 4.
`reqTags`: `Bone` on serrated_fang/dragon_claw/bone_spike, `Metal` on
iron_caltrop/silver_chain/iron_rivet; all others unrestricted.

## Art pipeline record

- Route: flux2 (unchanged). 20 generations ran as ONE generation family, then 20
  cutouts as ONE matte family — a single gen->matte barrier fire, per REQ-0233.
  Interleaving would have cost 20 ComfyUI restarts.
- Driver: `/tmp/sis005_run.py` (detached). Result: **gen 20/20 ok, cutout 20/20 ok,
  0 failures**.
- Adoption: 20/20 HTTP 200, each exported to `content/art/si/<id>.png`.

## Gate results

- `tools/self_test_vocab.cjs` — **ALL GREEN**, failures: 0
  (verbs covered 31, triggers 20/20; every effect rendered EN + JA).
- si_def dialect + `validateBody('si')` over all 20 new entries — **0 failures**
  (slot/reqTags in `vocab.socket_tags`, rarity in `vocab.rarities`, trigger/verb/
  status in vocab, every `n` a valid [lo,hi] range).
- Art verification — 20/20 RGBA, alpha range 0-255, all four corners alpha 0,
  subject coverage 6-58% opaque. `GET /api/art/sis005_emerald_gem.png` -> 200 image/png.
- `server/tests/content_test.cjs` — SKIPPED in this worktree (no DATABASE_URL); it
  is covered by `tools/ci.sh` on a DB-backed run.

## Status

BUILT — content authored, gates green, art adopted and serving. **Not merged and
not deployed.** The live API serves from the main checkout, so these entries do
not reach the game until this branch is merged to master and `backpack-api`
picks the content up. Merge/deploy is deliberately left to the user (PROJECT.md:
main checkout + live services are coordinate-first).

Follow-up available if wanted: gacha/pack pool wiring — nothing drafts these 20
yet, so they are reachable only once a pack table references them.
