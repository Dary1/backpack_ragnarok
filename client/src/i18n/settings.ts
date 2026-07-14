// client/src/i18n/settings.ts -- REQ-0145b (ce): Settings page.
// en/ja key groups merged by ../i18n.ts (the barrel); en/ja key parity
// is gated at the barrel (see the split-commit gate record in the REQ).

export const settingsEn = {

  // Settings (Settings.tsx)
  'settings.title': 'Settings',
  'settings.account': 'Account',
  'settings.name': 'Name',
  'settings.roles': 'Roles',
  'settings.rolesNone': '(none)',
  'settings.logout': 'Log out',
  'settings.accountLoadError': 'Failed to load account info',
  // REQ-0118c: Supabase sign-in (Discord + guest).
  'settings.signInTitle': 'Sign in',
  'settings.signInUnconfigured': 'Sign-in is not configured in this build.',
  'settings.continueWithDiscord': 'Continue with Discord',
  'settings.playAsGuest': 'Play as guest',
  'settings.playingAsGuest': 'Playing as a guest. Link Discord to keep your progress on any device.',
  'settings.signedInDiscord': 'Signed in with Discord as {name}',
  'settings.signOutDiscord': 'Sign out of Discord',
  'settings.botTitle': 'API / Bot mode',
  'settings.botComingSoon': 'Coming soon',
  'settings.botNote': 'Programmatic access for bots/automation will land in a future update.',

  // REQ-0059: Circuit Chimes (+ haptics) controls.
  'settings.soundTitle': 'Sound & Haptics',
  'settings.chimesLabel': 'Circuit chimes',
  'settings.chimesHint': 'Play a deterministic audio signature as your circuit ignites during a run replay.',
  'settings.hapticsLabel': 'Haptics (vibration)',
  'settings.hapticsHint': 'Vibrate in rhythm with the pulse on supported mobile devices.',
  'settings.volumeLabel': 'Volume',
} as const;

export const settingsJa = {

  'settings.title': '設定',
  'settings.account': 'アカウント',
  'settings.name': '名前',
  'settings.roles': '権限',
  'settings.rolesNone': '（なし）',
  'settings.logout': 'ログアウト',
  'settings.accountLoadError': 'アカウント情報の読み込みに失敗しました',
  // REQ-0118c: Supabase sign-in (Discord + guest).
  'settings.signInTitle': 'サインイン',
  'settings.signInUnconfigured': 'このビルドではサインインは設定されていません。',
  'settings.continueWithDiscord': 'Discordで続ける',
  'settings.playAsGuest': 'ゲストとしてプレイ',
  'settings.playingAsGuest': 'ゲストとしてプレイ中です。Discordを連携すると、どの端末でも進行状況を引き継げます。',
  'settings.signedInDiscord': 'Discordで{name}としてサインイン中',
  'settings.signOutDiscord': 'Discordからサインアウト',
  'settings.botTitle': 'API・ボットモード',
  'settings.botComingSoon': '近日公開予定',
  'settings.botNote': 'ボットや自動化向けのプログラム的アクセスは今後追加予定です。',

  // REQ-0059: Circuit Chimes (+ haptics) controls.
  'settings.soundTitle': 'サウンドと振動',
  'settings.chimesLabel': 'サーキットチャイム',
  'settings.chimesHint': 'リプレイ中、回路の起動に合わせて決定論的なオーディオシグネチャを再生します。',
  'settings.hapticsLabel': '振動（ハプティクス）',
  'settings.hapticsHint': '対応するモバイル端末で、パルスのリズムに合わせて振動します。',
  'settings.volumeLabel': '音量',
} as const;
