// client/src/guide/FirstRunGuide.tsx -- REQ-0141. The first-run guided tour
// overlay: a single floating card that reveals one placement layer at a time
// (progressive disclosure). NON-MODAL by design (spec: "never modal-stacked")
// -- there is NO interaction-blocking backdrop; the card floats over the canvas
// page and the board underneath stays fully usable, so the player can look at
// exactly the layer each card describes. Skippable at any point. Renders
// nothing unless the guide is 'active' and the canvas page is showing.
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { useGameStore } from '../store';
import { GUIDE_STEPS, GUIDE_STEP_COUNT, readGuide } from './guideModel';
import { advanceGuide, skipGuide } from './guideController';
import { CanvasEmptyState } from '../canvas/CanvasEmptyState';

export function FirstRunGuide() {
  const snap = useGameStore();
  if (snap.status !== 'ready' || snap.route !== 'backpacks' || !snap.state) return null;
  const g = readGuide(snap.state);
  if (!g || g.status !== 'active') return null;
  const idx = Math.max(0, Math.min(GUIDE_STEP_COUNT - 1, g.step));
  const step = GUIDE_STEPS[idx];
  const isLast = idx === GUIDE_STEP_COUNT - 1;
  const locale = snap.locale;
  // If the CURRENT squad canvas is genuinely empty (a returning player who
  // cleared it, or a spare squad reached via Replay), lean on the SHARED
  // REQ-0140 empty-state copy for the opening card -- one source of truth for
  // empty-canvas guidance, no forked copy.
  const canvasEmpty = snap.state.bps.length === 0;
  return (
    <div
      className="first-run-guide"
      data-guide-status={g.status}
      data-guide-step={idx}
      data-guide-step-id={step.id}
      data-guide-spot={step.spot}
      role="dialog"
      aria-label={t(locale, 'guide.ariaLabel')}
    >
      {canvasEmpty && step.id === 'bp' ? <CanvasEmptyState variant="zero-bp" locale={locale} /> : null}
      <div className="first-run-guide-card">
        <div className="first-run-guide-progress" aria-hidden="true">
          {GUIDE_STEPS.map((s, i) => (
            <span key={s.id} className={`frg-dot${i === idx ? ' on' : ''}${i < idx ? ' done' : ''}`} />
          ))}
        </div>
        <div className="first-run-guide-count">
          {t(locale, 'guide.stepCount', { n: String(idx + 1), total: String(GUIDE_STEP_COUNT) })}
        </div>
        <div className="first-run-guide-title">{t(locale, `guide.step.${step.id}.title` as TranslationKey)}</div>
        <div className="first-run-guide-body">{t(locale, `guide.step.${step.id}.body` as TranslationKey)}</div>
        <div className="first-run-guide-actions">
          <button type="button" className="first-run-guide-skip" data-testid="guide-skip" onClick={skipGuide}>
            {t(locale, 'guide.skip')}
          </button>
          <button type="button" className="first-run-guide-next" data-testid="guide-next" onClick={advanceGuide}>
            {t(locale, isLast ? 'guide.finish' : 'guide.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
