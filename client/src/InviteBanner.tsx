// Welcome banner — REQ-0037, migrated to formal chrome i18n (REQ-0038).
// Minimal, dependency-free "toast" shown right after the #/invite/<token>
// route flow resolves a player (see store.ts's handleInviteRoute()). No
// toast library exists in this app -- this is a small fixed-position
// banner driven entirely by the module store's `welcomeBanner` field
// (null = hidden), consistent with the app's existing "plain CSS +
// module-store state" style (e.g. the auto-save status indicator in
// Header.tsx).
import { t } from './i18n';
import { clearWelcomeBanner, type Locale } from './store';

interface InviteBannerProps {
  text: string | null;
  locale: Locale;
}

export function InviteBanner({ text, locale }: InviteBannerProps) {
  if (!text) return null;
  return (
    <div className="invite-banner" role="status">
      <span className="invite-banner-text">{t(locale, 'invite.welcome', { name: text })}</span>
      <button
        type="button"
        className="invite-banner-close"
        onClick={clearWelcomeBanner}
        aria-label={t(locale, 'invite.dismiss')}
      >
        ×
      </button>
    </div>
  );
}
