// client/src/ShortcutHelp.tsx -- REQ-0369 (spec item 2): the ? shortcut
// reference overlay. A static, i18n'd list of the product's gameplay
// bindings (Esc / R / 1..5 / Space / ?) in a standard scrim+modal that
// follows THIS REQ's own conventions via lib/useModalConventions
// (Esc-to-close, overlay-click, focus trap, initial focus). Mounted ONCE
// at App level (like FloatingItemTip); open/closed state lives in
// lib/inputShortcuts.ts's pub-sub (the global ? binding opens it). The
// hook-holding inner component mounts only while open, so its
// document-level Esc listener exists only while the overlay is actually
// on screen (an always-mounted hook would steal Esc from other modals).
// E2E contract (REQ-0369 item 3): additive only -- new testids, no
// existing selector or EN label touched.
import { useSyncExternalStore } from 'react';
import { t, type TranslationKey } from './i18n';
import { closeShortcutHelp, getShortcutHelpOpen, subscribeShortcutHelp } from './lib/inputShortcuts';
import { useModalConventions } from './lib/useModalConventions';
import { useGameStore } from './store';

/** Key glyph -> description key. The glyphs are keyboard keys, not prose --
 * deliberately NOT localized. */
const ROWS: ReadonlyArray<readonly [string, TranslationKey]> = [
  ['Esc', 'shortcuts.escDesc'],
  ['R', 'shortcuts.rDesc'],
  ['1\u20135', 'shortcuts.digitsDesc'],
  ['Space', 'shortcuts.spaceDesc'],
  ['?', 'shortcuts.helpDesc'],
];

export function ShortcutHelp() {
  const open = useSyncExternalStore(subscribeShortcutHelp, getShortcutHelpOpen, getShortcutHelpOpen);
  if (!open) return null;
  return <ShortcutHelpModal />;
}

function ShortcutHelpModal() {
  const snapshot = useGameStore();
  const locale = snapshot.locale;
  const { dialogRef, onScrimClick } = useModalConventions(closeShortcutHelp);
  return (
    <div className="scrim shortcut-help-scrim" data-testid="shortcut-help-overlay" onClick={onScrimClick}>
      <div className="modal panel ornate shortcut-help-modal" role="dialog" aria-modal="true" ref={dialogRef} tabIndex={-1} style={{ maxWidth: 440 }}>
        <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
        <h3 className="ph3 dj" data-testid="shortcut-help-title">{t(locale, 'shortcuts.title')}</h3>
        <table className="shortcut-help-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {ROWS.map(([key, desc]) => (
              <tr key={key}>
                <td style={{ padding: '4px 12px 4px 0', whiteSpace: 'nowrap' }}><kbd className="chip">{key}</kbd></td>
                <td style={{ padding: '4px 0' }}>{t(locale, desc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="btn" data-testid="shortcut-help-close" onClick={closeShortcutHelp}>
            {t(locale, 'shortcuts.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
