// client/src/i18n/notify.ts -- REQ-0327: the troop-disband notification
// toast strings. en/ja key groups merged by ../i18n.ts (the barrel); en/ja
// key parity is gated there. ONE notification kind today (troop_disbanded).
export const notifyEn = {
  'notify.troopDisbanded': 'Your troop disbanded — Level {level}.',
  'notify.troopDisbandedNoLevel': 'Your troop disbanded.',
  // REQ-0357: the wipe-streak circuit breaker announced itself.
  'notify.troopDisbandedWipeStreak': 'Your troop disbanded — three expeditions in a row wiped with no progress. Rework the squads before recruiting again.',
  'notify.roomHalted': 'Expedition halted — three runs in a row wiped with no progress. Rework the squad or pick another dungeon.',
  'notify.dismiss': 'Dismiss',
} as const;

export const notifyJa = {
  'notify.troopDisbanded': '部隊が解散しました — レベル {level}。',
  'notify.troopDisbandedNoLevel': '部隊が解散しました。',
  // REQ-0357
  'notify.troopDisbandedWipeStreak': '部隊を解散しました — 3回連続で進捗ゼロのまま全滅。編成を見直してから再募集してください。',
  'notify.roomHalted': '遠征を停止しました — 3回連続で進捗ゼロのまま全滅。編成の見直しか別のダンジョンを検討してください。',
  'notify.dismiss': '閉じる',
} as const;
