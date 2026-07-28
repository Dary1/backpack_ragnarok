// client/src/i18n/notify.ts -- REQ-0327: the troop-disband notification
// toast strings. en/ja key groups merged by ../i18n.ts (the barrel); en/ja
// key parity is gated there. ONE notification kind today (troop_disbanded).
export const notifyEn = {
  'notify.troopDisbanded': 'Your troop disbanded — Level {level}.',
  'notify.troopDisbandedNoLevel': 'Your troop disbanded.',
  'notify.dismiss': 'Dismiss',
} as const;

export const notifyJa = {
  'notify.troopDisbanded': '部隊が解散しました — レベル {level}。',
  'notify.troopDisbandedNoLevel': '部隊が解散しました。',
  'notify.dismiss': '閉じる',
} as const;
