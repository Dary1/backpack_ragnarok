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
//
// REQ-0071 (MJOLNIR re-skin; mock: web/redesign/expedition.html's
// .mon-panel): chrome/framing ONLY -- the Pixi lifecycle above, the
// poll-and-diff loop, the settled gate, and every data-testid/class the
// E2E suite selects are untouched. New chrome, all fed by REAL run data:
//   - m-head strip: 戦況監視 title + the room's resolved dungeon name, a
//     LIVE chip while the run is still unsettled, and the room's genSeed
//     (ApiRoom.genSeed -- the mock's "seed 0x..." readout, real here).
//   - iron control bar under the Field canvas: decorative rivets, a
//     wall-clock readout (clock.elapsedSecs / durationSecs -- the run
//     replay is SERVER-paced, so the mock's pause/speed/skip controls
//     have no honest backing and are omitted, see the REQ-0071 notes
//     doc), and the mock timeline whose fill is the same progress pct
//     the summary bar shows, with one diamond pip per encounter_start
//     event at its own t/durationSecs position.
//   - Log tab gains the mock's logbar caption (event count).
//   - Reward rows render as small item cards (icon via the SAME
//     iconDataUrl the WarehouseTab already uses + the rarity word tint).
import { useEffect, useRef, useState } from 'react';
import {
  fetchContent,
  fetchDungeons,
  fetchRun,
  fetchWarehouse,
  type ApiContentPayload,
  type ApiRoom,
  type ApiRunEvent,
  type ApiRunView,
  type ApiWarehouseItem,
} from '../api';
import { loadSpriteTextures } from '../board/sprites';
import { iconDataUrl } from '../dex/dexIcons';
import { t } from '../i18n';
import type { Locale } from '../store';
import { useGameStore } from '../store';
import { formatCountdown } from './RoomCard';
import { MonitorRenderer, type MonitorUnitVisual } from './MonitorRenderer';

/** Same item-name resolution WarehouseTab.tsx already uses (itemId ->
 * localized display name, falling back to the raw id if content hasn't
 * loaded yet or the id is unrecognized) -- kept as a small local copy
 * rather than exporting/importing across the two modules, since it is a
 * single three-line lookup and the two components' content-fetch
 * lifecycles are independent (this component fetches content lazily,
 * only once a run actually settles, not on every mount). */
function localizedItemName(locale: Locale, content: ApiContentPayload | null, itemId: string): string {
  const entry = content?.items[itemId] ?? content?.sis[itemId];
  if (!entry) return itemId;
  if (locale === 'ja') return entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name;
  return entry.name;
}

/** REQ-0045 (g): one humanized, one-line-per-event sentence per the
 * task brief's exact field list (t, type, actor, cells, dmg, status) --
 * covers every ev.ev value sim/combat.cjs actually emits (see
 * MonitorRenderer.ts's own applyOneEvent switch for the same
 * vocabulary, mirrored here for TEXT instead of a Pixi visual). Falls
 * back to a generic "t=Xs <ev> {raw JSON}" line for any event shape not
 * explicitly covered, so a future/unknown event type never disappears
 * from the log silently -- it just renders less prettily until this
 * function is extended for it. */
function humanizeEvent(ev: ApiRunEvent): string {
  const t = typeof ev.t === 'number' ? ev.t.toFixed(2) : '?';
  const cellStr = (c: unknown): string => (Array.isArray(c) ? `[${c[0]},${c[1]}]` : String(c));
  switch (ev.ev) {
    case 'encounter_start':
      return `t=${t}s  encounter #${ev.enc} starts (${ev.kind}, formation ${ev.formation})`;
    case 'telegraph':
      return `t=${t}s  telegraph: ${ev.src} winds up ${ev.skill} from the ${ev.edge} edge (fires at t=${typeof ev.fires_at === 'number' ? ev.fires_at.toFixed(2) : '?'}s)`;
    case 'ray_fire':
      return `t=${t}s  ray fired by ${ev.src} into the ${ev.field} field, entering at ${cellStr(ev.entry)}`;
    case 'ray_step':
      return `t=${t}s  ray travels through ${Array.isArray(ev.path) ? ev.path.length : '?'} cell(s)`;
    case 'ray_bounce':
      return `t=${t}s  ray bounces at ${cellStr(ev.at)} (new dir ${ev.new_dir}, bounce #${ev.bounce})`;
    case 'ray_hit':
      return `t=${t}s  HIT: ${ev.dst} takes ${ev.amount} dmg (hp after: ${ev.hp_after})`;
    case 'ray_aoe': {
      const hits = Array.isArray(ev.hits) ? (ev.hits as Array<{ dst?: string; amount?: number }>) : [];
      const hitList = hits.map((h) => `${h.dst}:${h.amount}`).join(', ');
      return `t=${t}s  AOE at ${cellStr(ev.center)} (radius ${ev.radius}): ${hitList || 'no targets'}`;
    }
    case 'ray_hit_all': {
      const hits = Array.isArray(ev.hits) ? (ev.hits as Array<{ dst?: string; amount?: number }>) : [];
      const hitList = hits.map((h) => `${h.dst}:${h.amount}`).join(', ');
      return `t=${t}s  HIT ALL (whole field): ${hitList || 'no targets'}`;
    }
    case 'reflect_damage':
      return `t=${t}s  reflect: ${ev.dst} takes ${ev.amount} reflected dmg`;
    case 'link_pulse':
      return `t=${t}s  link pulse: ${ev.from}→${ev.to} (hop ${ev.hop})`;
    case 'pulse_payload':
      return `t=${t}s  pulse payload: ${ev.dst} ${ev.verb}${typeof ev.amount === 'number' ? ' ' + ev.amount : ''}`;
    case 'pulse_fizzle':
      return `t=${t}s  pulse fizzle (${ev.reason})`;
    case 'att_reveal':
      return `t=${t}s  ${ev.kind} found at ${cellStr(ev.at)}`;
    case 'att_disarm':
      return `t=${t}s  trap disarmed${ev.reward ? ` (reward: ${ev.reward})` : ''}`;
    case 'att_open':
      return `t=${t}s  ${ev.kind} opened${ev.shortcut ? ' -> shortcut!' : (ev.reward ? ` (reward: ${ev.reward})` : '')}`;
    case 'att_lost':
      return `t=${t}s  ${ev.kind} lost -- no ${ev.kind === 'trap' ? 'detection' : 'unlock'} POs deployed`;
    case 'att_fire':
      return `t=${t}s  trap fired (${ev.reason}) -- the price of skipping detection`;
    case 'progress':
      return `t=${t}s  progress: encounter #${ev.enc} -> ${ev.pct}%`;
    case 'shortcut':
      return `t=${t}s  shortcut: encounter #${ev.enc} grants +${typeof ev.jump_pct === 'number' ? ev.jump_pct.toFixed(1) : ev.jump_pct}% (now ${ev.pct_after}%)`;
    case 'run_end':
      return `t=${t}s  RUN END: ${String(ev.result).toUpperCase()} at ${ev.final_pct}% progress`;
    default:
      return `t=${t}s  ${ev.ev}  ${JSON.stringify(ev)}`;
  }
}

/** REQ-0071: the mock ctrl bar's wall-clock readout -- mm:ss, tabular
 * digits via the theme's .tnum. Distinct from formatCountdown (kept
 * as-is for countdown TEXT lines): this one is a fixed-width clock face,
 * not a sentence fragment. */
function formatClock(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** REQ-0071: icon + rarity for a reward row -- the SAME content-map
 * resolution WarehouseTab.tsx's contentEntryFor already uses (TM stacks
 * live in content.tms; plain PO/SI items in content.items/content.sis),
 * degrading to "no icon, no tint" while content is still loading or for
 * an unrecognized id. */
function rewardVisual(content: ApiContentPayload | null, item: ApiWarehouseItem): { icon: string | null; rarity: string | null } {
  if (!content) return { icon: null, rarity: null };
  const entry = item.kind === 'tm' ? content.tms[item.itemId] : content.items[item.itemId] ?? content.sis[item.itemId];
  if (!entry) return { icon: null, rarity: null };
  return { icon: iconDataUrl(entry.icon), rarity: entry.rarity ?? null };
}

interface MonitorProps {
  room: ApiRoom;
  locale: Locale;
  /** REQ-0071: resolved display name for room.dungeonId (RoomCard already
   * receives it from SchedulePage's join) -- shown in the mock m-head's
   * 「戦況監視 — <dungeon>」strip. Pure display. */
  dungeonName: string;
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

export function Monitor({ room, locale, dungeonName }: MonitorProps) {
  const snapshot = useGameStore();
  const [run, setRun] = useState<ApiRunView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mountedOnce, setMountedOnce] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MonitorRenderer | null>(null);
  const lastEventIndexRef = useRef(0);
  const unitsMountedRef = useRef(false);
  const [rewards, setRewards] = useState<ApiWarehouseItem[] | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  /** REQ-0045 (g): expanded-view tab -- 'field' (the existing Pixi
   * canvas) or 'log' (a new humanized text panel + raw JSONL copy
   * button). Local, not persisted -- purely a display toggle within the
   * already-expanded monitor section. */
  const [activeTab, setActiveTab] = useState<'field' | 'log'>('field');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

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

  // Mount player-side unit visuals once (formation box + full BP/PO
  // canvas copy) -- these never change mid-run, so this only needs to
  // run once after both the renderer AND the room's own preset/
  // formation data are available.
  //
  // REQ-0045 (d) root cause: this used to take only `presetCanvas.bps[0]`
  // (the FIRST bp) and hand MonitorRenderer a single {bpColor,bpShape}
  // pair, which mountUnits() then drew as if that one shape alone
  // occupied the WHOLE formation box starting at its own local (0,0) --
  // "only the first BP is copied, auto-placed top-left". The preset's
  // OTHER BPs (and every placed PO) were silently dropped from the
  // visual entirely. sim/combat.cjs's compileUnitSnapshot was ALWAYS
  // correct here (its own bps.map(...) already iterates every BP, each
  // offset by its own origin -- see localBpCells) -- this was purely a
  // client-side DISPLAY bug, the actual combat simulation never had it.
  // Fixed by copying the preset's bps/pos arrays 1:1 (same "canvas is
  // already 8x8, no auto-repositioning" contract compileUnitSnapshot
  // already follows): every BP's cells are its own shape offsets PLUS
  // its own origin (mirroring sim/combat.cjs's localBpCells formula
  // exactly), and every placed (loc==='grid') PO becomes its own icon
  // entry at its own origin cell.
  useEffect(() => {
    if (!mountedOnce || !rendererRef.current || unitsMountedRef.current) return;
    const presets = snapshot.state?.presets;
    const activeCanvas = snapshot.state;
    const itemDefs = snapshot.gameData?.ITEMS;
    if (!activeCanvas) return;
    const units: MonitorUnitVisual[] = room.slots.map((slot, idx) => {
      const box = `unit${idx + 1}`;
      let label = `U${idx + 1}`;
      const bps: MonitorUnitVisual['bps'] = [];
      const icons: MonitorUnitVisual['icons'] = [];
      if (slot.presetIndex != null) {
        const presetCanvas =
          presets && slot.presetIndex === presets.active
            ? activeCanvas
            : presets?.store[slot.presetIndex] ?? null;
        if (presetCanvas?.bps?.length) {
          label = presets?.names[slot.presetIndex] ?? label;
          for (const bp of presetCanvas.bps) {
            // Mirrors sim/combat.cjs's localBpCells: shape offsets PLUS
            // this BP's own origin -- NOT re-normalized to (0,0).
            const cells: [number, number][] = bp.shape.map(([dr, dc]) => [bp.origin[0] + dr, bp.origin[1] + dc]);
            bps.push({ color: bp.color, cells });
          }
        }
        if (presetCanvas?.pos?.length && itemDefs) {
          for (const po of presetCanvas.pos) {
            if (po.loc !== 'grid' || !po.cell) continue;
            const def = itemDefs[po.id];
            if (!def) continue; // unknown/stale item id -- skip this one icon defensively, other units unaffected
            icons.push({ textureKey: def.icon, shape: def.shape, rot: po.rot, origin: po.cell });
          }
        }
      }
      return { slotIndex: idx, box, bps, label, icons };
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
        // REQ-0045 (d)/(f) regression-test seam: expose this room's
        // mounted units + enemy marker bounds keyed by roomId, same
        // "assert on real data instead of reverse-engineering canvas
        // pixels" rationale as store.ts's own __backpackDebug hook --
        // multiple room cards can each have their own Monitor instance
        // mounted simultaneously, so this is a roomId-keyed map, not a
        // single flat object. Never read by any production UI code path.
        interface MonitorDebugEntry {
          units: () => MonitorUnitVisual[];
          enemyBounds: () => Array<{ x: number; labelWidth: number; labelText: string }>;
          pulseCounts: () => { linkPulses: number; payloads: number; fizzles: number; rays: number };
          attachmentCounts: () => { reveal: number; disarm: number; open: number; lost: number; fire: number };
          applyTestEvents: (evs: ApiRunEvent[]) => void;
        }
        const debugWin = window as unknown as { __monitorDebug?: Record<string, MonitorDebugEntry> };
        if (!debugWin.__monitorDebug) debugWin.__monitorDebug = {};
        debugWin.__monitorDebug[room.id] = {
          units: () => rendererRef.current?.getLastMountedUnits() ?? [],
          enemyBounds: () => rendererRef.current?.getEnemyMarkerBounds() ?? [],
          // REQ-0048 test seam: pulse-visual counters + a direct applyEvents
          // hook so an e2e can drive synthetic pulse events (pulse CONTENT
          // -- spark/payload POs -- debuts later in the Ember Pack, so the
          // client render path is verified with injected events here).
          pulseCounts: () => rendererRef.current?.getPulseVisualCounts() ?? { linkPulses: 0, payloads: 0, fizzles: 0, rays: 0 },
          attachmentCounts: () => rendererRef.current?.getAttachmentVisualCounts() ?? { reveal: 0, disarm: 0, open: 0, lost: 0, fire: 0 },
          applyTestEvents: (evs: ApiRunEvent[]) => rendererRef.current?.applyEvents(evs),
        };
      } catch (e) {
        // Non-fatal -- the expanded view simply shows no unit
        // footprints if the formation lookup fails; ray animation and
        // the enemy side are unaffected.
      }
    })();
  }, [mountedOnce, room.slots, room.formationId, snapshot.state, snapshot.state?.presets, snapshot.gameData, room.id]);

  // REQ-0045 (e): once a run has genuinely settled (NOT merely
  // `run.result !== 'incomplete'` -- see the summary-gate fix below for
  // why that distinction matters) with a non-wipe result, fetch the
  // reward list. The warehouse is the actual reward ledger (golden e/f);
  // GET .../run itself carries no `rewards` field at all. Filtered down
  // to rows whose sourceRunId matches THIS run, so a monitor showing an
  // OLDER run's summary (or a different room's) never bleeds another
  // run's rewards into view. Runs once per runId (guarded by the
  // `rewards === null` check combined with the runId-keyed effect deps),
  // not on every ~2s poll tick.
  useEffect(() => {
    if (!run || !run.settled || run.result === 'wipe' || rewards !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const [contentPayload, whRes] = await Promise.all([fetchContent(), fetchWarehouse()]);
        if (cancelled) return;
        setContent(contentPayload);
        setRewards(whRes.items.filter((it) => it.sourceRunId === run.runId));
      } catch (e) {
        // Non-fatal -- the rewards list simply stays empty/unloaded if
        // this fetch fails; the rest of the summary panel (result,
        // level, cooldown) is unaffected.
        if (!cancelled) setRewards([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [run, rewards]);

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
    <div className="panel ornate schedule-monitor" data-testid="schedule-monitor" data-run-id={run?.runId}>
      <i className="k tl" />
      <i className="k tr" />
      <i className="k br" />
      <i className="k bl" />

      {/* REQ-0071: the mock's m-head strip -- title, dungeon name, LIVE
          chip while the run's own clock says it is still going, and the
          room's real generator seed. */}
      <div className="schedule-monitor-head">
        <span className="schedule-monitor-head-title dj">{t(locale, 'schedule.monitor.title')}</span>
        <span className="schedule-monitor-head-sep" aria-hidden="true">
          —
        </span>
        <span className="schedule-monitor-head-room">{dungeonName}</span>
        {run && !settled ? (
          <span className="chip is-live schedule-monitor-live-chip den" data-testid="schedule-monitor-live-chip">
            <span className="dot" aria-hidden="true" />
            {t(locale, 'schedule.monitor.live')}
          </span>
        ) : null}
        <span className="schedule-monitor-grow" aria-hidden="true" />
        {room.genSeed ? (
          <span className="schedule-monitor-seed t-micro tnum">{t(locale, 'schedule.monitor.seed', { seed: room.genSeed })}</span>
        ) : null}
      </div>

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
          toggles afterward, never a remount. REQ-0045 (g): the expanded
          section now also carries a "Log" tab (humanized one-line-per-
          event text + a raw JSONL copy button) alongside the existing
          "Field" (Pixi canvas) tab -- both panes stay mounted, only
          their own CSS visibility toggles on tab switch, same
          "mount once, toggle visibility" discipline as expand/collapse
          itself. */}
      <div className={`schedule-monitor-expanded${expanded ? '' : ' schedule-monitor-hidden'}`}>
        <div className="schedule-monitor-tabs">
          <button
            type="button"
            className={`schedule-monitor-tab-btn${activeTab === 'field' ? ' schedule-monitor-tab-btn-active' : ''}`}
            data-testid="schedule-monitor-tab-field"
            onClick={() => setActiveTab('field')}
          >
            {t(locale, 'schedule.monitor.tabField')}
          </button>
          <button
            type="button"
            className={`schedule-monitor-tab-btn${activeTab === 'log' ? ' schedule-monitor-tab-btn-active' : ''}`}
            data-testid="schedule-monitor-tab-log"
            onClick={() => setActiveTab('log')}
          >
            {t(locale, 'schedule.monitor.tabLog')}
          </button>
        </div>
        <div className={activeTab === 'field' ? 'schedule-monitor-field-pane' : 'schedule-monitor-hidden'}>
          <div className="schedule-monitor-stage">
            <canvas ref={canvasRef} className="schedule-monitor-canvas" data-testid="schedule-monitor-canvas" />
          </div>
          {/* REQ-0071: the mock's iron control bar. Replay pacing is the
              SERVER's wall clock (REQ-0045), so the mock's pause/speed/
              skip controls have no honest backing and are omitted -- the
              bar carries the real clock readout + the timeline (same pct
              source as the summary bar) with one pip per encounter_start
              at its own t/durationSecs position. */}
          <div className="schedule-monitor-ctrl">
            <span className="schedule-monitor-rivet" aria-hidden="true" />
            <span className="schedule-monitor-clock tnum" data-testid="schedule-monitor-clock">
              {run ? `${formatClock(run.clock.elapsedSecs)} / ${formatClock(run.durationSecs)}` : '--:-- / --:--'}
            </span>
            <div className="schedule-monitor-timeline" aria-hidden="true">
              <div className="schedule-monitor-timeline-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
              {run && run.durationSecs > 0
                ? run.events
                    .filter((ev) => ev.ev === 'encounter_start' && typeof ev.t === 'number')
                    .map((ev, i) => (
                      <i
                        key={i}
                        className="schedule-monitor-pip"
                        style={{ left: `${Math.max(0, Math.min(100, ((ev.t as number) / run.durationSecs) * 100))}%` }}
                      />
                    ))
                : null}
            </div>
            <span className="schedule-monitor-rivet" aria-hidden="true" />
          </div>
        </div>
        <div className={activeTab === 'log' ? 'schedule-monitor-log-panel' : 'schedule-monitor-hidden'} data-testid="schedule-monitor-log-panel">
          <div className="schedule-monitor-log-actions">
            <button
              type="button"
              className="schedule-monitor-log-copy-btn"
              data-testid="schedule-monitor-log-copy-btn"
              onClick={async () => {
                // Raw JSONL -- one event per line, same wire shape
                // GET .../run's own `events` array already carries (no
                // server-side toJSONL() call needed here; this is
                // exactly combat.cjs's own toJSONL format: one
                // JSON.stringify'd event per line).
                const jsonl = (run?.events ?? []).map((ev) => JSON.stringify(ev)).join('\n');
                try {
                  await navigator.clipboard.writeText(jsonl);
                  setCopyStatus('copied');
                } catch (e) {
                  setCopyStatus('failed');
                }
                setTimeout(() => setCopyStatus('idle'), 2000);
              }}
            >
              {t(locale, 'schedule.monitor.copyJsonl')}
            </button>
            {copyStatus === 'copied' ? <span className="schedule-monitor-log-copy-status" data-testid="schedule-monitor-log-copy-status">{t(locale, 'schedule.monitor.copied')}</span> : null}
            {copyStatus === 'failed' ? <span className="schedule-monitor-log-copy-status schedule-monitor-log-copy-failed">{t(locale, 'schedule.monitor.copyFailed')}</span> : null}
          </div>
          <pre className="schedule-monitor-log-text" data-testid="schedule-monitor-log-text">
            {run && run.events.length > 0
              ? run.events.map((ev, idx) => `${idx}: ${humanizeEvent(ev)}`).join('\n')
              : t(locale, 'schedule.monitor.logEmpty')}
          </pre>
          {/* REQ-0071: mock logbar caption -- real event count. */}
          <div className="schedule-monitor-logbar t-micro">{t(locale, 'schedule.monitor.logCaption', { count: run?.events.length ?? 0 })}</div>
        </div>
      </div>

      {/* REQ-0045 (e) root cause #1: this panel used to reveal itself
          whenever `run.result !== 'incomplete'`, but result/rewards-
          adjacent fields are computed INSTANTLY at run start and always
          reflect the EVENTUAL final outcome (see ApiRunView's own doc
          comment in api.ts and server/api.cjs's matching comment on the
          GET .../run handler) -- so "Victory" could render the moment a
          run started, long before anything had actually happened,
          whenever the run's eventual (correctly-computed) outcome
          happened to be a win. The gate now strictly requires `settled`
          (== run.clock.isSettled, mirrored server-side into the
          `settled` field), matching visibleEvents()'s own
          not-yet-reached-events withholding discipline -- a spectator
          never sees the outcome before the run's own clock says it's
          over. */}
      {run && settled ? (
        <div className="schedule-monitor-summary" data-testid="schedule-monitor-summary">
          <div className={`schedule-monitor-result schedule-monitor-result-${run.result} dj`}>
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
            <>
              <div className="schedule-monitor-rewards-title">{t(locale, 'schedule.monitor.rewardsTitle')}</div>
              {/* REQ-0045 (e) root cause #2: `run.rewards` was never a
                  real field at all (GET .../run carries no such key) --
                  the warehouse IS the reward ledger; this list is
                  fetched (see the effect above) and rendered here for
                  the first time. `rewards === null` means "not fetched
                  yet" (still loading); `[]` means "fetched, genuinely
                  zero rows" (e.g. a victory whose reward roll produced
                  nothing this time, or the run's rows were already
                  claimed+consumed elsewhere before this panel loaded). */}
              {rewards === null ? (
                <div className="schedule-monitor-rewards-loading" data-testid="schedule-monitor-rewards-loading">{t(locale, 'schedule.loading')}</div>
              ) : rewards.length === 0 ? (
                <div className="schedule-monitor-rewards-none" data-testid="schedule-monitor-rewards-none">{t(locale, 'schedule.monitor.rewardsNone')}</div>
              ) : (
                <ul className="schedule-monitor-rewards-list" data-testid="schedule-monitor-rewards-list">
                  {rewards.map((item) => {
                    // REQ-0071: mock spoils rows -- icon thumb + rarity-
                    // tinted name (same content-map lookup + iconDataUrl
                    // the WarehouseTab rows already use).
                    const visual = rewardVisual(content, item);
                    return (
                      <li className="schedule-monitor-reward-row" key={item.itemUid} data-testid="schedule-monitor-reward-row" data-item-uid={item.itemUid}>
                        <span className="schedule-monitor-reward-thumb" aria-hidden="true">
                          {visual.icon ? <img src={visual.icon} alt="" /> : null}
                        </span>
                        <span className={`schedule-monitor-reward-name${visual.rarity ? ` rarity r-${visual.rarity}` : ''}`}>
                          {localizedItemName(locale, content, item.itemId)}
                          {item.kind === 'tm' && typeof item.qty === 'number' ? ` x${item.qty}` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
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
