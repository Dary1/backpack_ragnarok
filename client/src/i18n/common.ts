// client/src/i18n/common.ts -- REQ-0145b (ce): shell chrome shared across routes -- header, landing/title screen, invite banner, placeholder page.
// en/ja key groups merged by ../i18n.ts (the barrel); en/ja key parity
// is gated at the barrel (see the split-commit gate record in the REQ).

export const commonEn = {

  // Header (Header.tsx)
  'header.status.saved': 'saved ✓',
  'header.status.saving': 'saving…',
  'header.status.offline': 'offline',
  'header.langToggle': '🇯🇵 日本語',

  // Placeholder route (PlaceholderPage.tsx)
  'placeholder.comingSoon': 'This feature is coming soon.',

  // Landing / title screen (landing/LandingPage.tsx) -- REQ-0069.
  // EN side is authored natural English; ja mirrors the mock's copy.
  'landing.menu.continue': 'Continue',
  'landing.menu.continueNote': 'To the canvas',
  'landing.menu.expeditions': 'Watch expeditions',
  'landing.menu.hall': 'Hall — Ragnarok',
  'landing.menu.settings': 'Settings',
  'landing.menu.settingsNote': 'Language & logout',
  'landing.signedInAs': 'Signed in as {name}',
  'landing.copyright': 'backpack_ragnarok © 2026',

  // Invite banner (InviteBanner.tsx)
  'invite.welcome': 'Welcome, {name}!',
  'invite.dismiss': 'Dismiss',
} as const;

export const commonJa = {

  'header.status.saved': '保存済み ✓',
  'header.status.saving': '保存中…',
  'header.status.offline': 'オフライン',
  'header.langToggle': '🇬🇧 EN',

  'placeholder.comingSoon': 'この機能は近日公開予定です。',

  'landing.menu.continue': '続きから',
  'landing.menu.continueNote': '編成の間へ',
  'landing.menu.expeditions': '遠征を見守る',
  'landing.menu.hall': '殿堂 — ラグナロク',
  'landing.menu.settings': '設定',
  'landing.menu.settingsNote': '言語・ログアウト',
  'landing.signedInAs': '{name} としてログイン中',
  'landing.copyright': 'backpack_ragnarok © 2026',

  'invite.welcome': 'ようこそ、{name} さん！',
  'invite.dismiss': '閉じる',
} as const;
