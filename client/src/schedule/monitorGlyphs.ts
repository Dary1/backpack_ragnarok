// REQ-0276 B1/B2: rune / glyph fallbacks used until the real art registries
// cover these ids. Pure maps so the Phase C pass restyles chips/badges in ONE
// place. gimic class glyphs are the ratified set (REQ-0276 brief + REQ-0259
// fallback): thorn=trap, gebo=chest, dagaz=door.
export const ENEMY_RUNE = 'ᛦ'; // bone-coloured placeholder while monster art loads / is absent

/** Gimic badge glyph: prefer the gimicId's class prefix (REQ-0259 ids are
 * `trap_*` / `chest_*` / `door_*`), fall back to the att_* event kind, then a
 * generic rune. Never a broken image. */
export function gimicGlyph(gimicId: string | null | undefined, evKind: string): string {
  const id = (gimicId || '').toLowerCase();
  if (id.startsWith('trap')) return 'ᚦ';
  if (id.startsWith('chest')) return 'ᚷ';
  if (id.startsWith('door')) return 'ᛞ';
  switch (evKind) {
    case 'att_fire': return 'ᚦ';   // trap volley
    case 'att_open': return 'ᚷ';   // chest opened / shortcut
    case 'att_lost': return 'ᛞ';   // door / trap lost
    case 'att_disarm': return 'ᚦ'; // trap disarmed
    case 'att_reveal': return 'ᛦ'; // freshly revealed, class unknown
    default: return 'ᛯ';
  }
}

/** Status-effect chip glyph by status name (case-insensitive substring match).
 * isaz=freeze/frost, ansuz=burn/fire, pertho=poison, algiz=shock/stun; a plain
 * dot for anything else so an unknown status still shows a chip (never blank). */
export function statusGlyph(status: string): string {
  const s = (status || '').toLowerCase();
  if (/(freeze|frost|chill|rime|ice)/.test(s)) return 'ᛁ';
  if (/(burn|fire|scorch|ember)/.test(s)) return 'ᚨ';
  if (/(poison|venom|toxic)/.test(s)) return 'ᛈ';
  if (/(shock|stun|daze|paralys)/.test(s)) return 'ᛉ';
  if (/(bleed|wound)/.test(s)) return 'ᛋ';
  return '•';
}
