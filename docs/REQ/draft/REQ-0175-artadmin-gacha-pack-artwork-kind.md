# REQ-0175 — artadmin-gacha-pack-artwork-kind

**Status:** draft — raised by the user (chat 2026-07-14) alongside REQ-0171: *「ガチャパック
Registryアートも、artadmin側にtypeを追加して、対応するようにREQ起こしだけやっておいてください」*.
**REQ起こしのみ。実装は別セッション。**
**Reserved:** 2026-07-14
**Slug:** artadmin-gacha-pack-artwork-kind
**Depends on:** REQ-0171 (the `gacha_pack` DATA facet — this REQ is its ARTWORK facet),
REQ-0151/REQ-0156 (the artwork registry + its admin UX).

## Goal

A gacha pack is a thing the player LOOKS AT before they spend on it — the Workshop's casting
panel currently shows a rune glyph (`鋳`) because a pack has no art. Give the pack an artwork
facet in the same registry every other kind already lives in, so a pack's illustration is
generated, inspected, adopted and exported through the machinery that exists — not bolted on.

Registry spine §7 already says a kind is a row in two tables: `content_defs.kind` (the DATA
facet — REQ-0171 adds `gacha_pack` there) and `artworks.kind` (the ART facet — this REQ).

## Scope (to be specced when picked up)

- `artworks.kind` gains **`gacha_pack`**: the ENUM/allowlist in `server/services/art_sizing.cjs`
  (`KINDS`), the size rule (`deriveSize`), and the default `prompt_template` in
  `server/routes/art.cjs` (`po|si` → outline on white; `unit` → portrait; `monster` → white bg;
  **`gacha_pack` → ???, a design question, not an inference**).
- **Sizing is the first real decision.** A unit is locked 512×512 upright (G2/G3). A pack card
  is almost certainly NOT square — the Workshop's cast panel is a portrait-ish card. Whatever
  is chosen becomes a locked gate like every other kind's, so it must be chosen deliberately.
- Inspection kits: which of the existing kits apply (`matte.coverage_band` is advisory across
  po/si/unit; `po.cell_packing` and `si.subject_frame` are kind-specific and clearly do not).
  A pack card may want NO kit, and "no kit" must be an explicit ruling, not an omission.
- Export: `content/art/gacha_pack/<system_name>.png`, via the existing `exportAdopted` path.
- Client: the Workshop's cast panel renders the adopted pack art (`/api/art/<icon>.png`) with
  the SAME fallback discipline the unit icons use — a pack with no adopted art keeps today's
  rune glyph, and a 404 is a non-event, never a broken card.
- `live_packs.json` / the `gacha_pack/1` schema gains an `icon` field (a FREE reference to an
  artwork system_name, exactly like `unit/1`'s — never derived from the id).

## Open questions for the user (do not infer)

1. **What IS a pack's art?** The container (a crate/cup/mould), or a montage of what it can
   emit? The Workshop's copy calls it a casting mould (`鋳`).
2. **Aspect/size.** Square like a unit, or a card?
3. **One art per pack, or a rarity-tier frame + art?** (Rarity is not yet a pack concept.)

## Non-goals

- Pack CONTENT management (pool/weights/cost) — that is REQ-0171, already implemented.
- Skins/variants of pack art (REQ-0126 lineage).
