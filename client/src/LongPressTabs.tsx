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
// still" from "the user is dragging this tab element around", though tabs
// themselves are never drag sources here) cancels the timer (so a
// press-drag never triggers rename); pointerup BEFORE the timer fires
// clears the timer and performs the normal switch (matching the task
// spec's "click switches on pointerup before threshold" -- the switch
// itself only ever happens from the pointerup handler, never from
// pointerdown, so a long-press that eventually fires the rename timer has
// already had its pointerup happen-or-not be irrelevant: once armed, the
// rename UI takes over and the switch never fires for that gesture).
import { useEffect, useRef, useState } from 'react';

const LONG_PRESS_MS = 600;
const MOVE_TOLERANCE_PX = 8;

export interface LongPressTabsProps {
  count: number;
  names: string[];
  active: number;
  onSwitch: (index: number) => void;
  onRename: (index: number, name: string) => void;
  className: string; // e.g. 'inv-tabs' | 'preset-tabs'
  tabClassName: string; // e.g. 'inv-tab' | 'preset-tab'
  activeClassName: string; // e.g. 'inv-tab-active' | 'preset-tab-active'
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
}: LongPressTabsProps) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const handlePointerDown = (index: number) => (e: React.PointerEvent) => {
    if (renaming !== null) return; // another tab is mid-rename; ignore
    longPressFiredRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    clearTimer();
    timerRef.current = setTimeout(() => armRename(index), LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || timerRef.current === null) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) clearTimer();
  };

  const handlePointerUp = (index: number) => () => {
    const fired = longPressFiredRef.current;
    clearTimer();
    startRef.current = null;
    if (!fired) onSwitch(index);
  };

  const handlePointerLeave = () => {
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
    <div className={className} role="tablist">
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
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`${tabClassName}${i === active ? ' ' + activeClassName : ''}`}
            onPointerDown={handlePointerDown(i)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp(i)}
            onPointerLeave={handlePointerLeave}
          >
            {names[i] ?? i + 1}
          </button>
        );
      })}
    </div>
  );
}
