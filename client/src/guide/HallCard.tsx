// client/src/guide/HallCard.tsx -- REQ-0376 (onboarding beyond the canvas).
// The first-visit card for ONE hall: a dismissible, non-modal statement of that
// hall's 3-4 laws in plain language, in both locales.
//
// WHY IT IS IN-FLOW AND NOT A FLOATING TOAST. It wears the ContextualHint
// visual family (panel ground, gold rule, x dismiss) as the spec asks, but it
// renders INSIDE the page, directly under the pagehead divider, instead of
// floating fixed over it the way .guide-hint does. Two reasons, one design and
// one mechanical: a hall's laws are read once, deliberately, on arrival -- not
// glanced at mid-gesture like a hint -- and a fixed overlay across five whole
// pages would sit on top of live controls (the sortie launch bar, the market
// tab row, the warehouse toolbar), where it would both hide them from the
// player and intercept the e2e suite's clicks. In-flow, it can cover nothing.
//
// It renders for ANY profile that has not dismissed this hall, veterans
// included -- these laws are new information for them too, since they were only
// ever stated in flavor prose. REQ-0141's persistence guarantee is preserved
// not by hiding the card but by writing NOTHING until the dismiss (see
// guideController.markHallSeen).
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { useGameStore } from '../store';
import { HALL_LAW_COUNT, isHallSeen, readGuide, type HallId } from './guideModel';
import { markHallSeen } from './guideController';

export function HallCard({ hall }: { hall: HallId }) {
  const snap = useGameStore();
  // No state means no persisted guide to read and nowhere for a dismiss to be
  // written -- render nothing rather than a card whose x would silently no-op.
  if (snap.status !== 'ready' || !snap.state) return null;
  if (isHallSeen(readGuide(snap.state), hall)) return null;
  const locale = snap.locale;
  const laws = Array.from(
    { length: HALL_LAW_COUNT[hall] },
    (_unused, i) => `guide.hall.${hall}.law${i + 1}` as TranslationKey,
  );
  return (
    <section className="hall-card" data-hall-card={hall} data-testid={`hall-card-${hall}`} role="note">
      <div className="hall-card-body">
        <div className="hall-card-title">{t(locale, `guide.hall.${hall}.title` as TranslationKey)}</div>
        <ul className="hall-card-laws">
          {laws.map((key) => (
            <li key={key} className="hall-card-law">{t(locale, key)}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="hall-card-dismiss"
        data-testid={`hall-card-dismiss-${hall}`}
        aria-label={t(locale, 'guide.hall.dismiss')}
        onClick={() => markHallSeen(hall)}
      >
        &times;
      </button>
    </section>
  );
}
