// client/src/schedule/SquadStatusBoard.tsx -- REQ-0239 (design 02): the
// always-visible strip on #/schedule -- one tile per squad the player owns, so
// a single glance answers "what is every squad doing and when does it free up".
// View-only: a tile click watches the room; ready/undeployable CTAs navigate.
// Consumes the SAME rooms state + 4s poll as SchedulePage (no new poll loop);
// owns ONE shared 1s ticker for every tile's countdown (no per-tile intervals).
import { useEffect, useState } from 'react';
import type { ApiRoom } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { SquadBoardTile } from './SquadBoardTile';
import { useSquadDeployment } from './useSquadDeployment';

interface SquadStatusBoardProps {
  locale: Locale;
  rooms: ApiRoom[] | null;
  dungeonNameFor: (dungeonId: string) => string;
  onWatch: (roomId: string) => void;
}

export function SquadStatusBoard({ locale, rooms, dungeonNameFor, onWatch }: SquadStatusBoardProps) {
  const squads = useSquadDeployment(rooms);
  // One shared 1s ticker for every tile's countdown/progress (design 02 sec 6).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (squads.length === 0) return null;

  const deployed = squads.filter((s) => s.state === 'deployed').length;
  const recovering = squads.filter((s) => s.state === 'recovering').length;

  return (
    <section className="squad-board" data-testid="squad-board">
      <div className="squad-board-head">
        <span className="den squad-board-den">{t(locale, 'schedule.board.den')}</span>
        <span className="squad-board-summary t-micro tnum">
          {t(locale, 'schedule.board.summary', { total: squads.length, deployed, recovering })}
        </span>
      </div>
      <div className="squad-board-tiles">
        {squads.map((squad) => (
          <SquadBoardTile
            key={squad.index}
            locale={locale}
            squad={squad}
            now={now}
            dungeonNameFor={dungeonNameFor}
            onWatch={onWatch}
          />
        ))}
      </div>
    </section>
  );
}
