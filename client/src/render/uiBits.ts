// Shared UI bits — REQ-0075. Small presentation helpers the redesign
// page-ports share, lifted OUT of individual page components so a second
// consumer never has to copy-paste them (the REQ-0072→0075 heads-up in
// docs/REQ-0072-redesign-warehouse.md explicitly calls out
// rarThemeClass/TtlRing as "lift them if a page needs rarity frames or
// progress rings" -- this is that lift).
//
// rarThemeClass: the app rarity ramp (content/live's Common / Uncommon /
// Rare / Relic) -> the MJOLNIR theme's `.rar-*` frame class
// (client/src/theme/mjolnir.css). The mock double-encodes rarity as a
// coloured border + a corner .gem + the rarity WORD, all driven by this
// one class on the card's `.rar` element. Relic wears the mock's
// LEGENDARY tone (the mock labels that tier 遺宝 = relic), the exact
// mapping REQ-0070's `.rarity.r-Relic` rule and REQ-0072's WarehouseTab
// already established -- kept here as the single definition both now
// import. The theme also defines epic/legend/mythic frames; those tier
// NAMES aren't in the live ramp today but are mapped defensively so a
// future content tier renders with a real frame rather than silently
// falling back to common. Unknown/unloaded rarity -> the common frame.
export function rarThemeClass(rarity: string | undefined): string {
  switch (rarity) {
    case 'Uncommon':
      return 'rar-uncommon';
    case 'Rare':
      return 'rar-rare';
    case 'Epic':
      return 'rar-epic';
    // Relic is the app-ramp name for the top live tier; Legendary/Legend
    // are the theme/mock's own word for the same visual weight -- all map
    // to the legend frame (REQ-0070's established Relic->legend mapping).
    case 'Relic':
    case 'Legend':
    case 'Legendary':
      return 'rar-legend';
    case 'Mythic':
      return 'rar-mythic';
    default:
      return 'rar-common';
  }
}
