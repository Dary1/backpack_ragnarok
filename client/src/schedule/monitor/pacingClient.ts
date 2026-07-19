// REQ-0240: client mirror of the pacing contract. The client NEVER re-derives
// pacing -- it obeys the server's `pt` -- but it reads the liveLag / catch-up
// constants (and intro/outro) from the SAME shared/pacing.json the server
// paces from (03 spec ss7.2 "mirrored constant").
import pacing from '../../../../shared/pacing.json';
import type { ApiRunEvent } from '../../api';

export interface PacingConstants {
  version: number;
  introMs: number;
  outroMs: number;
  minPresentSecs: number;
  maxPresentSecs: number;
  liveLagTargetMs: number;
  catchupThresholdMs: number;
}
export const PACING = pacing as unknown as PacingConstants;

/** The presentation time (ms) of an event: its server-assigned `pt` for a
 * paced run (pacingVersion >= 1), else its sim `t` * 1000 (legacy runs replay
 * on the sim clock exactly as before). */
export function ptOfEvent(ev: ApiRunEvent, pacingVersion: number): number {
  if (pacingVersion >= 1 && typeof ev.pt === 'number') return ev.pt;
  return (typeof ev.t === 'number' ? ev.t : 0) * 1000;
}

/** Count of events (assumed pt-ordered) whose presentation time <= playheadMs
 * -- the release cursor the renderer/feed/dock advance on. */
export function releasedCount(events: ApiRunEvent[], playheadMs: number, pacingVersion: number): number {
  let n = 0;
  for (let i = 0; i < events.length; i++) {
    if (ptOfEvent(events[i], pacingVersion) <= playheadMs) n = i + 1;
    else break;
  }
  return n;
}
