// client/src/sortie/stateChip.tsx -- REQ-0239 (design 00 sec 3): the ONE
// canonical squad/room lifecycle state chip -- color + icon + WORD triple,
// reused by the sortie shelf/slots AND the squad status board so a state never
// gets a second visual. A11y: the state word is always present as TEXT (color
// is never the only encoding), matching the rarity double-encoding doctrine.
import type { ReactNode } from 'react';
import { t, type TranslationKey } from '../i18n';
import type { Locale } from '../store';

export type SquadStateKey =
  | 'ready'
  | 'deployed'
  | 'recovering'
  | 'cancelReserved'
  | 'undeployable'
  | 'staging'
  | 'returning';

// Icons per 00 sec 3 (deployed ⚔, recovering ❄, cancelReserved ⌛, undeployable
// ⛔, ready ● dot). staging/returning extend the ramp for the board (02).
const STATE_ICON: Record<SquadStateKey, string> = {
  ready: '',
  deployed: '⚔',
  recovering: '❄',
  cancelReserved: '⌛',
  undeployable: '⛔',
  staging: '◆',
  returning: '',
};

interface StateChipProps {
  stateKey: SquadStateKey;
  label: string;
  /** the deployed ⚔ chip reuses the .chip.is-live heartbeat (design 02 sec 6). */
  live?: boolean;
  testId?: string;
  children?: ReactNode;
}

/** The state chip: `.chip.st-<key>` carries the color+border+dot tint (defined
 * in sortie.css); the icon glyph + the localized WORD are the redundant text
 * encoding. `data-state` lets the e2e suite assert the derived state. */
export function StateChip({ stateKey, label, live, testId }: StateChipProps) {
  const icon = STATE_ICON[stateKey];
  return (
    <span
      className={`chip st-${stateKey}${live ? ' is-live' : ''}`}
      data-state={stateKey}
      data-testid={testId}
    >
      <span className="dot" aria-hidden="true" />
      {icon ? <span className="chip-icon" aria-hidden="true">{icon}</span> : null}
      {label}
    </span>
  );
}

// The canonical localized WORD for a state (design 00 sec 3 triple), sourced
// from the board i18n keys so the sortie page and the board never disagree on
// the word for a state.
const STATE_LABEL_KEY: Record<SquadStateKey, TranslationKey> = {
  ready: 'schedule.board.stateReady',
  deployed: 'schedule.board.stateDeployed',
  recovering: 'schedule.board.stateRecovering',
  cancelReserved: 'schedule.board.cancelReserved',
  undeployable: 'schedule.board.stateUndeployable',
  staging: 'schedule.board.stateStaging',
  returning: 'schedule.board.returning',
};

export function stateLabel(locale: Locale, key: SquadStateKey): string {
  return t(locale, STATE_LABEL_KEY[key]);
}
