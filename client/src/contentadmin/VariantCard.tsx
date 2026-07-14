// client/src/contentadmin/VariantCard.tsx -- REQ-0157. One variant card:
// identity (variant_no, source + parent lineage, created), the machine-check
// chips (REQ-0155 testid grammar preserved: overall-<no>, check-<no>-<name>,
// check-detail-<no>-<name>), the advisory agent-review chip with expandable
// rationale + the review draft controls, and the per-variant actions: view
// JSON (collapsible pretty-print + copy), diff vs adopted, A/B diff pick,
// Adopt / Delete (both confirm-gated at the root), Edit-as-new (modal at the
// root), Re-run checks (REQ-0157 recheck endpoint).
// REQ-0164 additions: a transient `is-new` highlight + scroll-into-view for
// freshly-ingested cards (C); the review DRAFT controls now hide behind a
// per-card `review-open-<no>` toggle to de-clutter the browse case (F, the
// REQ-0155 review-* draft testids are unchanged once opened); the recheck
// button gets a busy state so double-clicks do not double-fire (C); and the
// created timestamp renders LOCAL time with the raw ISO as its title (F).
import { useEffect, useRef, useState } from 'react';
import type { ContentVariantDto, MachineCheck } from '../api';
import { copyText, fmtDate, parentLabel, prettyJson, reviewClass } from './contentShared';

export function VariantCard(props: {
  v: ContentVariantDto;
  all: ContentVariantDto[];
  isAdopted: boolean;
  adoptedNo: number | null;
  isNew: boolean;
  shouldScroll: boolean;
  recheckBusy: boolean;
  expandedChecks: Record<string, boolean>;
  onToggleCheck: (key: string) => void;
  reviewDraft: { verdict: string; rationale: string };
  onReviewDraft: (no: number, draft: { verdict: string; rationale: string }) => void;
  onReviewSubmit: (no: number) => void;
  onAskAdopt: (no: number) => void;
  onAskDelete: (no: number) => void;
  onEditOpen: (no: number) => void;
  onRecheck: (no: number) => void;
  picked: boolean;
  onTogglePick: (no: number) => void;
  onDiffAdopted: (no: number) => void;
  report: (m: string, kind: 'ok' | 'err') => void;
}) {
  const { v, all, isAdopted, adoptedNo, isNew, shouldScroll, recheckBusy, expandedChecks, reviewDraft } = props;
  const no = v.variant_no;
  const [jsonOpen, setJsonOpen] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const mc: MachineCheck = v.machine_check || { overall: 'FAIL', checks: [] };
  const overall = mc.overall || 'FAIL';
  const r = v.agent_review;
  const lineage = parentLabel(v, all);

  // REQ-0164 C: first freshly-ingested card scrolls into view (try-safe,
  // browser-only; a no-op in headless Playwright). Keyed on shouldScroll so
  // it fires once on ingest, not on every 5 s detail poll re-render.
  useEffect(() => {
    if (shouldScroll && cardRef.current) {
      try { cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* headless no-op */ }
    }
  }, [shouldScroll]);

  async function doCopyJson() {
    const ok = await copyText(prettyJson(v.data));
    props.report(ok ? 'variant ' + no + ' JSON copied' : 'copy failed', ok ? 'ok' : 'err');
  }

  return (
    <div ref={cardRef} data-testid={'variant-' + no}
      className={'ca-vcard' + (isAdopted ? ' is-adopted' : '') + (overall === 'FAIL' ? ' is-fail' : '') + (isNew ? ' is-new' : '')}>
      <div className="ca-vcard-top">
        <span className="ca-vno den tnum">v{no}</span>
        {isAdopted && <b data-testid={'variant-adopted-' + no} className="aa-adopt-badge">ADOPTED</b>}
        {isNew && <span data-testid={'variant-new-' + no} className="chip ca-newchip">new</span>}
        <span data-testid={'variant-source-' + no} className="ca-source" title={'model: ' + (v.provenance.model || '-')}>
          {v.provenance.source}{lineage ? ' ' + lineage : ''}
        </span>
        <span className="ca-created t-micro tnum" title={v.created_at || ''}>{fmtDate(v.created_at)}</span>
      </div>

      <div data-testid={'checks-' + no} className="ca-checks">
        <span data-testid={'overall-' + no} className={'ca-overall ' + (overall === 'PASS' ? 'is-pass' : 'is-fail')}>{overall}</span>
        {(mc.checks || []).map((c) => {
          const key = no + '|' + c.name;
          return (
            <span key={c.name} className="ca-checkwrap">
              <button type="button" data-testid={'check-' + no + '-' + c.name}
                className={'aa-verdict ' + (!c.applicable ? 'ca-verdict--na' : c.ok ? 'aa-verdict--pass' : 'aa-verdict--fail')}
                title={c.detail} onClick={() => props.onToggleCheck(key)}>
                {c.name} {!c.applicable ? 'n/a' : c.ok ? 'ok' : 'x'}
              </button>
              {expandedChecks[key] && (
                <span data-testid={'check-detail-' + no + '-' + c.name} className="ca-check-detail">{c.detail}</span>
              )}
            </span>
          );
        })}
        <button type="button" data-testid={'recheck-' + no} className="btn btn-ghost aa-btn-xs ca-recheck"
          disabled={recheckBusy}
          title="re-run the four machine checks (validators/vocab may have moved since ingest)"
          onClick={() => props.onRecheck(no)}>{recheckBusy ? 'rechecking...' : 'Re-run checks'}</button>
      </div>

      <div className="ca-review">
        {r ? (
          <button type="button" data-testid={'review-' + no} className={'aa-verdict ' + reviewClass(r.verdict)}
            title={r.rationale} onClick={() => setRationaleOpen((x) => !x)}>
            <b data-testid={'review-verdict-' + no}>{r.verdict}</b>
            <span className="ca-review-preview">: {r.rationale.slice(0, 48)}{r.rationale.length > 48 ? '...' : ''}</span>
          </button>
        ) : <span data-testid={'review-' + no} className="t-micro ca-noreview">no advisory review</span>}
        {rationaleOpen && r && (
          <div data-testid={'review-rationale-full-' + no} className="ca-rationale">
            <b>{r.agent || 'agent'}</b> ({r.model || '?'}): {r.rationale}
          </div>
        )}
        <button type="button" data-testid={'review-open-' + no} className="btn btn-ghost aa-btn-xs ca-review-toggle"
          aria-expanded={reviewOpen} onClick={() => setReviewOpen((x) => !x)}>
          {reviewOpen ? 'Hide review draft' : 'Add review'}
        </button>
        {reviewOpen && (
          <span className="ca-review-draft">
            <select data-testid={'review-verdict-select-' + no} className="aa-input ca-input-xs" value={reviewDraft.verdict}
              onChange={(e) => props.onReviewDraft(no, { ...reviewDraft, verdict: e.target.value })}>
              <option value="recommend">recommend</option><option value="neutral">neutral</option><option value="concern">concern</option>
            </select>
            <input data-testid={'review-rationale-' + no} className="aa-input ca-input-xs ca-rationale-input"
              placeholder="rationale (required)" value={reviewDraft.rationale}
              onChange={(e) => props.onReviewDraft(no, { ...reviewDraft, rationale: e.target.value })} />
            <button data-testid={'review-submit-' + no} type="button" className="btn btn-ghost aa-btn-xs"
              onClick={() => props.onReviewSubmit(no)}>save</button>
          </span>
        )}
      </div>

      <div className="ca-vactions">
        <button data-testid={'adopt-' + no} type="button" className="btn aa-btn-xs" disabled={isAdopted}
          onClick={() => props.onAskAdopt(no)}>Adopt</button>
        <button data-testid={'delete-' + no} type="button" className="btn btn-ghost aa-btn-xs" disabled={isAdopted}
          onClick={() => props.onAskDelete(no)}>Delete</button>
        <button data-testid={'edit-open-' + no} type="button" className="btn btn-ghost aa-btn-xs"
          onClick={() => props.onEditOpen(no)}>Edit as new</button>
        <button data-testid={'json-toggle-' + no} type="button" className="btn btn-ghost aa-btn-xs"
          onClick={() => setJsonOpen((x) => !x)}>{jsonOpen ? 'Hide JSON' : 'View JSON'}</button>
        <button data-testid={'diff-adopted-' + no} type="button" className="btn btn-ghost aa-btn-xs"
          disabled={adoptedNo == null || adoptedNo === no}
          title={adoptedNo == null ? 'nothing adopted yet' : adoptedNo === no ? 'this IS the adopted variant' : 'diff v' + no + ' against adopted v' + adoptedNo}
          onClick={() => props.onDiffAdopted(no)}>Diff vs adopted</button>
        <label className="aa-pick t-micro">
          <input type="checkbox" data-testid={'diff-pick-' + no} checked={props.picked}
            onChange={() => props.onTogglePick(no)} /> A/B
        </label>
      </div>

      {jsonOpen && (
        <div className="ca-json">
          <div className="ca-json-bar">
            <span className="t-micro tnum">sha256 {String(v.data_sha256 || '').slice(0, 12)}...</span>
            <button type="button" data-testid={'json-copy-' + no} className="btn btn-ghost aa-btn-xs"
              onClick={() => { void doCopyJson(); }}>Copy JSON</button>
          </div>
          <pre data-testid={'json-view-' + no}>{prettyJson(v.data)}</pre>
        </div>
      )}
    </div>
  );
}
