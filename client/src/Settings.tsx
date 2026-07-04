// Settings route (#/settings) — REQ-0037 (account block + logout) and
// REQ-0039 "Now" (bot/API-mode placeholder block, the ENTIRE REQ-0039
// scope landing here -- see docs/REQ/REQ-0039-bot-api-pending.md).
// Replaces the generic PlaceholderPage App.tsx used to render for this
// route. Follows the same "fetch /api/me, treat failure as roles-less,
// non-fatal" pattern DexRoot.tsx already established.
import { useEffect, useState } from 'react';
import { fetchMe, type ApiMe } from './api';
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
      <h2>{locale === 'ja' ? '設定' : 'Settings'}</h2>

      <section className="settings-section settings-account">
        <h3>{locale === 'ja' ? 'アカウント' : 'Account'}</h3>
        {me ? (
          <div className="settings-account-body">
            <div className="settings-field">
              <span className="settings-field-label">{locale === 'ja' ? '名前' : 'Name'}</span>
              <span className="settings-field-value">{me.name}</span>
            </div>
            <div className="settings-field">
              <span className="settings-field-label">Player ID</span>
              <span className="settings-field-value settings-field-mono">{me.playerId}</span>
            </div>
            <div className="settings-field">
              <span className="settings-field-label">{locale === 'ja' ? '権限' : 'Roles'}</span>
              <span className="settings-field-value">
                {me.roles.length > 0 ? me.roles.join(', ') : locale === 'ja' ? '（なし）' : '(none)'}
              </span>
            </div>
            <button type="button" className="settings-logout-btn" onClick={logout}>
              {locale === 'ja' ? 'ログアウト' : 'Log out'}
            </button>
          </div>
        ) : (
          <div className="settings-account-error">
            {locale === 'ja'
              ? 'アカウント情報の読み込みに失敗しました' + (error ? `: ${error}` : '')
              : 'Failed to load account info' + (error ? `: ${error}` : '')}
          </div>
        )}
      </section>

      {/* REQ-0039 "Now" scope -- static bilingual placeholder only, no
          interactive elements (no key generation, no input fields). The
          "Pending" section of that REQ is explicitly NOT built here. */}
      <section className="settings-section settings-bot-placeholder">
        <h3>{locale === 'ja' ? 'API・ボットモード' : 'API / Bot mode'}</h3>
        <p>{locale === 'ja' ? '近日公開予定' : 'Coming soon'}</p>
        <p className="settings-bot-placeholder-note">
          {locale === 'ja'
            ? 'ボットや自動化向けのプログラム的アクセスは今後追加予定です。'
            : 'Programmatic access for bots/automation will land in a future update.'}
        </p>
      </section>
    </div>
  );
}
