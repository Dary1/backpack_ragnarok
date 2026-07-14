// client/src/contentadmin/Workspace.tsx -- REQ-0157. The center workspace
// for the SELECTED content def: header (name, kind chip, adopted state,
// artwork linkage + Dex links), brief + schema_ref editing with dirty
// indicator + explicit Save, the numbered WORKFLOW STRIP that makes the Q1
// agent-session loop legible ((1) commission payload with one-click copy ->
// (2) paste + live parse preview gating Ingest -> (3) adjudicate), the
// variant cards and the side-by-side diff view.
// REQ-0164 B/C: the workflow strip is collapsible (cd-flow-toggle + a
// one-line summary when collapsed); step 3 and the Variants header carry live
// PASS/FAIL adjudication tallies; freshly-ingested cards get an is-new
// highlight + scroll-into-view; variant cards are keyed by
// <system_name>:<variant_no> so per-card UI state never survives a def switch.
// REQ-0174 (content-artwork-ref): art linkage is now an operator-SELECTED
// def-level reference. The header carries an "artwork" row (current thumb +
// full name + link mode 'selected'|'name match'|'none') with a Select button
// (cd-art-pick-open) opening the ARTWORK PICKER overlay (search + matching-
// type-first list + type chips + adopted badges + exact-name suggestion +
// cd-art-clear). Picking PATCHes artwork_ref (via onPickArtwork). Every art
// surface -- rail, header, adopt-confirm, and the per-variant thumb -- resolves
// through the def (variants obtain art ONLY through the parent def).
import { useState } from 'react';
import type { ContentDefDto, ContentVariantDto, ContentCommission, ArtworkDto } from '../api';
import { parseIngest, artworkThumbUrl, resolveDefArtwork, artLinkMode, artPickTestid, defAdoptedArtUrl } from './contentShared';
import { VariantCard } from './VariantCard';
import { DiffView } from './DiffView';

export interface DefDraft { brief: string; schema_ref: string }

// REQ-0174: kind -> the artwork kind the picker treats as "matching". The
// entity kinds map 1:1 (po_def->po ...); tm_def/skill_def have no single art
// kind, so their picker defaults to ALL types (a type-filter chip row).
const MATCH_TYPE: Record<string, string> = { po_def: 'po', si_def: 'si', monster_def: 'monster', unit_def: 'unit' };

/** REQ-0174 ARTWORK PICKER overlay: the 選択式 art linkage. Lists artworks of
 * the matching type first, search-filtered, with thumbs + names + adopted
 * badges; the exact-name suggestion is pinned on top and the current ref is
 * highlighted. Rows are cd-art-pick-<system_name-safe> (':' -> '__'); a
 * Clear-link action (cd-art-clear) drops the ref back to none. */
function ArtworkPicker({ def, artworks, currentRef, onPick, onClear, onClose }: {
  def: ContentDefDto;
  artworks: ArtworkDto[];
  currentRef: string | null;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const matchType = MATCH_TYPE[def.kind]; // undefined for tm_def/skill_def
  const [query, setQuery] = useState('');
  // default to ALL types (matching-type rows are pinned first by the sort
  // below); the chip row lets the operator narrow -- so same-type artworks are
  // listed first while other types stay selectable (type mismatch is permitted).
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const exactName = def.system_name;

  const typeChips = matchType ? [matchType, 'all'] : ['all', 'po', 'si', 'monster', 'unit'];
  const q = query.trim().toLowerCase();
  const filtered = artworks.filter((a) =>
    (typeFilter === 'all' || a.kind === typeFilter)
    && (!q || a.system_name.toLowerCase().includes(q)));
  const rows = filtered.slice().sort((a, b) => {
    // exact-name suggestion pinned first
    const ax = a.system_name === exactName ? 0 : 1;
    const bx = b.system_name === exactName ? 0 : 1;
    if (ax !== bx) return ax - bx;
    // then matching-type first (when the list mixes types)
    if (matchType) {
      const am = a.kind === matchType ? 0 : 1;
      const bm = b.kind === matchType ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    return a.system_name.localeCompare(b.system_name);
  });

  return (
    <div className="aa-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div data-testid="cd-art-picker" className="panel panel-pad ca-art-picker" role="dialog" aria-modal="true">
        <div className="ca-art-picker-head">
          <span className="den t-h3 gold-text">Link artwork to {def.system_name}</span>
          <button type="button" data-testid="cd-art-pick-close" className="btn btn-ghost aa-btn-xs" onClick={onClose}>Close</button>
        </div>
        <div className="t-micro ca-art-picker-note">
          {matchType
            ? 'showing ' + matchType + ' artworks first (the matching type for ' + def.kind + '); other types are still selectable'
            : def.kind + ' has no single artwork type -- filter by type below'}
        </div>
        <input data-testid="cd-art-search" className="aa-input aa-search" type="search"
          placeholder="search artwork name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="aa-filters ca-art-typechips">
          {typeChips.map((t) => (
            <button key={t} type="button" data-testid={'cd-art-type-' + t}
              className={'chip aa-chipbtn' + (typeFilter === t ? ' is-on' : '')}
              onClick={() => setTypeFilter(t)}>{t}</button>
          ))}
        </div>
        <div className="ca-art-picker-actions">
          <button type="button" data-testid="cd-art-clear" className="btn btn-ghost aa-btn-sm"
            disabled={currentRef == null} onClick={onClear}>Clear link (no artwork)</button>
        </div>
        <div data-testid="cd-art-picklist" className="ca-art-picklist">
          {rows.map((a) => {
            const thumb = artworkThumbUrl(a);
            const isCurrent = a.system_name === currentRef;
            const isSuggested = a.system_name === exactName;
            return (
              <button key={a.system_name} type="button" data-testid={artPickTestid(a.system_name)}
                className={'ca-art-pickrow' + (isCurrent ? ' is-current' : '')}
                onClick={() => onPick(a.system_name)}>
                <span className="ca-art-pickthumb">
                  {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="ca-thumb-ph">◇</span>}
                </span>
                <span className="ca-art-pickname">{a.system_name}</span>
                <span className={'aa-kind ca-kind--' + a.kind}>{a.kind}</span>
                {isSuggested ? <span className="chip ca-art-suggest">exact-name suggestion</span> : null}
                {a.adopted_render_id != null ? <span className="chip ca-art-adopted">adopted</span> : null}
                {isCurrent ? <span className="chip ca-art-currentchip">linked</span> : null}
              </button>
            );
          })}
          {rows.length === 0 && <div className="aa-empty t-micro">no artworks match</div>}
        </div>
      </div>
    </div>
  );
}

export function Workspace(props: {
  def: ContentDefDto;
  variants: ContentVariantDto[];
  artworkFacet: boolean;
  artworksByName: Record<string, ArtworkDto>;
  artworks: ArtworkDto[];
  onPickArtwork: (ref: string | null) => void;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  // REQ-0174: art resolves through the def (REF-FIRST: artwork_ref -> exact-
  // name -> none). Every art surface below uses this single resolution; the
  // artadmin link carries the resolved artwork's REAL system_name.
  const art = resolveDefArtwork(def, props.artworksByName);
  const linkMode = artLinkMode(def, props.artworksByName);
  const hasArtLink = !!art;
  const artHash = '#/artadmin/' + encodeURIComponent(art ? art.system_name : def.system_name);
  const headerThumb = artworkThumbUrl(art);
  const variantThumb = headerThumb; // variants share the def's resolved art
  // REQ-0133: the def's adopted registry-render URL (game-mirror) for the entity
  // preview -- registry art wins, else the sprite icon (labelled in-preview).
  const entityArtUrl = defAdoptedArtUrl(def, props.artworksByName);
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
          {hasArtLink && (
            <a data-testid="cd-header-thumb" className="ca-header-thumb" href={artHash}
              title={'open ' + art!.system_name + ' in Art Admin'}>
              {headerThumb
                ? <img src={headerThumb} alt="" loading="lazy" />
                : <span className="ca-header-thumb-ph">◇</span>}
            </a>
          )}
        </div>
        <div className="ca-artrow t-micro" data-testid="cd-artwork-row">
          <span className="ca-artrow-label">artwork:</span>
          {hasArtLink
            ? <span data-testid="cd-artwork-facet" className="ca-facet-yes">
                <span className="ca-artrow-name">{art!.system_name}</span>{' '}
                <span className="ca-artrow-mode">(link: {linkMode})</span>{' '}&middot;{' '}
                <a data-testid="cd-artadmin-goto" href={artHash}>open in Art Admin</a>{' '}&middot;{' '}
                <a data-testid="cd-dex-link" href={'#/dex/' + def.system_name}>view in Dex</a></span>
            : <span data-testid="cd-artwork-facet" className="ca-facet-no">none (no artwork linked -- link: none)</span>}
          <button type="button" data-testid="cd-art-pick-open" className="btn aa-btn-xs ca-art-pick-btn"
            onClick={() => setPickerOpen(true)}>Select artwork</button>
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
          <VariantCard key={def.system_name + ':' + v.variant_no} v={v} kind={def.kind} all={variants}
            isAdopted={adoptedNo === v.variant_no} adoptedNo={adoptedNo}
            isNew={props.newNos.includes(v.variant_no)} shouldScroll={props.scrollToNo === v.variant_no}
            recheckBusy={props.recheckingNos.includes(v.variant_no)}
            expandedChecks={props.expandedChecks} onToggleCheck={props.onToggleCheck}
            reviewDraft={props.reviewDrafts[v.variant_no] || { verdict: 'neutral', rationale: '' }}
            onReviewDraft={props.onReviewDraft} onReviewSubmit={props.onReviewSubmit}
            onAskAdopt={props.onAskAdopt} onAskDelete={props.onAskDelete}
            onEditOpen={props.onEditOpen} onRecheck={props.onRecheck}
            picked={diffPicks.includes(v.variant_no)} onTogglePick={props.onTogglePick}
            onDiffAdopted={props.onDiffAdopted} hasArt={hasArtLink} artThumb={variantThumb}
            entityArtUrl={entityArtUrl}
            report={props.report} />
        ))}
        {variants.length === 0 && <div className="aa-empty t-micro">no variants yet -- commission a batch above</div>}
      </div>

      {va && vb && <DiffView a={va} b={vb} kind={def.kind} adoptedNo={adoptedNo} onClose={props.onCloseDiff} />}

      {pickerOpen && (
        <ArtworkPicker def={def} artworks={props.artworks} currentRef={def.artwork_ref ?? null}
          onPick={(name) => { setPickerOpen(false); props.onPickArtwork(name); }}
          onClear={() => { setPickerOpen(false); props.onPickArtwork(null); }}
          onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
