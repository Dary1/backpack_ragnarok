// client/src/lib/useModalConventions.ts -- REQ-0366, deliberately in the
// EXACT shape REQ-0369 ("Input conventions") specifies for its unified
// modal behavior, so 0369 can adopt this hook verbatim across every
// player-facing modal (BuyModal, workshop roll result, DismantlePanel,
// sealed-run compare). REQ-0366's warehouse SellModal is the first
// adopter (0369 names it as such in its cross-refs).
//
// The four conventions (0369 spec 1):
//  - Esc-to-close (document-level; fires even while an input is focused
//    -- Esc is the universal close, unlike 0369's letter/digit shortcuts
//    which ARE input-guarded).
//  - overlay-click-to-close (a TRUE scrim click only, never a click
//    inside the dialog -- the same e.target === e.currentTarget
//    predicate BuyModal already uses).
//  - focus trap (Tab/Shift+Tab cycle within the dialog's focusable set).
//  - initial focus (the dialog's first focusable element by DOM order,
//    else the dialog itself -- give the dialog tabIndex={-1} so the
//    fallback can take focus); prior focus is restored on unmount.
import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/** The focusable-descendant query the trap and initial focus share.
 * Deliberately the standard practical set, not a full a11y-tree walk. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalConventions(onClose: () => void): {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  onScrimClick: (e: ReactMouseEvent<HTMLElement>) => void;
} {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Latest-callback ref so the document listener (bound once) never
  // closes over a stale onClose -- same pattern as the app's other
  // long-lived listeners.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const dialog = dialogRef.current;
    if (dialog) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialog).focus();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const els = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        const inside = dialogRef.current.contains(active);
        if (e.shiftKey && (active === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      prev?.focus?.();
    };
  }, []);

  const onScrimClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) onCloseRef.current();
  };

  return { dialogRef, onScrimClick };
}
