// client/src/artadmin/Lightbox.tsx -- REQ-0156. The core judging tool:
// full-size candidate view with zoom (fit / 1:1 / 2x / 4x), background
// toggle (dark / white / checker), keyboard prev/next + Escape, a 2x2
// tiled mode + half-shift toggle for bpskin (the industry-norm seam
// eyeball for seamless textures, REQ-0138/0152 finding), 2-up compare at
// synchronized zoom/background, and Adopt from inside (routed through the
// page's confirm dialog). Adoption stays a HUMAN act (S7 spirit) -- this
// component only makes the comparison honest.
import { useEffect, useState } from 'react';
import { artRenderUrl } from '../api';

type ZoomMode = 'fit' | '1' | '2' | '4';
type BgMode = 'dark' | 'white' | 'checker';

const ZOOMS: ZoomMode[] = ['fit', '1', '2', '4'];
const BGS: BgMode[] = ['dark', 'white', 'checker'];

function Pane({ name, seed, zoom, bg, tile, halfshift, testId }: {
  name: string; seed: number; zoom: ZoomMode; bg: BgMode;
  tile: boolean; halfshift: boolean; testId?: string;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const url = artRenderUrl(name, seed);
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
  return (
    <div className={'aa-lb-stage aa-lb-bg--' + bg}>
      <img data-testid={testId} className={'aa-lb-img' + (zoom === 'fit' ? ' is-fit' : '')}
        src={url} alt={'seed ' + seed} style={style}
        onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
    </div>
  );
}

export function Lightbox({ name, kind, seeds, initialSeed, compareWith, adoptedSeed, keysDisabled, onAdopt, onClose }: {
  name: string;
  kind: string;
  seeds: number[];                    // ok seeds, gallery order (nav ring)
  initialSeed: number;
  compareWith: number | null;         // non-null -> open in 2-up compare
  adoptedSeed: number | null;
  keysDisabled: boolean;              // true while the confirm dialog is up
  onAdopt: (seed: number) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(Math.max(0, seeds.indexOf(initialSeed)));
  const [compare, setCompare] = useState<number | null>(compareWith);
  const [zoom, setZoom] = useState<ZoomMode>('fit');
  const [bg, setBg] = useState<BgMode>('dark');
  const [tile, setTile] = useState(false);
  const [halfshift, setHalfshift] = useState(false);

  const seed = seeds[idx] != null ? seeds[idx] : initialSeed;

  useEffect(() => {
    if (keysDisabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (compare != null) return;                 // nav is single-mode only
      if (e.key === 'ArrowLeft') setIdx((i) => (i - 1 + seeds.length) % seeds.length);
      if (e.key === 'ArrowRight') setIdx((i) => (i + 1) % seeds.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keysDisabled, compare, seeds.length, onClose]);

  const isBpskin = kind === 'bpskin';

  return (
    <div data-testid="lightbox" className="aa-lb" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="aa-lb-bar">
        <span className="den t-label gold-text">{name} <span className="tnum">s{seed}</span>{compare != null ? <span className="tnum"> vs s{compare}</span> : null}</span>
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
        <span className="aa-lb-group aa-lb-actions">
          {compare == null && seeds.length > 1 && (
            <>
              <button type="button" data-testid="lightbox-prev" className="btn btn-ghost aa-btn-xs"
                onClick={() => setIdx((i) => (i - 1 + seeds.length) % seeds.length)}>&larr;</button>
              <button type="button" data-testid="lightbox-next" className="btn btn-ghost aa-btn-xs"
                onClick={() => setIdx((i) => (i + 1) % seeds.length)}>&rarr;</button>
            </>
          )}
          {compare != null && (
            <button type="button" data-testid="lightbox-uncompare" className="btn btn-ghost aa-btn-xs"
              onClick={() => setCompare(null)}>single</button>
          )}
          <button type="button" data-testid="lightbox-adopt" className="btn aa-btn-sm"
            disabled={adoptedSeed === seed}
            onClick={() => onAdopt(seed)}>{adoptedSeed === seed ? 'Adopted' : 'Adopt s' + seed}</button>
          <button type="button" data-testid="lightbox-close" className="btn btn-ghost aa-btn-sm" onClick={onClose}>✕</button>
        </span>
      </div>
      {compare == null ? (
        <div className="aa-lb-body">
          <Pane name={name} seed={seed} zoom={zoom} bg={bg} tile={tile && isBpskin} halfshift={halfshift} testId="lightbox-img" />
        </div>
      ) : (
        <div data-testid="lightbox-compare" className="aa-lb-body aa-lb-body--compare">
          <div className="aa-lb-half">
            <div className="t-micro aa-lb-caption tnum">s{seed}{adoptedSeed === seed ? ' (adopted)' : ''}</div>
            <Pane name={name} seed={seed} zoom={zoom} bg={bg} tile={tile && isBpskin} halfshift={halfshift} testId="lightbox-img" />
          </div>
          <div className="aa-lb-half">
            <div className="t-micro aa-lb-caption tnum">s{compare}{adoptedSeed === compare ? ' (adopted)' : ''}
              {' '}<button type="button" data-testid="lightbox-adopt-b" className="aa-linkbtn"
                disabled={adoptedSeed === compare} onClick={() => onAdopt(compare)}>adopt this</button>
            </div>
            <Pane name={name} seed={compare} zoom={zoom} bg={bg} tile={tile && isBpskin} halfshift={halfshift} testId="lightbox-img-b" />
          </div>
        </div>
      )}
    </div>
  );
}
