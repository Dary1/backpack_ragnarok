// Settings route (#/settings) — REQ-0037 (account block + logout) and
// REQ-0039 "Now" (bot/API-mode placeholder block, the ENTIRE REQ-0039
// scope landing here -- see docs/REQ/REQ-0039-bot-api-pending.md).
// Replaces the generic PlaceholderPage App.tsx used to render for this
// route. Follows the same "fetch /api/me, treat failure as roles-less,
// non-fatal" pattern DexRoot.tsx already established. Migrated to formal
// chrome i18n (REQ-0038) -- all locale ternaries below go through
// ./i18n.ts's t() now.
//
// REQ-0059: adds the Sound & Haptics block -- the client-only controls for
// Circuit Chimes (chimes on/off, haptics on/off, volume). Prefs persist to
// localStorage via ./schedule/chimes/chimePrefs; a mounted run Monitor's
// ChimeEngine picks up changes live through the CHIME_PREFS_EVENT that
// saveChimePrefs dispatches.
import { useEffect, useState } from 'react';
import { fetchMe, type ApiMe } from './api';
import { t } from './i18n';
import { logout, type Locale } from './store';
import { loadChimePrefs, saveChimePrefs, type ChimePrefs } from './schedule/chimes/chimePrefs';
import { getAuthState, subscribeAuth, signInWithDiscord, signInAsGuest, linkDiscord, signOutSupabase, type AuthState } from './auth/session'; // REQ-0118c

interface SettingsProps {
  locale: Locale;
}

// REQ-0118c: Supabase sign-in block (Continue with Discord / Play as guest,
// and, once signed in, link/upgrade or sign out). Degrades to a "not
// configured" note when the build has no Supabase env (e.g. CI/e2e builds),
// so the REQ-0037 invite/guest path is entirely unaffected there.
function AuthBlock({ locale }: { locale: Locale }) {
  const [auth, setAuth] = useState<AuthState>(() => getAuthState());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => subscribeAuth(() => setAuth(getAuthState())), []);
  const run = async (fn: () => Promise<{ error: unknown } | void>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (r && r.error) setErr(r.error instanceof Error ? r.error.message : String(r.error));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const reload = () => { if (typeof location !== 'undefined') location.reload(); };
  return (
    <section className="settings-section settings-signin" data-testid="settings-signin">
      <h3>{t(locale, 'settings.signInTitle')}</h3>
      {!auth.configured ? (
        <p className="settings-hint" data-testid="settings-signin-unconfigured">{t(locale, 'settings.signInUnconfigured')}</p>
      ) : auth.status === 'discord' || auth.status === 'other' ? (
        <div className="settings-signin-body">
          <p data-testid="settings-signin-status">{t(locale, 'settings.signedInDiscord', { name: auth.name ?? '' })}</p>
          <button type="button" className="settings-signout-btn" data-testid="settings-signout" disabled={busy}
            onClick={() => run(async () => { await signOutSupabase(); reload(); })}>
            {t(locale, 'settings.signOutDiscord')}
          </button>
        </div>
      ) : auth.status === 'anonymous' ? (
        <div className="settings-signin-body">
          <p data-testid="settings-signin-status">{t(locale, 'settings.playingAsGuest')}</p>
          <button type="button" className="settings-link-btn" data-testid="settings-link-discord" disabled={busy}
            onClick={() => run(() => linkDiscord())}>
            {t(locale, 'settings.continueWithDiscord')}
          </button>
        </div>
      ) : (
        <div className="settings-signin-body">
          <button type="button" className="settings-discord-btn" data-testid="settings-continue-discord" disabled={busy}
            onClick={() => run(() => signInWithDiscord())}>
            {t(locale, 'settings.continueWithDiscord')}
          </button>
          <button type="button" className="settings-guest-btn" data-testid="settings-play-guest" disabled={busy}
            onClick={() => run(async () => { const r = await signInAsGuest(); if (r && r.error) return r; reload(); })}>
            {t(locale, 'settings.playAsGuest')}
          </button>
        </div>
      )}
      {err ? <p className="settings-account-error" data-testid="settings-signin-error">{err}</p> : null}
    </section>
  );
}

export function Settings({ locale }: SettingsProps) {
  const [me, setMe] = useState<ApiMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chimePrefs, setChimePrefs] = useState<ChimePrefs>(() => loadChimePrefs());

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

  const updateChimePrefs = (patch: Partial<ChimePrefs>) => {
    setChimePrefs((prev) => {
      const next = { ...prev, ...patch };
      saveChimePrefs(next);
      return next;
    });
  };

  const volumePct = Math.round(chimePrefs.volume * 100);

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

      <AuthBlock locale={locale} />

      {/* REQ-0059: Circuit Chimes + haptics controls (client-only). */}
      <section className="settings-section settings-sound" data-testid="settings-sound">
        <h3>{t(locale, 'settings.soundTitle')}</h3>
        <div className="settings-field settings-toggle">
          <label className="settings-toggle-label">
            <input
              type="checkbox"
              data-testid="settings-chimes-toggle"
              checked={chimePrefs.chimes}
              onChange={(e) => updateChimePrefs({ chimes: e.target.checked })}
            />
            <span className="settings-field-label">{t(locale, 'settings.chimesLabel')}</span>
          </label>
          <p className="settings-hint">{t(locale, 'settings.chimesHint')}</p>
        </div>
        <div className="settings-field settings-toggle">
          <label className="settings-toggle-label">
            <input
              type="checkbox"
              data-testid="settings-haptics-toggle"
              checked={chimePrefs.haptics}
              onChange={(e) => updateChimePrefs({ haptics: e.target.checked })}
            />
            <span className="settings-field-label">{t(locale, 'settings.hapticsLabel')}</span>
          </label>
          <p className="settings-hint">{t(locale, 'settings.hapticsHint')}</p>
        </div>
        <div className="settings-field settings-volume">
          <span className="settings-field-label">{t(locale, 'settings.volumeLabel')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            data-testid="settings-chimes-volume"
            value={volumePct}
            onChange={(e) => updateChimePrefs({ volume: Number(e.target.value) / 100 })}
          />
          <span className="settings-field-value" data-testid="settings-chimes-volume-value">{volumePct}%</span>
        </div>
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
