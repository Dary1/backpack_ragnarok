# REQ-0377 — Release polish pass (P2 checklist bundle)

## Status
todo -> (pending gates) — spec by Cowork session 2026-08-10 (gamer-lens UI gap
analysis batch); ratified by user 2026-08-10, chat:
「では、それらを全て、TODOのREQとして書き出してください」.
Built by Cowork session 2026-08-11 on branch/worktree
`req-0377-release-polish-pass`, user directive「全9項目を一気に実装」.

BUNDLE REQ. Two items diverged in status during the build and were split per
this file's own rule; the other seven shipped together here:

| | |
|---|---|
| **REQ-0377a** | account DELETE cascade (item 7's second half) — `todo` |
| **REQ-0377b** | SPIKE: resolution-aware Pixi boards (item 5's crispness half) — `todo` |

## Origin
UI gap analysis 2026-08-10 (Cowork). The P2 band — pre-release checklist.

---

## Binding decisions taken during the build

### D1 (user, 2026-08-11) — item 1: HIDE Friends, do not disable it
Asked as the item itself required. Chosen: remove it from `NAV_ITEMS`. The
`'#/friends'` route and its `PlaceholderPage` are KEPT, so reviving the entry is
a one-line revert and existing deep links still resolve.

### D2 (user, 2026-08-11) — item 9: EN nav label `Backpacks` -> `Squad`
Candidates were drawn from code, not invented: `Squad` (the engine's own name
for the canvas owner — REQ-0123 terminology, `shared/engine.d.ts` "One squad's
canvas snapshot"), `Builder` (already in EN copy: `schedule.board.goBackpacks`
= "To builder →"), `Loadout` (genre-standard, but present nowhere in this
codebase). User chose **Squad**. The ja label 編成 is unchanged.

Scope of the rename, decided here: the rail label, PLUS the EN copy that names
the SCREEN (`sortie.shelf.*`, `schedule.slots.*`, `workshop.rule*`,
`shortcuts.*`). Copy that names the BP PIECES — `ragnarok.devotion.step1d`,
`ragnarok.blast.bps`, `ragnarok.done.body` ("Its Backpacks, items and forms are
sealed") — is deliberately untouched: those are backpacks, not the hall.
The e2e EN-label click contract moved in the same commit, as the item demanded:
`nav-routing`, `board-render-ondemand`, `canvas-chrome`, `canvas-undo`,
`input-conventions`.

### D3 (build) — item 2: the build id is SERVED, not baked into the bundle
**This overrides the item's stated approach and is the most important decision
in this REQ.** The brief said "inject the short commit hash at build (vite
define) into the landing footer". Doing that would re-arm the exact defect
REQ-0341 exists to remove — a TRACKED artifact (`web/app`) whose bytes vary
with an untracked input — which shipped dead sign-in TWICE (REQ-0266,
REQ-0337). `server/routes/public.cjs` states the rule in place, for REQ-0344:
*"Served, not built in. web/app is a TRACKED build artifact; REQ-0341 exists
because making its bytes depend on env is how sign-in shipped broken TWICE."*
It would additionally falsify `tools/release.sh`'s written premise for
re-issuing its CI receipt — *"since REQ-0341 the bundle is a pure function of
client/src"* — which that file explicitly says must go if it stops being true.

So: `server/lib/meta.cjs` resolves the short sha ONCE at process load (degrading
to `'unknown'`, never throwing), and `GET /api/health` returns it. The landing
footer fetches it. The main checkout @ master IS live and serves `web/app` and
the API from one tree, so the API's HEAD is the identity of what is served.

Placed on `/api/health` rather than `/api/config` on purpose: health is already
the service-identity endpoint, and `/api/config`'s body is asserted with
`deepStrictEqual` in three places precisely so it stays byte-for-byte what
REQ-0341 shipped — REQ-0344 leaned on that guard and an always-present field
there would spend it.

### D4 (build) — item 4: one `zoom`, not the text tokens
The brief said "driven by the mjolnir text-scale tokens". Those scales are real
(246 `.t-*` call sites) but they are not the whole app — every pre-MJOLNIR
surface in `styles/base.css` still sets px font-size directly. Driving only the
tokens would grow SOME of the text on a screen and leave the rest, which is
worse than not offering the setting. The scale is instead applied once, as
`body { zoom: var(--ui-scale) }`, which reaches every surface. `zoom` is not
novel here: `styles/canvas.css` has shipped `zoom: 0.75` on the board stage
since REQ-0140. Default 'm' == 1.0, so an untouched install and every e2e run
render byte-identically to before.

### D5 (build) — item 5: the toggle ships, the crispness does not
The item's own NOTE required verifying the Pixi resolution cost first. Done, and
recorded in REQ-0377b: `BoardRenderer.mount()` passes no `resolution`, so every
board is ALREADY upscaled on every HiDPI display. Zoom makes an existing
softness more visible rather than creating it, so the toggle ships; making the
boards resolution-aware changes render characteristics app-wide and is split to
a spike, exactly as the NOTE instructed.

Hit-testing needed no change: `board/geom.ts`'s `clientToLocal` derives its
scale from `getBoundingClientRect()`, which `zoom` moves — which is why the
shipped 0.75 rule never broke drags. The two scale factors now MULTIPLY
(`--board-fit` × `--board-zoom`) instead of one `zoom` declaration silently
overwriting the other.

### D6 (build) — item 8: retention is 12, and it is not item 7's question
`DEX_PRICE_HISTORY_MAX` 5 -> 12 (`server/services/market/lib.cjs`). Five was
chosen when the only consumer read `entries[0]`; a sparkline reads the series,
and with the per-TM filter applied five can leave two or three usable points.
Cost is ~90 bytes per entry in one per-item jsonb doc. It is a ROLLING slice, so
existing docs converge with no migration.

The REQ text suggested deciding this "alongside item 7's storage review". They
never actually met: item 7 is about deleting a PLAYER's data, and the dex price
history is per-ITEM and carries no player id — a settled price is market
history, not personal data. Recorded so the coupling is not re-inferred later.

### D7 (build) — item 7 splits at export/delete
Export shipped (composes the two reads the app already makes; no new endpoint).
Delete did not, and the reason is structural rather than a size estimate:
`server/migrations/001_init.sql` states there are no DELETE-cascading FKs
between player tables, so the cascade must be hand-written across ~15 roots ×
2 backends, with four open product decisions. Full inventory and decisions in
REQ-0377a. No delete control is rendered — an inert one would be the same dead
door item 1 just removed from the rail.

---

## What shipped, per item

1. **Friends rail entry** — removed from `Nav.tsx`'s `NAV_ITEMS`; route +
   `PlaceholderPage` kept. (D1)
2. **Title footer build identity** — `GET /api/health` gains `build`;
   `client/src/api/meta.ts` + landing footer render it; `web/notes/index.html`
   is the patch-notes page, linked from the footer and from `web/index.html`.
   (D3)
3. **Themed sign-in controls** — `.settings-discord-btn` / `-guest-btn` /
   `-link-btn` had NO CSS rule anywhere and rendered as browser-default chrome;
   they now carry `.btn` / `.btn-forge`. The landing sign-in row's bespoke rule
   is reduced to a size override over the same primitive.
   `.settings-signout-btn` is deliberately left alone: it is not a sign-IN
   control and its red border carries meaning.
4. **UI scale** — `a11y/scalePrefs.ts` (mirrors `motionPrefs.ts` exactly) +
   an S/M/L `role=radiogroup` in the Accessibility block. (D4)
5. **Board zoom** — `board/BoardZoom.tsx` + `boardZoomPrefs.ts`, in the
   boardfoot, CSS-hidden above 840px. (D5)
6. **Replay niceties** — the transport bar drags (pointer events +
   `setPointerCapture`; `touch-action: none`, without which the browser claims
   a horizontal touch drag and the move stream dies), and every feed row is a
   real `<button>` that seeks to its own event time. Both guarded on `settled`:
   seeking a live run would fight `useRunPlayhead`'s deliberate 2.5s cadence.
7. **Account data controls** — export only. (D7 / REQ-0377a)
8. **Market anchor sparkline** — `historyFor()` + `AnchorSparkline` in
   `market/priceCarve.tsx`, rendered by both `CarveAnchor` call sites
   (SellPane, warehouse SellModal). Renders nothing below two points: one point
   is not a trend, and a flat stub would imply a stability the data does not
   show. Direction is carried by shape + aria-label, never colour alone
   (REQ-0143). (D6)
9. **EN nav label** — `Backpacks` -> `Squad`. (D2)

## Gates
<!-- filled in by the build session after the run; see the execution log below -->
PENDING — `tools/ci.sh` (CI_SCOPE=both) queued behind six concurrent worktree
runs on the box CI lock.

## Out of scope
Anything P0/P1 (owned by REQ-0366..0376), balance, content.
