// client/src/contentadmin/Workspace.tsx -- REQ-0157. The center workspace
// for the SELECTED content def: header (name, kind chip, adopted state,
// artwork-facet / Dex links), brief + schema_ref editing with dirty
// indicator + explicit Save, the numbered WORKFLOW STRIP that makes the Q1
// agent-session loop legible ((1) commission payload with one-click copy ->
// (2) paste + live parse preview gating Ingest -> (3) adjudicate), the
// variant cards and the side-by-side diff view.
// REQ-0164 B/C: the workflow strip is collapsible (cd-flow-toggle + a
// one-line summary when collapsed -- the common "inspect existing content"
// task no longer scrolls past commissioning UI); step 3 and the Variants
// header carry live PASS/FAIL adjudication tallies; freshly-ingested cards
// get an is-new highlight + scroll-into-view; variant cards are keyed by
// <system_name>:<variant_no> so per-card UI state never survives a def switch.
import type { ContentDefDto, ContentVariantDto, ContentCommission } from '../api';
import { parseIngest } from './contentShared';
import { VariantCard } from './VariantCard';
import { DiffView } from './DiffView';

export interface DefDraft { brief: string; schema_ref: string }

export function Workspace(props: {
  def: ContentDefDto;
  variants: ContentVariantDto[];
  artworkFacet: boolean;
  adoptedNo: number | null;
  draft: DefDraft;
  onDraft: (patch: Partial<DefDraft>) => void;
  dirty: boolean;
  onSave: () => void;
  flowCollapsed: boolean;
  onToggleFlow: () => void;
  genN: number;
  onGenN: (n: number) => void;
  commission: ContentCommission | null;
  onCommission: () => void;
  onCopyCommission: () => void;
  ingestText: string;
  onIngestText: (t: string) => void;
  ingestBusy: boolean;
  onIngest: (variants: Array<{ data: Record<string, unknown>; provenance?: Record<string, unknown> }>) => void;
  newNos: number[];
  scrollToNo: number | null;
  recheckingNos: number[];
  expandedChecks: Record<string, boolean>;
  onToggleCheck: (key: string) => void;
  reviewDrafts: Record<number, { verdict: string; rationale: string }>;
  onReviewDraft: (no: number, draft: { verdict: string; rationale: string }) => void;
  onReviewSubmit: (no: number) => void;
  onAskAdopt: (no: number) => void;
  onAskDelete: (no: number) => void;
  onEditOpen: (no: number) => void;
  onRecheck: (no: number) => void;
  diffPicks: number[];
  onTogglePick: (no: number) => void;
  onDiffAdopted: (no: number) => void;
  onOpenPickedDiff: () => void;
  diffPair: { a: number; b: number } | null;
  onCloseDiff: () => void;
  report: (m: string, kind: 'ok' | 'err') => void;
}) {
  const { def, variants, adoptedNo, draft, dirty, commission, diffPicks, diffPair, flowCollapsed } = props;
  const parse = parseIngest(props.ingestText);
  const va = diffPair ? variants.find((v) => v.variant_no === diffPair.a) : undefined;
  const vb = diffPair ? variants.find((v) => v.variant_no === diffPair.b) : undefined;
  const passCount = variants.filter((v) => (v.machine_check && v.machine_check.overall) === 'PASS').length;
  const failCount = variants.length - passCount;
  const flowSummary = (adoptedNo != null ? 'adopted v' + adoptedNo : 'not adopted')
    + ' · ' + variants.length + ' variant' + (variants.length === 1 ? '' : 's');

  return (
    <div data-testid="cd-detail" className="ca-ws">
      <div className="panel panel-pad">
        <div className="aa-ws-head">
          <span className="den t-h3 gold-text">{def.system_name}</span>
          <span className={'aa-kind ca-kind--' + def.kind}>{def.kind}</span>
          {adoptedNo != null
            ? <span className="aa-adopt-badge tnum" data-testid="cd-adopted-state">adopted v{adoptedNo} &middot; exported to content/</span>
            : <span className="t-micro" data-testid="cd-adopted-state">not adopted yet</span>}
          {dirty && <span data-testid="cd-dirty" className="chip aa-dirty">unsaved changes</span>}
        </div>
        <div className="ca-facetline t-micro">
          {props.artworkFacet
            ? <span data-testid="cd-artwork-facet" className="ca-facet-yes">artwork facet: present --{' '}
                <a data-testid="cd-artadmin-goto" href="#/artadmin">open in Art Admin</a>{' '}&middot;{' '}
                <a data-testid="cd-dex-link" href={'#/dex/' + def.system_name}>view in Dex</a></span>
            : <span data-testid="cd-artwork-facet" className="ca-facet-no">artwork facet: none (data-only entity)</span>}
        </div>
        <div className="aa-form aa-form--edit">
          <label className="aa-field">
            <span className="t-micro">schema_ref (vocab the data must satisfy)</span>
            <input data-testid="cd-edit-schema-ref" className="aa-input" value={draft.schema_ref}
              onChange={(e) => props.onDraft({ schema_ref: e.target.value })} />
          </label>
          <label className="aa-field aa-field--wide">
            <span className="t-micro">brief (the commission text)</span>
            <textarea data-testid="cd-edit-brief" className="aa-input aa-textarea" rows={2} value={draft.brief}
              onChange={(e) => props.onDraft({ brief: e.target.value })} />
          </label>
        </div>
        <div className="aa-ws-actions">
          <button data-testid="cd-save" type="button" className="btn aa-btn-sm" disabled={!dirty}
            onClick={props.onSave}>Save</button>
        </div>
      </div>

      <div className="panel panel-pad ca-flow">
        <div className="ca-flow-head">
          <button type="button" data-testid="cd-flow-toggle" className="ca-flow-toggle"
            aria-expanded={!flowCollapsed} onClick={props.onToggleFlow}>
            <span className="ca-flow-caret" aria-hidden="true">{flowCollapsed ? '▸' : '▾'}</span>
            <span className="den t-label gold-text">Commission workflow</span>
            {flowCollapsed
              ? <span data-testid="cd-flow-summary" className="t-micro ca-flow-summary">{flowSummary}</span>
              : <span className="t-micro ca-flow-note">(agent-session driven -- no LLM key on the server)</span>}
          </button>
        </div>
        {!flowCollapsed && (
          <div className="ca-flow-steps">
            <div className="ca-step">
              <span className="ca-stepno den">1</span>
              <div className="ca-steprow">
                <span className="ca-step-title">Commission</span>
                <input data-testid="cd-gen-n" className="aa-input aa-input--num" type="number" min={1} max={20}
                  value={props.genN} onChange={(e) => props.onGenN(Number(e.target.value) || 1)} />
                <button data-testid="cd-commission" type="button" className="btn aa-btn-sm"
                  onClick={props.onCommission}>Build commission payload</button>
              </div>
              {commission && (
                <div className="ca-payload">
                  <div className="ca-payload-bar">
                    <span className="t-micro">hand this payload to an agent session; it POSTs the variants back to {commission.post_to}</span>
                    <button data-testid="cd-copy-commission" type="button" className="btn aa-btn-xs"
                      onClick={props.onCopyCommission}>Copy payload</button>
                  </div>
                  <pre data-testid="cd-commission-out" className="ca-pre">{JSON.stringify(commission, null, 2)}</pre>
                </div>
              )}
            </div>
            <div className="ca-step">
              <span className="ca-stepno den">2</span>
              <div className="ca-steprow">
                <span className="ca-step-title">Ingest the agent's reply (or the agent POSTs directly)</span>
              </div>
              <textarea data-testid="cd-ingest-json" className="aa-input aa-textarea ca-ingest" rows={5}
                placeholder='{"variants":[{"data":{...},"provenance":{"source":"llm","model":"...","prompt":"...","params":{}}}]}'
                value={props.ingestText} onChange={(e) => props.onIngestText(e.target.value)} />
              <div data-testid="cd-parse-preview" className={'ca-parse is-' + parse.state}>{parse.note}</div>
              <div>
                <button data-testid="cd-ingest" type="button" className="btn aa-btn-sm"
                  disabled={parse.state !== 'ok' || parse.count === 0 || props.ingestBusy}
                  onClick={() => props.onIngest(parse.variants)}>
                  {props.ingestBusy ? 'ingesting...' : 'Ingest + run machine checks'}
                </button>
              </div>
            </div>
            <div className="ca-step">
              <span className="ca-stepno den">3</span>
              <div className="ca-steprow">
                <span className="ca-step-title">Adjudicate below: compare variants, read checks + advisory review, adopt exactly one.</span>
                <span data-testid="cd-adjudicate-summary" className="ca-adjud-summary tnum">{variants.length} variants &middot; {passCount} PASS &middot; {failCount} FAIL</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="aa-gallery-head">
        <span className="den t-label">Variants <span className="tnum">({variants.length})</span></span>
        {variants.length > 0 && (
          <span data-testid="cd-variants-tally" className="t-micro tnum ca-variants-tally">{passCount} PASS &middot; {failCount} FAIL</span>
        )}
        {diffPicks.length === 2 && (
          <button type="button" data-testid="cd-diff-open" className="btn aa-btn-sm"
            onClick={props.onOpenPickedDiff}>Diff v{diffPicks[0]} vs v{diffPicks[1]}</button>
        )}
        {diffPicks.length === 1 && <span className="t-micro">pick one more variant to diff</span>}
      </div>
      <div data-testid="cd-variants" className="ca-vlist">
        {variants.map((v) => (
          <VariantCard key={def.system_name + ':' + v.variant_no} v={v} all={variants}
            isAdopted={adoptedNo === v.variant_no} adoptedNo={adoptedNo}
            isNew={props.newNos.includes(v.variant_no)} shouldScroll={props.scrollToNo === v.variant_no}
            recheckBusy={props.recheckingNos.includes(v.variant_no)}
            expandedChecks={props.expandedChecks} onToggleCheck={props.onToggleCheck}
            reviewDraft={props.reviewDrafts[v.variant_no] || { verdict: 'neutral', rationale: '' }}
            onReviewDraft={props.onReviewDraft} onReviewSubmit={props.onReviewSubmit}
            onAskAdopt={props.onAskAdopt} onAskDelete={props.onAskDelete}
            onEditOpen={props.onEditOpen} onRecheck={props.onRecheck}
            picked={diffPicks.includes(v.variant_no)} onTogglePick={props.onTogglePick}
            onDiffAdopted={props.onDiffAdopted} report={props.report} />
        ))}
        {variants.length === 0 && <div className="aa-empty t-micro">no variants yet -- commission a batch above</div>}
      </div>

      {va && vb && <DiffView a={va} b={vb} adoptedNo={adoptedNo} onClose={props.onCloseDiff} />}
    </div>
  );
}
