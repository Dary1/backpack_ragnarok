# REQ-0171 — contentadmin-gacha-pack-pools

**Status:** draft — raised by the user (chat 2026-07-14) while ruling on REQ-0170's
emission model: *「パックによって異なるべき… コンテンツ管理画面でのREQにしてください」*.
**Reserved:** 2026-07-14
**Slug:** contentadmin-gacha-pack-pools
**Depends on:** REQ-0170 (ships `content/live/live_packs.json` — the table this REQ puts a
screen on top of), REQ-0155/REQ-0157/REQ-0164 (the content-data registry admin + its UX).

## Goal

Gacha packs — WHICH Units a pack can emit, at what weight, for what cost — must be
authored in the **content admin screen**, not in a JSON file edited by hand and not in
`gacha.cjs`. REQ-0170 makes the pool data (one `gacha_pack/1` row, all 12 units, uniform
weight); this REQ makes it *managed* data.

## Scope (sketch — to be specced when picked up)

- Registry facet: `content_defs.kind = gacha_pack` (the same variant-as-record machinery
  every other def kind uses: `schema_vocab` / `engine_types` / `gen_data` / `integrate`
  checks, then a live write).
- Admin UI: list packs; edit a pack's pool (add/remove Units, set weights), cost, cell-count
  range and HP-per-cell; validate that every `unit` in a pool exists in `live_units.json`
  and that weights are positive.
- Live target: `content/live/live_packs.json`, written through the existing content-export
  path (never hand-edited once this lands).
- Themed packs (REQ-0062 lineage) become authorable content rather than a code change —
  which is the point: the acquisition ruling (user, 2026-07-06) says connective identities
  are obtained by CHOOSING which pack to open.

## Non-goals

- The Workshop's UI for *choosing* a pack (a separate front-end REQ; REQ-0062's catalog).
- Rarity/pity/duplicate rules. Nothing has been ruled.
