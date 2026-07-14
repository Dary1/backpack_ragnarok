// client/src/board/overlayPalette.ts -- REQ-0143 (overlay-accessibility).
//
// THE single source of truth for every RENDERER-DRAWN gameplay-signal overlay
// colour + its non-hue cue. BS-G1 (backpack_skin_pipeline.md S4) makes the
// renderer the sole enforcement point for gameplay signals, so this file is
// that point: skins can never carry these, and every overlay reads its colour
// here rather than from an inline literal. Two rules, both machine-checkable by
// the overlay_a11y_harness:
//
//   1. COLORBLIND-SAFE. Colours are drawn from the Okabe-Ito / Wong (2011)
//      qualitative palette -- the standard set engineered to stay separable
//      under deuteranopia, protanopia and tritanopia. The harness re-proves it
//      by simulating all three CVD types (standard sRGB matrices) on the
//      overlay-on-skin composite and measuring CIELAB deltaE within each
//      meaning group.
//   2. NEVER HUE ALONE. Every meaning that a colour carries ALSO carries a
//      non-hue `cue` token (shape / pattern / luminance / geometry). Where two
//      states in a group are not separable by simulated colour alone, their
//      cues MUST differ. The harness enforces this: a group passes iff every
//      pair is separable by colour OR by a distinct cue.
//
// Pure data + tiny colour math. NO Pixi / DOM / IO import, so the harness loads
// it from plain Node (vite ssrLoadModule) exactly as it loads composite.ts.

/** A non-hue channel that distinguishes a state independently of its colour.
 * `solid`/`luminance` mean "no extra shape needed -- the colour itself is
 * separable under CVD by lightness"; the rest name an actual drawn cue. */
export type OverlayCue =
  | "solid"
  | "luminance"
  | "hatch-diagonal"
  | "hatch-dots"
  | "ring-solid"
  | "ring-dashed"
  | "glyph-triangle"
  | "glyph-droplet"
  | "glyph-leaf"
  | "glyph-bolt"
  | "crack-light"
  | "crack-heavy"
  | "arc-fill";

export interface OverlaySignal {
  /** 0xrrggbb, consumed directly by Pixi fill/stroke. */
  color: number;
  /** #rrggbb mirror -- what the harness parses (and CSS, if ever needed). */
  hex: string;
  /** The non-hue channel this state also carries (rule 2). */
  cue: OverlayCue;
  /** Default wash alpha where the overlay is a translucent tint. */
  alpha: number;
}

function sig(hex: string, cue: OverlayCue, alpha = 1): OverlaySignal {
  return { color: parseInt(hex.slice(1), 16), hex, cue, alpha };
}

// --- Okabe-Ito base swatches (documented CVD-safe qualitative palette) -------
export const OKABE_ITO = {
  black: "#000000",
  orange: "#e69f00",
  skyBlue: "#56b4e9",
  bluishGreen: "#009e73",
  yellow: "#f0e442",
  blue: "#0072b2",
  vermillion: "#d55e00",
  reddishPurple: "#cc79a7",
} as const;

/**
 * Overlay groups. A "group" is a set of states whose MEANINGS are told apart
 * from each other at a glance -- so it is exactly within a group that CVD
 * separability must hold. Keys are stable; renderers import the leaves.
 */
export const OVERLAY = {
  /** REQ-0030 usage wash: is this item/BP already spent by a squad? The old
   * pair was red 0xff3b3b vs yellow 0xffd23b -- two warm hues that collapse
   * together under deuteranopia/protanopia. Replaced by vermillion vs yellow
   * (a large lightness gap) and each gets a distinct hatch so the wash is
   * legible even when printed grey. */
  usage: {
    selfSquad: sig(OKABE_ITO.vermillion, "hatch-diagonal", 0.2),
    otherSquad: sig(OKABE_ITO.blue, "hatch-dots", 0.2),
  },
  /** Placement validity ring/wash. The old pair was green #5cb573 vs red
   * #c05050 -- the canonical red/green confusion. Replaced by bluish-green vs
   * vermillion (separable by lightness under all three CVD types) PLUS a solid
   * vs dashed ring so validity never rides on hue. */
  dropTarget: {
    ok: sig(OKABE_ITO.bluishGreen, "ring-solid", 0.25),
    bad: sig(OKABE_ITO.vermillion, "ring-dashed", 0.25),
  },
  /** Combat side tint (game_golden asymmetric combat). Not drawn yet -- combat
   * is unimplemented -- but defined here so that when the renderer draws it, it
   * draws THIS. Blue vs vermillion is the canonical CVD-safe opposition. */
  side: {
    team: sig(OKABE_ITO.blue, "solid", 0.28),
    enemy: sig(OKABE_ITO.vermillion, "solid", 0.28),
  },
  /** Element tints. Every element also carries a glyph, so the element reads
   * even in full greyscale -- hue is never the only channel. */
  element: {
    fire: sig(OKABE_ITO.vermillion, "glyph-triangle", 0.3),
    water: sig(OKABE_ITO.blue, "glyph-droplet", 0.3),
    nature: sig(OKABE_ITO.bluishGreen, "glyph-leaf", 0.3),
    arc: sig(OKABE_ITO.reddishPurple, "glyph-bolt", 0.3),
  },
  /** Damage state. Healthy draws nothing; damaged/critical are both warm, so
   * they lean on a large lightness gap (orange vs vermillion) AND crack
   * density (light vs heavy) -- never hue alone. */
  damage: {
    damaged: sig(OKABE_ITO.orange, "crack-light", 0.35),
    critical: sig(OKABE_ITO.vermillion, "crack-heavy", 0.45),
  },
  /** Charge UI. G7 makes charge a RADIAL RING FILL: the arc sweep itself is
   * the non-hue channel (0..full is geometry, not colour), and "ready" adds a
   * colour shift on top. So a single accent is CVD-safe by construction. */
  charge: {
    fill: sig(OKABE_ITO.skyBlue, "arc-fill", 1),
    ready: sig(OKABE_ITO.orange, "arc-fill", 1),
  },
} as const;

/** Every meaning group as a flat list of [label, signal], for the harness to
 * iterate without hard-coding the tree. Order is stable (determinism). */
export function overlayGroups(): Array<{ group: string; states: Array<{ label: string; signal: OverlaySignal }> }> {
  const out: Array<{ group: string; states: Array<{ label: string; signal: OverlaySignal }> }> = [];
  for (const [group, states] of Object.entries(OVERLAY)) {
    const list: Array<{ label: string; signal: OverlaySignal }> = [];
    for (const [label, signal] of Object.entries(states as Record<string, OverlaySignal>)) list.push({ label, signal });
    out.push({ group, states: list });
  }
  return out;
}

// --- colour math (shared with the harness; pure) -----------------------------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** sRGB channel (0..255) -> linear (0..1), the WCAG / CIE transfer function. */
export function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an 0..255 RGB triple. */
export function relLuminance(rgb: [number, number, number]): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

/** WCAG contrast ratio between two luminances (>= 1). */
export function contrastRatio(l1: number, l2: number): number {
  const a = Math.max(l1, l2), b = Math.min(l1, l2);
  return (a + 0.05) / (b + 0.05);
}

/** Alpha-composite an overlay RGB over a base RGB (both 0..255). */
export function over(overlay: [number, number, number], base: [number, number, number], alpha: number): [number, number, number] {
  return [
    Math.round(overlay[0] * alpha + base[0] * (1 - alpha)),
    Math.round(overlay[1] * alpha + base[1] * (1 - alpha)),
    Math.round(overlay[2] * alpha + base[2] * (1 - alpha)),
  ];
}
