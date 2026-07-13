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
  'settings.botTitle': 'API / Bot mode',
  'settings.botComingSoon': 'Coming soon',
  'settings.botNote': 'Programmatic access for bots/automation will land in a future update.',
} as const;

export const settingsJa = {

  'settings.title': '設定',
  'settings.account': 'アカウント',
  'settings.name': '名前',
  'settings.roles': '権限',
  'settings.rolesNone': '（なし）',
  'settings.logout': 'ログアウト',
  'settings.accountLoadError': 'アカウント情報の読み込みに失敗しました',
  'settings.botTitle': 'API・ボットモード',
  'settings.botComingSoon': '近日公開予定',
  'settings.botNote': 'ボットや自動化向けのプログラム的アクセスは今後追加予定です。',
} as const;
