// Designed empty states -- REQ-0140 (canvas-side-panel-parity). The copy is
// SHARED with REQ-0141 (canvas-first-run-guidance): a zero-BP canvas and an
// empty inventory get guidance, never a blank void. Kept as one small,
// variant-driven component (+ its i18n keys under canvas.empty.*) so REQ-0141
// can import it directly instead of forking parallel copy.
import { t } from '../i18n';
import type { Locale } from '../store';

export type CanvasEmptyVariant = 'zero-bp' | 'empty-inventory';

// `as const` keeps the i18n keys as literal types (t()'s key param is the
// strict union of all keys), not widened to string.
const KEYS = {
  'zero-bp': { title: 'canvas.empty.zeroBpTitle', body: 'canvas.empty.zeroBpBody', rune: 'ᛗ' },
  'empty-inventory': { title: 'canvas.empty.invTitle', body: 'canvas.empty.invBody', rune: 'ᚷ' },
} as const;

/** Guidance block for an empty canvas surface. `variant` selects the copy;
 * the caller owns placement (an overlay over the board, or inside the
 * inventory list). */
export function CanvasEmptyState({ variant, locale }: { variant: CanvasEmptyVariant; locale: Locale }) {
  const k = KEYS[variant];
  return (
    <div className={`canvas-empty canvas-empty-${variant}`} data-empty-variant={variant} role="note">
      <div className="canvas-empty-rune" aria-hidden="true">
        {k.rune}
      </div>
      <div className="canvas-empty-title">{t(locale, k.title)}</div>
      <div className="canvas-empty-body">{t(locale, k.body)}</div>
    </div>
  );
}
