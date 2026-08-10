# REQ-0377 — Release polish pass (P2 checklist bundle)

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.
BUNDLE REQ: independent small items. Per the board convention, split into
REQ-0377a/b/... files the moment items diverge in status.

## Origin
UI gap analysis 2026-08-10 (Cowork). The P2 band — pre-release checklist.

## Items
1. **Friends rail entry** — a permanent "coming soon" PlaceholderPage occupies
   a 9-slot main nav (`Nav.tsx` NAV_ITEMS; `PlaceholderPage`). Decision at
   build: hide until implemented, or disabled entry + "soon" chip. Either
   beats today's dead door.
2. **Title footer build identity** — no version/build identifier anywhere
   (verified: landing shows copyright only) and no news/patch-notes link.
   Inject the short commit hash at build (vite define) into the landing
   footer; add a patch-notes link (a static `web/` page is enough to start).
   Bug reports currently cannot name a build.
3. **Theme the sign-in controls** — "Continue with Discord" / "Play as guest"
   render as untheme d default buttons (live screenshot evidence 2026-08-10,
   signed-out Settings). First thing a new player clicks; apply the MJOLNIR
   button primitives (`theme/mjolnir.css`). Same for the landing sign-in row.
4. **UI scale setting** — Accessibility block gains a text/UI scale toggle
   (S/M/L) driven by the mjolnir text-scale tokens; persists like other
   client prefs.
5. **Board zoom on small screens** — below the 840px layout the fixed-scale
   Pixi boards get small cells; add a two-step zoom toggle on the board
   stage. NOTE: verify Pixi resolution/crispness cost first — if non-trivial,
   this item becomes a spike before a feature.
6. **Replay niceties** — click-seek exists (`Monitor.tsx` onScrubClick); add
   drag-scrub on the progress bar and feed-row click → seek to that event's
   time.
7. **Account data controls** — no export or delete-account path exists.
   Export = download of the profile JSON via existing reads; delete = new
   server route + storage cascade + confirm flow. Largest item; expected to
   split out. Prerequisite thinking for Steam (draft REQ-0118b) and any
   public release.
8. **Market anchor history sparkline** — needs settlement-history retention;
   decide retention alongside item 7's storage review. (REQ-0375 shipped
   sort; this is the follow-up depth.)
9. **OPEN DECISION — EN nav label 'Backpacks'** — the hall is Canvas +
   Inventory; EN 'Backpacks' undersells it (ja 編成 is fine). Any rename must
   move the e2e EN-label click contract in the same change. User call
   required; parked here so it is not lost.

## Gates
Per item at build time; the bundle is DONE only when every shipped item's e2e
is green and unshipped items have been split to their own REQs. CI green
throughout.

## Out of scope
Anything P0/P1 (owned by REQ-0366..0376), balance, content.
