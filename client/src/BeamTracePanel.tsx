// Beam-trace diagnostics panel -- REQ-0142.
//
// Hovering a Unit core (or one of its beam segments) on the CANVAS board
// floats this panel beside it: one row per compass direction, saying either
// what the beam LINKS or -- the whole point of the REQ -- WHY the link a
// player expected is not there. The three "why not" reasons, in plain
// language, EN + ja:
//
//   blocked        the receiver you expected is further along the ray, but a
//                  nearer Unit took the first hit (canvas_spec: a beam "can
//                  not penetrate and link multiple linkers ... one link
//                  direction only one first hit").
//   no-receiver    the beam is fired and nothing stands on the ray. MARKED,
//                  never nagged about: canvas_spec calls duds intentional
//                  and legitimate (F2 and C8's dir-3 in its own worked
//                  example are both deliberate).
//   dir-not-in-set the direction is simply not in this Unit's beam set, so
//                  nothing is fired down it at all -- the answer the player
//                  who is staring at two perfectly aligned Units needs.
//
// Mounted ONCE at App level (like FloatingItemTip, REQ-0119) so it floats
// above the board without any per-page wiring, and anchored with the same
// measure-then-flip logic. It reads hover from board/beamHover.ts and derives
// everything else from the store snapshot through board/linkTrace.ts -- a
// READ-ONLY engine query (REQ-0142 non-goal: no engine changes, no mutators).
// P5 (The Unreplicable Self) forbids solving the layout FOR the player: this
// panel explains what IS, and never suggests what to do about it.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getBeamHover, subscribeBeamHover } from './board/beamHover';
import { cellLabel, traceUnit, type DirTrace, type UnitTrace } from './board/linkTrace';
import { t } from './i18n';
import { useGameStore, type Locale } from './store';
import type { GameState } from './engine/engine.d.ts';

const GAP = 12; // px between the hovered thing and the panel
const MARGIN = 8; // min px from any viewport edge

/** A BP's display name, falling back to its id (a BP always has a name in
 * practice; the fallback keeps a malformed/legacy state readable rather than
 * rendering "undefined"). */
function bpName(state: GameState, id: string): string {
  return state.bps.find((b) => b.id === id)?.name ?? id;
}

/** The plain-language line for one direction. This function IS the REQ's
 * "why not" surface -- every branch is either a link or one of the three
 * reasons, and none of them tells the player what to do about it (P5). */
function rowText(state: GameState, dt: DirTrace, locale: Locale): string {
  switch (dt.reason) {
    case 'linked':
      return t(locale, 'beam.row.linked', { to: bpName(state, dt.to!) });
    case 'blocked':
      return t(locale, 'beam.row.blocked', {
        blocked: dt.shadowed.map((b) => bpName(state, b)).join(' / '),
        blocker: bpName(state, dt.to!),
        at: cellLabel(dt.firstOnRay!.cell),
      });
    case 'no-receiver':
      return t(locale, 'beam.row.noReceiver');
    case 'dir-not-in-set':
      return dt.firstOnRay
        ? t(locale, 'beam.row.dirNotInSetWould', {
            would: bpName(state, dt.firstOnRay.bp),
            at: cellLabel(dt.firstOnRay.cell),
          })
        : t(locale, 'beam.row.dirNotInSet');
  }
}

const DIR_KEYS = ['beam.dir.0', 'beam.dir.1', 'beam.dir.2', 'beam.dir.3', 'beam.dir.4', 'beam.dir.5', 'beam.dir.6', 'beam.dir.7'] as const;

export function BeamTracePanel() {
  const hover = useSyncExternalStore(subscribeBeamHover, getBeamHover, getBeamHover);
  const snapshot = useGameStore();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const state = snapshot.state;
  const engine = snapshot.engine;
  const layout = snapshot.gameData?.LAYOUT;
  // The trace is recomputed on every hover/state change and never cached:
  // it is a pure read over a handful of BPs (the same argument BoardRenderer
  // makes for recomputing tintSets every frame), and a cache here could only
  // ever go stale against a board the player just edited.
  const trace: UnitTrace | null = hover && state && engine && layout ? traceUnit(engine, state, layout, hover.bp) : null;

  // Measure, then anchor beside the hovered thing -- flipping left if the
  // panel would overflow the right edge, and clamping into the viewport.
  // Same placement as FloatingItemTip (same anchor contract, same
  // hidden-until-measured guard against a first-frame flash).
  //
  // The dependency list is a STABLE KEY, never `trace` itself. traceUnit()
  // returns a fresh object on every render by design (it is a pure query, and
  // a cache here could only go stale against a board the player just edited)
  // -- so depending on its identity would re-run this effect after every
  // render, and its setPos would produce a fresh {left,top} object, which
  // re-renders, which re-runs the effect: an unbounded loop (React error #185,
  // "maximum update depth exceeded"). The hover TARGET is what the position
  // actually depends on, and beamHover.ts already guarantees one stable object
  // identity per target (see its sameTarget() dedupe), so `hover` alone is the
  // honest dependency; traceKey only records that a trace exists to measure.
  const traceKey = trace ? `${trace.bp}:${hover ? hover.dir : 'x'}` : null;
  useLayoutEffect(() => {
    if (!hover || !traceKey) {
      setPos(null);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a = hover.anchor;
    let left = a.left + a.width + GAP;
    if (left + pw > vw - MARGIN) left = a.left - pw - GAP;
    left = Math.max(MARGIN, Math.min(left, vw - pw - MARGIN));
    let top = a.top;
    top = Math.max(MARGIN, Math.min(top, vh - ph - MARGIN));
    // Idempotent: never publish an equal-but-new object (belt and braces
    // against the loop above -- a re-render must not beget a re-render).
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [hover, traceKey]);

  if (!hover || !trace || !state) return null;
  const locale = snapshot.locale;

  // A hovered beam SEGMENT narrows the panel to that one direction (the
  // player pointed at a specific beam and asked about IT); a hovered Unit
  // core shows the whole 8-direction fan.
  const rows = hover.dir === null ? trace.dirs : trace.dirs.filter((d) => d.dir === hover.dir);

  return (
    <div
      ref={panelRef}
      className="beam-trace"
      role="tooltip"
      data-beam-bp={trace.bp}
      data-beam-dir={hover.dir === null ? 'all' : String(hover.dir)}
      style={{
        left: pos ? pos.left : hover.anchor.left,
        top: pos ? pos.top : hover.anchor.top,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="beam-trace-head">
        <span className="beam-trace-title">{t(locale, 'beam.title')}</span>
        <span className="beam-trace-unit">
          {bpName(state, trace.bp)} · {cellLabel(trace.cell)}
        </span>
      </div>
      <div className="beam-trace-summary">
        {t(locale, 'beam.summary', {
          links: trace.linked.length,
          mutual: trace.mutualWith.length,
          duds: trace.duds.length,
        })}
      </div>
      {rows.map((dt) => (
        <div className="beam-trace-row" key={dt.dir} data-dir={String(dt.dir)} data-status={dt.status} data-reason={dt.reason}>
          <span className={`beam-trace-dir beam-trace-dir--${dt.status}`}>{t(locale, DIR_KEYS[dt.dir])}</span>
          <span className="beam-trace-text">
            {rowText(state, dt, locale)}
            {dt.mutual ? <span className="beam-trace-mutual">⇄ {t(locale, 'beam.row.mutual')}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
