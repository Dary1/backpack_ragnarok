// client/src/i18n/common.ts -- REQ-0145b (ce): shell chrome shared across routes -- header, landing/title screen, invite banner, placeholder page.
// en/ja key groups merged by ../i18n.ts (the barrel); en/ja key parity
// is gated at the barrel (see the split-commit gate record in the REQ).

export const commonEn = {

  // Header (Header.tsx)
  'header.status.saved': 'saved ✓',
  'header.status.saving': 'saving…',
  'header.status.offline': 'offline',
  'header.langToggle': '🇯🇵 日本語',

  // Held-TM balance HUD (TmHud.tsx) -- REQ-0205. aria-label for the strip;
  // per-TM tooltip text is CONTENT i18n (the served TM def), not a chrome key.
  'hud.tmAria': 'Held currencies',

  // Placeholder route (PlaceholderPage.tsx)
  'placeholder.comingSoon': 'This feature is coming soon.',

  // Landing / title screen (landing/LandingPage.tsx) -- REQ-0069.
  // EN side is authored natural English; ja mirrors the mock's copy.
  'landing.menu.continue': 'Continue',
  'landing.menu.continueNote': 'To the canvas',
  'landing.menu.expeditions': 'Watch expeditions',
  'landing.menu.hall': 'Hall — Ragnarok',
  'landing.menu.settings': 'Settings',
  'landing.menu.settingsNote': 'Language & account',
  'landing.signedInAs': 'Signed in as {name}',
  // REQ-0365: shown INSTEAD of signedInAs when the server returned 401.
  'landing.signInRequired': 'Sign in to play.',
  'landing.signIn': 'Sign in',
  'landing.copyright': 'backpack_ragnarok © 2026',

  // Invite banner (InviteBanner.tsx)
  'invite.welcome': 'Welcome, {name}!',
  'invite.dismiss': 'Dismiss',

  // Contained render error (RenderErrorBoundary.tsx) -- REQ-0336. Deliberately
  // generic: the same card fronts any surface that can fail to draw, and the
  // point of the copy is that the REST of the app is still usable.
  'render.error.title': 'This part could not be drawn',
  'render.error.body': 'Something went wrong rendering this view. Nothing was lost, and the rest of the app is unaffected.',
  'render.error.retry': 'Try again',

  // REQ-0369: the ? shortcut-reference overlay (ShortcutHelp.tsx). Key
  // GLYPHS are hardcoded in the component; only prose is localized.
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.escDesc': 'Close the open dialog or tooltip',
  'shortcuts.rDesc': 'Rotate the piece under drag or float (Backpacks)',
  'shortcuts.digitsDesc': 'Switch the active squad tab (Backpacks)',
  'shortcuts.spaceDesc': 'Play / pause an expedition replay',
  'shortcuts.helpDesc': 'Open this shortcut reference',
  'shortcuts.close': 'Close',
} as const;

export const commonJa = {

  'header.status.saved': '保存済み ✓',
  'header.status.saving': '保存中…',
  'header.status.offline': 'オフライン',
  'header.langToggle': '🇬🇧 EN',

  'hud.tmAria': '所持通貨',

  'placeholder.comingSoon': 'この機能は近日公開予定です。',

  'landing.menu.continue': '続きから',
  'landing.menu.continueNote': '編成の間へ',
  'landing.menu.expeditions': '遠征を見守る',
  'landing.menu.hall': '殿堂 — ラグナロク',
  'landing.menu.settings': '設定',
  'landing.menu.settingsNote': '言語・アカウント',
  'landing.signedInAs': '{name} としてログイン中',
  'landing.signInRequired': 'プレイするにはサインインが必要です。',
  'landing.signIn': 'サインイン',
  'landing.copyright': 'backpack_ragnarok © 2026',

  'invite.welcome': 'ようこそ、{name} さん！',
  'invite.dismiss': '閉じる',

  'render.error.title': 'この部分を描画できませんでした',
  'render.error.body': 'この表示の描画中に問題が発生しました。データは失われておらず、他の画面には影響ありません。',
  'render.error.retry': '再試行',

  // REQ-0369
  'shortcuts.title': 'キーボードショートカット',
  'shortcuts.escDesc': '開いているダイアログやツールチップを閉じる',
  'shortcuts.rDesc': 'ドラッグ/フロート中のピースを回転(編成画面)',
  'shortcuts.digitsDesc': '操作する分隊タブを切り替え(編成画面)',
  'shortcuts.spaceDesc': '遠征リプレイの再生/一時停止',
  'shortcuts.helpDesc': 'このショートカット一覧を開く',
  'shortcuts.close': '閉じる',
} as const;
