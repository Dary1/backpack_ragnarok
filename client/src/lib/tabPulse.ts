// client/src/lib/tabPulse.ts -- REQ-0145b (cb): canonical home of the
// cross-page inv-tab pulse helper, previously duplicated byte-for-byte
// in warehouse/WarehousePage.tsx and schedule/WorkshopPage.tsx (the
// WorkshopPage copy even documented itself as a "byte-for-byte copy").
// Both call sites now import from here; future pages should too.

export const TAB_PULSE_MS = 1600; // >= the 3-cycle CSS animation's own 0.5s*3 duration, plus margin

/** Briefly applies the tab-claim-pulse CSS class (see index.css) to the
 * inv-tab button at `pageIndex`, found via LongPressTabs.tsx's
 * data-tab-index attribute -- a plain DOM query rather than plumbing a
 * "pulsing page index" prop through Tabs.tsx/LongPressTabs.tsx (both
 * shared with the squad-tabs use of the same component), matching the
 * original REQ-0041 preference for additive, minimally-invasive hooks. */
export function pulseTab(pageIndex: number): void {
  const el = document.querySelector<HTMLElement>(`[data-tab-kind="inv"][data-tab-index="${pageIndex}"]`);
  if (!el) return;
  el.classList.remove('tab-claim-pulse');
  // Force a reflow so re-adding the class restarts the animation even if
  // a previous pulse on the SAME tab hasn't finished clearing yet.
  void el.offsetWidth;
  el.classList.add('tab-claim-pulse');
  setTimeout(() => el.classList.remove('tab-claim-pulse'), TAB_PULSE_MS);
}
