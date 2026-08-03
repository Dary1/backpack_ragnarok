// client/src/sortie/LevelStepper.tsx -- REQ-0239 (design 01 sec 4): [-] n [+]
// with a direct input; clamps >= 1.
import { t } from '../i18n';
import type { Locale } from '../store';

interface LevelStepperProps {
  locale: Locale;
  level: number;
  onChange: (level: number) => void;
  /** true when the typed level is below the dungeon's recommended band. */
  belowBand?: boolean;
  /** REQ-0304: fired when the player presses ENTER in the attackLv input. */
  onEnter?: () => void;
}

export function LevelStepper({ locale, level, onChange, belowBand, onEnter }: LevelStepperProps) {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1);
  return (
    <div className={`sortie-level${belowBand ? ' is-below-band' : ''}`}>
      <span className="sortie-level-label den">{t(locale, 'sortie.level.label')}</span>
      <button type="button" className="btn sortie-level-btn" aria-label="-" onClick={() => onChange(clamp(level - 1))}>−</button>
      <input
        className="sortie-level-input tnum"
        data-testid="sortie-level-input"
        type="number"
        min={1}
        value={level}
        onChange={(e) => onChange(clamp(parseInt(e.target.value, 10)))}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
        aria-label={t(locale, 'sortie.level.label')}
      />
      <button type="button" className="btn sortie-level-btn" aria-label="+" onClick={() => onChange(clamp(level + 1))}>+</button>
    </div>
  );
}
