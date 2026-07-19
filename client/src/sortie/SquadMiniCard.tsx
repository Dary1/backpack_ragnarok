// client/src/sortie/SquadMiniCard.tsx -- REQ-0239 (design 01 sec 6.1): the
// ONLY squad representation on the sortie page -- a compact summary (microgrid +
// unit strip + state chip + conflict strip). NO full inventory grid anywhere.
import { getItemArtUrl } from '../board/itemArt';
import { t } from '../i18n';
import type { Locale } from '../store';
import { SquadMicrogrid } from './SquadMicrogrid';
import { StateChip, stateLabel, type SquadStateKey } from './stateChip';
import type { SquadInfo } from './useSquadConflicts';

interface SquadMiniCardProps {
  locale: Locale;
  info: SquadInfo;
  stateKey: SquadStateKey;
  /** '壱'..'肆' when assigned to a troop slot -> gold ring + ordinal badge. */
  assignedOrdinal?: string | null;
  /** desaturated + red link strip when this squad conflicts with an assigned one. */
  conflicted?: boolean;
  /** red strip text: "共有: {item} ×{n}（{squad}と）" (design 01 sec 6.3 rule 2). */
  conflictStrip?: string | null;
  /** hover tooltip listing the shared units. */
  conflictTooltip?: string | null;
  /** symmetry strip on the assigned card: "この部隊を使うと {names} が出撃不可" (rule 3). */
  blocksStrip?: string | null;
  /** passive gold link badge (informational) when this squad shares a uid with any other. */
  showSharedBadge?: boolean;
  deployedDungeonName?: string | null;
  /** "帰還 12:41" / "再出撃 00:41" secondary line for deployed/recovering. */
  freesLabel?: string | null;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}

const MAX_ICONS = 4;

export function SquadMiniCard(props: SquadMiniCardProps) {
  const {
    locale, info, stateKey, assignedOrdinal, conflicted, conflictStrip, conflictTooltip,
    blocksStrip, showSharedBadge, deployedDungeonName, freesLabel, onClick, disabled, testId,
  } = props;
  const clickable = !!onClick && !disabled;
  const bps = info.canvas?.bps ?? [];
  const iconBps = bps.slice(0, MAX_ICONS);
  const overflow = bps.length - iconBps.length;

  const classes = [
    'sortie-squad-card',
    'panel',
    assignedOrdinal ? 'is-assigned' : '',
    conflicted ? 'is-conflict' : '',
    disabled ? 'is-disabled' : '',
    clickable ? 'is-clickable' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      data-testid={testId}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      } : undefined}
      title={conflictTooltip ?? undefined}
    >
      <div className="sortie-squad-card-head">
        <SquadMicrogrid canvas={info.canvas} size={40} />
        <div className="sortie-squad-card-id">
          <span className="dj sortie-squad-name" title={info.name}>{info.name}</span>
          <StateChip stateKey={stateKey} label={stateLabel(locale, stateKey)} live={stateKey === 'deployed'} testId={testId ? `${testId}-state` : undefined} />
        </div>
        {assignedOrdinal ? <span className="sortie-slot-ordinal-badge" aria-hidden="true">{assignedOrdinal}</span> : null}
        {showSharedBadge && !conflicted && !assignedOrdinal ? (
          <span className="sortie-shared-badge" title={t(locale, 'sortie.squad.sharedBadge', { n: info.sharedBadgeCount })}>
            🔗<span className="tnum">{info.sharedBadgeCount}</span>
          </span>
        ) : null}
      </div>

      <div className="sortie-squad-card-units">
        <div className="sortie-unit-strip">
          {iconBps.map((bp, i) => {
            const url = getItemArtUrl(bp.unit?.id);
            return url
              ? <img key={i} className="sortie-unit-icon" src={url} alt="" loading="lazy" />
              : <span key={i} className="sortie-unit-icon sortie-unit-dot" style={{ backgroundColor: bp.color || 'var(--bone-3)' }} aria-hidden="true" />;
          })}
          {overflow > 0 ? <span className="sortie-unit-more t-micro tnum">+{overflow}</span> : null}
        </div>
        <span className="sortie-squad-meta t-micro tnum">{t(locale, 'sortie.squad.bp', { n: info.bpCount })}</span>
        {info.chargeCount > 0 ? <span className="sortie-squad-meta t-micro tnum">{t(locale, 'sortie.squad.charge', { n: info.chargeCount })}</span> : null}
      </div>

      {conflictStrip ? (
        <div className="sortie-conflict-strip" title={conflictTooltip ?? undefined}>🔗 {conflictStrip}</div>
      ) : blocksStrip ? (
        <div className="sortie-conflict-strip is-blocks">🔗 {blocksStrip}</div>
      ) : deployedDungeonName || freesLabel ? (
        <div className="sortie-squad-substatus t-micro">
          {deployedDungeonName ? <span className="sortie-squad-substatus-dungeon">{deployedDungeonName}</span> : null}
          {freesLabel ? <span className="sortie-squad-substatus-time tnum">{freesLabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
