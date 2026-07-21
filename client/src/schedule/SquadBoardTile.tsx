// client/src/schedule/SquadBoardTile.tsx -- REQ-0239 (design 02): one squad
// tile. Shares visual DNA with the sortie SquadMiniCard (same microgrid + chip
// recipe) and adds a timeline row. Time is shown as BOTH a countdown and an
// absolute clock (design 00 P-D). A reserved cancel renders alongside the live
// state, its release time honest (run end / cooldownUntil) -- never "canceled"
// until the room actually reports it (B2).
import { useEffect, useState } from 'react';
import { resolveUnitArtUrl } from '../dex/unitArt'; // REQ-0266
import { t } from '../i18n';
import { setRoute, useGameStore, type Locale } from '../store';
import { SquadMicrogrid } from '../sortie/SquadMicrogrid';
import { StateChip, stateLabel, type SquadStateKey } from '../sortie/stateChip';
import { formatCountdown } from './RoomCard';
import type { SquadBoardState } from './useSquadDeployment';

interface SquadBoardTileProps {
  locale: Locale;
  squad: SquadBoardState;
  now: number;
  dungeonNameFor: (dungeonId: string) => string;
  onWatch: (roomId: string) => void;
}

function clockTime(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

/** REQ-0266: the lead BP's unit portrait. Was `getItemArtUrl(unit.id)` -- the same
 * PERMANENTLY DEAD branch SquadMiniCard carried (that map is keyed by ITEM id;
 * unit ids never appear in it), so this icon has never rendered once. It now
 * walks the one unit art chain (active skin -> the def's own icon).
 *
 * The fallback stays exactly what it was: NOTHING. Rendering null keeps row1 a
 * two-item flex, which is the layout every tile has today -- and it is also where
 * a failed load lands, so a 404 cannot paint a broken-image glyph next to the
 * squad name. `.squad-board-lead-icon` fixes the <img> at 20x20 (object-fit:
 * cover), and row1's budget is 205px against ~136px used, so the icon fits
 * without squeezing `.squad-board-name`. */
function LeadUnitIcon({ unitId, icon }: { unitId: string | null; icon: string | null }) {
  const [failed, setFailed] = useState(false);
  const art = resolveUnitArtUrl(unitId, icon);
  useEffect(() => { setFailed(false); }, [art.url]);
  if (!art.url || failed) return null;
  return <img className="squad-board-lead-icon" data-art-source={art.source} src={art.url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function SquadBoardTile({ locale, squad, now, dungeonNameFor, onWatch }: SquadBoardTileProps) {
  const { index } = squad;
  // REQ-0266: the `icon` rung of the unit art chain. Hook call kept at the very
  // top -- everything below it is a conditional context/state cascade.
  const unitDefs = useGameStore().gameData?.UNITS;
  const runEndsMs = squad.runStartedAtMs != null && squad.runDurationSecs != null
    ? squad.runStartedAtMs + squad.runDurationSecs * 1000 : null;
  const returning = squad.state === 'deployed' && runEndsMs != null && now >= runEndsMs;
  const visualState: SquadStateKey = returning ? 'returning' : squad.state;

  const clickableRoom = squad.roomId && (squad.state === 'deployed' || squad.state === 'recovering' || squad.state === 'staging');
  const onActivate = () => {
    if (clickableRoom && squad.roomId) onWatch(squad.roomId);
    else if (squad.state === 'ready') setRoute('sortie');
    else if (squad.state === 'undeployable') setRoute('backpacks');
  };

  // Row 4 context line.
  let context: React.ReactNode = null;
  if (squad.state === 'deployed') {
    const progressPct = runEndsMs != null && squad.runStartedAtMs != null && squad.runDurationSecs
      ? Math.max(0, Math.min(100, ((now - squad.runStartedAtMs) / (squad.runDurationSecs * 1000)) * 100)) : 0;
    if (squad.cancelReserved && runEndsMs != null) {
      context = (
        <div className="squad-board-release" data-testid={`squad-board-release-${index}`}>
          {t(locale, 'schedule.board.releaseAt', { time: clockTime(runEndsMs, locale), countdown: formatCountdown(Math.max(0, runEndsMs - now), locale) })}
        </div>
      );
    } else if (returning) {
      context = <div className="squad-board-returning">{t(locale, 'schedule.board.returning')}</div>;
    } else {
      context = (
        <div className="squad-board-progress">
          <span className="bar"><span className="fill gold" style={{ width: `${progressPct}%` }} /></span>
          {runEndsMs != null ? <span className="squad-board-eta tnum">{t(locale, 'schedule.board.returnAt', { time: clockTime(runEndsMs, locale) })}</span> : null}
        </div>
      );
    }
  } else if (squad.state === 'recovering') {
    const cdMs = squad.cooldownUntilIso ? Math.max(0, Date.parse(squad.cooldownUntilIso) - now) : 0;
    if (squad.cancelReserved && squad.releaseAtIso) {
      const rel = Date.parse(squad.releaseAtIso);
      context = (
        <div className="squad-board-release" data-testid={`squad-board-release-${index}`}>
          {t(locale, 'schedule.board.releaseAt', { time: clockTime(rel, locale), countdown: formatCountdown(Math.max(0, rel - now), locale) })}
        </div>
      );
    } else {
      context = (
        <div className="squad-board-recover">
          <span className="tnum">{t(locale, 'schedule.board.redeployIn', { time: formatCountdown(cdMs, locale) })}</span>
          {squad.cooldownUntilIso ? <span className="squad-board-eta tnum">{clockTime(Date.parse(squad.cooldownUntilIso), locale)}</span> : null}
        </div>
      );
    }
  } else if (squad.state === 'staging') {
    context = (
      <div className="squad-board-staging">
        {squad.stagingSlotsFilled != null && squad.stagingSlotsFilled < 4
          ? t(locale, 'schedule.board.stagingSlots', { k: squad.stagingSlotsFilled })
          : t(locale, 'schedule.board.staging')}
      </div>
    );
  } else if (squad.state === 'ready') {
    context = <button type="button" className="btn btn-ghost squad-board-cta" onClick={(e) => { e.stopPropagation(); setRoute('sortie'); }}>{t(locale, 'schedule.board.goSortie')}</button>;
  } else if (squad.state === 'undeployable') {
    context = <button type="button" className="btn btn-ghost squad-board-cta" onClick={(e) => { e.stopPropagation(); setRoute('backpacks'); }}>{t(locale, 'schedule.board.goBackpacks')}</button>;
  }

  const showDungeonRow = squad.state === 'deployed' || squad.state === 'recovering' || squad.state === 'staging';
  const leadUnitId = squad.canvas?.bps?.[0]?.unit?.id ?? null;
  const leadDef = leadUnitId ? unitDefs?.[leadUnitId] : null;
  const leadIcon = leadDef && typeof leadDef.icon === 'string' && leadDef.icon ? leadDef.icon : null;

  return (
    <div
      className={`squad-board-tile panel st-edge-${visualState}${clickableRoom || squad.state === 'ready' || squad.state === 'undeployable' ? ' is-clickable' : ''}`}
      data-testid={`squad-board-tile-${index}`}
      role="button"
      tabIndex={0}
      aria-label={t(locale, 'schedule.board.tileAria', { squad: squad.name, state: stateLabel(locale, visualState) })}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
    >
      <div className="squad-board-row1">
        <SquadMicrogrid canvas={squad.canvas} size={28} className="squad-board-microgrid" />
        <span className="dj squad-board-name" title={squad.name}>{squad.name}</span>
        <LeadUnitIcon unitId={leadUnitId} icon={leadIcon} />
      </div>
      <div className="squad-board-row2" data-testid={`squad-board-state-${index}`} data-state={visualState}>
        <StateChip stateKey={visualState} label={stateLabel(locale, visualState)} live={visualState === 'deployed'} />
        {squad.cancelReserved ? <StateChip stateKey="cancelReserved" label={stateLabel(locale, 'cancelReserved')} /> : null}
      </div>
      {showDungeonRow && squad.dungeonId ? (
        <div className="squad-board-row3 t-micro">
          <span className="squad-board-dungeon">{dungeonNameFor(squad.dungeonId)}</span>
          {squad.level != null ? <span className="tnum">Lv{squad.level}</span> : null}
        </div>
      ) : null}
      <div className="squad-board-row4">{context}</div>
    </div>
  );
}
