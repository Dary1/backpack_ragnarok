// client/src/i18n/nav.ts -- REQ-0145b (ce): nav-rail labels (Nav.tsx).
// en/ja key groups merged by ../i18n.ts (the barrel); en/ja key parity
// is gated at the barrel (see the split-commit gate record in the REQ).

export const navEn = {
  // Nav (Nav.tsx)
  // REQ-0377 item 9 (user call): 'Backpacks' -> 'Squad'. The hall behind
  // this entry is a squad's canvas PLUS its inventory pages, and Squad is
  // exactly the engine's name for the canvas owner (REQ-0123 terminology;
  // shared/engine.d.ts, "One squad's canvas snapshot") -- so the label now
  // names the thing being edited instead of one kind of piece on it. The ja
  // label is unchanged; it never had the problem. The e2e EN-label click
  // contract moved in this same change (see Nav.tsx's header).
  // 'nav.friends' below is KEPT even though REQ-0377 item 1 dropped Friends
  // from the rail: App.tsx still renders PlaceholderPage titleKey=
  // "nav.friends" for a '#/friends' deep link.
  'nav.backpacks': 'Squad',
  'nav.schedule': 'Schedule',
  'nav.warehouse': 'Warehouse', // REQ-0086
  'nav.workshop': 'Workshop', // REQ-0042
  'nav.friends': 'Friends',
  'nav.dex': 'Dex',
  'nav.settings': 'Settings',
  // REQ-0069: MJOLNIR chrome -- routes from the mock rail whose real
  // pages land in later REQs, + the rail logo's accessible label.
  'nav.market': 'Market',
  'nav.ragnarok': 'Ragnarok',
  'nav.logoLabel': 'Back to title',
} as const;

export const navJa = {
  // REQ-0069: the ja rail labels adopt the mock's vocabulary (編成/
  // 遠征) -- they also FIT the 86px rail, which the old katakana names
  // do not. EN labels stay as-is (the E2E suite clicks them by text).
  'nav.backpacks': '編成',
  'nav.schedule': '遠征',
  'nav.warehouse': '倉庫', // REQ-0086
  'nav.workshop': '工房',
  'nav.friends': 'フレンズ',
  'nav.dex': '図鑑',
  'nav.settings': '設定',
  'nav.market': '市場',
  'nav.ragnarok': '殿堂',
  'nav.logoLabel': 'タイトルへ戻る',
} as const;
