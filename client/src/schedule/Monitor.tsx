// Run monitor (golden k) -- REQ-0036 P1-C. Small panel (progress %,
// encounter type/mode, one-line telegraph readout) always shown for a
// room that has ever had a run; an expand toggle reveals the full
// two-grid PixiJS view (MonitorRenderer.ts).
//
// Polling: GET .../run roughly every ~2s while this room has a run
// (active OR recently settled, so the summary/rewards panel has a
// chance to render before polling stops). Each poll returns the FULL
// events array up to the current elapsedSecs (not a delta) -- this
// component tracks `lastEventIndex` (the count of events already
// rendered) and slices `events.slice(lastEventIndex)` before handing the
// NEW tail to MonitorRenderer.applyEvents(), per the run-clock polling
// contract described in server/README.md / the task brief. Progress
// prefers the latest `progress` event's `pct` field when present, else
// falls back to `clock.pct`.
//
// Pixi lifecycle: the MonitorRenderer (a real PIXI.Application) is
// created ONCE, the first time this room's monitor is expanded, and kept
// mounted (a permanently-rendered <canvas>, toggled only via CSS
// display:none on collapse) for the lifetime of this component -- NOT
// recreated on every expand/collapse or every poll tick, mirroring the
// Board/InventoryBoard "one Pixi Application forever" discipline this
// task brief calls out explicitly.
import { useEffect, useRef, useState } from 'react';
import { fetchDungeons, fetchRun, type ApiRoom, type ApiRunEvent, type ApiRunView } from '../api';
import { loadSpriteTextures } from '../board/sprites';
import { t } from '../i18n';
import type { Locale } from '../store';
import { useGameStore } from '../store';
import { formatCountdown } from './RoomCard';
import { MonitorRenderer, type MonitorUnitVisual } from './MonitorRenderer';

interface MonitorProps {
  room: ApiRoom;
  locale: Locale;
}

const POLL_MS = 2000;

function latestOfType(events: ApiRunEvent[], evName: string): ApiRunEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].ev === evName) return events[i];
  }
  return null;
}

function telegraphSentence(locale: Locale, ev: ApiRunEvent | null): string {
  if (!ev) return t(locale, 'schedule.monitor.noTelegraphYet');
  const skill = typeof ev.skill === 'string' ? ev.skill : '?';
  const edge = typeof ev.edge === 'string' ? ev.edge : Array.isArray(ev.edge) ? ev.edge.join('/') : '?';
  const dir = typeof ev.dir === 'string' || typeof ev.dir === 'number' ? String(ev.dir) : '?';
  return `${skill} (${edge}, ${dir})`;
}

export function Monitor({ room, locale }: MonitorProps) {
  const snapshot = useGameStore();
  const [run, setRun] = useState<ApiRunView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mountedOnce, setMountedOnce] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MonitorRenderer | null>(null);
  const lastEventIndexRef = useRef(0);
  const unitsMountedRef = useRef(false);

  // Poll GET .../run every ~2s while this room has (or recently had) a
  // run. Stops implicitly if the room has no lastRunId at all (no run
  // yet) -- there is nothing to poll for.
  useEffect(() => {
    if (!room.lastRunId) {
      setRun(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const view = await fetchRun(room.id);
        if (!cancelled) setRun(view);
      } catch (e) {
        // Non-fatal -- a transient fetch failure just skips this tick;
        // the next interval tick retries.
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [room.id, room.lastRunId]);

  // Mount the Pixi renderer ONCE, the first time this monitor is
  // expanded -- never recreated on later expand/collapse toggles.
  useEffect(() => {
    if (!expanded || mountedOnce || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const textures = await loadSpriteTextures();
      if (cancelled || !canvasRef.current) return;
      const renderer = await MonitorRenderer.mount(canvasRef.current, textures);
      if (cancelled) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      setMountedOnce(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, mountedOnce]);

  // Mount player-side unit visuals once (formation box + BP footprint +
  // one representative icon per slot) -- these never change mid-run, so
  // this only needs to run once after both the renderer AND the room's
  // own preset/formation data are available.
  useEffect(() => {
    if (!mountedOnce || !rendererRef.current || unitsMountedRef.current) return;
    const presets = snapshot.state?.presets;
    const activeCanvas = snapshot.state;
    if (!activeCanvas) return;
    const units: MonitorUnitVisual[] = room.slots.map((slot, idx) => {
      const box = `unit${idx + 1}`;
      let bpColor = '#888888';
      let bpShape: [number, number][] = [];
      let label = `U${idx + 1}`;
      if (slot.presetIndex != null) {
        const presetCanvas =
          presets && slot.presetIndex === presets.active
            ? activeCanvas
            : presets?.store[slot.presetIndex] ?? null;
        const bp = presetCanvas?.bps?.[0];
        if (bp) {
          bpColor = bp.color;
          bpShape = bp.shape;
          label = presets?.names[slot.presetIndex] ?? label;
        }
      }
      return { slotIndex: idx, box, bpColor, bpShape, label };
    });
    // NOTE: `box` above is a placeholder key ("unit1".."unit4"), NOT yet
    // the real "F2:M9"-style box string -- the real box strings live in
    // the dungeons-list formation payload (ApiFormationEntry.canvases),
    // which this component does not fetch on its own (SchedulePage/
    // CreateRoomForm already fetch it for the create form). Rather than
    // re-fetch it again here per-room, MonitorRenderer.mountUnits()
    // degrades gracefully: parseBoxToPixelRect on a plain "unit1" string
    // (no colon) yields a zero-size rect at the origin, which would draw
    // nothing useful. To keep this real (not a silent no-op), fetch the
    // formation's actual canvases map once, matched by the room's own
    // formationId.
    void (async () => {
      try {
        const payload = await fetchDungeons();
        const formation = payload.formations.find((f) => f.id === room.formationId);
        const withRealBoxes = units.map((u) => ({ ...u, box: formation?.canvases[`unit${u.slotIndex + 1}`] ?? u.box }));
        rendererRef.current?.mountUnits(withRealBoxes);
        unitsMountedRef.current = true;
      } catch (e) {
        // Non-fatal -- the expanded view simply shows no unit
        // footprints if the formation lookup fails; ray animation and
        // the enemy side are unaffected.
      }
    })();
  }, [mountedOnce, room.slots, room.formationId, snapshot.state, snapshot.state?.presets]);

  // Feed only the NEW tail of events to the renderer on every poll
  // update -- track lastEventIndex across polls (per the run-clock
  // polling contract: each poll returns the FULL array, not a delta).
  useEffect(() => {
    if (!run || !rendererRef.current) return;
    const newTail = run.events.slice(lastEventIndexRef.current);
    if (newTail.length > 0) {
      // BUG #4 defensive fix (REQ-0041): lastEventIndexRef MUST advance
      // unconditionally, even if applyEvents somehow throws (it no longer
      // should -- see MonitorRenderer.ts's own per-event try/catch -- but
      // this call site is the SPECIFIC reason the original freeze became
      // a PERMANENT crash-loop rather than a one-off dropped frame: this
      // ref used to only advance AFTER a successful (non-throwing) call,
      // so a throw here left the same stuck event range re-processed,
      // and re-thrown, on every subsequent ~2s poll forever. Advancing in
      // a finally block makes "skip the bad tail, keep polling forward"
      // the guaranteed behavior regardless of what MonitorRenderer does
      // internally -- belt-and-suspenders on top of the renderer's own
      // fix, not a substitute for it.
      try {
        rendererRef.current.applyEvents(newTail);
      } finally {
        lastEventIndexRef.current = run.events.length;
      }
    }
  }, [run]);

  // Destroy the Pixi Application only on a REAL unmount of this Monitor
  // instance (room card removed from the rooms list entirely), never on
  // a mere collapse.
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  if (!room.lastRunId) {
    return <div className="schedule-monitor schedule-monitor-empty">{t(locale, 'schedule.monitor.awaitingRun')}</div>;
  }

  const pct = run ? (latestOfType(run.events, 'progress')?.pct as number | undefined) ?? run.clock.pct : 0;
  const encStart = run ? latestOfType(run.events, 'encounter_start') : null;
  const telegraph = run ? latestOfType(run.events, 'telegraph') : null;
  const settled = run?.settled ?? false;

  return (
    <div className="schedule-monitor" data-testid="schedule-monitor" data-run-id={run?.runId}>
      <div className="schedule-monitor-small">
        <div className="schedule-monitor-progress-row">
          <span className="schedule-monitor-progress-label">{t(locale, 'schedule.monitor.progress')}</span>
          <div className="schedule-monitor-progress-bar">
            <div className="schedule-monitor-progress-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
          <span className="schedule-monitor-progress-pct" data-testid="schedule-monitor-progress-pct">
            {Math.round(pct)}%
          </span>
        </div>
        <div className="schedule-monitor-encounter" data-testid="schedule-monitor-encounter">
          {t(locale, 'schedule.monitor.encounter')}: {encStart ? `${encStart.kind ?? encStart.enc ?? '?'}` : '—'}
        </div>
        <div className="schedule-monitor-telegraph" data-testid="schedule-monitor-telegraph">
          {t(locale, 'schedule.monitor.telegraph')}: {telegraphSentence(locale, telegraph)}
        </div>
        <button type="button" className="schedule-monitor-expand-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t(locale, 'schedule.collapse') : t(locale, 'schedule.expand')}
        </button>
      </div>

      {/* The canvas stays in the DOM once created (mounted lazily on
          first expand, per the module comment) -- only CSS visibility
          toggles afterward, never a remount. */}
      <div className={`schedule-monitor-expanded${expanded ? '' : ' schedule-monitor-hidden'}`}>
        <canvas ref={canvasRef} className="schedule-monitor-canvas" data-testid="schedule-monitor-canvas" />
      </div>

      {run && (settled || run.result !== 'incomplete') ? (
        <div className="schedule-monitor-summary" data-testid="schedule-monitor-summary">
          <div className="schedule-monitor-result">
            {t(
              locale,
              run.result === 'victory' ? 'schedule.monitor.resultVictory' : run.result === 'wipe' ? 'schedule.monitor.resultWipe' : 'schedule.monitor.resultIncomplete'
            )}
          </div>
          {run.result === 'wipe' ? (
            <>
              <div className="schedule-monitor-rewards-none">{t(locale, 'schedule.monitor.rewardsWipeNote')}</div>
              <div className="schedule-monitor-level-dropped">{t(locale, 'schedule.monitor.levelDropped', { level: run.levelAfter })}</div>
            </>
          ) : (
            <div className="schedule-monitor-rewards-title">{t(locale, 'schedule.monitor.rewardsTitle')}</div>
          )}
          {settled ? <div className="schedule-monitor-settled-badge">{t(locale, 'schedule.monitor.settled')}</div> : null}
          {run.cooldownSecs > 0 ? (
            <div className="schedule-monitor-cooldown" data-testid="schedule-monitor-cooldown">
              {t(locale, 'schedule.monitor.cooldownUntil', { time: formatCountdown(run.cooldownSecs * 1000) })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
