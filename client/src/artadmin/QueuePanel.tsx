// client/src/artadmin/QueuePanel.tsx -- REQ-0156. Right-hand strip:
// generation controls for the selected artwork (next / N / explicit seed)
// plus the live queue panel (GET /api/art/queue every 2 s): the running job
// with a live elapsed timer + the cold-load hint, pending jobs each with a
// Cancel, and the inspection backlog depth. Visible without a selection.
// art-queue keeps showing the generation queue DEPTH number (REQ-0151 e2e).
import { useState } from 'react';
import type { ArtQueueDto } from '../api';
import { fmtElapsed } from './artShared';

export function QueuePanel({ selected, queue, fetchedAt, nowTick, onGenerate, onCancel }: {
  selected: string | null;
  queue: ArtQueueDto | null;
  fetchedAt: number;
  nowTick: number;
  onGenerate: (mode: 'next' | 'n' | 'seed', n: number, seed: number) => void;
  onCancel: (artwork: string, seed: number, renderId: number) => void;
}) {
  const [nSeeds, setNSeeds] = useState(3);
  const [explicitSeed, setExplicitSeed] = useState(1);

  const running = queue ? queue.running : null;
  const pending = queue ? queue.pending : [];
  const depth = pending.length + (running ? 1 : 0);
  // live elapsed: server-reported elapsed + local time since that snapshot
  const elapsed = running ? running.elapsed_ms + Math.max(0, nowTick - fetchedAt) : 0;

  return (
    <aside className="aa-side">
      <div className="panel panel-pad aa-genbox">
        <div className="den t-label gold-text">Generate</div>
        <div className="t-micro aa-gen-target">{selected ? selected : 'select an artwork first'}</div>
        <button data-testid="art-gen-next" type="button" className="btn-forge aa-forge" disabled={!selected}
          onClick={() => onGenerate('next', nSeeds, explicitSeed)}>Generate next seed</button>
        <div className="aa-gen-row">
          <button data-testid="art-gen-n" type="button" className="btn aa-btn-sm" disabled={!selected}
            onClick={() => onGenerate('n', nSeeds, explicitSeed)}>Generate N</button>
          <input data-testid="art-n" className="aa-input aa-input--num" type="number" min={1} max={20}
            value={nSeeds} onChange={(e) => setNSeeds(Number(e.target.value) || 1)} />
        </div>
        <div className="aa-gen-row">
          <button data-testid="art-gen-seed" type="button" className="btn aa-btn-sm" disabled={!selected}
            onClick={() => onGenerate('seed', nSeeds, explicitSeed)}>Generate at seed</button>
          <input data-testid="art-seed" className="aa-input aa-input--num" type="number"
            value={explicitSeed} onChange={(e) => setExplicitSeed(Number(e.target.value) || 1)} />
        </div>
      </div>
      <div className="panel panel-pad aa-queuebox">
        <div className="den t-label gold-text">Queue <b data-testid="art-queue" className="tnum">{depth}</b></div>
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
        <div className="t-micro aa-inspectdepth">inspections pending: <span data-testid="art-inspect-depth" className="tnum">{queue ? queue.inspectDepth : 0}</span></div>
      </div>
    </aside>
  );
}
