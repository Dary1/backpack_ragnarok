// client/src/board/boardZoomPrefs.ts -- REQ-0377 item 5: persistence for the
// board zoom step. Same localStorage + pure-normaliser shape as
// a11y/motionPrefs / a11y/scalePrefs; kept in its own module so the pure part
// is testable without a DOM and so BoardZoom.tsx stays a view.
//
// Only two steps by design ("a two-step zoom toggle"): a player on a phone
// wants bigger or normal, not a slider to fiddle with mid-drag.

export type BoardZoomStep = 'fit' | 'in';

export const BOARD_ZOOM_STEPS: BoardZoomStep[] = ['fit', 'in'];
export const STORAGE_KEY = 'bp.board.zoom';

/** Coerce an arbitrary parsed value into a valid step. Pure. */
export function normalizeBoardZoom(raw: unknown): BoardZoomStep {
  return raw === 'in' ? 'in' : 'fit';
}

export function loadBoardZoom(): BoardZoomStep {
  try {
    return normalizeBoardZoom(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'fit';
  }
}

export function saveBoardZoom(step: BoardZoomStep): void {
  try {
    localStorage.setItem(STORAGE_KEY, step);
  } catch {
    // Storage disabled/full -- the step still applies for this session.
  }
}
