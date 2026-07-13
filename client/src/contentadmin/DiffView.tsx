// client/src/contentadmin/DiffView.tsx -- REQ-0157. Side-by-side pretty-
// printed line diff between two variants' data (the REQ-0155 positional
// line-diff algorithm kept verbatim in contentShared.diffRows; this file
// only restyles it): sticky header naming both variants with their
// machine-check verdict chips, changed lines tinted per side.
import type { ContentVariantDto } from '../api';
import { diffRows } from './contentShared';

function VerdictChip({ v }: { v: ContentVariantDto }) {
  const overall = (v.machine_check && v.machine_check.overall) || 'FAIL';
  return <span className={'ca-overall ' + (overall === 'PASS' ? 'is-pass' : 'is-fail')}>{overall}</span>;
}

export function DiffView({ a, b, adoptedNo, onClose }: {
  a: ContentVariantDto; b: ContentVariantDto; adoptedNo: number | null; onClose: () => void;
}) {
  const rows = diffRows(a.data, b.data);
  const changed = rows.filter((r) => r.diff).length;
  const label = (v: ContentVariantDto) => 'v' + v.variant_no + (adoptedNo === v.variant_no ? ' (adopted)' : '');
  return (
    <div data-testid="diff-view" className="panel ca-diff">
      <div className="ca-diff-head">
        <span className="den t-label gold-text">Diff</span>
        <span className="ca-diff-name tnum">{label(a)}</span><VerdictChip v={a} />
        <span className="t-micro">vs</span>
        <span className="ca-diff-name tnum">{label(b)}</span><VerdictChip v={b} />
        <span className="t-micro tnum">{changed} line{changed === 1 ? '' : 's'} differ</span>
        <button type="button" data-testid="diff-close" className="btn btn-ghost aa-btn-xs ca-diff-close" onClick={onClose}>close</button>
      </div>
      <div className="ca-diff-body">
        <div className="ca-diff-row ca-diff-row--cols t-micro">
          <div className="ca-diff-cell gold-text">{label(a)}</div>
          <div className="ca-diff-cell gold-text">{label(b)}</div>
        </div>
        {rows.map((r, i) => (
          <div key={i} className={'ca-diff-row' + (r.diff ? ' is-diff' : '')}>
            <pre className="ca-diff-cell ca-diff-cell--a">{r.l}</pre>
            <pre className="ca-diff-cell ca-diff-cell--b">{r.r}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
