// client/src/artadmin/Workspace.tsx -- REQ-0156. The center workspace for
// the SELECTED artwork: header (name, kind, derived resolution, adoption
// state), the edit form with dirty indicator + explicit Save + debounced
// final-prompt preview (the page owns the debounce; art-preview stays as
// the manual trigger for the e2e contract), and the render gallery
// (cards per seed with lightbox thumbnails, confirm-gated Adopt/Delete,
// failed-render Retry, compare picks, REQ-0152 kit chips).
//
// REQ-0191: po thumbnails carry the same cell backdrop as the lightbox, so a
// gallery scan already shows which seed sits in its cells -- the lightbox is
// then for confirming the call, not for discovering it. Same component, same
// default-ON rule; the page owns the toggle so the gallery and the lightbox
// never disagree about what is being looked at.
import { KitChips } from './KitChips';
import { PoMaskEditor, MonsterShapeEditor } from './ShapeEditors';
import { SHAPE_LOCKS, SHAPE_LOCK_HELP, MAX_DILATION_PX } from './artShared';
import type { ShapeLock } from './artShared';
import { deriveSizeClient } from './artShared';
import type { ArtDraft, Kind } from './artShared';
import { artRenderUrl, refOf, refKey, sameRef, refLabel } from '../api';
import type { RenderRef } from '../api';

// REQ-0223b: a twin shares its sibling's seed, so a bare seed is no longer a
// unique DOM id -- two same-seed cards would collide on React's key and on the
// testid, and React would reconcile them into each other (the classic duplicate-key
// bug: state and images swap between cards).
//
// Variant 0 keeps the BARE id ('render-42') and only twins are suffixed
// ('render-42-v1'). That is not cosmetic: five e2e specs (artadmin, artinspect,
// dex-admin, contentadmin, reference-model) address renders through these ids, and
// variant 0 is the render they have always meant. Same hinge as REQ-0223a's
// "absent means 0" -- the diff stays about twins.
function tid(r: RenderRef): string { return r.variant ? r.seed + '-v' + r.variant : String(r.seed); }
import { CellStage, maskBbox, cellFitFrom } from './CellBackdrop';
import type { ArtworkDto, RenderDto, InspectionDto, KitDto } from '../api';

// REQ-0216: gallery thumbs draw at a CONSTANT px-per-cell, so footprints
// compare at true relative scale across cards (a 1x1 render is visibly
// small, a 5x2 visibly wide -- same scale on every card). 42 is the largest
// integer cell that still fits the widest possible footprint (the po mask
// is 5x5 max) in the 212px card thumb well: 5 * 42 = 210 <= 212.
const THUMB_CELL_PX = 42;

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
  onAskAdopt: (ref: RenderRef) => void;
  onAskDelete: (ref: RenderRef) => void;
  onRetry: (ref: RenderRef) => void;
  onRepack: (ref: RenderRef) => void;
  onCutout: (ref: RenderRef) => void;  // REQ-0193
  onOpenLightbox: (ref: RenderRef, compareWith: RenderRef | null) => void;
  onRerunKit: (ref: RenderRef, kitId?: string) => void;
  expandedKits: Record<string, boolean>;
  onToggleKit: (key: string) => void;
  comparePicks: RenderRef[];
  onTogglePick: (ref: RenderRef) => void;
  cells: boolean;                     // REQ-0191: cell backdrop on the thumbs
  onToggleCells: () => void;
  savedMask: boolean[][] | null;      // REQ-0191: SAVED shape (not the draft)
}) {
  const { art, renders, kits, inspections, adoptedId, draft, onDraft, dirty, shapeDirty,
    finalPreview, comparePicks, savedMask } = props;
  const kind = art.kind as Kind;
  // REQ-0191: the backdrop is drawn from the SAVED mask, never the draft --
  // an unsaved click in the editor must not repaint the footprint under
  // renders that were made against the old one.
  const thumbBb = kind === 'po' && props.cells && savedMask ? maskBbox(savedMask) : null;
  const newSize = deriveSizeClient(kind, draft.mask, draft.mw, draft.mh, draft.cw, draft.ch, draft.role);
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
          {kind === 'vfx' && (
            <div className="aa-field">
              <span className="t-micro">role (derived size: <b className="tnum">{newSize.width}x{newSize.height}</b>{shapeDirty ? ' after save' : ''})</span>
              <select data-testid="art-edit-vfx-role" className="aa-input" value={draft.role}
                onChange={(e) => onDraft({ role: e.target.value as 'ray' | 'hit' })}>
                <option value="ray">ray (256x64 strip, tiled along the path)</option>
                <option value="hit">hit (256x256 burst)</option>
              </select>
              {shapeDirty && renders.length > 0 && (
                <div data-testid="art-shape-warn" className="aa-warn t-micro">
                  role change: the {renders.length} existing render(s) keep their OLD size + inspections; only new renders use the new one
                </div>
              )}
            </div>
          )}
          {(kind === 'po' || kind === 'monster' || kind === 'gimic') && (
            <div className="aa-field">
              <span className="t-micro">shape (derived size: <b className="tnum">{newSize.width}x{newSize.height}</b>{shapeDirty ? ' after save' : ''})</span>
              {kind === 'po' && <PoMaskEditor idPrefix="edit-" mask={draft.mask}
                onToggle={(r, c) => onDraft({ mask: draft.mask.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))) })} />}
              {kind === 'po' && (
                <div className="aa-field aa-shapelock">
                  <span className="t-micro">shape lock (how hard the render is held to these cells)</span>
                  <select data-testid="art-edit-shape-lock" className="aa-input" value={draft.shape_lock}
                    onChange={(e) => onDraft({ shape_lock: e.target.value as ShapeLock })}>
                    {SHAPE_LOCKS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <span data-testid="art-edit-shape-lock-help" className="t-micro aa-hint">{SHAPE_LOCK_HELP[draft.shape_lock]}</span>
                  {draft.shape_lock === 'strict' && (
                    <label className="aa-field">
                      <span className="t-micro">dilation (px of slack around the cells; only 8 is score-validated)</span>
                      <input data-testid="art-edit-shape-dilation" className="aa-input aa-input--num" type="number"
                        min={0} max={MAX_DILATION_PX} step={1} value={draft.shape_dilation_px}
                        onChange={(e) => onDraft({ shape_dilation_px: Number(e.target.value) || 0 })} />
                    </label>
                  )}
                </div>
              )}
              {(kind === 'monster' || kind === 'gimic') && <MonsterShapeEditor idPrefix="edit-" w={draft.mw} h={draft.mh}
                onW={(v) => onDraft({ mw: v })} onH={(v) => onDraft({ mh: v })} />}
              {shapeDirty && renders.length > 0 && (
                <div data-testid="art-shape-warn" className="aa-warn t-micro">
                  shape change: the {renders.length} existing render(s) keep their OLD size; only new renders use the new one
                </div>
              )}
            </div>
          )}
          {kind === 'custom' && (
            <div className="aa-field">
              <span className="t-micro">resolution (snapped: <b className="tnum">{newSize.width}x{newSize.height}</b>{shapeDirty ? ' after save' : ''})</span>
              <div className="aa-res-inputs">
                <label className="aa-field">
                  <span className="t-micro">width</span>
                  <input data-testid="art-edit-res-w" className="aa-input aa-input--num" type="number" min={16} max={16384} step={16} value={draft.cw} onChange={(e) => onDraft({ cw: Number(e.target.value) || 0 })} />
                </label>
                <label className="aa-field">
                  <span className="t-micro">height</span>
                  <input data-testid="art-edit-res-h" className="aa-input aa-input--num" type="number" min={16} max={16384} step={16} value={draft.ch} onChange={(e) => onDraft({ ch: Number(e.target.value) || 0 })} />
                </label>
              </div>
              {shapeDirty && renders.length > 0 && (
                <div data-testid="art-shape-warn" className="aa-warn t-micro">
                  resolution change: the {renders.length} existing render(s) keep their OLD size; only new renders use the new one
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
        {kind === 'po' && (
          <button type="button" data-testid="art-cells"
            className={'chip aa-chipbtn' + (props.cells ? ' is-on' : '')}
            title="draw each render over its cell footprint (owned vs unowned cells)"
            onClick={props.onToggleCells}>cells</button>
        )}
        {comparePicks.length === 2 && (
          <button type="button" data-testid="art-compare" className="btn aa-btn-sm"
            onClick={() => props.onOpenLightbox(comparePicks[0], comparePicks[1])}>
            Compare {refLabel(comparePicks[0])} vs {refLabel(comparePicks[1])}
          </button>
        )}
        {comparePicks.length === 1 && <span className="t-micro">pick one more render to compare</span>}
      </div>
      <div data-testid="art-renders" className="aa-gallery">
        {renders.map((r) => {
          const isAdopted = adoptedId != null && r.id === adoptedId;
          const ref = refOf(r);
          const t = tid(ref);
          const picked = comparePicks.some((p) => sameRef(p, ref));
          // REQ-0223b: renders arrive (seed, variant)-ordered from the server, so a
          // twin sits next to its sibling; `twin` marks the ones that need to say why
          // two cards share a seed number.
          const twin = r.variant > 0;
          return (
            <div key={refKey(ref)} data-testid={'render-' + t}
              className={'aa-card' + (isAdopted ? ' is-adopted' : '') + (r.status === 'failed' ? ' is-failed' : '') + (twin ? ' is-twin' : '')}>
              <div className="aa-card-top">
                <span className="tnum">seed {r.seed}{twin ? <span className="aa-variant-tag" title="same seed, different generation parameters (REQ-0223)"> ·v{r.variant}</span> : null}</span>
                <span data-testid={'render-status-' + t} className={'aa-status aa-status--' + r.status}>[{r.status}]</span>
                {isAdopted && <span className="aa-adopt-badge">ADOPTED</span>}
              </div>
              {r.status === 'ok' ? (
                <button type="button" data-testid={'render-thumb-' + t} className="aa-card-thumb"
                  title="open lightbox" onClick={() => props.onOpenLightbox(ref, null)}>
                  {thumbBb ? (
                    <CellStage bb={thumbBb} mask={savedMask as boolean[][]}
                      fit={cellFitFrom(inspections[String(r.id)])}
                      probeUrl={artRenderUrl(art.system_name, r.seed, r.variant)}
                      widthPx={thumbBb.cols * THUMB_CELL_PX} className="aa-cb--thumb"
                      testId={'render-cb-' + t}>
                      <img src={artRenderUrl(art.system_name, r.seed, r.variant)} alt={refLabel(ref)} loading="lazy" />
                    </CellStage>
                  ) : (
                    <img src={artRenderUrl(art.system_name, r.seed, r.variant)} alt={refLabel(ref)} loading="lazy" />
                  )}
                </button>
              ) : r.status === 'failed' ? (
                <div className="aa-card-failed">
                  <div className="aa-card-error t-micro">{r.error || 'failed'}</div>
                  <button type="button" data-testid={'retry-' + t} className="btn aa-btn-xs"
                    onClick={() => props.onRetry(ref)}>Retry {refLabel(ref)}</button>
                </div>
              ) : (
                <div className="aa-card-pending t-micro">{r.status === 'running' ? 'rendering…' : 'queued…'}</div>
              )}
              <div className="aa-card-actions">
                <button data-testid={'adopt-' + t} type="button" className="btn aa-btn-xs"
                  disabled={r.status !== 'ok' || isAdopted}
                  onClick={() => props.onAskAdopt(ref)}>Adopt</button>
                <button data-testid={'delete-' + t} type="button" className="btn btn-ghost aa-btn-xs"
                  disabled={isAdopted}
                  onClick={() => props.onAskDelete(ref)}>Delete</button>
                {kind === 'po' && r.status === 'ok' && (
                  <button data-testid={'repack-' + t} type="button" className="btn btn-ghost aa-btn-xs"
                    title="derive a best-placement variant at seed+100000 (REQ-0192)"
                    onClick={() => props.onRepack(ref)}>Repack</button>
                )}
                {r.status === 'ok' && (
                  <label className="aa-pick t-micro">
                    <input type="checkbox" data-testid={'pick-' + t} checked={picked}
                      onChange={() => props.onTogglePick(ref)} /> A/B
                  </label>
                )}
              </div>
{/* REQ-0193: the chip row now also carries the kind-agnostic cutout
                  chip, so it renders for an ok render even when the kind has
                  no kits at all (kits.length === 0). */}
              {r.status === 'ok' && (
                <KitChips seed={r.seed} variant={r.variant} kits={kits} rows={inspections[String(r.id)] || []}
                  renders={renders}
                  expanded={props.expandedKits} onToggle={props.onToggleKit}
                  onRerun={(_seed, kitId) => props.onRerunKit(ref, kitId)}
                  onCutout={() => props.onCutout(ref)} />
              )}
            </div>
          );
        })}
        {renders.length === 0 && <div className="aa-empty t-micro">no renders yet -- generate a first seed on the right</div>}
      </div>
    </div>
  );
}
