# Style Guide — units-001-roster (REQ-0127)

Scope: first Unit roster batch on the AI-raster route
(`docs/llm_managed/unit_icon_pipeline.md` v1.1). One style token block for
the whole roster (G5 roster coherence). Framing: **bust** — ratified
2026-07-12 (pipeline §3 item 1, ALL GREEN); full-body art is a separate
dex/splash asset class (REQ-0137 identity), never the board icon.

Checkpoint: **pending REQ-0136 verdict** (this batch generates only after
the bakeoff winner is ratified; the prompt template below is
checkpoint-portable — stylization tokens front-loaded).

## 1. Art direction

Painterly dark-fantasy CHARACTER icon. Same palette / rendering / mood as
the item route (batch-003 style guide §1: MJOLNIR night-iron, aged bone,
worn leather, muted heraldic gold; painterly brushwork, soft cel-shading,
top-left key light, cool rim light; grim, ancient, Norse-forged; NOT
photorealistic). The icon is the character's identity — face + silhouette
(G4: readable at 64 px). No gameplay state in art (G2): no arrows, gauges,
beams, ring-like framing (G7 reserves the charge ring).

## 2. Prompt template

```
bust portrait of <concept clause>, head and shoulders only, single
character centered, filling the square frame with a small even margin,
stylized painterly dark-fantasy game character icon, hand-painted
illustration, digital painting, concept art, soft cel-shading, matte
finish, weathered materials, muted desaturated palette of aged iron grey
worn leather and tarnished gold, Norse mythology aesthetic, grim and
ancient, gentle top-left key light, subtle cool rim light, crisp readable
silhouette, plain uniform near-white background, clean flat backdrop,
no shadow, no gradient, high detail, sharp focus
```

Negative = item-route standard + `full body, legs, feet, extra limbs,
extra fingers, multiple people`.

`gen_render` constant (1×1): target 256×256, gen 1024×1024, Lanczos
downscale. Plain names for generation (common_content_pipeline §2).

## 3. Roster concepts (user-authored seed list)

| id | concept clause |
|---|---|
| unit-elf | a slender sharp-featured elf woman with long pale silver hair and pointed ears, weathered green hooded cloak over worn leather armor with muted tarnished gold clasps, calm piercing gaze |
| unit-dwarf | a stocky dwarf warrior with a braided iron-grey beard and a heavy brow, riveted steel pauldrons over a leather apron, a forge-scarred face, stern deep-set eyes |
| unit-thief | a wiry hooded thief with a half-masked face and sharp amused eyes, dark oiled-leather armor with crossed belts and small knives, a loose grey scarf |
| unit-angel | a solemn armored angel with folded pale-feathered wings behind the shoulders, a plain steel circlet and silvered breastplate, serene downcast gaze |
| unit-shieldmaiden | a fierce shieldmaiden with tight blond braids and a painted round shield at her shoulder, chainmail over a wool tunic, a thin scar across her cheek |
| unit-priest | an aged priest with a shaved crown and a heavy wool cowl, a tarnished gold holy pendant, weathered kind face, hands hidden in wide sleeves |
| unit-princess | a young royal princess with a modest aged-gold crown over dark braided hair, a high-collared layered court dress in muted deep blue, composed watchful expression |
| unit-lightcavalry | a light cavalry rider with a plumed open-faced helm and a short lance over the shoulder, boiled-leather lamellar coat, wind-burned face |
| unit-berserker | a massive scarred warrior with a wild braided red-brown beard and shaved temples, bare shoulders draped in a dark bear pelt, iron arm ring and a worn leather baldric, fierce battle-hardened expression |
| unit-necromancer | a gaunt necromancer with sunken glowing pale eyes and long ash-white hair, black-green robes with bone clasps and a raised ragged collar |
| unit-watcher | a hooded watcher with an unreadable shadowed face and a single faintly glowing lantern-amulet at the throat, long grey travel cloak |
| unit-squire | a young earnest squire with cropped hair and an oversized padded gambeson, a polished kettle helm under one arm, hopeful steady gaze |

## 4. Gates recap

Scoring filters only (< 20 % coverage auto-FAIL; user gallery verdict
selects — S5). Gallery `web/preview/units-001/`, 256 px + 64 px per
candidate, numbered (S6). STOP at S7. Nothing enters `content/live/`.
