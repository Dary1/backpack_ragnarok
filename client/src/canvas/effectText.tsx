// Shared effect-text renderer -- REQ-0140 (canvas-side-panel-parity).
//
// The engine ships each item's effect copy as a SERVER-RENDERED string
// (ItemDef/SIDef.eff_en / eff_ja -- see shared/engine.d.ts), one logical
// clause per newline-separated line. Several surfaces render those lines the
// same way (the floating item tip, the Dex detail card); this is the single
// reusable renderer for NEW canvas-screen surfaces (the side-panel detail
// card), exported so later work (e.g. REQ-0141 guidance callouts) can reuse
// it rather than re-inlining the split. Engine copy is consumed AS-IS.
import type { Locale } from '../store';

interface HasEff {
  eff_en?: string;
  eff_ja?: string;
}

/** Locale-active effect text for a def: the active locale's copy, falling
 * back to the other language when the active one is empty (an untranslated
 * effect should still show SOMETHING, matching FloatingItemTip/ItemPanel). */
export function effTextOf(def: HasEff, locale: Locale): string {
  return (locale === 'ja' ? def.eff_ja : def.eff_en) || def.eff_en || def.eff_ja || '';
}

/** Splits effect text into trimmed, non-empty lines. */
export function effLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Renders effect copy as one line element per clause. Returns null when
 * there is no effect text (the caller decides the empty fallback). */
export function EffectLines({ text, className = 'eff-line' }: { text: string; className?: string }) {
  const lines = effLines(text);
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line, i) => (
        <div className={className} key={i}>
          {line}
        </div>
      ))}
    </>
  );
}
