// client/src/sortie/LaunchBar.tsx -- REQ-0239 (design 01 sec 5): the sticky
// footer -- readiness line (error red / ready green) + the screen's ONE gold
// CTA. Inline errors only (no toast/modal), per design 00 sec 5.
import { t } from '../i18n';
import type { Locale } from '../store';

interface LaunchBarProps {
  locale: Locale;
  assignedCount: number;
  launching: boolean;
  error: string | null;
  onLaunch: () => void;
  resumeAvailable?: boolean;
  onResume?: () => void;
}

export function LaunchBar({ locale, assignedCount, launching, error, onLaunch, resumeAvailable, onResume }: LaunchBarProps) {
  const missing = 4 - assignedCount;
  // REQ-0337: the bar has THREE states now, not two. Any seat the player leaves
  // empty is not a shortfall any more -- it is the recruitment. So:
  //   0 squads  -> not ready (there is nothing to send).
  //   1-3       -> ready, in RECRUIT mode: the empty seats are advertised
  //                publicly and the button opens the recruitment rather than
  //                marching. Copy must not promise a departure -- the Troop only
  //                departs once other players take those seats (REQ-0325).
  //   4         -> ready, SOLO mode: unchanged wording and unchanged behavior.
  const ready = assignedCount >= 1;
  const recruiting = ready && missing > 0;
  const statusText = !ready
    ? t(locale, 'sortie.launch.needAnySquad')
    : recruiting
      ? t(locale, 'sortie.recruit.willOpen', { n: missing })
      : t(locale, 'sortie.launch.ready');
  return (
    <div className="sortie-launchbar" data-testid="sortie-launchbar">
      <div className={`sortie-launch-status${ready ? ' is-ready' : ''}${recruiting ? ' is-recruiting' : ''}`} data-testid="sortie-launch-status" data-mode={recruiting ? 'recruit' : 'solo'}>
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
          {launching
            ? t(locale, recruiting ? 'sortie.recruit.opening' : 'sortie.launch.launching')
            : recruiting
              ? <>{t(locale, 'sortie.recruit.button')} ⚑</>
              : <>{t(locale, 'sortie.launch.button')} ⚔</>}
        </button>
      </div>
    </div>
  );
}
