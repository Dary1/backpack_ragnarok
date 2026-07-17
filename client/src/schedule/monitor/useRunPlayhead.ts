// REQ-0240 (03 spec ss7.4): the client playhead. Buffers the server-revealed
// (already pt-gated) events and RELEASES them to the renderer/feed/dock at
// presentation cadence -- a deliberate 2.5s live lag absorbs poll jitter, a
// 6s catch-up rule silently re-syncs after a hidden/throttled tab, and the
// settled transport rides pt with a 0.5/1/2/4x speed. The client never
// re-derives pacing; it obeys `pt` and reads only the lag/catch-up constants.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiRunView } from '../../api';
import { PACING, releasedCount } from './pacingClient';

export type Speed = 0.5 | 1 | 2 | 4;

export interface Playhead {
  playheadMs: number;
  durationMs: number;
  releasedIdx: number;
  isLive: boolean;
  needsCatchup: boolean;
  catchUp: () => void;
  speed: Speed;
  setSpeed: (s: Speed) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  seekMs: (ms: number) => void;
  restart: () => void;
  progressPct: number;
  silentEpoch: number;
}

export function useRunPlayhead(run: ApiRunView | null): Playhead {
  const settled = run?.settled ?? false;
  const pacingVersion = run?.pacingVersion ?? 0;
  const durationMs = run ? run.durationSecs * 1000 : 0;

  const [playheadMs, setPlayheadMs] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);
  const [playing, setPlaying] = useState(false);
  const [needsCatchup, setNeedsCatchup] = useState(false);
  const [silentEpoch, setSilentEpoch] = useState(0);

  const headRef = useRef(0);
  const lastNowRef = useRef(0);
  const pollWallRef = useRef(0);
  const pollElapsedRef = useRef(0);
  const catchupSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!run) return;
    pollWallRef.current = performance.now();
    pollElapsedRef.current = run.clock.elapsedSecs * 1000;
  }, [run]);

  // Settle transition: park at the end, paused; request a silent full apply.
  useEffect(() => {
    if (settled && run) {
      headRef.current = durationMs;
      setPlayheadMs(durationMs);
      setPlaying(false);
      setNeedsCatchup(false);
      setSilentEpoch((e) => e + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, run?.runId]);

  const catchUp = useCallback(() => {
    if (!run || settled) return;
    const estServer = pollElapsedRef.current + (performance.now() - pollWallRef.current);
    const target = Math.max(0, estServer - PACING.liveLagTargetMs);
    headRef.current = Math.max(headRef.current, target - 1500);
    setPlayheadMs(headRef.current);
    setNeedsCatchup(false);
    catchupSinceRef.current = null;
    setSilentEpoch((e) => e + 1);
  }, [run, settled]);

  const seekMs = useCallback((ms: number) => {
    if (!run) return;
    const clamped = Math.max(0, Math.min(durationMs, ms));
    headRef.current = clamped;
    setPlayheadMs(clamped);
    setPlaying(false);
    setSilentEpoch((e) => e + 1);
  }, [run, durationMs]);

  const restart = useCallback(() => {
    headRef.current = 0;
    setPlayheadMs(0);
    setSilentEpoch((e) => e + 1);
    setPlaying(true);
  }, []);

  useEffect(() => {
    if (!run) return;
    let raf = 0;
    lastNowRef.current = performance.now();
    const frame = (now: number): void => {
      const dt = now - lastNowRef.current;
      lastNowRef.current = now;
      if (settled) {
        if (playing) {
          let h = headRef.current + dt * speed;
          if (h >= durationMs) { h = durationMs; setPlaying(false); }
          headRef.current = h;
          setPlayheadMs(h);
        }
      } else {
        const estServer = pollElapsedRef.current + (now - pollWallRef.current);
        const target = Math.max(0, estServer - PACING.liveLagTargetMs);
        const lag = target - headRef.current;
        if (lag > PACING.catchupThresholdMs) {
          if (catchupSinceRef.current === null) catchupSinceRef.current = now;
          setNeedsCatchup(true);
          if (now - catchupSinceRef.current > 20000) {
            headRef.current = Math.max(headRef.current, target - 1500);
            setSilentEpoch((e) => e + 1);
            setNeedsCatchup(false);
            catchupSinceRef.current = null;
          }
        } else {
          catchupSinceRef.current = null;
          setNeedsCatchup((v) => (v ? false : v));
        }
        if (headRef.current < target) { headRef.current = Math.min(headRef.current + dt, target); setPlayheadMs(headRef.current); }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, settled, playing, speed, durationMs]);

  useEffect(() => {
    const onVis = (): void => { if (document.visibilityState === 'visible' && !settled) catchUp(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [settled, catchUp]);

  const releasedIdx = run ? releasedCount(run.events, playheadMs, pacingVersion) : 0;
  const progressPct = durationMs > 0 ? Math.max(0, Math.min(100, (playheadMs / durationMs) * 100)) : 0;

  return { playheadMs, durationMs, releasedIdx, isLive: !settled, needsCatchup, catchUp, speed, setSpeed, playing, setPlaying, seekMs, restart, progressPct, silentEpoch };
}
