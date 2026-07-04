// Settings route (#/settings) — REQ-0037 (account block + logout) and
// REQ-0039 "Now" (bot/API-mode placeholder block, the ENTIRE REQ-0039
// scope landing here -- see docs/REQ/REQ-0039-bot-api-pending.md).
// Replaces the generic PlaceholderPage App.tsx used to render for this
// route. Follows the same "fetch /api/me, treat failure as roles-less,
// non-fatal" pattern DexRoot.tsx already established. Migrated to formal
// chrome i18n (REQ-0038) -- all locale ternaries below go through
// ./i18n.ts's t() now.
import { useEffect, useState } from 'react';
import { fetchMe, type ApiMe } from './api';
import { t } from './i18n';
import { logout, type Locale } from './store';

interface SettingsProps {
  locale: Locale;
}

export function Settings({ locale }: SettingsProps) {
  const [me, setMe] = useState<ApiMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch((e) => {
        if (!cancelled) {
          setMe(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="settings-page">
      <h2>{t(locale, 'settings.title')}</h2>

      <section className="settings-section settings-account">
        <h3>{t(locale, 'settings.account')}</h3>
        {me ? (
          <div className="settings-account-body">
            <div className="settings-field">
              <span className="settings-field-label">{t(locale, 'settings.name')}</span>
              <span className="settings-field-value">{me.name}</span>
            </div>
            <div className="settings-field">
              <span className="settings-field-label">Player ID</span>
              <span className="settings-field-value settings-field-mono">{me.playerId}</span>
            </div>
            <div className="settings-field">
              <span className="settings-field-label">{t(locale, 'settings.roles')}</span>
              <span className="settings-field-value">
                {me.roles.length > 0 ? me.roles.join(', ') : t(locale, 'settings.rolesNone')}
              </span>
            </div>
            <button type="button" className="settings-logout-btn" onClick={logout}>
              {t(locale, 'settings.logout')}
            </button>
          </div>
        ) : (
          <div className="settings-account-error">
            {t(locale, 'settings.accountLoadError') + (error ? `: ${error}` : '')}
          </div>
        )}
      </section>

      {/* REQ-0039 "Now" scope -- static bilingual placeholder only, no
          interactive elements (no key generation, no input fields). The
          "Pending" section of that REQ is explicitly NOT built here. */}
      <section className="settings-section settings-bot-placeholder">
        <h3>{t(locale, 'settings.botTitle')}</h3>
        <p>{t(locale, 'settings.botComingSoon')}</p>
        <p className="settings-bot-placeholder-note">{t(locale, 'settings.botNote')}</p>
      </section>
    </div>
  );
}
