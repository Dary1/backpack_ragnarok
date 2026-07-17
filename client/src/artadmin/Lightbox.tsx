// client/src/artadmin/Lightbox.tsx -- REQ-0156. The core judging tool:
// full-size candidate view with zoom (fit / 1:1 / 2x / 4x), background
// toggle (dark / white / checker), keyboard prev/next + Escape, a 2x2
// tiled mode + half-shift toggle for bpskin (the industry-norm seam
// eyeball for seamless textures, REQ-0138/0152 finding), 2-up compare at
// synchronized zoom/background, and Adopt from inside (routed through the
// page's confirm dialog). Adoption stays a HUMAN act (S7 spirit) -- this
// component only makes the comparison honest.
//
// REQ-0191: po renders additionally get the CELL BACKDROP -- the render
// composited over its own cell footprint (CellBackdrop.tsx), default ON,
// because for a po the question "does the subject sit in its cells" is the
// judging question, and it cannot be asked against plain white. The 'cells'
// chip turns it off; every other control (zoom, bg, compare, adopt) is
// untouched and works the same with it on or off.
import { useEffect, useState } from 'react';
import { artRenderUrl, refKey, sameRef, refLabel } from '../api';
import type { RenderRef } from '../api';
import { CellStage, maskBbox, aspectMatches } from './CellBackdrop';
import type { CellFit } from './CellBackdrop';

type ZoomMode = 'fit' | '1' | '2' | '4';
type BgMode = 'dark' | 'white' | 'checker';

const ZOOMS: ZoomMode[] = ['fit', '1', '2', '4'];
const BGS: BgMode[] = ['dark', 'white', 'checker'];

function Pane({ name, rref, zoom, bg, tile, halfshift, cells, mask, fit, testId }: {
  name: string; rref: RenderRef; zoom: ZoomMode; bg: BgMode;
  tile: boolean; halfshift: boolean;
  cells: boolean;                     // REQ-0191: draw the cell backdrop
  mask: boolean[][] | null;           // the artwork's saved po shape mask
  fit: CellFit | null;                // po.cell_fit row for THIS render
  testId?: string;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const url = artRenderUrl(name, rref.seed, rref.variant);
  if (tile) {
    // 2x2 repeat of the texture; half-shift offsets the pattern by half a
    // tile so the tile SEAM runs through the middle of the view -- any
    // discontinuity becomes an obvious cross. Numeric zooms scale the tile;
    // 'fit' shows a compact 2x2 at half size.
    const z = zoom === 'fit' ? 0.5 : Number(zoom);
    const tw = (nat ? nat.w : 1024) * z, th = (nat ? nat.h : 1024) * z;
    return (
      <div className={'aa-lb-stage aa-lb-bg--' + bg}>
        {/* hidden probe img resolves the natural size for the tile math */}
        <img src={url} alt="" style={{ display: 'none' }}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <div data-testid={testId} className="aa-lb-tile" style={{
          width: tw * 2, height: th * 2,
          backgroundImage: 'url("' + url + '")',
          backgroundSize: tw + 'px ' + th + 'px',
          backgroundPosition: halfshift ? (tw / 2) + 'px ' + (th / 2) + 'px' : '0 0',
        }} />
      </div>
    );
  }
  const style = zoom === 'fit'
    ? undefined
    : { width: ((nat ? nat.w : 0) || 256) * Number(zoom) + 'px', maxWidth: 'none', maxHeight: 'none' };
  const img = (
    <img data-testid={testId} className={'aa-lb-img' + (zoom === 'fit' ? ' is-fit' : '')}
      src={url} alt={refLabel(rref)} style={style}
      onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
  );
  // REQ-0191: the backdrop needs a footprint AND a render that actually has
  // that footprint's aspect -- a mask edited after the render was made would
  // otherwise draw a grid that lies about where the cells are.
  const bb = cells && mask ? maskBbox(mask) : null;
  if (!bb || !aspectMatches(bb, nat)) {
    return <div className={'aa-lb-stage aa-lb-bg--' + bg}>{img}</div>;
  }
  const basis = (nat ? nat.w : 0) || bb.cols * 256;
  return (
    <div className={'aa-lb-stage aa-lb-bg--' + bg}>
      <CellStage bb={bb} mask={mask as boolean[][]} fit={fit} probeUrl={url}
        widthPx={zoom === 'fit' ? basis : basis * Number(zoom)}
        style={zoom === 'fit' ? { maxWidth: '96%', maxHeight: '96%' } : undefined}
        testId={testId ? testId + '-cb' : undefined}>
        {img}
      </CellStage>
    </div>
  );
}

export function Lightbox({ name, kind, mask, fitByRef, refs, initialRef, compareWith, adoptedRef, keysDisabled, onAdopt, onClose }: {
  name: string;
  kind: string;
  mask: boolean[][] | null;           // REQ-0191: saved po shape mask (null off-po)
  fitByRef: Record<string, CellFit | null>;   // REQ-0191: po.cell_fit per render, refKey'd
  refs: RenderRef[];                  // ok renders, gallery order (nav ring)
  initialRef: RenderRef;
  compareWith: RenderRef | null;      // non-null -> open in 2-up compare
  adoptedRef: RenderRef | null;
  keysDisabled: boolean;              // true while the confirm dialog is up
  onAdopt: (ref: RenderRef) => void;
  onClose: () => void;
}) {
  // REQ-0223b: the nav ring is over RENDERS, not seeds -- twins share a seed, so
  // indexOf on a number would land on whichever twin came first and the ring would
  // silently skip the other.
  const [idx, setIdx] = useState(Math.max(0, refs.findIndex((r) => sameRef(r, initialRef))));
  const [compare, setCompare] = useState<RenderRef | null>(compareWith);
  const [zoom, setZoom] = useState<ZoomMode>('fit');
  const [bg, setBg] = useState<BgMode>('dark');
  const [tile, setTile] = useState(false);
  const [halfshift, setHalfshift] = useState(false);
  // REQ-0191: default ON for po (that IS the po judging view); the chip keeps
  // the plain render one click away.
  const [cells, setCells] = useState(kind === 'po');

  const rref = refs[idx] != null ? refs[idx] : initialRef;
  // REQ-0223b: THE A/B strip. Renders arrive (seed, variant)-ordered from the server
  // (REQ-0223a's listRenders), so a seed's twins are already adjacent -- the strip is
  // a filter over the ring, not a re-sort. Present only when this seed HAS twins;
  // a lone render must not sprout an A/B affordance it cannot honour.
  const strip = refs.filter((r) => r.seed === rref.seed);
  const hasTwins = strip.length > 1;

  useEffect(() => {
    if (keysDisabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (compare != null) return;                 // nav is single-mode only
      if (e.key === 'ArrowLeft') setIdx((i) => (i - 1 + refs.length) % refs.length);
      if (e.key === 'ArrowRight') setIdx((i) => (i + 1) % refs.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysDisabled, compare, refs.length, onClose]);

  const isBpskin = kind === 'bpskin';
  const isPo = kind === 'po';

  return (
    <div data-testid="lightbox" className="aa-lb" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="aa-lb-bar">
        <span className="den t-label gold-text">{name} <span className="tnum">{refLabel(rref)}</span>{compare != null ? <span className="tnum"> vs {refLabel(compare)}</span> : null}</span>
        <span className="aa-lb-group">
          {ZOOMS.map((z) => (
            <button key={z} type="button" data-testid={'lightbox-zoom-' + z}
              className={'chip aa-chipbtn' + (zoom === z ? ' is-on' : '')}
              onClick={() => setZoom(z)}>{z === 'fit' ? 'fit' : z + 'x'}</button>
          ))}
        </span>
        <span className="aa-lb-group">
          {BGS.map((b) => (
            <button key={b} type="button" data-testid={'lightbox-bg-' + b}
              className={'chip aa-chipbtn' + (bg === b ? ' is-on' : '')}
              onClick={() => setBg(b)}>{b}</button>
          ))}
        </span>
        {isPo && (
          <span className="aa-lb-group">
            <button type="button" data-testid="lightbox-cells"
              className={'chip aa-chipbtn' + (cells ? ' is-on' : '')}
              title="draw the render over its cell footprint (owned vs unowned cells)"
              onClick={() => setCells((v) => !v)}>cells</button>
          </span>
        )}
        {isBpskin && (
          <span className="aa-lb-group">
            <button type="button" data-testid="lightbox-tile"
              className={'chip aa-chipbtn' + (tile ? ' is-on' : '')}
              onClick={() => setTile((t) => !t)}>2x2 tile</button>
            <button type="button" data-testid="lightbox-halfshift" disabled={!tile}
              className={'chip aa-chipbtn' + (halfshift ? ' is-on' : '')}
              onClick={() => setHalfshift((h) => !h)}>half-shift</button>
          </span>
        )}
        {/* REQ-0223b: the A/B strip -- every variant of the seed on screen, one
            click apart, and 'A/B' opens the two-up at a TRUE same-seed pair. This is
            the affordance REQ-0187 lacked: it had to burn disjoint seed ranges, so its
            2-up always confounded the lock delta with a seed delta. */}
        {compare == null && hasTwins && (
          <span className="aa-lb-group" data-testid="lightbox-strip">
            {strip.map((r) => (
              <button key={refKey(r)} type="button" data-testid={'lightbox-strip-' + (r.variant ? r.seed + '-v' + r.variant : r.seed)}
                className={'chip aa-chipbtn' + (sameRef(r, rref) ? ' is-on' : '')}
                title={'seed ' + r.seed + ', variant ' + r.variant + ' -- same seed, different generation parameters'}
                onClick={() => setIdx(refs.findIndex((x) => sameRef(x, r)))}>
                {r.variant ? 'v' + r.variant : 'v0'}
              </button>
            ))}
            <button type="button" data-testid="lightbox-ab"
              className="chip aa-chipbtn"
              title="compare this seed's two variants side by side"
              onClick={() => setCompare(strip.find((r) => !sameRef(r, rref)) || null)}>A/B</button>
          </span>
        )}
        <span className="aa-lb-group aa-lb-actions">
          {compare == null && refs.length > 1 && (
            <>
              <button type="button" data-testid="lightbox-prev" className="btn btn-ghost aa-btn-xs"
                onClick={() => setIdx((i) => (i - 1 + refs.length) % refs.length)}>&larr;</button>
              <button type="button" data-testid="lightbox-next" className="btn btn-ghost aa-btn-xs"
                onClick={() => setIdx((i) => (i + 1) % refs.length)}>&rarr;</button>
            </>
          )}
          {compare != null && (
            <button type="button" data-testid="lightbox-uncompare" className="btn btn-ghost aa-btn-xs"
              onClick={() => setCompare(null)}>single</button>
          )}
          <button type="button" data-testid="lightbox-adopt" className="btn aa-btn-sm"
            disabled={sameRef(adoptedRef, rref)}
            onClick={() => onAdopt(rref)}>{sameRef(adoptedRef, rref) ? 'Adopted' : 'Adopt ' + refLabel(rref)}</button>
          <button type="button" data-testid="lightbox-close" className="btn btn-ghost aa-btn-sm" onClick={onClose}>✕</button>
        </span>
      </div>
      {compare == null ? (
        <div className="aa-lb-body">
          <Pane name={name} rref={rref} zoom={zoom} bg={bg} tile={tile && isBpskin} halfshift={halfshift}
            cells={cells && isPo} mask={mask} fit={fitByRef[refKey(rref)] || null} testId="lightbox-img" />
        </div>
      ) : (
        <div data-testid="lightbox-compare" className="aa-lb-body aa-lb-body--compare">
          <div className="aa-lb-half">
            <div className="t-micro aa-lb-caption tnum">{refLabel(rref)}{sameRef(adoptedRef, rref) ? ' (adopted)' : ''}</div>
            <Pane name={name} rref={rref} zoom={zoom} bg={bg} tile={tile && isBpskin} halfshift={halfshift}
              cells={cells && isPo} mask={mask} fit={fitByRef[refKey(rref)] || null} testId="lightbox-img" />
          </div>
          <div className="aa-lb-half">
            {/* REQ-0223b: when the two halves share a seed this caption is the whole
                point -- it is what tells the operator the ONLY difference between these
                two images is the parameter under test. */}
            <div className="t-micro aa-lb-caption tnum">{refLabel(compare)}{sameRef(adoptedRef, compare) ? ' (adopted)' : ''}
              {compare.seed === rref.seed ? <span data-testid="lightbox-sameseed" className="aa-lb-sameseed"> same seed</span> : null}
              {' '}<button type="button" data-testid="lightbox-adopt-b" className="aa-linkbtn"
                disabled={sameRef(adoptedRef, compare)} onClick={() => onAdopt(compare)}>adopt this</button>
            </div>
            <Pane name={name} rref={compare} zoom={zoom} bg={bg} tile={tile && isBpskin} halfshift={halfshift}
              cells={cells && isPo} mask={mask} fit={fitByRef[refKey(compare)] || null} testId="lightbox-img-b" />
          </div>
        </div>
      )}
    </div>
  );
}
