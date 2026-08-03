// Settings route (#/settings) — REQ-0037 (account block; REQ-0362 removed its
// Logout button -- AuthBlock below is now the app's single sign-out control)
// and REQ-0039 "Now" (bot/API-mode placeholder block, the ENTIRE REQ-0039
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
import { ApiError, clearStoredToken, fetchMe, getStoredToken, type ApiMe } from './api';
import { t } from './i18n';
import { setRoute, type Locale } from './store';
import { loadChimePrefs, saveChimePrefs, type ChimePrefs } from './schedule/chimes/chimePrefs';
import { loadMotionPrefs, saveMotionPrefs, type MotionPrefs } from './a11y/motionPrefs'; // REQ-0143
import { replayGuide } from './guide/guideController'; // REQ-0141
import { getAuthState, subscribeAuth, signInWithDiscord, signInAsGuest, linkDiscord, signOutSupabase, type AuthState } from './auth/session'; // REQ-0118c

interface SettingsProps {
  locale: Locale;
}

// REQ-0118c: Supabase sign-in block (Continue with Discord / Play as guest,
// and, once signed in, link/upgrade or sign out). Degrades to a "not
// configured" note when the build has no Supabase env (e.g. CI/e2e builds),
// so the REQ-0037 invite/guest path is entirely unaffected there.
//
// REQ-0362: this block is now the app's ONLY sign-out control. The account
// block above used to carry its own Logout button wired to store's logout(),
// which cleared ONLY the REQ-0037 invite token and reloaded. On a Supabase
// session that is a no-op the user can see: auth/client.ts builds the client
// with persistSession: true, so initSupabaseAuth() restores the identical
// session on the very next boot -- and the hash was still #/settings, so the
// page came back byte-identical and the button read as inert. signOut() below
// drops BOTH credentials and lands on the landing route.
//
// Two consequences of that merge, both deliberate:
//   - the button must ALSO appear when Supabase is unconfigured or signed_out
//     but an invite token is stored. An env-less CI/e2e build has no Supabase
//     client at all, so the REQ-0037 invite path is the only auth path there;
//     gating sign-out on auth.configured would delete its only exit.
//   - 'anonymous' gains a sign-out button it never had, so a guest is no
//     longer permanently stuck in that session.
function AuthBlock({ locale }: { locale: Locale }) {
  const [auth, setAuth] = useState<AuthState>(() => getAuthState());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // REQ-0362: read ONCE at mount. The only writer during this page's life is
  // signOut() below, which reloads, so this can never go stale under us.
  const [hasInviteToken] = useState(() => getStoredToken() !== null);
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
  // REQ-0362: sign-out reboots onto the LANDING route. Assigning the hash
  // before reload() means the fresh boot routes straight there instead of
  // flashing a signed-out #/settings -- reloading in place is exactly what
  // made the old Logout button look like it had done nothing.
  const signOut = async () => {
    await signOutSupabase(); // no-op when Supabase is not configured
    clearStoredToken();      // REQ-0037 invite token
    if (typeof location === 'undefined') return;
    location.hash = '#/';
    location.reload();
  };
  const signOutButton = (
    <button type="button" className="settings-signout-btn" data-testid="settings-signout" disabled={busy}
      onClick={() => run(signOut)}>
      {t(locale, 'settings.signOut')}
    </button>
  );
  const inviteStatus = hasInviteToken
    ? <p data-testid="settings-signin-status">{t(locale, 'settings.signedInWithInvite')}</p>
    : null;
  return (
    <section className="settings-section settings-signin" data-testid="settings-signin">
      <h3>{t(locale, 'settings.signInTitle')}</h3>
      {auth.status === 'discord' || auth.status === 'other' ? (
        <div className="settings-signin-body">
          <p data-testid="settings-signin-status">{t(locale, 'settings.signedInDiscord', { name: auth.name ?? '' })}</p>
          {signOutButton}
        </div>
      ) : auth.status === 'anonymous' ? (
        <div className="settings-signin-body">
          <p data-testid="settings-signin-status">{t(locale, 'settings.playingAsGuest')}</p>
          <button type="button" className="settings-link-btn" data-testid="settings-link-discord" disabled={busy}
            onClick={() => run(() => linkDiscord())}>
            {t(locale, 'settings.continueWithDiscord')}
          </button>
          {signOutButton}
        </div>
      ) : !auth.configured ? (
        <div className="settings-signin-body">
          <p className="settings-hint" data-testid="settings-signin-unconfigured">{t(locale, 'settings.signInUnconfigured')}</p>
          {inviteStatus}
          {hasInviteToken ? signOutButton : null}
        </div>
      ) : (
        <div className="settings-signin-body">
          {inviteStatus}
          <button type="button" className="settings-discord-btn" data-testid="settings-continue-discord" disabled={busy}
            onClick={() => run(() => signInWithDiscord())}>
            {t(locale, 'settings.continueWithDiscord')}
          </button>
          <button type="button" className="settings-guest-btn" data-testid="settings-play-guest" disabled={busy}
            onClick={() => run(async () => { const r = await signInAsGuest(); if (r && r.error) return r; reload(); })}>
            {t(locale, 'settings.playAsGuest')}
          </button>
          {hasInviteToken ? signOutButton : null}
        </div>
      )}
      {err ? <p className="settings-account-error" data-testid="settings-signin-error">{err}</p> : null}
    </section>
  );
}

export function Settings({ locale }: SettingsProps) {
  const [me, setMe] = useState<ApiMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  // REQ-0365: a 401 here is not a load failure -- it is the server saying there
  // is no account to show (dev_mode OFF + no credential). Showing
  // 'Failed to load account info' for it would send the one user who CAN fix it
  // looking for an outage instead of at the sign-in block right below.
  const [signedOut, setSignedOut] = useState(false);
  const [chimePrefs, setChimePrefs] = useState<ChimePrefs>(() => loadChimePrefs());
  const [motionPrefs, setMotionPrefs] = useState<MotionPrefs>(() => loadMotionPrefs()); // REQ-0143

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch((e) => {
        if (!cancelled) {
          setMe(null);
          if (e instanceof ApiError && e.status === 401) { setSignedOut(true); setError(null); return; }
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

  // REQ-0143: reduced-motion. saveMotionPrefs persists + applies the document
  // attributes + fires the same-tab change event the renderer listens on.
  const updateMotionPrefs = (patch: Partial<MotionPrefs>) => {
    setMotionPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveMotionPrefs(next);
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
          </div>
        ) : signedOut ? (
          <div className="settings-account-signedout" data-testid="settings-account-signedout">
            {t(locale, 'settings.notSignedIn')}
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

      {/* REQ-0141: first-run guide replay control. */}
      <section className="settings-section settings-guide" data-testid="settings-guide">
        <h3>{t(locale, 'guide.settings.title')}</h3>
        <p className="settings-hint">{t(locale, 'guide.settings.desc')}</p>
        <button
          type="button"
          className="settings-guide-replay"
          data-testid="settings-guide-replay"
          onClick={() => { replayGuide(); setRoute('backpacks'); }}
        >
          {t(locale, 'guide.settings.replay')}
        </button>
      </section>

      {/* REQ-0143: Accessibility -- reduced-motion toggle + a colourblind-safe
          note. Reduced-motion seeds from prefers-reduced-motion and, once
          toggled, is honoured app-wide (Ragnarok Frame slow-mo, beam anim,
          charge pulses) via a11y/motionPrefs. */}
      <section className="settings-section settings-a11y" data-testid="settings-a11y">
        <h3>{t(locale, 'settings.a11yTitle')}</h3>
        <div className="settings-field settings-toggle">
          <label className="settings-toggle-label">
            <input
              type="checkbox"
              data-testid="settings-reduced-motion-toggle"
              checked={motionPrefs.reducedMotion}
              onChange={(e) => updateMotionPrefs({ reducedMotion: e.target.checked })}
            />
            <span className="settings-field-label">{t(locale, 'settings.reducedMotionLabel')}</span>
          </label>
          <p className="settings-hint">{t(locale, 'settings.reducedMotionHint')}</p>
        </div>
        <p className="settings-hint" data-testid="settings-a11y-colorblind-note">{t(locale, 'settings.colorblindNote')}</p>
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
