// client/src/i18n/notify.ts -- REQ-0327: the troop-disband notification
// toast strings, extended by REQ-0368 with the notification CENTRE copy
// (bell, nav badges, login digest). en/ja key groups merged by ../i18n.ts
// (the barrel); en/ja key parity is gated there.
export const notifyEn = {
  'notify.troopDisbanded': 'Your troop disbanded — Level {level}.',
  'notify.troopDisbandedNoLevel': 'Your troop disbanded.',
  // REQ-0357: the wipe-streak circuit breaker announced itself.
  'notify.troopDisbandedWipeStreak': 'Your troop disbanded — three expeditions in a row wiped with no progress. Rework the squads before recruiting again.',
  'notify.roomHalted': 'Expedition halted — three runs in a row wiped with no progress. Rework the squad or pick another dungeon.',
  'notify.dismiss': 'Dismiss',
  // ---- REQ-0368: the feed kinds, as one-line bell/digest entries ----
  'notify.runSettledVictory': 'Expedition returned in victory — {loot} spoils banked.',
  'notify.runSettledWipe': 'Expedition wiped — nothing banked.',
  'notify.runSettledIncomplete': 'Expedition returned incomplete — {loot} spoils banked.',
  'notify.marketSettled': 'Sold {item} — {net} ᚠ banked, {burn} ᚠ burned.',
  'notify.warehouseExpiring': '{count} warehouse items expire within a day.',
  'notify.warehouseExpired': '{count} warehouse items expired and were lost.',
  // ---- REQ-0368: the bell ----
  'notify.bell.label': 'Notifications ({count} unread)',
  'notify.bell.title': 'Notifications',
  'notify.bell.empty': 'Nothing new.',
  // ---- REQ-0368: the nav-rail badges (screen-reader text; the visible
  // badge is a shape + a number, never colour alone -- REQ-0143) ----
  'notify.badge.schedule': '{count} expeditions returned',
  'notify.badge.warehouse': '{count} warehouse items expiring',
  // ---- REQ-0368: the login digest ----
  'notify.digest.title': 'While you were away',
  'notify.digest.titleEn': 'THE HALL KEPT WATCH',
  'notify.digest.runs': 'Expeditions returned: {wins} won, {losses} lost',
  'notify.digest.spoils': 'Spoils banked: {count}',
  'notify.digest.market': 'Market income: {net} ᚠ from {count} sales',
  'notify.digest.expired': 'Lost to expiry: {count} items',
  'notify.digest.expiring': 'Expiring within a day: {count} items',
  'notify.digest.gotoSchedule': 'To the expeditions',
  'notify.digest.gotoWarehouse': 'To the warehouse',
  'notify.digest.dismiss': 'Continue',
} as const;

export const notifyJa = {
  'notify.troopDisbanded': '部隊が解散しました — レベル {level}。',
  'notify.troopDisbandedNoLevel': '部隊が解散しました。',
  // REQ-0357
  'notify.troopDisbandedWipeStreak': '部隊を解散しました — 3回連続で進捗ゼロのまま全滅。編成を見直してから再募集してください。',
  'notify.roomHalted': '遠征を停止しました — 3回連続で進捗ゼロのまま全滅。編成の見直しか別のダンジョンを検討してください。',
  'notify.dismiss': '閉じる',
  // ---- REQ-0368 ----
  'notify.runSettledVictory': '遠征が勝利で帰還 — 戦利品 {loot} 点を保管。',
  'notify.runSettledWipe': '遠征は全滅 — 収穫なし。',
  'notify.runSettledIncomplete': '遠征が未踏破で帰還 — 戦利品 {loot} 点を保管。',
  'notify.marketSettled': '{item} が売却 — {net} ᚠ を受領、{burn} ᚠ を焼却。',
  'notify.warehouseExpiring': '倉庫の {count} 点が1日以内に期限切れになります。',
  'notify.warehouseExpired': '倉庫の {count} 点が期限切れで失われました。',
  'notify.bell.label': '通知（未読 {count} 件）',
  'notify.bell.title': '通知',
  'notify.bell.empty': '新しい通知はありません。',
  'notify.badge.schedule': '遠征帰還 {count} 件',
  'notify.badge.warehouse': '倉庫の期限切れ間近 {count} 点',
  'notify.digest.title': '留守のあいだに',
  'notify.digest.titleEn': 'THE HALL KEPT WATCH',
  'notify.digest.runs': '遠征の帰還：{wins} 勝 {losses} 敗',
  'notify.digest.spoils': '保管した戦利品：{count} 点',
  'notify.digest.market': '市場の収入：{count} 件の売却で {net} ᚠ',
  'notify.digest.expired': '期限切れで失われた品：{count} 点',
  'notify.digest.expiring': '1日以内に期限切れ：{count} 点',
  'notify.digest.gotoSchedule': '遠征へ',
  'notify.digest.gotoWarehouse': '倉庫へ',
  'notify.digest.dismiss': '続ける',
} as const;
