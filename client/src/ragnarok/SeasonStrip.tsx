// client/src/ragnarok/SeasonStrip.tsx -- REQ-0066. The season strip from
// web/redesign/ragnarok.html: a 12-wedge wheel (phases 1..phase-1 "done",
// `phase` "now") + the "days until Ragnarok" countdown. Data is the
// GET /api/ragnarok/season response (registry + derived clock).
//
// REQ-0067 CONSTRAINT, enforced here: the countdown carries NO urgency
// styling, EVER (retention philosophy: inform, never pressure -- the
// explicit OPPOSITE of the vow step, where slowing the player is the
// point). The number renders identically at 84 days and at 1 day; there
// is no red/pulse/shrink threshold anywhere in this component. See
// .ragnarok-cd-num in index.css.
//
// States (all realistic, per REQ-0067 item 2 -- a fresh season IS the
// common case): a live season (wheel + countdown + note), an ENDED
// season (derived.ended -- a doorway to the season-end reckoning), and a
// missing/empty/future registry (season === null -- "between winters").
// The event-time variant (REQ-0068's Acts I-III page is OUT OF SCOPE):
// when the season has ended we render the doorway chip the mock shows; it
// links to the season-end mock page but we do not build that page.
import type { Locale } from '../store';
import { t } from '../i18n';
import type { ApiRagnarokSeasonResponse } from '../api';

const WEDGE_COUNT = 12;

/** Builds the 12 wheel wedge <path>s exactly as the mock's inline script
 * does (same trig: each wedge is a 30deg arc at r=30, starting at -90deg;
 * the small a1 offset leaves a hairline gap between wedges). `phase` is
 * 1-based: wedges [0, phase-1) are done, wedge (phase-1) is now. */
function Wheel({ phase }: { phase: number }) {
  const r = 30;
  const paths = [];
  for (let i = 0; i < WEDGE_COUNT; i++) {
    const a0 = ((i * 30 - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * 30 - 94) * Math.PI) / 180;
    const d = `M ${Math.cos(a0) * r} ${Math.sin(a0) * r} A ${r} ${r} 0 0 1 ${Math.cos(a1) * r} ${Math.sin(a1) * r}`;
    const cls = i < phase - 1 ? 'wedge done' : i === phase - 1 ? 'wedge now' : 'wedge';
    paths.push(<path key={i} d={d} className={cls} />);
  }
  return (
    <svg className="ragnarok-wheel" width={96} height={96} viewBox="0 0 86 86" data-testid="ragnarok-season-wheel" data-phase={phase}>
      <g transform="translate(43,43)">
        <circle r={30} fill="none" stroke="#10141B" strokeWidth={9} />
        <g data-testid="ragnarok-season-wedges">{paths}</g>
        <circle r={20} fill="none" stroke="rgba(201,169,89,.25)" strokeWidth={1} />
        <text y={4} textAnchor="middle" style={{ fontSize: '13px', fill: '#C9A959', fontFamily: "'Noto Sans Runic'" }}>ᛃ</text>
      </g>
    </svg>
  );
}

interface SeasonStripProps {
  locale: Locale;
  data: ApiRagnarokSeasonResponse;
}

export function SeasonStrip({ locale, data }: SeasonStripProps) {
  const { season, derived } = data;

  // Degenerate: no current season (missing/empty/entirely-future registry).
  if (!season || !derived) {
    return (
      <section className="ragnarok-season-strip" data-testid="ragnarok-season-strip" data-state="none">
        <div className="ragnarok-season-empty">
          <div className="ragnarok-season-phase">{t(locale, 'ragnarok.season.none')}</div>
          <div className="ragnarok-cd-note">{t(locale, 'ragnarok.season.noneNote')}</div>
        </div>
      </section>
    );
  }

  const name = locale === 'ja' ? season.name : season.nameEn || season.name;
  const phaseLabel = name
    ? t(locale, 'ragnarok.season.phase', { index: season.index, name, phase: derived.phase })
    : t(locale, 'ragnarok.season.phaseNoName', { index: season.index, phase: derived.phase });

  return (
    <section className="ragnarok-season-strip" data-testid="ragnarok-season-strip" data-state={derived.ended ? 'ended' : 'live'}>
      <Wheel phase={derived.phase} />
      <div className="ragnarok-season-meta">
        <div className="ragnarok-season-phase">{phaseLabel}</div>
        {derived.ended ? (
          <>
            <div className="ragnarok-cdown">
              <span className="ragnarok-cd-lbl">{t(locale, 'ragnarok.season.ended')}</span>
            </div>
            <div className="ragnarok-cd-note">{t(locale, 'ragnarok.season.endedNote')}</div>
          </>
        ) : (
          <>
            {/* NO urgency styling -- .ragnarok-cd-num is the same gold at
                every value of daysToRagnarok (REQ-0067). */}
            <div className="ragnarok-cdown">
              <span className="ragnarok-cd-lbl">{t(locale, 'ragnarok.season.countdownLabel')}</span>
              <b className="ragnarok-cd-num" data-testid="ragnarok-countdown">{derived.daysToRagnarok}</b>
              <span className="ragnarok-cd-day">{t(locale, 'ragnarok.season.day')}</span>
            </div>
            <div className="ragnarok-cd-note">{t(locale, 'ragnarok.season.note')}</div>
          </>
        )}
        {/* Event-time doorway: the season-end reckoning page (REQ-0068) is
            OUT OF SCOPE -- we render the doorway the mock shows once the
            season has ended, linking to the mock page; we build nothing
            beyond this link. It is a plain doorway, not urgency chrome. */}
        {derived.ended ? (
          <div className="ragnarok-season-door">
            <a className="btn" href="/redesign/season_end_ragnarok_1.html" data-testid="ragnarok-season-event-door">
              {t(locale, 'ragnarok.season.eventDoor')}
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
