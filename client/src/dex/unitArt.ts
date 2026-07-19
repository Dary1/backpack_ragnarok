// client/src/dex/unitArt.ts -- REQ-0266 (item 25): THE DOM adapter for Unit art.
//
// REQ-0125a promised "a DOM adapter over the same resolver"; it was never built,
// so every DOM surface that wanted a unit picture forked the chain -- and two of
// them forked it into a PERMANENTLY DEAD branch (getItemArtUrl(bp.unit.id): unit
// ids and item ids have verified zero overlap, so those <img> elements had never
// rendered once). This module is that adapter, and it is the unit twin of
// dex/dexIcons.ts's resolveIconUrl(id, iconId): same signature shape, same
// "return the URL AND which tier won" contract.
//
// It resolves through board/unitIcon.ts's own exported helpers rather than
// re-deriving anything, which is the entire point: the DOM surfaces and the
// PixiJS board walk ONE chain, so they can never disagree about what a unit
// looks like.
//
//     active skin (the player's pick, else the def's default)
//       -> the unit def's own `icon`
//       -> null == the CALLER's own fallback (rune glyph / colour dot /
//          empty well) -- each surface keeps the one it already had.
//
// NON-PROBING, and that property is load-bearing. The skin rung's URL comes out
// of /api/content's `art_urls` keyed by SKIN id (REQ-0266 ruling D-A) -- i.e. the
// server already resolved it against an ADOPTED artwork. A skin whose artwork is
// not adopted is simply ABSENT from that map, so skinArtUrl() returns null and
// the chain falls through WITHOUT emitting an <img> whose src 404s. Never build a
// skin URL from a naming convention here; absence is the normal case (ruling D5),
// not an error, and a probe would turn every un-generated skin into a network
// miss and a broken-image glyph.
import { activeSkinId, skinArtUrl, unitArtUrl } from '../board/unitIcon';

/** Which tier answered -- carried out of the resolver exactly like dexIcons'
 * ResolvedIcon.source and unitIcon's UnitIconRung, so a caller can label or
 * style by provenance and a test can assert the chain fell through for the
 * RIGHT reason rather than merely that it landed somewhere. */
export type UnitArtSource = 'skin' | 'default' | 'none';

export interface ResolvedUnitArt {
  /** URL for a DOM <img src>, or null at 'none' -- meaning "draw your own
   * fallback". Never a URL this module invented. */
  url: string | null;
  source: UnitArtSource;
}

/**
 * The DOM analog of board/unitIcon.ts's resolveUnitIcon(): the SAME rung order,
 * expressed as URLs instead of texture-map keys. A DOM <img> has no texture map,
 * so availability is the browser's problem -- a caller that wants to hide a 404
 * keeps its own onError handler (the posture UnitCatalog's portrait well has
 * always had, and the one the squad surfaces gain here).
 *
 * `icon` is the unit def's own artwork system_name (ApiUnitEntry.icon), supplied
 * by the caller for exactly the reason dexIcons.resolveIconUrl() takes `iconId`:
 * this module owns no registry, so it stays pure and total. Pass null when the
 * caller has no def in hand -- the chain then just skips that rung and reports
 * 'none' rather than inventing one.
 *
 * Pure. Total. Never throws.
 */
export function resolveUnitArtUrl(
  unitId: string | null | undefined,
  icon: string | null | undefined,
): ResolvedUnitArt {
  // Rung 1 -- the ACTIVE skin. activeSkinId() is itself pick -> def default, and
  // skinArtUrl() is sparse by construction (see the non-probing note above).
  const skinUrl = skinArtUrl(activeSkinId(unitId, 'unit'));
  if (skinUrl) return { url: skinUrl, source: 'skin' };
  // Rung 2 -- the def's own icon, i.e. exactly what every unit surface drew
  // before REQ-0266. Byte-identical URL, so "no skin" is a no-diff path.
  if (typeof icon === 'string' && icon.length > 0) return { url: unitArtUrl(icon), source: 'default' };
  // Rung 3 -- nothing to draw. NOT an error: the caller renders its own glyph.
  return { url: null, source: 'none' };
}
