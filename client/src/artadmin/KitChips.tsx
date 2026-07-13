// client/src/artadmin/KitChips.tsx -- REQ-0152 inspection-kit chips,
// restyled by REQ-0156 onto the MJOLNIR chip grammar. STRICTLY advisory:
// verdicts never gate adoption (standing rule). The full REQ-0152 testid
// contract is preserved verbatim (kits-/kit-/chip-/verdict-/stale-/rerun-/
// run-<seed>-<kit_id>, kit-details-...) -- artinspect.spec.ts drives these.
import type { InspectionDto, KitDto } from '../api';

function verdictClass(v: string): string {
  return v === 'PASS' ? 'aa-verdict--pass' : v === 'WARN' ? 'aa-verdict--warn' : 'aa-verdict--fail';
}

function InspectDetails({ row, seed }: { row: InspectionDto; seed: number }) {
  return (
    <div data-testid={'kit-details-' + seed + '-' + row.kit_id} className="aa-kit-details">
      <div>v{row.kit_version}{row.stale ? ' (STALE)' : ''}</div>
      <div className="aa-kit-details-h">metrics</div>
      {Object.entries(row.metrics).map(([k, v]) => <div key={k}>{k}={String(v)}</div>)}
      <div className="aa-kit-details-h">checks</div>
      {row.checks.map((c, i) => <div key={i} className={c.ok ? 'aa-check-ok' : 'aa-check-bad'}>{c.ok ? 'ok' : 'x'} {c.name} ({String(c.value)} / {c.threshold})</div>)}
      {row.notes.length > 0 && <div className="aa-kit-details-h">notes</div>}
      {row.notes.map((nt, i) => <div key={i} className="aa-kit-note">- {nt}</div>)}
    </div>
  );
}

export function KitChips({ seed, kits, rows, expanded, onToggle, onRerun }: {
  seed: number; kits: KitDto[]; rows: InspectionDto[];
  expanded: Record<string, boolean>; onToggle: (key: string) => void;
  onRerun: (seed: number, kitId?: string) => void;
}) {
  const byKit = new Map(rows.map((r) => [r.kit_id, r]));
  return (
    <div data-testid={'kits-' + seed} className="aa-kits">
      {kits.map((k) => {
        const row = byKit.get(k.kit_id);
        if (!row) {
          return (
            <span key={k.kit_id} data-testid={'kit-' + seed + '-' + k.kit_id} className="chip aa-kit-none">
              {k.kit_id}: not inspected
              <button data-testid={'run-' + seed + '-' + k.kit_id} type="button" className="aa-linkbtn"
                onClick={() => onRerun(seed, k.kit_id)}>run</button>
            </span>
          );
        }
        const key = seed + '|' + k.kit_id;
        return (
          <span key={k.kit_id} data-testid={'kit-' + seed + '-' + k.kit_id} className="aa-kit">
            <button data-testid={'chip-' + seed + '-' + k.kit_id} type="button"
              className={'aa-verdict ' + verdictClass(row.verdict)}
              title={k.kit_id + ' v' + row.kit_version}
              onClick={() => onToggle(key)}>
              {k.kit_id} <b data-testid={'verdict-' + seed + '-' + k.kit_id}>{row.verdict}</b>
            </button>
            {row.stale && <span data-testid={'stale-' + seed + '-' + k.kit_id} className="aa-stale">stale</span>}
            {row.stale && <button data-testid={'rerun-' + seed + '-' + k.kit_id} type="button" className="aa-linkbtn"
              onClick={() => onRerun(seed, k.kit_id)}>re-run</button>}
            {expanded[key] && <InspectDetails row={row} seed={seed} />}
          </span>
        );
      })}
    </div>
  );
}
