// client/src/schedule/useListMultiSelect.ts -- REQ-0090: a reusable
// multi-select interaction for linearly-ordered DOM list pickers (NOT the
// spatial Pixi inventory board -- "index" only has an unambiguous meaning
// for a flat list; see REQ-0090's doc for why the board is out of scope).
// Colocated here next to its first consumer (DismantlePanel.tsx) the same
// way dex/ShapeGrid.tsx is colocated near ITS first consumer and imported
// cross-folder by later ones (DismantlePanel itself does this today) --
// this codebase has no dedicated hooks/ or common/ folder, so a future
// second consumer (e.g. market/SellPane.tsx) is expected to import this
// file directly from schedule/, same pattern.
//
// Exactly three interactions, per REQ-0090's explicit (and deliberately
// non-OS-standard) spec -- implement precisely as specified, do not
// "correct" the Ctrl/Shift roles to match Explorer/Finder convention:
//   - Plain mousedown (no modifier): CLEARS the selection, selects just
//     this row, and arms drag-add. Doubles as the plain-click case (a
//     mousedown+mouseup with no movement in between is just this).
//   - Mouse held down + entering other rows while armed: each entered row
//     is ADDED to the selection (pure-additive -- re-entering an already-
//     selected row is a no-op, it does NOT toggle off; see REQ-0090
//     [USER] #2, this is the documented default pending further input).
//   - Shift+mousedown: ADDS just this one row to the current selection
//     (does not clear anything else). Does not arm drag-add.
//   - Ctrl+mousedown: selects the inclusive index RANGE between the
//     current anchor and this row, ADDED to the current selection (does
//     not clear anything outside the range). No modifier click in this
//     model ever clears except the plain one. If there is no anchor yet
//     (e.g. the very first interaction on a fresh mount), falls back to a
//     plain single-select of this row (REQ-0090 [USER] #3 default).
//
// Anchor policy: the anchor moves to the most-recently-interacted index
// after EVERY case above (including after a Ctrl+Click's own endpoint) --
// so repeated Ctrl+Clicks chain ("next range starts where the last one
// ended") rather than always ranging from one fixed, sticky point the way
// Explorer's Shift+Click does. Not pinned down explicitly by REQ-0090;
// this is the simpler of the two reasonable readings and is called out in
// the REQ's outcome notes.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ListMultiSelectHandlers {
  onRowMouseDown: (index: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean }) => void;
  onRowMouseEnter: (index: number) => void;
}

export interface UseListMultiSelectResult {
  selected: Set<string>;
  isSelected: (key: string) => boolean;
  clear: () => void;
  handlers: ListMultiSelectHandlers;
}

export function useListMultiSelect<T>(items: T[], keyOf: (item: T) => string): UseListMultiSelectResult {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Refs, not state -- these drive imperative decisions inside event
  // handlers and must never lag a render behind (the mouseenter stream
  // during a drag can fire many times before React re-renders).
  const anchorRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;

  const keyAt = useCallback((index: number): string | undefined => {
    const it = itemsRef.current[index];
    return it === undefined ? undefined : keyOfRef.current(it);
  }, []);

  // Disarm on mouseup ANYWHERE (not just over a row) -- releasing the
  // button outside the list, or over a gap between rows, must still end
  // the drag. A plain window listener (not per-row) is the only way to
  // reliably observe this, same reasoning as DismantlePanel's own
  // window-level Escape-key listener.
  useEffect(() => {
    function onUp() {
      armedRef.current = false;
    }
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  // The item list can change identity out from under an in-progress
  // selection (e.g. a confirm removed some rows) -- drop any selected key
  // that no longer resolves to a live row so a stale key can never linger
  // and silently get re-included in a later action.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(items.map((it) => keyOf(it)));
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (live.has(k)) {
          next.add(k);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Only re-validate when the item SET actually changes; keyOf is
    // expected to be referentially stable enough not to matter here (same
    // posture as every other derived-from-items memo in this codebase).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
    armedRef.current = false;
  }, []);

  const onRowMouseDown = useCallback(
    (index: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean }) => {
      const key = keyAt(index);
      if (key === undefined) return;

      if (e.shiftKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
        anchorRef.current = index;
        armedRef.current = false;
        return;
      }

      if (e.ctrlKey) {
        const anchor = anchorRef.current;
        if (anchor === null) {
          setSelected(new Set([key]));
        } else {
          const lo = Math.min(anchor, index);
          const hi = Math.max(anchor, index);
          setSelected((prev) => {
            const next = new Set(prev);
            for (let i = lo; i <= hi; i++) {
              const k = keyAt(i);
              if (k !== undefined) next.add(k);
            }
            return next;
          });
        }
        anchorRef.current = index;
        armedRef.current = false;
        return;
      }

      // Plain mousedown: clear + select just this row, arm drag-add.
      setSelected(new Set([key]));
      anchorRef.current = index;
      armedRef.current = true;
    },
    [keyAt]
  );

  const onRowMouseEnter = useCallback(
    (index: number) => {
      if (!armedRef.current) return;
      const key = keyAt(index);
      if (key === undefined) return;
      setSelected((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    },
    [keyAt]
  );

  const isSelected = useCallback((key: string) => selected.has(key), [selected]);

  return { selected, isSelected, clear, handlers: { onRowMouseDown, onRowMouseEnter } };
}
