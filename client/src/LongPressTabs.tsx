// Shared tab-row component with long-press-to-rename — REQ-0031 Phase B.
// Used by BOTH the inventory page tabs and the canvas preset tabs (same
// interaction contract for both tab kinds per the task spec: "LONG-PRESS
// (~600ms pointerdown hold, no move) on an inventory tab or preset tab ->
// inline rename ... Normal click still switches (click switches on
// pointerup before threshold)").
//
// Interaction model: a plain click (pointerdown -> pointerup with no long
// hold and no rename armed) switches to that tab, exactly like the old
// Tabs.tsx button onClick. A pointerdown that is held for
// LONG_PRESS_MS (~600ms) WITHOUT the pointer moving past a small
// tolerance arms rename mode for that tab instead: the label is replaced
// by a text input (pre-filled with the current name, auto-focused +
// selected). Enter or blur commits the new name via `onRename`; Escape
// cancels (reverts to the tab label, no engine call). While rename mode
// is armed for a tab, that tab's own click-to-switch is suppressed (the
// rename input's own click doesn't bubble to a tab-switch), but every
// OTHER tab keeps switching normally.
//
// Long-press vs click disambiguation: pointerdown starts a timer AND
// records the start position; pointermove past a small tolerance (8px --
// generous enough to absorb a shaky touch/mouse hold without accidentally
// treating it as a drag, tight enough to still distinguish "holding
// still" from "the user is dragging this tab element around") cancels the
// timer (so a press-drag never triggers rename); pointerup BEFORE the
// timer fires clears the timer and performs the normal switch (matching
// the task spec's "click switches on pointerup before threshold" -- the
// switch itself only ever happens from the pointerup handler, never from
// pointerdown, so a long-press that eventually fires the rename timer has
// already had its pointerup happen-or-not be irrelevant: once armed, the
// rename UI takes over and the switch never fires for that gesture).
//
// REQ-0032 addition -- drag-to-reorder, THREE-way gesture disambiguation:
// the same pointerdown arms BOTH the LONG_PRESS_MS timer above AND a drag
// watch. Whichever fires first wins:
//   - pointer moves past MOVE_TOLERANCE_PX BEFORE the long-press timer
//     fires -> cancels the timer (exactly as before) AND, new in
//     REQ-0032, enters DRAG mode instead of doing nothing: `dragFrom` is
//     set to this tab's index, tabDrag.ts's shared broadcast is armed
//     (kind:'preset'|'inv' per this instance's `kind` prop -- this is
///    what lets App.tsx show the trash-drop-zone ONLY for preset drags),
//     and every subsequent pointermove (listened on `window`, since the
//     pointer can leave the originating tab's own DOM element mid-drag)
//     recomputes which GAP between tabs the dragged tab should land in
//     (dragOverGap), rendered as a thin highlighted insertion indicator
//     between the two neighboring tabs.
//   - pointer stays put past LONG_PRESS_MS -> arms rename (unchanged from
//     REQ-0031 Phase B); drag never engages for this gesture since the
//     move-threshold was never crossed.
//   - pointerup before either threshold -> plain click, switches tabs
//     (unchanged).
// On drop (pointerup while dragFrom is set): if a preset-kind drag was
// released over the trash-drop-zone (hit-tested via
// document.elementFromPoint against the zone's own DOM node, found by
// data-tab-trash-zone attribute -- decoupled from this component's own
// subtree since the zone renders elsewhere, over the Canvas board), calls
// `onDeletePreset` instead of reordering; otherwise, if a valid
// destination gap was tracked, calls `onReorder(dragFrom, destIndex)`.
// Either way, tabDrag.ts's broadcast is cleared immediately so the trash
// overlay disappears the instant the drag ends (drop or cancel via
// pointerleave/pointercancel), never lingering.
import { useEffect, useRef, useState } from 'react';
import { setTabDragState } from './tabDrag';

const LONG_PRESS_MS = 600;
const MOVE_TOLERANCE_PX = 8;
const TRASH_ZONE_SELECTOR = '[data-tab-trash-zone]';

export interface LongPressTabsProps {
  count: number;
  names: string[];
  active: number;
  onSwitch: (index: number) => void;
  onRename: (index: number, name: string) => void;
  className: string; // e.g. 'inv-tabs' | 'preset-tabs'
  tabClassName: string; // e.g. 'inv-tab' | 'preset-tab'
  activeClassName: string; // e.g. 'inv-tab-active' | 'preset-tab-active'
  /** REQ-0032: which tab kind this is -- gates the trash-drop-zone (ONLY
   * 'preset' drags ever broadcast a trash-eligible drag state) and is
   * forwarded verbatim into tabDrag.ts's shared state. */
  kind: 'preset' | 'inv';
  /** REQ-0032: commits a drag-to-reorder (0-based from/to, same splice-out
   * /splice-in semantics as the engine's reorderPreset/reorderInvPage). */
  onReorder: (from: number, to: number) => void;
  /** REQ-0032: called instead of onReorder when a PRESET tab is dropped
   * onto the trash-drop-zone. Absent/unused for kind==='inv' (inventory
   * tabs never render a trash zone, so this path is never reachable for
   * them regardless). */
  onDeletePreset?: (index: number) => void;
}

export function LongPressTabs({
  count,
  names,
  active,
  onSwitch,
  onRename,
  className,
  tabClassName,
  activeClassName,
  kind,
  onReorder,
  onDeletePreset,
}: LongPressTabsProps) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOverGap, setDragOverGap] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);
  const draggingIndexRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (renaming !== null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const armRename = (index: number) => {
    longPressFiredRef.current = true;
    setDraft(names[index] ?? '');
    setRenaming(index);
  };

  // Computes which GAP (0..count, gap i sits BEFORE tab i; gap `count`
  // sits after the last tab) the pointer's current x-position is closest
  // to, by comparing against each tab button's own midpoint -- this is
  // what drives both the destination index on drop AND the live
  // insertion-indicator highlight while dragging.
  const gapForClientX = (clientX: number): number => {
    const row = rowRef.current;
    if (!row) return draggingIndexRef.current ?? 0;
    const buttons = Array.from(row.querySelectorAll<HTMLElement>(`.${tabClassName}`));
    let gap = buttons.length;
    for (let i = 0; i < buttons.length; i++) {
      const r = buttons[i].getBoundingClientRect();
      const mid = r.left + r.width / 2;
      if (clientX < mid) {
        gap = i;
        break;
      }
    }
    return gap;
  };

  const isOverTrashZone = (clientX: number, clientY: number): boolean => {
    if (kind !== 'preset') return false;
    const el = document.elementFromPoint(clientX, clientY);
    return !!(el && el.closest(TRASH_ZONE_SELECTOR));
  };

  const endDrag = () => {
    draggingIndexRef.current = null;
    setDragFrom(null);
    setDragOverGap(null);
    setTabDragState(null);
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerUp);
  };

  const handleWindowPointerMove = (e: PointerEvent) => {
    if (draggingIndexRef.current === null) return;
    setDragOverGap(gapForClientX(e.clientX));
  };

  const handleWindowPointerUp = (e: PointerEvent) => {
    const from = draggingIndexRef.current;
    if (from === null) {
      endDrag();
      return;
    }
    if (isOverTrashZone(e.clientX, e.clientY)) {
      endDrag();
      if (kind === 'preset' && onDeletePreset) onDeletePreset(from);
      return;
    }
    const gap = gapForClientX(e.clientX);
    endDrag();
    // Translate an insertion GAP into a splice destination index: dropping
    // into gap g means "this tab should end up at index g" if g<=from, or
    // "at index g-1" if g>from (since removing `from` first shifts every
    // later gap left by one) -- exactly the semantics reorderPreset/
    // reorderInvPage's splice(from,1)+splice(to,0,item) already implement.
    const to = gap > from ? gap - 1 : gap;
    if (to !== from) onReorder(from, to);
  };

  const enterDrag = (index: number) => {
    draggingIndexRef.current = index;
    setDragFrom(index);
    setDragOverGap(index);
    setTabDragState({ kind, from: index });
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
  };

  const handlePointerDown = (index: number) => (e: React.PointerEvent) => {
    if (renaming !== null) return; // another tab is mid-rename; ignore
    longPressFiredRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    timerRef.current = setTimeout(() => armRename(index), LONG_PRESS_MS);
    // Without explicit pointer capture, a pointermove that jumps past this
    // button's own (small, ~30px-tall) bounding box on its VERY FIRST
    // synthetic move event gets delivered to whatever element is now
    // under the cursor instead of back to this button -- React's
    // onPointerMove on THIS element then never fires at all for that
    // gesture, so the 8px drag threshold below is silently never checked
    // (confirmed via E2E: a fast multi-step drag toward a distant target,
    // e.g. the trash zone, could skip past the button's own bounds on
    // step 1 and never arm drag mode). setPointerCapture pins every
    // subsequent pointer event for this pointerId back to this element
    // regardless of visual cursor position, exactly matching how a real
    // press-and-drag gesture is expected to behave.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (index: number) => (e: React.PointerEvent) => {
    if (draggingIndexRef.current !== null) return; // window listener owns drag-in-progress moves
    if (!startRef.current || timerRef.current === null) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) {
      clearTimer();
      enterDrag(index);
    }
  };

  const handlePointerUp = (index: number) => () => {
    if (draggingIndexRef.current !== null) return; // window pointerup handler owns drag commits
    const fired = longPressFiredRef.current;
    clearTimer();
    startRef.current = null;
    if (!fired) onSwitch(index);
  };

  const handlePointerLeave = () => {
    if (draggingIndexRef.current !== null) return; // once dragging, only the window listeners matter
    clearTimer();
    startRef.current = null;
  };

  const commit = (index: number) => {
    const trimmed = draft.trim();
    if (trimmed) onRename(index, trimmed);
    setRenaming(null);
  };

  const cancel = () => setRenaming(null);

  return (
    <div className={className} role="tablist" ref={rowRef}>
      {Array.from({ length: count }, (_, i) => {
        if (renaming === i) {
          return (
            <input
              key={i}
              ref={inputRef}
              className={`${tabClassName} ${tabClassName}-rename-input`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(i);
                else if (e.key === 'Escape') cancel();
              }}
            />
          );
        }
        const isDragSource = dragFrom === i;
        const showGapBefore = dragFrom !== null && dragOverGap === i && dragOverGap !== dragFrom && dragOverGap !== dragFrom + 1;
        const showGapAfter =
          dragFrom !== null && i === count - 1 && dragOverGap === count && dragOverGap !== dragFrom + 1;
        return (
          <div key={i} className="tab-drop-gap-wrap">
            {showGapBefore ? <span className="tab-drop-gap" /> : null}
            <button
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`${tabClassName}${i === active ? ' ' + activeClassName : ''}${isDragSource ? ' tab-dragging' : ''}`}
              onPointerDown={handlePointerDown(i)}
              onPointerMove={handlePointerMove(i)}
              onPointerUp={handlePointerUp(i)}
              onPointerLeave={handlePointerLeave}
              // REQ-0041: lets external code (WarehouseTab.tsx's claim
              // flow) find a SPECIFIC inventory tab button by index (via
              // a plain DOM query, e.g. `[data-tab-kind="inv"][data-tab-
              // index="2"]`) to apply a brief CSS pulse animation when an
              // auto-claimed item lands on a page OTHER than the
              // currently-open one -- a lightweight, additive attribute;
              // no existing behavior of this shared component changes.
              data-tab-kind={kind}
              data-tab-index={i}
            >
              {names[i] ?? i + 1}
            </button>
            {showGapAfter ? <span className="tab-drop-gap" /> : null}
          </div>
        );
      })}
    </div>
  );
}
