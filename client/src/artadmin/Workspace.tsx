// client/src/artadmin/Workspace.tsx -- REQ-0156. The center workspace for
// the SELECTED artwork: header (name, kind, derived resolution, adoption
// state), the edit form with dirty indicator + explicit Save + debounced
// final-prompt preview (the page owns the debounce; art-preview stays as
// the manual trigger for the e2e contract), and the render gallery
// (cards per seed with lightbox thumbnails, confirm-gated Adopt/Delete,
// failed-render Retry, compare picks, REQ-0152 kit chips).
import { KitChips } from './KitChips';
import { PoMaskEditor, MonsterShapeEditor } from './ShapeEditors';
import { deriveSizeClient } from './artShared';
import type { ArtDraft, Kind } from './artShared';
import { artRenderUrl } from '../api';
import type { ArtworkDto, RenderDto, InspectionDto, KitDto } from '../api';

export function Workspace(props: {
  art: ArtworkDto;
  renders: RenderDto[];
  kits: KitDto[];
  inspections: Record<string, InspectionDto[]>;
  adoptedId: number | null;
  draft: ArtDraft;
  onDraft: (patch: Partial<ArtDraft>) => void;
  dirty: boolean;
  shapeDirty: boolean;
  finalPreview: string;
  onPreviewNow: () => void;
  onSave: () => void;
  onAskAdopt: (seed: number) => void;
  onAskDelete: (seed: number) => void;
  onRetry: (seed: number) => void;
  onOpenLightbox: (seed: number, compareWith: number | null) => void;
  onRerunKit: (seed: number, kitId?: string) => void;
  expandedKits: Record<string, boolean>;
  onToggleKit: (key: string) => void;
  comparePicks: number[];
  onTogglePick: (seed: number) => void;
}) {
  const { art, renders, kits, inspections, adoptedId, draft, onDraft, dirty, shapeDirty,
    finalPreview, comparePicks } = props;
  const kind = art.kind as Kind;
  const newSize = deriveSizeClient(kind, draft.mask, draft.mw, draft.mh);
  const adoptedRender = adoptedId != null ? renders.find((r) => r.id === adoptedId) : undefined;

  return (
    <div data-testid="art-editor" className="aa-ws">
      <div className="panel panel-pad aa-ws-headpanel">
        <div className="aa-ws-head">
          <span className="den t-h3 gold-text">{art.system_name}</span>
          <span className={'aa-kind aa-kind--' + art.kind}>{art.kind}</span>
          <span className="t-micro tnum">{art.gen_width}x{art.gen_height}</span>
          {adoptedRender
            ? <span className="aa-adopt-badge tnum" data-testid="art-adopted-state">adopted s{adoptedRender.seed} &middot; exported to content/</span>
            : <span className="t-micro" data-testid="art-adopted-state">not adopted yet</span>}
          {dirty && <span data-testid="art-dirty" className="chip aa-dirty">unsaved changes</span>}
        </div>
        <div className="aa-form aa-form--edit">
          <label className="aa-field">
            <span className="t-micro">main_object</span>
            <input data-testid="art-edit-main-object" className="aa-input" value={draft.main_object}
              onChange={(e) => onDraft({ main_object: e.target.value })} />
          </label>
          <label className="aa-field">
            <span className="t-micro">style/aux prompt (empty = default per kind)</span>
            <input data-testid="art-edit-style" className="aa-input" value={draft.style_override}
              placeholder="(default per kind)" onChange={(e) => onDraft({ style_override: e.target.value })} />
          </label>
          <label className="aa-field aa-field--wide">
            <span className="t-micro">prompt template</span>
            <textarea data-testid="art-edit-template" className="aa-input aa-textarea" rows={2} value={draft.prompt_template}
              onChange={(e) => onDraft({ prompt_template: e.target.value })} />
          </label>
          {kind === 'bpskin' && (
            <label className="aa-field">
              <span className="t-micro">edge_padding (compose band, px)</span>
              <input data-testid="art-edit-edge" className="aa-input aa-input--num" type="number" value={draft.edge_padding}
                onChange={(e) => onDraft({ edge_padding: Number(e.target.value) || 0 })} />
            </label>
          )}
          {(kind === 'po' || kind === 'monster') && (
            <div className="aa-field">
              <span className="t-micro">shape (derived size: <b className="tnum">{newSize.width}x{newSize.height}</b>{shapeDirty ? ' after save' : ''})</span>
              {kind === 'po' && <PoMaskEditor idPrefix="edit-" mask={draft.mask}
                onToggle={(r, c) => onDraft({ mask: draft.mask.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))) })} />}
              {kind === 'monster' && <MonsterShapeEditor idPrefix="edit-" w={draft.mw} h={draft.mh}
                onW={(v) => onDraft({ mw: v })} onH={(v) => onDraft({ mh: v })} />}
              {shapeDirty && renders.length > 0 && (
                <div data-testid="art-shape-warn" className="aa-warn t-micro">
                  shape change: the {renders.length} existing render(s) keep their OLD size; only new renders use the new one
                </div>
              )}
            </div>
          )}
        </div>
        <div className="aa-ws-actions">
          <button data-testid="art-save" type="button" className="btn aa-btn-sm" disabled={!dirty}
            onClick={props.onSave}>Save</button>
          <button data-testid="art-preview" type="button" className="btn btn-ghost aa-btn-sm"
            onClick={props.onPreviewNow}>Preview final prompt</button>
        </div>
        <div data-testid="art-final-prompt" className="aa-finalprompt">{finalPreview}</div>
      </div>

      <div className="aa-gallery-head">
        <span className="den t-label">Renders <span className="tnum">({renders.length})</span></span>
        {comparePicks.length === 2 && (
          <button type="button" data-testid="art-compare" className="btn aa-btn-sm"
            onClick={() => props.onOpenLightbox(comparePicks[0], comparePicks[1])}>
            Compare s{comparePicks[0]} vs s{comparePicks[1]}
          </button>
        )}
        {comparePicks.length === 1 && <span className="t-micro">pick one more render to compare</span>}
      </div>
      <div data-testid="art-renders" className="aa-gallery">
        {renders.map((r) => {
          const isAdopted = adoptedId != null && r.id === adoptedId;
          const picked = comparePicks.includes(r.seed);
          return (
            <div key={r.seed} data-testid={'render-' + r.seed}
              className={'aa-card' + (isAdopted ? ' is-adopted' : '') + (r.status === 'failed' ? ' is-failed' : '')}>
              <div className="aa-card-top">
                <span className="tnum">seed {r.seed}</span>
                <span data-testid={'render-status-' + r.seed} className={'aa-status aa-status--' + r.status}>[{r.status}]</span>
                {isAdopted && <span className="aa-adopt-badge">ADOPTED</span>}
              </div>
              {r.status === 'ok' ? (
                <button type="button" data-testid={'render-thumb-' + r.seed} className="aa-card-thumb"
                  title="open lightbox" onClick={() => props.onOpenLightbox(r.seed, null)}>
                  <img src={artRenderUrl(art.system_name, r.seed)} alt={'seed ' + r.seed} loading="lazy" />
                </button>
              ) : r.status === 'failed' ? (
                <div className="aa-card-failed">
                  <div className="aa-card-error t-micro">{r.error || 'failed'}</div>
                  <button type="button" data-testid={'retry-' + r.seed} className="btn aa-btn-xs"
                    onClick={() => props.onRetry(r.seed)}>Retry seed {r.seed}</button>
                </div>
              ) : (
                <div className="aa-card-pending t-micro">{r.status === 'running' ? 'rendering…' : 'queued…'}</div>
              )}
              <div className="aa-card-actions">
                <button data-testid={'adopt-' + r.seed} type="button" className="btn aa-btn-xs"
                  disabled={r.status !== 'ok' || isAdopted}
                  onClick={() => props.onAskAdopt(r.seed)}>Adopt</button>
                <button data-testid={'delete-' + r.seed} type="button" className="btn btn-ghost aa-btn-xs"
                  disabled={isAdopted}
                  onClick={() => props.onAskDelete(r.seed)}>Delete</button>
                {r.status === 'ok' && (
                  <label className="aa-pick t-micro">
                    <input type="checkbox" data-testid={'pick-' + r.seed} checked={picked}
                      onChange={() => props.onTogglePick(r.seed)} /> A/B
                  </label>
                )}
              </div>
              {r.status === 'ok' && kits.length > 0 && (
                <KitChips seed={r.seed} kits={kits} rows={inspections[String(r.id)] || []}
                  expanded={props.expandedKits} onToggle={props.onToggleKit}
                  onRerun={(seed, kitId) => props.onRerunKit(seed, kitId)} />
              )}
            </div>
          );
        })}
        {renders.length === 0 && <div className="aa-empty t-micro">no renders yet -- generate a first seed on the right</div>}
      </div>
    </div>
  );
}
