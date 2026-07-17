// client/src/lib/connShapeLabel.ts -- REQ-0208: the human-facing connection-
// shape readouts, LIFTED VERBATIM from schedule/WorkshopPage.tsx (REQ-0170)
// so the Dex unit surfaces (dex/UnitCatalog.tsx) and the Workshop label a
// unit's connection the SAME way -- one wording, one truth, no parallel
// formatter. The workshop.* i18n keys are used deliberately: the strings ARE
// the Workshop's (same facts, same phrasing); a second dex.* copy would be a
// translation drift waiting to happen.
import type { ApiConnShape } from '../../../shared/dto';
import { t } from '../i18n';
import type { Locale } from '../store';

/** The project compass: ray dirs 0=N .. 7=NW. */
export const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Turns a connection shape's ray dirs (0=N..7=NW, the project compass) into a
 * human-facing string. An offset shape has no dirs and reads '—' -- it jumps, it
 * does not fire along a compass line. */
export function dirsLabel(shape: ApiConnShape | undefined): string {
  if (!shape || shape.kind !== 'ray' || !shape.dirs || !shape.dirs.length) return '—';
  return shape.dirs.map((d) => COMPASS_LABELS[d] ?? '?').join(' ・ ');
}

/** The connection shape, named the way the vocabulary names it (ja label when the
 * player is reading Japanese -- 飛車 / 角 / 香 are the terms the design uses), with
 * the range/pierce facts that actually govern the walk appended. Invents nothing:
 * every part is read off vocab.json's connection_shapes entry. */
export function shapeLabel(key: string | undefined, shape: ApiConnShape | undefined, locale: Locale): string {
  if (!key || !shape) return '—';
  const base = locale === 'ja' && shape.ja ? shape.ja : key;
  if (shape.kind === 'none') return base + ' (' + t(locale, 'workshop.shapeNone') + ')';
  if (shape.kind === 'offset') return base + ' (' + t(locale, 'workshop.shapeOffset', { n: (shape.offsets ?? []).length }) + ')';
  const range = (shape.range === 0 || shape.range == null)
    ? t(locale, 'workshop.shapeRangeUnlimited')
    : t(locale, 'workshop.shapeRange', { n: shape.range });
  return base + ' (' + range + ')';
}
