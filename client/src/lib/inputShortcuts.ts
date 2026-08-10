// client/src/lib/inputShortcuts.ts -- REQ-0369: gameplay keyboard shortcuts.
//
// ONE window-level keydown listener, wired once at boot (main.tsx's
// initInputShortcuts() call -- the same lifecycle shape as store/undo.ts's
// initUndoHotkey). Every binding here is GUARDED (REQ-0369 spec item 2):
// it never fires while focus sits in an input/textarea/contentEditable
// (store/undo.ts's focusInTextEntry -- the exact guard Ctrl+Z uses), and
// never with a Ctrl/Meta/Alt chord held (those belong to the browser or to
// other bindings, e.g. REQ-0367's Ctrl+Z).
//
// What is deliberately NOT here:
//  - Esc: universal close is the per-modal lib/useModalConventions hook
//    (adopted across the player-facing modals by this REQ) plus the
//    pre-existing Esc surfaces (FloatingItemTip, DexCardWindow,
//    NotificationBell, the admin pages). A modal's Esc handler
//    stopPropagation()s on document, so an open modal shields this
//    window-level listener from Esc by construction.
//  - Space: the schedule-monitor replay's play/pause needs the mounted
//    Monitor's own playhead closure, so Monitor.tsx wires its own guarded
//    listener while a settled run's transport is on screen.
//
// What IS here:
//  - R rotates the piece under drag/float, backpacks route only. With
//    REQ-0289 not yet landed, R maps to the CURRENT dblclick-rotate call
//    path (the handlePOPointerDown/handleBPPointerDown rotate core, see
//    0289's 2026-08-10 amendment), reached through drag.ts's board
//    registry: rotatePieceOnBoard -> the owning board's rotateShortcut
//    closure (board/commits.ts). Under drag the carried PO / assembly
//    blade / BP rotates in place (the ghost re-reads state on the next
//    pointermove); under float, the tip'd PO. SIs have no rotation -- an
//    SI tip/carry is deliberately ignored, exactly like the pointer path.
//  - 1..5 switch the active squad tab on the backpacks route only
//    (store/squads.ts's switchActiveSquad; the engine refuses an
//    out-of-range index, so a digit past the squad count is a no-op).
//  - ? opens the shortcut-reference overlay (ShortcutHelp.tsx renders it;
//    the pub-sub below is the seam, same pattern as board/itemTip.ts).
//    preventDefault'd because Firefox binds ? to quick-find.
import { boardIdKey, getCarry, rotatePieceOnBoard } from '../board/drag';
import { getItemTip } from '../board/itemTip';
import { focusInTextEntry, getSnapshot, switchActiveSquad } from '../store';

// --- ? overlay open/closed pub-sub (framework-free, like board/itemTip.ts) ---
let helpOpen = false;
const listeners = new Set<() => void>();

export function getShortcutHelpOpen(): boolean {
  return helpOpen;
}

export function subscribeShortcutHelp(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openShortcutHelp(): void {
  if (helpOpen) return;
  helpOpen = true;
  for (const l of listeners) l();
}

export function closeShortcutHelp(): void {
  if (!helpOpen) return;
  helpOpen = false;
  for (const l of listeners) l();
}

let wired = false;

/** Wires the global gameplay-shortcut listener. Called once at boot
 * (main.tsx), idempotent like initUndoHotkey. */
export function initInputShortcuts(): void {
  if (wired) return;
  if (typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (focusInTextEntry()) return;
    if (e.key === '?') {
      e.preventDefault();
      openShortcutHelp();
      return;
    }
    // Everything below is board interaction -- backpacks route only. The
    // boards stay MOUNTED on other routes (only .route-hidden, App.tsx's
    // REQ-0034 design), so without this guard a lingering tip could rotate
    // an invisible board's piece from, say, the market page.
    if (getSnapshot().route !== 'backpacks') return;
    if (e.key === 'r' || e.key === 'R') {
      const carry = getCarry();
      if (carry) {
        // The carried piece. An 'asm' carry rotates as its blade PO
        // (carry.uid IS the blade uid -- BoardRenderer.beginDrag), which
        // is exactly what the dblclick core does for an assembly.
        if (carry.kind === 'bp' && carry.bpId) rotatePieceOnBoard(boardIdKey(carry.originBoard), 'bp', carry.bpId);
        else if (carry.kind === 'po' || carry.kind === 'asm') rotatePieceOnBoard(boardIdKey(carry.originBoard), 'po', carry.uid);
        return;
      }
      const tip = getItemTip();
      if (tip && tip.kind === 'po' && tip.uid) rotatePieceOnBoard(tip.boardKey, 'po', tip.uid);
      return;
    }
    if (e.key >= '1' && e.key <= '5') {
      switchActiveSquad(Number(e.key) - 1);
    }
  });
}
