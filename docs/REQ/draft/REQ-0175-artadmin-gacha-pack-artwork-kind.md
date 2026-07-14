# REQ-0175 — artadmin-gacha-pack-artwork-kind

**Status:** draft — raised by the user (chat 2026-07-14) alongside REQ-0171: *「ガチャパック
Registryアートも、artadmin側にtypeを追加して、対応するようにREQ起こしだけやっておいてください」*.
**Raised as a REQ only (2026-07-14). §0 closes every open question — CLEARED TO IMPLEMENT.**
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

## Open questions for the user — ALL THREE CLOSED 2026-07-14 (see §0)

1. ~~What IS a pack's art?~~ **Ruled: the roll BUTTON image and the post-roll illustration
   BACKGROUND — one and the same image.**
2. ~~Aspect/size.~~ **Ruled: 768 × 768.**
3. ~~One art per pack, or a rarity-tier frame?~~ **Ruled: one pack = one image.**

**No open question remains. This REQ is cleared to implement.**

## Non-goals

- Pack CONTENT management (pool/weights/cost) — that is REQ-0171, already implemented.
- Skins/variants of pack art (REQ-0126 lineage).

---

## 0. Ruling log (user, binding — 2026-07-14)

| Q | Ruling |
|---|---|
| **What IS a pack's art?** | **The pack's roll BUTTON image, and the illustration BACKGROUND shown after the roll — the SAME image serves both.** So it is one illustration per pack, doing double duty: a button face at small size and a backdrop at large size. |
| **Aspect / size** | **768 × 768.** (Not the unit's locked 512; packs get their own locked size.) |
| **One art per pack, or frame + art?** | **One pack = one image.** No rarity frame, no montage of contents. |
| **The art KIND itself** | **Add it** — `artworks.kind = gacha_pack` is required, not optional. |

### What the rulings settle, and what they demand

- The image is used at **two very different scales** (button ≈ a panel tile; background ≈ the
  result modal's backdrop). That is a REAL constraint on the brief, not a rendering detail: the
  composition must read as a silhouette at button size AND not fight the modal's text at
  backdrop size. Concretely: **subject centred, low-contrast periphery, no text baked in, no
  hard frame** (a frame would double-draw against the panel's own `ornate` corners).
- 768×768 square is **locked** (`art_sizing.cjs` `deriveSize`), exactly as `unit` is locked at 512.
- Because ONE image is both button and backdrop, there is **no second asset to fall back to**:
  a pack with no adopted art keeps today's rune glyph (`鋳`) as the button and **no** backdrop.
  The fallback chain must therefore be per-USE, not per-pack.
