// REQ-0276 B1: MJOLNIR palette tokens as Pixi colour NUMBERS + a few shared
// skin helpers, centralised so the Phase C VFX pass restyles HERE (one place),
// not at every draw site. These replace the ad-hoc 0x59d6d6 / 0xc05050 /
// 0xffe680 literals the monitor grew organically. Discipline (styleguide):
// gold = STRUCTURE (frames/focus) only; ember x frost = the world's voice;
// blood = damage / HP-low; bone = text.
export const MJ = {
  void: 0x0a0d12,
  panel: 0x131820,
  raised: 0x1b222d,
  borderLo: 0x28313e,
  bone: 0xe9e3d3,
  bone2: 0xa8a193,
  bone3: 0x6b675c,
  gold: 0xc9a959,
  // REQ-0276 C: hi/lo companions straight from the styleguide swatches --
  // -hi for the bright instant of an effect, -lo for quiet structural frames.
  goldHi: 0xebd9a4,
  goldLo: 0x857038,
  ember: 0xe25822,
  emberHi: 0xff8a3d,
  emberLo: 0x7e2a10,
  frost: 0x6fc4de,
  frostHi: 0xb8e9f5,
  blood: 0xb0413e,
};

/** REQ-0276 B1: per-enemy HP-bar fill colour by remaining fraction -- frost
 * (cool "intact") when healthy, ember at the mid band, blood when low. Phase C
 * may re-tune the stops / add the 25%-notch emphasis; the geometry + fraction
 * are placed by the renderer, this only maps a fraction to a state colour. */
export function hpColor(frac: number): number {
  if (frac <= 0.25) return MJ.blood;
  if (frac <= 0.5) return MJ.ember;
  return MJ.frost;
}

/** REQ-0276 B1: a stable low-key tint per packId for the SUBTLE pack-grouping
 * edge (a thin left border on each actor's cell block). Deterministic hash into
 * a small in-palette cycle -- structural grouping only, not a glow. */
const PACK_TINTS: number[] = [MJ.frost, MJ.gold, MJ.ember, MJ.bone2];
export function packTint(packId: string | null | undefined): number {
  if (!packId) return MJ.borderLo;
  let h = 0;
  for (let i = 0; i < packId.length; i++) h = (h * 31 + packId.charCodeAt(i)) & 0x7fffffff;
  return PACK_TINTS[h % PACK_TINTS.length];
}
