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
  fetchContent, fetchDungeons, fetchRun, fetchRunById, fetchWarehouse,
  type ApiContentPayload, type ApiRoom, type ApiRunEvent, type ApiWarehouseItem,
} from '../api';
import { loadBoardTextures } from '../board/sprites';
import { iconDataUrl } from '../dex/dexIcons';
import { t } from '../i18n';
import type { Locale } from '../store';
import { focusInTextEntry, useGameStore } from '../store';
import { formatCountdown } from './RoomCard';
import { seatIsOwnedBy } from './seats'; // REQ-0337
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
  /** REQ-0304: the DRAWN dungeon's theme, surfaced in the monitor header post-entry. */
  dungeonTheme?: string;
  isAdmin: boolean;
  /** REQ-0372: a PAST run of this room to replay instead of its current one
   * (picked in the History fold). The past run is settled and immutable, so
   * this swaps the SOURCE of the run view and nothing else -- the renderer,
   * the playhead and the REQ-0099 transport are the same code either way. */
  replayRunId?: string | null;
  onRunSettled?: () => void;
}

const POLL_MS = 2000;
const SPEEDS: Speed[] = [0.5, 1, 2, 4];

function latestOfType(events: ApiRunEvent[], evName: string): ApiRunEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].ev === evName) return events[i];
  return null;
}

export function Monitor({ room, locale, dungeonName, dungeonTheme, isAdmin, replayRunId, onRunSettled }: MonitorProps) {
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
  // REQ-0355: 'own' (legacy own-store visuals) | 'run:<id>' (roster seat
  // canvases) -- keyed so an auto-restarted run's fresh snapshots re-mount.
  const squadsMountKeyRef = useRef<string | null>(null);
  const rosterSetRef = useRef<string | null>(null);
  const [rewards, setRewards] = useState<ApiWarehouseItem[] | null>(null);
  const [content, setContent] = useState<ApiContentPayload | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [narrow, setNarrow] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const playhead = useRunPlayhead(run);
  const { playheadMs, durationMs, releasedIdx, isLive, needsCatchup, catchUp, speed, setSpeed, playing, setPlaying, seekMs, restart, progressPct, silentEpoch } = playhead;

  // Poll GET .../run ~2s while this room has (or recently had) a run.
  // REQ-0372: with a PAST run selected, fetch it ONCE instead -- a settled run
  // is immutable, so polling it would be pure noise (and would fight the
  // player's own playhead by re-triggering the settle-transition park).
  useEffect(() => {
    if (replayRunId) {
      let cancelled = false;
      setRun(null); // drop the previous run first: the renderer resets on run identity change
      void (async () => {
        try { const view = await fetchRunById(room.id, replayRunId); if (!cancelled) setRun(view); } catch { /* the row is gone (pruned) -- the fold reloads */ }
      })();
      return () => { cancelled = true; };
    }
    if (!room.lastRunId) { setRun(null); return; }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try { const view = await fetchRun(room.id); if (!cancelled) setRun(view); } catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [room.id, room.lastRunId, replayRunId]);

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

  // REQ-0276 B3: keep the renderer's locale in sync (enemy nameJa + KO copy).
  useEffect(() => { if (mountedOnce) rendererRef.current?.setLocale(locale); }, [mountedOnce, locale]);

  // Mount player squads + push the enemy/player roster to the renderer.
  // REQ-0355: seat visuals now come FIRST from the run roster's frozen per-seat
  // canvases (server-served, so ALL FOUR seats render for every troop member --
  // previously a seat held by another owner drew as an empty placeholder); the
  // REQ-0337 own-store path stays as the fallback for legacy runs.
  const rosterSlots = run?.roster?.slots;
  const hasSeatCanvases = !!rosterSlots?.some((sl) => sl?.canvas && ((sl.canvas.bps?.length ?? 0) > 0 || (sl.canvas.pos?.length ?? 0) > 0));
  useEffect(() => {
    if (!mountedOnce || !rendererRef.current) return;
    const mountKey = hasSeatCanvases ? `run:${run?.runId ?? ''}` : 'own';
    if (squadsMountKeyRef.current === mountKey) return;
    const squadStore = snapshot.state?.presets;
    const activeCanvas = snapshot.state;
    const itemDefs = snapshot.gameData?.ITEMS;
    if (!hasSeatCanvases && !activeCanvas) return;
    const squads: MonitorSquadVisual[] = room.slots.map((slot, idx) => {
      const bps: MonitorSquadVisual['bps'] = [];
      const icons: MonitorSquadVisual['icons'] = [];
      let label = `U${idx + 1}`;
      // REQ-0337: `slot` is NULL for a co-op Troop's free seat (a solo room's
      // unfilled slot is `{squadIndex:null}`), and a seat held by ANOTHER player
      // names a squad on THEIR canvas which we do not have. isOwnSeat covers
      // both: anything that is not our own seat draws as the bare `U{n}`
      // placeholder with no BPs, which is the honest rendering -- we cannot know
      // what their squad looks like. Reading slot.squadIndex unguarded threw a
      // TypeError here the moment a Troop was watched (caught live 2026-07-29,
      // contained by MonitorErrorBoundary but the whole Watch pane was dead).
      // REQ-0355: the run's own frozen seat canvas draws ANY owner's seat.
      const seatCanvas = rosterSlots?.[idx]?.canvas;
      if (seatCanvas && ((seatCanvas.bps?.length ?? 0) > 0 || (seatCanvas.pos?.length ?? 0) > 0)) {
        if (seatIsOwnedBy(slot, room.ownerId)) label = squadStore?.names[slot.squadIndex] ?? label;
        else label = seatCanvas.bps?.[0]?.name ?? label;
        for (const bp of seatCanvas.bps ?? []) {
          const u = bp.unit ?? undefined;
          const seatCell: [number, number] | undefined =
            u && Array.isArray(u.off) && Number.isFinite(bp.origin[0] + u.off[0]) && Number.isFinite(bp.origin[1] + u.off[1])
              ? [bp.origin[0] + u.off[0], bp.origin[1] + u.off[1]]
              : undefined;
          bps.push({ color: bp.color ?? '#8a8a8a', cells: bp.shape.map(([dr, dc]) => [bp.origin[0] + dr, bp.origin[1] + dc]), unitId: u?.id, seatCell });
        }
        if (itemDefs) {
          for (const po of seatCanvas.pos ?? []) {
            if (!Array.isArray(po.cell)) continue;
            const def = itemDefs[po.id]; if (!def) continue;
            icons.push({ textureKey: def.icon, shape: def.shape, rot: po.rot, origin: po.cell, itemId: po.id });
          }
        }
      } else if (seatIsOwnedBy(slot, room.ownerId)) {
        const squadCanvas = squadStore && slot.squadIndex === squadStore.active ? activeCanvas : squadStore?.store[slot.squadIndex] ?? null;
        if (squadCanvas?.bps?.length) {
          label = squadStore?.names[slot.squadIndex] ?? label;
          for (const bp of squadCanvas.bps) {
            // REQ-0284 (regression hotfix): a BP need NOT carry a seated Unit --
            // the owner's live squad fields a bare "wall" BP (footprint, no
            // unit). REQ-0283 read bp.unit.id / bp.unit.off[0] unconditionally
            // (the BP.unit TYPE is non-optional, but real stored canvases can
            // omit it), throwing a TypeError HERE at monitor mount; with no error
            // boundary in the app that aborted the whole Watch view. Draw a
            // unit-less BP faithfully as its bare cells -- unitId + seatCell
            // absent are both already honoured by squadCompositor (fill + POs,
            // no seat disc / icon / skin), so nothing is displaced.
            const u = bp.unit as { id?: string; off?: [number, number] } | undefined;
            const seatCell: [number, number] | undefined =
              u && Array.isArray(u.off) && Number.isFinite(bp.origin[0] + u.off[0]) && Number.isFinite(bp.origin[1] + u.off[1])
                ? [bp.origin[0] + u.off[0], bp.origin[1] + u.off[1]]
                : undefined;
            bps.push({ color: bp.color, cells: bp.shape.map(([dr, dc]) => [bp.origin[0] + dr, bp.origin[1] + dc]), unitId: u ? u.id : undefined, seatCell });
          }
        }
        if (squadCanvas?.pos?.length && itemDefs) {
          for (const po of squadCanvas.pos) {
            if (po.loc !== 'grid' || !po.cell) continue;
            const def = itemDefs[po.id]; if (!def) continue;
            icons.push({ textureKey: def.icon, shape: def.shape, rot: po.rot, origin: po.cell, itemId: po.id });
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
        squadsMountKeyRef.current = mountKey;
        interface MonitorDebugEntry {
          squads: () => MonitorSquadVisual[];
          enemyBounds: () => Array<{ x: number; labelWidth: number; labelText: string }>;
          pulseCounts: () => { linkPulses: number; payloads: number; fizzles: number; rays: number };
          attachmentCounts: () => { reveal: number; disarm: number; open: number; lost: number; fire: number };
          applyTestEvents: (evs: ApiRunEvent[]) => void;
          chimeStats: () => ChimeStats | null;
          enemyActors: () => unknown[];
          setTestRoster: (roster: import('../api').ApiRunRoster) => number;
          ramps: () => { pt: number; cooldowns: Array<{ key: string; frac: number }>; charges: Array<{ key: string; value: number; capacity: number; frac: number }>; badges: string[] };
          setPlayhead: (ms: number) => void;
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
          enemyActors: () => rendererRef.current?.getEnemyActors() ?? [],
          // REQ-0285 regression seam: drive the UNGUARDED mount path directly
          // (renderer.setRoster) with an arbitrary roster and report how many
          // actors were built. A malformed enemy must be SKIPPED (not throw), so
          // a 2-valid + 1-malformed roster returns 2 and the view stays alive.
          setTestRoster: (roster: import('../api').ApiRunRoster) => {
            rendererRef.current?.setRoster(roster);
            return rendererRef.current?.getBuiltEnemyCount() ?? -1;
          },
          // REQ-0292 P2: pt-clock ramp seam -- setPlayhead drives the clock, ramps()
          // reports cooldown/charge fractions + tracked skill-badge keys at that pt.
          ramps: () => rendererRef.current?.getRampsSnapshot() ?? { pt: 0, cooldowns: [], charges: [], badges: [] },
          setPlayhead: (ms: number) => rendererRef.current?.setPlayhead(ms),
        };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[backpack_ragnarok] Monitor: squad/formation mount failed', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountedOnce, hasSeatCanvases, run?.runId, room.slots, room.formationId, room.ownerId, snapshot.state, snapshot.gameData, room.id]);

  // Push roster (M1) to the renderer once available (drives stage plates/HP ticks).
  useEffect(() => {
    if (!mountedOnce || !rendererRef.current || !run?.roster) return;
    if (rosterSetRef.current === run.runId) return;
    // REQ-0285: setRoster runs at monitor mount and is the one UNGUARDED
    // synchronous throw path in this component -- a malformed roster (guarded
    // per-enemy inside EnemyPlane.setRoster) must never tear down the Watch
    // view. Belt-and-suspenders with the MonitorErrorBoundary wrapping this tree.
    try {
      rendererRef.current.setRoster(run.roster);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[backpack_ragnarok] Monitor: setRoster failed (run rendered without the enemy plane)', e);
    }
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

  // REQ-0292 P2: push the presentation-time playhead + pacingVersion into the
  // renderer so its persistent ramp ticker evaluates the cooldown/charge sweeps
  // against the SAME pt clock the release cursor uses. playheadMs updates every
  // rAF; setPlayhead is a cheap field set (the Pixi ticker does the drawing).
  useEffect(() => { rendererRef.current?.setPlayhead(playheadMs); }, [playheadMs]);
  useEffect(() => { rendererRef.current?.setPacingVersion(run?.pacingVersion ?? 1); }, [run?.pacingVersion, mountedOnce]);

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
  // REQ-0372: a PAST run is settled by construction -- announcing it would
  // re-fire the spoils/history refresh on every row click, for a settlement
  // that happened long ago. Only the room's CURRENT run settling is news.
  useEffect(() => { if (settled && run && !replayRunId) onRunSettled?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [settled, run?.runId, replayRunId]);

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

  // REQ-0369 (spec item 2): Space = play/pause while a settled run's replay
  // transport is on screen. Guarded like every gameplay shortcut (never
  // while focus is in an input/textarea/contentEditable, never with a
  // Ctrl/Meta/Alt chord); preventDefault stops the page scroll and a
  // focused button's own Space activation from double-toggling. Live runs
  // have no transport -- the listener only exists while settled.
  useEffect(() => {
    if (!settled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (focusInTextEntry()) return;
      e.preventDefault();
      onPlayPause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settled, onPlayPause]);
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
  // REQ-0355: BP display names from the run's seat canvases (the feed used to
  // print raw content ids like "bp_starter_guard" for every player-side line).
  const bpNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const sl of run?.roster?.slots ?? []) for (const bp of sl.canvas?.bps ?? []) if (bp.name && !m.has(bp.id)) m.set(bp.id, bp.name);
    return m;
  }, [run?.roster]);
  const feedRows = useMemo<FeedRow[]>(() => {
    // One resolver for every dst the feed sees: an enemy instance label
    // ("frost_giant#1") localizes its base name and keeps the instance tag;
    // a player BP content id resolves through the seat canvases.
    const displayName = (id: string): string => {
      const hash = id.indexOf('#');
      const base = hash >= 0 ? id.slice(0, hash) : id;
      const en = enemyNameById.get(id) ?? enemyNameById.get(base);
      if (en) return hash >= 0 ? `${en}${id.slice(hash)}` : en;
      return bpNameById.get(id) ?? id;
    };
    const rows: FeedRow[] = [];
    for (let i = 0; i < released.length; i++) {
      const fr = feedRow(locale, released[i], i, { dungeonName, enemyName: displayName });
      if (fr) rows.push(fr);
    }
    return rows;
  }, [released, locale, dungeonName, enemyNameById, bpNameById]);
  const rosterState = useMemo(() => reduceRunRoster(run?.roster ?? null, released, locale === 'ja' ? 'ja' : 'en'), [run?.roster, released, locale]);
  // REQ-0337: null-safe + owner-scoped (see the squad-visual mount above and
  // schedule/seats.ts). This useMemo was the exact frame in the live TypeError.
  const squadNames = useMemo(() => room.slots.map((slot, idx) => {
    if (seatIsOwnedBy(slot, room.ownerId)) return snapshot.state?.presets?.names[slot.squadIndex] ?? null;
    return run?.roster?.slots?.[idx]?.canvas?.bps?.[0]?.name ?? null; // REQ-0355: another owner's seat -- best available label
  }), [room.slots, room.ownerId, snapshot.state, run?.roster]);
  const railNodes = useMemo<RailNode[]>(() => {
    if (!run) return [];
    return railNodesFrom(run.events, locale).map((n) => ({ ...n, passed: n.ptMs <= playheadMs }));
  }, [run, locale, playheadMs]);

  const latestProgress = run ? (latestOfType(released, 'progress')?.pct as number | undefined) : undefined;
  const railPct = typeof latestProgress === 'number' ? latestProgress : progressPct;
  const returnAt = run && isLive ? new Date(Date.parse(run.startedAt) + run.durationSecs * 1000).toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : null;

  if (!room.lastRunId && !replayRunId) {
    return <div className="schedule-monitor schedule-monitor-empty">{t(locale, 'schedule.monitor.awaitingRun')}</div>;
  }

  return (
    <div ref={shellRef} className={`panel ornate schedule-monitor mon-shell${narrow ? ' is-narrow' : ''}`} data-testid="schedule-monitor" data-run-id={run?.runId}>
      <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />

      <MonitorHeader
        locale={locale} dungeonId={room.dungeonId} dungeonName={dungeonName} theme={dungeonTheme} level={room.level}
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
