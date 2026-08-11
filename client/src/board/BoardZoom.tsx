// client/src/board/BoardZoom.tsx -- REQ-0377 item 5: a two-step zoom toggle
// for the canvas board stage on narrow screens.
//
// THE PROBLEM. The Pixi boards are FIXED-SIZE: BoardRenderer.mount() inits the
// Application at PAD*2 + COLS*CELL (board/geom.ts: CELL 80, PAD 38), so an 8x8
// board is a 716px square no matter what viewport it lands in. Under the 840px
// breakpoint (styles/base.css, where the rail becomes a bottom bar) that square
// is wider than the screen, and what the player gets is a board scaled down to
// fit -- cells too small to aim a drag at on the device where aiming is
// hardest.
//
// THE MECHANISM, and the verification the REQ asked for before building it.
// This uses CSS `zoom`, which is not a new idea here: styles/canvas.css has
// shipped `zoom: 0.75` on this very element for short viewports since REQ-0140.
// Two things follow, and both were checked in the code rather than assumed:
//
//   1. DRAGGING KEEPS WORKING. board/geom.ts's clientToLocal() derives its
//      client->board scale from getBoundingClientRect() (divided by the
//      renderer resolution), and `zoom` moves that rect. So the pointer math
//      re-derives itself at any zoom -- which is exactly why the shipped 0.75
//      rule does not break drops, and the same reason this one does not.
//      localBoxToClient() (the DOM overlays) is the same formula inverted.
//
//   2. ZOOMING IN IS LEGIBLE, NOT CRISP -- and that is a KNOWN, PRE-EXISTING
//      cost, not one this REQ introduces. BoardRenderer.mount() calls
//      app.init() with no `resolution`/`autoDensity`, so the backing store is
//      1x and EVERY HiDPI display already views these boards upscaled. Zooming
//      to 1.4 makes an existing softness more visible; it does not create it.
//      Making the boards resolution-aware is a real improvement and a REAL
//      cost (backing-store area grows with the square of resolution, across
//      every mounted board), so per this item's own NOTE that half is split
//      out as a spike rather than smuggled in here. The toggle ships; the
//      crispness work gets measured on its own.
//
// The step is applied as a DATA ATTRIBUTE, not an inline style, so it composes
// with the existing short-viewport rule through a multiply in CSS instead of
// one `zoom` declaration silently overwriting the other.
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import type { Locale } from '../store';
import { BOARD_ZOOM_STEPS, loadBoardZoom, saveBoardZoom, type BoardZoomStep } from './boardZoomPrefs';

interface Props { locale: Locale; }

export function BoardZoom({ locale }: Props) {
  const [step, setStep] = useState<BoardZoomStep>(() => loadBoardZoom());

  // The attribute lives on the STAGE element, which this component does not
  // own (App.tsx renders .board-wrap-canvas around the whole stage, including
  // the boardfoot this button sits in). Setting it from an effect keeps the
  // toggle a leaf component instead of forcing a zoom prop through the tree.
  useEffect(() => {
    const stage = document.querySelector('.board-wrap-canvas');
    if (stage) stage.setAttribute('data-board-zoom', step);
    return () => { stage?.removeAttribute('data-board-zoom'); };
  }, [step]);

  const next = (): void => {
    const i = BOARD_ZOOM_STEPS.indexOf(step);
    const n = BOARD_ZOOM_STEPS[(i + 1) % BOARD_ZOOM_STEPS.length];
    setStep(n);
    saveBoardZoom(n);
  };

  return (
    <button
      type="button"
      className={`chip board-zoom-toggle${step === 'in' ? ' is-on' : ''}`}
      data-testid="board-zoom-toggle"
      data-step={step}
      aria-pressed={step === 'in'}
      title={t(locale, 'board.zoom.hint')}
      onClick={next}
    >
      {/* Shape + text, never colour alone (REQ-0143). */}
      <span aria-hidden="true">{step === 'in' ? '\u2296' : '\u2295'}</span>
      {t(locale, step === 'in' ? 'board.zoom.out' : 'board.zoom.in')}
    </button>
  );
}
