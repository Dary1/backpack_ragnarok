// client/src/sortie/SquadMiniCard.tsx -- REQ-0239 (design 01 sec 6.1): the
// ONLY squad representation on the sortie page -- a compact summary (microgrid +
// unit strip + state chip + conflict strip). NO full inventory grid anywhere.
import { useEffect, useState } from 'react';
import { resolveUnitArtUrl } from '../dex/unitArt'; // REQ-0266
import { t } from '../i18n';
import { useGameStore, type Locale } from '../store';
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

/** REQ-0266: one BP's unit portrait in the strip.
 *
 * This used to be `getItemArtUrl(bp.unit?.id)` -- a PERMANENTLY DEAD branch. That
 * map is keyed by ITEM id and unit ids have verified zero overlap with it, so it
 * returned null for every BP that has ever existed and this strip has only ever
 * drawn colour dots. It now walks the one unit art chain (active skin -> the
 * def's own icon), so these start rendering for real.
 *
 * The colour dot is KEPT, for two cases: a unit with no art at all, and an art
 * URL that fails to load. The second is why this is a component with its own
 * `failed` state rather than an inline ternary -- letting a 404 paint the
 * browser's broken-image glyph inside a 20px well would be a regression on a
 * surface that today always looks deliberate. Same onError-hides posture as the
 * Dex portrait well. Layout is unchanged either way: `.sortie-unit-icon` fixes
 * both the <img> and the dot at 20x20 with object-fit: cover. */
function UnitStripIcon({ unitId, icon, color }: { unitId: string | null | undefined; icon: string | null; color?: string }) {
  const [failed, setFailed] = useState(false);
  const art = resolveUnitArtUrl(unitId, icon);
  useEffect(() => { setFailed(false); }, [art.url]);
  if (!art.url || failed) {
    return <span className="sortie-unit-icon sortie-unit-dot" style={{ backgroundColor: color || 'var(--bone-3)' }} aria-hidden="true" />;
  }
  return <img className="sortie-unit-icon" data-art-source={art.source} src={art.url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function SquadMiniCard(props: SquadMiniCardProps) {
  const {
    locale, info, stateKey, assignedOrdinal, conflicted, conflictStrip, conflictTooltip,
    blocksStrip, showSharedBadge, deployedDungeonName, freesLabel, onClick, disabled, testId,
  } = props;
  const clickable = !!onClick && !disabled;
  const bps = info.canvas?.bps ?? [];
  const iconBps = bps.slice(0, MAX_ICONS);
  const overflow = bps.length - iconBps.length;
  // REQ-0266: the unit defs carry the `icon` rung of the art chain. Read ONCE per
  // card rather than once per icon, so a four-BP strip costs one subscription.
  const unitDefs = useGameStore().gameData?.UNITS;
  const iconOf = (id: string | null | undefined): string | null => {
    const def = id ? unitDefs?.[id] : null;
    return def && typeof def.icon === 'string' && def.icon ? def.icon : null;
  };

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
          {iconBps.map((bp, i) => (
            <UnitStripIcon key={i} unitId={bp.unit?.id} icon={iconOf(bp.unit?.id)} color={bp.color} />
          ))}
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
