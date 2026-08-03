// Landing (title) screen — REQ-0069. Port of the design mock
// web/redesign/index.html into the SPA as the empty-hash ('#/') route.
//
// What it is: a full-bleed fixed overlay (game title screen) with the
// key art, aurora + ember-particle atmosphere, the gold RAGNARÖK logo
// lockup, and a main menu whose entries deep-link into the app's hash
// routes via the store's setRoute() (no <a href> — same routing path the
// rail uses). It renders ONLY while `route === 'landing'` and is plain
// DOM: mounting/unmounting it never touches the always-mounted
// backpacks-view or its Pixi Applications (App.tsx's REQ-0034 hard rule).
//
// Static art is referenced from the served /redesign/assets/ path (the
// shared mock asset pool on the same origin) — deliberately NOT imported
// into the Vite bundle, per REQ-0069 ("no duplication"). Under `vite
// dev` those URLs 404 harmlessly (no /redesign proxy is configured —
// dev-mode /api is equally unproxied today); the deployed/E2E origin
// (static :8801 / the tunnel) serves them.
//
// Deviations from the mock, all deliberate (REQ-0069 report notes):
//  - No "press to begin" gate / SKIP-LANDING localStorage toggle: the
//    menu is open immediately. The skip feature changes boot routing and
//    is out of REQ-0069's scope.
//  - No season slab / countdown / Muninn notice: the client has no
//    season or notice data to back them; rather than hardcode fiction
//    they are omitted until a season REQ exists.
//  - The mock's fake save summary (caravan level, currency, dex counts)
//    is replaced by the one line of real identity we have: the resolved
//    /api/me player name.
//  - No pointer parallax (fx.js initParallax): decorative, needs a
//    document-level pointermove listener; skipped for now.
//  - Settings rune is ᛟ (matching the rail) instead of the mock's ᛈ,
//    which the rail already uses for Workshop.
import { useEffect, useRef } from 'react';
import type { ApiMe } from '../api';
import { t, type TranslationKey } from '../i18n';
import type { Locale, Route } from '../store';
import { setLocale, setRoute } from '../store';
import { particlesAllowed, startEmberField } from './particles';
import './landing.css';

/** Served by the :8801 static host (and the tunnel) from web/redesign/. */
const ASSET_BASE = '/redesign/assets';

interface MenuEntry {
  route: Route;
  rune: string;
  labelKey: TranslationKey;
  noteKey?: TranslationKey;
}

/** Mock main-menu entries mapped onto real app routes (REQ-0069: "nav
 * entries deep-link to app routes"): 続きから → backpacks, 遠征を見守る →
 * schedule, 殿堂 → ragnarok (placeholder), 設定 → settings. */
const MENU: MenuEntry[] = [
  { route: 'backpacks', rune: 'ᛗ', labelKey: 'landing.menu.continue', noteKey: 'landing.menu.continueNote' },
  { route: 'schedule', rune: 'ᚱ', labelKey: 'landing.menu.expeditions' },
  { route: 'ragnarok', rune: 'ᛏ', labelKey: 'landing.menu.hall' },
  { route: 'settings', rune: 'ᛟ', labelKey: 'landing.menu.settings', noteKey: 'landing.menu.settingsNote' },
];

interface LandingPageProps {
  locale: Locale;
  me: ApiMe | null;
  /** REQ-0365: the server refused to identify the caller (status:'signed_out').
   * Everything behind the menu needs a profile, so the deep-link entries are
   * genuinely disabled rather than routed-then-bounced -- a button that visibly
   * does nothing when pressed is the exact defect REQ-0362 was filed for, and
   * a bounce is the same lie with extra steps. Only 設定/Settings stays live,
   * because that is where sign-in is. */
  signedOut?: boolean;
}

export function LandingPage({ locale, me, signedOut = false }: LandingPageProps) {
  const pfxRef = useRef<HTMLCanvasElement | null>(null);

  // Perf-gated, E2E-off ember/snow field (see particles.ts's gating
  // notes). The disposer returned by startEmberField() is the effect
  // cleanup, so route round-trips never stack render loops.
  useEffect(() => {
    if (!particlesAllowed() || !pfxRef.current) return;
    return startEmberField(pfxRef.current, { mix: 'both', count: 64 });
  }, []);

  return (
    <div className="landing-stage grain vignette">
      <img className="landing-bg" src={`${ASSET_BASE}/key_title.jpg`} alt="" />
      <div className="landing-aurora" aria-hidden="true" />
      <canvas ref={pfxRef} className="landing-pfx" aria-hidden="true" />
      <div className="landing-shade" aria-hidden="true" />

      <header className="landing-logo">
        {/* triple horn of Odin mark (same as the rail logo) */}
        <svg className="landing-mark" viewBox="0 0 100 84" fill="none" stroke="#C9A959" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true">
          <path d="M50 12 a23 23 0 1 1 -20 34" />
          <path d="M69 27 a23 23 0 1 1 -33 27" />
          <path d="M31 27 a23 23 0 1 0 33 27" />
        </svg>
        {/* Brand lockup — not locale-switched (it is the game's mark). */}
        <div className="landing-logo-en den">BACKPACK</div>
        <h1 className="landing-logo-main">RAGNARÖK</h1>
        <svg className="landing-logo-under" viewBox="0 0 420 14" fill="none" stroke="#C9A959" aria-hidden="true">
          <path d="M8 7 H176 M244 7 H412" strokeWidth="1" opacity=".7" />
          <path d="M186 7 l12 -5 l12 5 l-12 5 z" strokeWidth="1.2" />
          <path d="M198 7 l12 -5 l12 5 l-12 5 z" strokeWidth="1.2" opacity=".65" />
          <circle cx="180" cy="7" r="1.6" fill="#C9A959" stroke="none" />
          <circle cx="240" cy="7" r="1.6" fill="#C9A959" stroke="none" />
        </svg>
        <div className="landing-logo-jp dj">バックパック・ラグナロク</div>
      </header>

      <nav className="landing-menu panel ornate" aria-label="title menu">
        <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
        {MENU.map((entry) => {
          const locked = signedOut && entry.route !== 'settings';
          return (
            <button key={entry.route} type="button" className={'landing-mi' + (locked ? ' landing-mi-locked' : '')}
              disabled={locked} data-testid={'landing-mi-' + entry.route}
              onClick={() => setRoute(entry.route)}>
              <span className="landing-mi-rune rune" aria-hidden="true">
                {entry.rune}
              </span>
              {t(locale, entry.labelKey)}
              {entry.noteKey ? <span className="landing-mi-note">{t(locale, entry.noteKey)}</span> : null}
            </button>
          );
        })}
        {signedOut ? (
          <div className="landing-signin-cta" data-testid="landing-signed-out">
            <span>{t(locale, 'landing.signInRequired')}</span>
            <button type="button" className="landing-signin-btn" data-testid="landing-signin"
              onClick={() => setRoute('settings')}>
              {t(locale, 'landing.signIn')}
            </button>
          </div>
        ) : me ? <div className="landing-savechip">{t(locale, 'landing.signedInAs', { name: me.name })}</div> : null}
      </nav>

      <div className="landing-corner landing-corner-tr">
        <button
          type="button"
          className="landing-langchip"
          onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}
        >
          {t(locale, 'header.langToggle')}
        </button>
      </div>
      <div className="landing-corner landing-corner-br">{t(locale, 'landing.copyright')}</div>
    </div>
  );
}
