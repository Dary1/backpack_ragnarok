// client/src/artadmin/QueuePanel.tsx -- REQ-0156. Right-hand strip:
// generation controls for the selected artwork (next / N / explicit seed)
// plus the live queue panel (GET /api/art/queue every 2 s): the running job
// with a live elapsed timer + the cold-load hint, pending jobs each with a
// Cancel, and the inspection backlog depth. Visible without a selection.
// art-queue keeps showing the generation queue DEPTH number (REQ-0151 e2e).
// REQ-0197: deferred-batch mode -- a hold toggle gates newly queued jobs
// behind an explicit "Execute batch", which releases them grouped so
// same-prompt jobs run back to back (text-encoder conditioning reuse).
import { useState } from 'react';
import type { ArtQueueDto } from '../api';
import { fmtElapsed, SHAPE_LOCKS } from './artShared';

export function QueuePanel({ selected, selectedKind, queue, fetchedAt, nowTick, onGenerate, onCancel, onHold, onExecute }: {
  selected: string | null;
  selectedKind: string | null;
  queue: ArtQueueDto | null;
  fetchedAt: number;
  nowTick: number;
  onGenerate: (mode: 'next' | 'n' | 'seed', n: number, seed: number, lockOverride: string) => void;
  onCancel: (artwork: string, seed: number, renderId: number) => void;
  onHold: (held: boolean) => void;
  onExecute: () => void;
}) {
  const [nSeeds, setNSeeds] = useState(3);
  const [explicitSeed, setExplicitSeed] = useState(1);
  // REQ-0186: a ONE-SHOT lock for the next generate, never written back to the
  // artwork ('' = use the artwork's own setting). The lock/legibility trade-off
  // is only visible once rendered and a conditioned render costs 76-130 s, so
  // the workflow this exists for is: same seed at two locks -> compare in the
  // lightbox -> Save the winner as the artwork's default.
  const [lockOverride, setLockOverride] = useState('');

  const running = queue ? queue.running : null;
  const pending = queue ? queue.pending : [];
  // REQ-0197: the deferred-batch gate. `|| []` tolerates a stale server.
  const heldPending = queue ? (queue.heldPending || []) : [];
  const held = !!(queue && queue.held);
  const depth = pending.length + heldPending.length + (running ? 1 : 0);
  // live elapsed: server-reported elapsed + local time since that snapshot
  const elapsed = running ? running.elapsed_ms + Math.max(0, nowTick - fetchedAt) : 0;

  return (
    <aside className="aa-side">
      <div className="panel panel-pad aa-genbox">
        <div className="den t-label gold-text">Generate</div>
        <div className="t-micro aa-gen-target">{selected ? selected : 'select an artwork first'}</div>
        {selectedKind === 'po' && (
          <div className="aa-gen-row aa-gen-lock">
            <span className="t-micro">lock (this render only)</span>
            <select data-testid="art-gen-lock" className="aa-input" value={lockOverride}
              onChange={(e) => setLockOverride(e.target.value)}>
              <option value="">artwork default</option>
              {SHAPE_LOCKS.filter((l) => l !== 'auto').map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}
        <button data-testid="art-gen-next" type="button" className="btn-forge aa-forge" disabled={!selected}
          onClick={() => onGenerate('next', nSeeds, explicitSeed, lockOverride)}>Generate next seed</button>
        <div className="aa-gen-row">
          <button data-testid="art-gen-n" type="button" className="btn aa-btn-sm" disabled={!selected}
            onClick={() => onGenerate('n', nSeeds, explicitSeed, lockOverride)}>Generate N</button>
          <input data-testid="art-n" className="aa-input aa-input--num" type="number" min={1} max={20}
            value={nSeeds} onChange={(e) => setNSeeds(Number(e.target.value) || 1)} />
        </div>
        <div className="aa-gen-row">
          <button data-testid="art-gen-seed" type="button" className="btn aa-btn-sm" disabled={!selected}
            onClick={() => onGenerate('seed', nSeeds, explicitSeed, lockOverride)}>Generate at seed</button>
          <input data-testid="art-seed" className="aa-input aa-input--num" type="number"
            value={explicitSeed} onChange={(e) => setExplicitSeed(Number(e.target.value) || 1)} />
        </div>
      </div>
      <div className="panel panel-pad aa-queuebox">
        <div className="den t-label gold-text">Queue <b data-testid="art-queue" className="tnum">{depth}</b></div>
        <div className="aa-gen-row">
          <label className="t-micro">
            <input data-testid="art-queue-hold" type="checkbox" checked={held} disabled={!queue}
              onChange={(e) => onHold(e.target.checked)} /> hold: run only on execute
          </label>
        </div>
        {held && (
          <button data-testid="art-queue-execute" type="button" className="btn aa-btn-sm"
            disabled={heldPending.length === 0} onClick={() => onExecute()}>
            Execute batch ({heldPending.length})</button>
        )}
        {running ? (
          <div data-testid="queue-running" className="aa-qjob is-running">
            <span className="chip is-live"><span className="dot" />running</span>
            <span className="aa-qjob-name">{running.artwork} <span className="tnum">s{running.seed}</span></span>
            <span data-testid="queue-elapsed" className="tnum aa-qjob-elapsed">{fmtElapsed(elapsed)}</span>
            <button type="button" data-testid={'queue-cancel-' + running.renderId} className="btn btn-ghost aa-btn-xs"
              onClick={() => onCancel(running.artwork, running.seed, running.renderId)}>Cancel</button>
          </div>
        ) : <div className="t-micro aa-qidle">idle</div>}
        {running && (
          <div className="t-micro aa-coldload">first image after a cold model load can take ~8 min; canceling a
            running job frees the queue, but the ComfyUI-side prompt finishes on its own</div>
        )}
        {pending.length > 0 && (
          <div className="aa-qpending">
            {pending.map((p) => (
              <div key={p.renderId} data-testid={'queue-pending-' + p.renderId} className="aa-qjob">
                <span className="aa-qjob-name">{p.artwork} <span className="tnum">s{p.seed}</span></span>
                <button type="button" data-testid={'queue-cancel-' + p.renderId} className="btn btn-ghost aa-btn-xs"
                  onClick={() => onCancel(p.artwork, p.seed, p.renderId)}>Cancel</button>
              </div>
            ))}
          </div>
        )}
        {heldPending.length > 0 && (
          <div className="aa-qheld">
            {heldPending.map((p) => (
              <div key={p.renderId} data-testid={'queue-held-' + p.renderId} className="aa-qjob">
                <span className="chip">held</span>
                <span className="aa-qjob-name">{p.artwork} <span className="tnum">s{p.seed}</span></span>
                <button type="button" data-testid={'queue-cancel-' + p.renderId} className="btn btn-ghost aa-btn-xs"
                  onClick={() => onCancel(p.artwork, p.seed, p.renderId)}>Cancel</button>
              </div>
            ))}
          </div>
        )}
        <div className="t-micro aa-inspectdepth">inspections pending: <span data-testid="art-inspect-depth" className="tnum">{queue ? queue.inspectDepth : 0}</span></div>
      </div>
    </aside>
  );
}
