// client/src/sortie/LaunchBar.tsx -- REQ-0239 (design 01 sec 5): the sticky
// footer -- readiness line (error red / ready green) + the screen's ONE gold
// CTA. Inline errors only (no toast/modal), per design 00 sec 5.
import { t } from '../i18n';
import type { Locale } from '../store';

interface LaunchBarProps {
  locale: Locale;
  dungeonSelected: boolean;
  assignedCount: number;
  launching: boolean;
  error: string | null;
  onLaunch: () => void;
  resumeAvailable?: boolean;
  onResume?: () => void;
}

export function LaunchBar({ locale, dungeonSelected, assignedCount, launching, error, onLaunch, resumeAvailable, onResume }: LaunchBarProps) {
  const missing = 4 - assignedCount;
  const ready = dungeonSelected && missing === 0;
  const statusText = !dungeonSelected
    ? t(locale, 'sortie.launch.needDungeon')
    : missing > 0
      ? t(locale, 'sortie.launch.needSquads', { n: missing })
      : t(locale, 'sortie.launch.ready');
  return (
    <div className="sortie-launchbar" data-testid="sortie-launchbar">
      <div className={`sortie-launch-status${ready ? ' is-ready' : ''}`} data-testid="sortie-launch-status">
        {error ? <span className="sortie-launch-error">{error}</span> : statusText}
      </div>
      <div className="sortie-launch-actions">
        {resumeAvailable && onResume ? (
          <button type="button" className="btn" onClick={onResume} disabled={launching}>{t(locale, 'sortie.launch.resume')}</button>
        ) : null}
        <button
          type="button"
          className="btn btn-forge sortie-launch-btn"
          data-testid="sortie-launch-btn"
          disabled={!ready || launching}
          onClick={onLaunch}
        >
          {launching ? t(locale, 'sortie.launch.launching') : <>{t(locale, 'sortie.launch.button')} ⚔</>}
        </button>
      </div>
    </div>
  );
}
