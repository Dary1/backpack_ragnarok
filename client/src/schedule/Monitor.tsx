// Run monitor (golden k) -- REQ-0036 P1-C, rebuilt REQ-0240 into the six-zone
// spectator surface (03 spec): M1 header banner, M2 expedition rail, M3 Pixi
// stage, M4 localized event feed, M5 squad dock, M6 transport. Presentation
// pacing (user directive #7): events are RELEASED to the renderer/feed/dock at
// presentation cadence by useRunPlayhead (2.5s deliberate live lag, 6s catch-up),
// NOT the instant the poll returns them. The sim still resolves instantly; the
// presentation TIME is what stretches.
//
// Kept invariants: ONE Pixi Application per Monitor, mounted once, CSS-toggled,
// destroyed only on real unmount; poll GET .../run ~2s (FULL server-visible
// array, gated on pt); every kept data-testid still works; the __monitorDebug
// e2e seam is preserved. The old Field/Log tabs retire (the feed IS the log,
// humanized; raw JSONL moves to the admin ⋯ menu).
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  fetchContent, fetchDungeons, fetchRun, fetchWarehouse,
  type ApiContentPayload, type ApiRoom, type ApiRunEvent, type ApiWarehouseItem,
} from '../api';
import { loadBoardTextures } from '../board/sprites';
import { iconDataUrl } from '../dex/dexIcons';
import { t } from '../i18n';
import type { Locale } from '../store';
import { useGameStore } from '../store';
import { formatCountdown } from './RoomCard';
import { MonitorRenderer, type MonitorSquadVisual } from './MonitorRenderer';
import { ChimeEngine, type ChimeStats } from './chimes/ChimeEngine';
import { loadChimePrefs, CHIME_PREFS_EVENT } from './chimes/chimePrefs';
import { MonitorHeader } from './monitor/MonitorHeader';
import { ExpeditionRail } from './monitor/ExpeditionRail';
import { railNodesFrom, type RailNode } from './monitor/railNodes';
import { EventFeed } from './monitor/EventFeed';
import { SquadDock } from './monitor/SquadDock';
import { useRunPlayhead, type Speed } from './monitor/useRunPlayhead';
import { feedRow, type FeedRow } from './monitor/feedCopy';
import { reduceRunRoster } from './monitor/runRoster';

function localizedItemName(locale: Locale, content: ApiContentPayload | null, itemId: string): string {
  const entry = content?.items[itemId] ?? content?.sis[itemId] ?? content?.tms[itemId];
  if (!entry) return itemId;
  if (locale === 'ja') return entry.i18n?.ja?.name ?? entry.name_ja ?? entry.name;
  return entry.name;
}
function rewardVisual(content: ApiContentPayload | null, item: ApiWarehouseItem): { icon: string | null; rarity: string | null } {
  if (!content) return { icon: null, rarity: null };
  const entry = item.kind === 'tm' ? content.tms[item.itemId] : content.items[item.itemId] ?? content.sis[item.itemId];
  if (!entry) return { icon: null, rarity: null };
  return { icon: iconDataUrl(entry.icon), rarity: entry.rarity ?? null };
}
function formatClock(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface MonitorProps {
  room: ApiRoom;
  locale: Locale;
  dungeonName: string;
  isAdmin: boolean;
  onRunSettled?: () => void;
}

const POLL_MS = 2000;
const SPEEDS: Speed[] = [0.5, 1, 2, 4];

function latestOfType(events: ApiRunEvent[], evName: string): ApiRunEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].ev === evName) return events[i];
  return null;
}

export function Monitor({ room, locale, dungeonName, isAdmin, onRunSettled }: MonitorProps) {
  const snapshot = useGameStore();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id); }, []);

  const [run, setRun] = useState<import('../api').ApiRunView | null>(null);
  const [mountedOnce, setMountedOnce] = useState(false);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<MonitorRenderer | null>(null);
  const chimeEngineRef = useRef<ChimeEngine | null>(null);
  const cursorRef = useRef(0);
  const lastSilentEpochRef = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const squadsMountedRef = useRef(false);
  const rosterSetRef = useRef<string | null>(null);
  const [rewards, setRewards] = useState<ApiWarehouseItem[] | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [narrow, setNarrow] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const playhead = useRunPlayhead(run);
  const { playheadMs, durationMs, releasedIdx, isLive, needsCatchup, catchUp, speed, setSpeed, playing, setPlaying, seekMs, restart, progressPct, silentEpoch } = playhead;

  // Poll GET .../run ~2s while this room has (or recently had) a run.
  useEffect(() => {
    if (!room.lastRunId) { setRun(null); return; }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try { const view = await fetchRun(room.id); if (!cancelled) setRun(view); } catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [room.id, room.lastRunId]);

  // Reset per-run cursors when the run identity changes.
  useEffect(() => {
    if (run && run.runId !== runIdRef.current) {
      runIdRef.current = run.runId;
      cursorRef.current = 0;
      lastSilentEpochRef.current = silentEpoch;
      rendererRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId]);

  // Mount the Pixi renderer ONCE the canvas enters the DOM.
  useEffect(() => {
    if (mountedOnce || !canvasEl) return;
    let cancelled = false;
    void (async () => {
      const textures = await loadBoardTextures();
      if (cancelled || !canvasEl) return;
      const renderer = await MonitorRenderer.mount(canvasEl, textures);
      if (cancelled) { renderer.destroy(); return; }
      rendererRef.current = renderer;
      const engine = new ChimeEngine(loadChimePrefs());
      chimeEngineRef.current = engine;
      renderer.setChimeSink(engine);
      renderer.setLayout(narrow ? 'column' : 'row');
      setMountedOnce(true);
    })();
    return () => { cancelled = true; };
  }, [mountedOnce, canvasEl, narrow]);

  // Breakpoint: relayout the Pixi fields (row <-> column) without recreating
  // the app; the DOM zones restack via CSS.
  useEffect(() => {
    const el = shellRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setNarrow(w < 900);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { rendererRef.current?.setLayout(narrow ? 'column' : 'row'); }, [narrow]);

  // Mount player squads once + push the enemy/player roster to the renderer.
  useEffect(() => {
    if (!mountedOnce || !rendererRef.current || squadsMountedRef.current) return;
    const squadStore = snapshot.state?.presets;
    const activeCanvas = snapshot.state;
    const itemDefs = snapshot.gameData?.ITEMS;
    if (!activeCanvas) return;
    const squads: MonitorSquadVisual[] = room.slots.map((slot, idx) => {
      const bps: MonitorSquadVisual['bps'] = [];
      const icons: MonitorSquadVisual['icons'] = [];
      let label = `U${idx + 1}`;
      if (slot.squadIndex != null) {
        const squadCanvas = squadStore && slot.squadIndex === squadStore.active ? activeCanvas : squadStore?.store[slot.squadIndex] ?? null;
        if (squadCanvas?.bps?.length) {
          label = squadStore?.names[slot.squadIndex] ?? label;
          for (const bp of squadCanvas.bps) bps.push({ color: bp.color, cells: bp.shape.map(([dr, dc]) => [bp.origin[0] + dr, bp.origin[1] + dc]) });
        }
        if (squadCanvas?.pos?.length && itemDefs) {
          for (const po of squadCanvas.pos) {
            if (po.loc !== 'grid' || !po.cell) continue;
            const def = itemDefs[po.id]; if (!def) continue;
            icons.push({ textureKey: def.icon, shape: def.shape, rot: po.rot, origin: po.cell });
          }
        }
      }
      return { slotIndex: idx, box: `unit${idx + 1}`, bps, label, icons };
    });
    void (async () => {
      try {
        const payload = await fetchDungeons();
        const formation = payload.formations.find((f) => f.id === room.formationId);
        const withRealBoxes = squads.map((u) => ({ ...u, box: formation?.canvases[`unit${u.slotIndex + 1}`] ?? u.box }));
        rendererRef.current?.mountSquads(withRealBoxes);
        squadsMountedRef.current = true;
        interface MonitorDebugEntry {
          squads: () => MonitorSquadVisual[];
          enemyBounds: () => Array<{ x: number; labelWidth: number; labelText: string }>;
          pulseCounts: () => { linkPulses: number; payloads: number; fizzles: number; rays: number };
          attachmentCounts: () => { reveal: number; disarm: number; open: number; lost: number; fire: number };
          applyTestEvents: (evs: ApiRunEvent[]) => void;
          chimeStats: () => ChimeStats | null;
        }
        const debugWin = window as unknown as { __monitorDebug?: Record<string, MonitorDebugEntry> };
        if (!debugWin.__monitorDebug) debugWin.__monitorDebug = {};
        debugWin.__monitorDebug[room.id] = {
          squads: () => rendererRef.current?.getLastMountedSquads() ?? [],
          enemyBounds: () => rendererRef.current?.getEnemyMarkerBounds() ?? [],
          pulseCounts: () => rendererRef.current?.getPulseVisualCounts() ?? { linkPulses: 0, payloads: 0, fizzles: 0, rays: 0 },
          attachmentCounts: () => rendererRef.current?.getAttachmentVisualCounts() ?? { reveal: 0, disarm: 0, open: 0, lost: 0, fire: 0 },
          applyTestEvents: (evs: ApiRunEvent[]) => rendererRef.current?.applyEvents(evs),
          chimeStats: () => chimeEngineRef.current?.getStats() ?? null,
        };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[backpack_ragnarok] Monitor: squad/formation mount failed', e);
      }
    })();
  }, [mountedOnce, room.slots, room.formationId, snapshot.state, snapshot.gameData, room.id]);

  // Push roster (M1) to the renderer once available (drives stage plates/HP ticks).
  useEffect(() => {
    if (!mountedOnce || !rendererRef.current || !run?.roster) return;
    if (rosterSetRef.current === run.runId) return;
    rendererRef.current.setRoster(run.roster);
    rosterSetRef.current = run.runId;
  }, [mountedOnce, run?.roster, run?.runId]);

  // Release events to the renderer at PRESENTATION cadence (playhead), not poll
  // time -- animated for normal live release, silent for catch-up/seek/settle.
  useEffect(() => {
    const r = rendererRef.current; if (!r || !run) return;
    const idx = releasedIdx;
    const silentBatch = silentEpoch !== lastSilentEpochRef.current;
    lastSilentEpochRef.current = silentEpoch;
    if (idx === cursorRef.current && !silentBatch) return;
    if (idx < cursorRef.current) { r.reset(); r.applyEvents(run.events.slice(0, idx), { silent: true }); }
    else if (idx > cursorRef.current) r.applyEvents(run.events.slice(cursorRef.current, idx), { silent: silentBatch });
    cursorRef.current = idx;
  }, [releasedIdx, silentEpoch, run]);

  // Rewards fetch once settled + non-wipe.
  useEffect(() => {
    if (!run || !run.settled || run.result === 'wipe' || rewards !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const [contentPayload, whRes] = await Promise.all([fetchContent(), fetchWarehouse()]);
        if (cancelled) return;
        setContent(contentPayload);
        setRewards(whRes.items.filter((it) => it.sourceRunId === run.runId));
      } catch { if (!cancelled) setRewards([]); }
    })();
    return () => { cancelled = true; };
  }, [run, rewards]);

  const settled = run?.settled ?? false;
  useEffect(() => { if (settled && run) onRunSettled?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [settled, run?.runId]);

  useEffect(() => () => {
    rendererRef.current?.destroy(); rendererRef.current = null;
    chimeEngineRef.current?.dispose(); chimeEngineRef.current = null;
  }, []);
  useEffect(() => {
    const onPrefs = (): void => chimeEngineRef.current?.setPrefs(loadChimePrefs());
    window.addEventListener(CHIME_PREFS_EVENT, onPrefs); window.addEventListener('storage', onPrefs);
    return () => { window.removeEventListener(CHIME_PREFS_EVENT, onPrefs); window.removeEventListener('storage', onPrefs); };
  }, []);

  const onCopyJsonl = useCallback(() => {
    const jsonl = (run?.events ?? []).map((ev) => JSON.stringify(ev)).join('\n');
    void navigator.clipboard.writeText(jsonl).then(() => setCopyStatus('copied')).catch(() => setCopyStatus('failed'));
    setTimeout(() => setCopyStatus('idle'), 2000);
  }, [run]);

  const onPlayPause = useCallback(() => {
    if (!settled || !run) return;
    chimeEngineRef.current?.resume();
    if (!playing) { if (playheadMs >= durationMs) restart(); else setPlaying(true); }
    else setPlaying(false);
  }, [settled, run, playing, playheadMs, durationMs, restart, setPlaying]);
  const onSkipEnd = useCallback(() => { if (settled && run) seekMs(durationMs); }, [settled, run, durationMs, seekMs]);
  const onScrubClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!settled || !run) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    seekMs(Math.max(0, Math.min(1, frac)) * durationMs);
  }, [settled, run, durationMs, seekMs]);

  // ---- derived view data (released slice drives feed/dock/rail passed-state) ----
  const released = useMemo(() => (run ? run.events.slice(0, releasedIdx) : []), [run, releasedIdx]);
  const enemyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const en of run?.roster?.enemies ?? []) m.set(en.id, locale === 'ja' ? en.nameJa : en.name);
    return m;
  }, [run?.roster, locale]);
  const feedRows = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [];
    for (let i = 0; i < released.length; i++) {
      const fr = feedRow(locale, released[i], i, { dungeonName, enemyName: (id) => enemyNameById.get(id) ?? id });
      if (fr) rows.push(fr);
    }
    return rows;
  }, [released, locale, dungeonName, enemyNameById]);
  const rosterState = useMemo(() => reduceRunRoster(run?.roster ?? null, released, locale === 'ja' ? 'ja' : 'en'), [run?.roster, released, locale]);
  const squadNames = useMemo(() => room.slots.map((slot) => (slot.squadIndex != null ? snapshot.state?.presets?.names[slot.squadIndex] ?? null : null)), [room.slots, snapshot.state]);
  const railNodes = useMemo<RailNode[]>(() => {
    if (!run) return [];
    return railNodesFrom(run.events, locale).map((n) => ({ ...n, passed: n.ptMs <= playheadMs }));
  }, [run, locale, playheadMs]);

  const latestProgress = run ? (latestOfType(released, 'progress')?.pct as number | undefined) : undefined;
  const railPct = typeof latestProgress === 'number' ? latestProgress : progressPct;
  const returnAt = run && isLive ? new Date(Date.parse(run.startedAt) + run.durationSecs * 1000).toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : null;

  if (!room.lastRunId) {
    return <div className="schedule-monitor schedule-monitor-empty">{t(locale, 'schedule.monitor.awaitingRun')}</div>;
  }

  return (
    <div ref={shellRef} className={`panel ornate schedule-monitor mon-shell${narrow ? ' is-narrow' : ''}`} data-testid="schedule-monitor" data-run-id={run?.runId}>
      <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />

      <MonitorHeader
        locale={locale} dungeonId={room.dungeonId} dungeonName={dungeonName} level={room.level}
        live={isLive} returnAt={returnAt} seed={isAdmin ? room.genSeed ?? null : null}
        isAdmin={isAdmin} onCopyJsonl={onCopyJsonl} copyStatus={copyStatus}
      />

      <ExpeditionRail locale={locale} nodes={railNodes} pct={railPct} durationMs={durationMs} settled={settled} onScrub={(frac) => seekMs(frac * durationMs)} />

      <div className="mon-body">
        <div className="mon-stage" data-testid="monitor-stage">
          <canvas ref={setCanvasEl} className="schedule-monitor-canvas" data-testid="schedule-monitor-canvas" />
        </div>
        <EventFeed locale={locale} rows={feedRows} live={isLive} />
      </div>

      <SquadDock locale={locale} squads={rosterState.squads} names={squadNames} />

      {/* M6 transport */}
      <div className="mon-transport" data-testid="schedule-monitor-transport">
        {settled ? (
          <>
            <button type="button" className="schedule-monitor-play mon-play" data-testid="schedule-monitor-play"
              aria-label={t(locale, playing ? 'schedule.monitor.replay.pause' : 'schedule.monitor.replay.play')} onClick={onPlayPause}>
              {playing ? '⏸' : '▶'}
            </button>
            {SPEEDS.map((s) => (
              <button key={s} type="button" className={`chip schedule-monitor-speed${speed === s ? ' is-on' : ''}`} data-testid={`schedule-monitor-speed-${s}`} onClick={() => setSpeed(s)}>{s}×</button>
            ))}
            <button type="button" className="btn btn-ghost schedule-monitor-skip-end" data-testid="schedule-monitor-skip-end" onClick={onSkipEnd}>{t(locale, 'schedule.monitor.replay.skipEnd')}</button>
          </>
        ) : (
          <>
            <span className="chip is-live den mon-transport-live"><span className="dot" aria-hidden="true" />{t(locale, 'schedule.monitor.live')}</span>
            {needsCatchup ? <button type="button" className="chip mon-catchup" data-testid="monitor-catchup" onClick={catchUp}>{t(locale, 'schedule.monitor.catchUp')}</button> : null}
          </>
        )}
        <span className="mon-transport-clock tnum" data-testid="schedule-monitor-clock">
          {run ? `${formatClock(playheadMs / 1000)} / ${formatClock(durationMs / 1000)}` : '--:-- / --:--'}
        </span>
        <div className={`mon-scrub${settled ? ' is-scrub' : ''}`} data-testid="schedule-monitor-scrub" onClick={settled ? onScrubClick : undefined}>
          <div className="mon-scrub-fill" style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
        </div>
      </div>

      {/* Settled summary (restyled; testids kept) */}
      {run && settled ? (
        <div className="schedule-monitor-summary mon-summary" data-testid="schedule-monitor-summary">
          <div className={`schedule-monitor-result schedule-monitor-result-${run.result} dj`}>
            {t(locale, run.result === 'victory' ? 'schedule.monitor.resultVictory' : run.result === 'wipe' ? 'schedule.monitor.resultWipe' : 'schedule.monitor.resultIncomplete')}
          </div>
          {run.result === 'wipe' ? (
            <>
              <div className="schedule-monitor-rewards-none">{t(locale, 'schedule.monitor.rewardsWipeNote')}</div>
              <div className="schedule-monitor-level-dropped">{t(locale, 'schedule.monitor.levelDropped', { level: String(run.levelAfter) })}</div>
            </>
          ) : (
            <>
              <div className="schedule-monitor-rewards-title">{t(locale, 'schedule.monitor.rewardsTitle')}</div>
              {rewards === null ? (
                <div className="schedule-monitor-rewards-loading" data-testid="schedule-monitor-rewards-loading">{t(locale, 'schedule.loading')}</div>
              ) : rewards.length === 0 ? (
                <div className="schedule-monitor-rewards-none" data-testid="schedule-monitor-rewards-none">{t(locale, 'schedule.monitor.rewardsNone')}</div>
              ) : (
                <ul className="schedule-monitor-rewards-list" data-testid="schedule-monitor-rewards-list">
                  {rewards.map((item) => {
                    const visual = rewardVisual(content, item);
                    return (
                      <li className="schedule-monitor-reward-row" key={item.itemUid} data-testid="schedule-monitor-reward-row" data-item-uid={item.itemUid}>
                        <span className="schedule-monitor-reward-thumb" aria-hidden="true">{visual.icon ? <img src={visual.icon} alt="" /> : null}</span>
                        <span className={`schedule-monitor-reward-name${visual.rarity ? ` rarity r-${visual.rarity}` : ''}`}>
                          {localizedItemName(locale, content, item.itemId)}{item.kind === 'tm' && typeof item.qty === 'number' ? ` x${item.qty}` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {rewards && rewards.length > 0 ? (
                <div className="schedule-monitor-rewards-hint" data-testid="schedule-monitor-rewards-hint">
                  <span>{t(locale, 'schedule.monitor.rewardsHint')}</span>
                  <a className="schedule-monitor-rewards-hint-link" href="#/warehouse">{t(locale, 'schedule.monitor.rewardsHintLink')}</a>
                </div>
              ) : null}
            </>
          )}
          <div className="schedule-monitor-settled-badge">{t(locale, 'schedule.monitor.settled')}</div>
          {room.status !== 'canceled' && !room.cancelRequested && room.cooldownUntil && Date.parse(room.cooldownUntil) > nowMs ? (
            <div className="schedule-monitor-cooldown" data-testid="schedule-monitor-cooldown">
              {t(locale, 'schedule.monitor.cooldownUntil', { time: formatCountdown(Date.parse(room.cooldownUntil) - nowMs, locale) })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
