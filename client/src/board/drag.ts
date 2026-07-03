// Drag/carry interaction state — REQ-0027 T0.2.
//
// Mirrors mock-src/ui.js's module-level `carry` object exactly in shape and
// lifecycle (see ui.js's startCarry/pointermove/pointerup/keydown blocks),
// just relocated to a tiny framework-free pub-sub (same pattern as
// store.ts) instead of a plain closure variable, because here TWO separate
// consumers need to react to it: the PixiJS board canvas (BoardRenderer,
// via Board.tsx) AND the React inventory panel (ItemPanel.tsx) -- a drag
// that starts in the React-rendered inventory list must show its ghost on
// the Pixi canvas, and a drag that starts on the canvas must let the
// inventory panel repaint (hide the item being carried FROM inventory, and
// show the inventory drop-zone highlight). This is ephemeral UI/interaction
// state, not game state -- it never touches `state` in store.ts directly;
// only the pointerup commit calls the engine mutators, which DO mutate
// `state` (via store.ts's notifyStateChanged()).
//
// `carry.kind`: 'po' | 'asm' | 'bp' | 'si' -- same four kinds as the mock.
// `carry.armed`: false until the pointer has moved >5px from the pointerdown
// origin (same threshold as the mock) -- this lets a plain click fall
// through to a separate dblclick-rotate detector instead of always starting
// a drag (see rotate.ts).
export type CarryKind = 'po' | 'asm' | 'bp' | 'si';

export type DropTarget =
  | { type: 'inv' }
  | { type: 'grid'; anchor: [number, number] }
  | { type: 'bp'; origin: [number, number] }
  | { type: 'sock'; skey: string };

export interface CarryState {
  kind: CarryKind;
  uid: string; // PO uid, or SI uid, or blade uid (for 'asm')
  bpId?: string; // set when kind==='bp'
  sx: number; // pointerdown clientX
  sy: number; // pointerdown clientY
  armed: boolean;
  drop: DropTarget | null;
  grabOff: [number, number]; // cell-space offset from anchor/origin to grab point
  // Live pointer position in BOARD-CANVAS-LOCAL pixel space (for ghost
  // rendering) -- updated on every pointermove once armed.
  px: number;
  py: number;
}

let carry: CarryState | null = null;
const listeners = new Set<() => void>();

export function getCarry(): CarryState | null {
  return carry;
}

export function subscribeCarry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

/** Starts a new carry. No-op if a carry is already active (matches the
 * mock's `if(carry||!kind)return;`) or a bare uid wasn't supplied. */
export function startCarry(init: Omit<CarryState, 'armed' | 'drop' | 'px' | 'py'>): void {
  if (carry) return;
  carry = { ...init, armed: false, drop: null, px: init.sx, py: init.sy };
  notify();
}

/** Arms the current carry (past the 5px move threshold) -- one-shot. */
export function armCarry(): void {
  if (!carry || carry.armed) return;
  carry.armed = true;
  notify();
}

/** Updates live pointer position + drop target during an armed drag. */
export function updateCarry(px: number, py: number, drop: DropTarget | null): void {
  if (!carry) return;
  carry.px = px;
  carry.py = py;
  carry.drop = drop;
  notify();
}

/** Clears the carry with NO engine call (Esc-cancel, or a plain
 * click that never armed). */
export function cancelCarry(): void {
  if (!carry) return;
  carry = null;
  notify();
}

/** Reads-and-clears the carry (used by pointerup to commit, so the caller
 * gets the final drop target before the module forgets it). */
export function takeCarry(): CarryState | null {
  const c = carry;
  carry = null;
  if (c) notify();
  return c;
}
