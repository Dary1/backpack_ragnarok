// client/src/guide/ContextualHint.tsx -- REQ-0141. A single dismissable,
// non-modal first-time hint toast (spec: "dismissable, never modal-stacked").
// Shows the one currently-active contextual hint surfaced by
// guideController.noteHint(); the persisted seen-flag guarantees each fires at
// most once, ever, per profile.
import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { useGameStore } from '../store';
import { subscribeHint, getActiveHint, dismissHint } from './guideController';

export function ContextualHint() {
  const snap = useGameStore();
  const hint = useSyncExternalStore(subscribeHint, getActiveHint, getActiveHint);
  if (!hint || snap.route !== 'backpacks') return null;
  const locale = snap.locale;
  return (
    <div className="guide-hint" data-guide-hint={hint} role="status">
      <div className="guide-hint-body">{t(locale, `guide.hint.${hint}` as TranslationKey)}</div>
      <button
        type="button"
        className="guide-hint-dismiss"
        data-testid="guide-hint-dismiss"
        aria-label={t(locale, 'guide.hint.dismiss')}
        onClick={dismissHint}
      >
        &times;
      </button>
    </div>
  );
}
