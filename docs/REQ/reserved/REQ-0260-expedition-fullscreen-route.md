# REQ-0260 — expedition-fullscreen-route: `#/expedition`, the full-screen battle shell

**Status:** draft — spec written, BLOCKED on user review. Three things need the user before work may
start: (1) §9.4 — playing the sim clock 1:1 makes the full-screen battle END BEFORE the room frees,
because REQ-0240 made room occupancy the PRESENTATION duration; the two clocks cannot both be
obeyed and the user must pick; (2) §9.2 — ruling C4 is NOT implementable as a client-only change,
because the pacing gate is on the WIRE (server-side), so this REQ must add a server seam; (3) §7.3 —
ruling Q3 as literally worded ("landscape → side-by-side") is arithmetically wrong on a real, common
viewport (1280x1024), and this REQ proposes the exact threshold instead.
**Reserved:** 2026-07-18
**Slug:** expedition-fullscreen-route
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — spec items (a), (d), (e) and rulings Q3 / C4.
**Depends on:** REQ-0255 (expedition-merge-baseline) — HARD. The 全画面 button lives on REQ-0240's
monitor header, which is unmerged; §9 depends on REQ-0240's pacing layer and on `run.simDurationSecs`,
which exists only on that branch.
**Blocks:** REQ-0261 (expedition-formation-render), and through it REQ-0262 / REQ-0263.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q3, §3 C4, §3 C5, §6.

## 1. Goal

Stand up the **shell**: a new route `#/expedition`, reachable by a 全画面 button on the existing
Battle Monitor, that owns the whole viewport and hosts two 26x18 planes at logical CELL=40 —
orientation chosen from the viewport, uniformly fit-scaled, no scrolling, playing the SIM clock.

This REQ delivers the **shell only**: route, deep link, mount discipline, orientation, fit-scale
transform, clock seam, chrome. **It draws two empty planes.** Everything inside them —
squads, instances, rays, HP, cooldowns — is REQ-0261/0262/0263. That split is deliberate: the
geometry decisions below (§7, §8) are provable arithmetic and can be reviewed on their own; the
rendering decisions are art-and-data decisions and cannot.

The existing small monitor is **UNTOUCHED** except for one added button. The user: 「今ある画面は放置して」.

## 2. Verified current state — I read every one of these

| fact | source | evidence |
|---|---|---|
| `Route` is a union of 12 members | `client/src/store/core.ts:105-118` | `export type Route = 'landing' \| 'backpacks' \| … \| 'contentadmin';` |
| `VALID_ROUTES` is a SEPARATE array | `client/src/store/core.ts:120` | `const VALID_ROUTES: Route[] = ['landing', …, 'contentadmin'];` — a second, hand-maintained list |
| unknown hash → `'backpacks'` | `client/src/store/core.ts:143-147` | `routeFromHash()`: `return (VALID_ROUTES as string[]).includes(raw) ? (raw as Route) : 'backpacks';` |
| deep links are regex, checked BEFORE `routeFromHash` | `client/src/store/routing.ts:150-172` | `INVITE_HASH_RE` → `DEX_ITEM_HASH_RE` → `CONTENTADMIN_HASH_RE` → `ARTADMIN_HASH_RE` → `MARKET_SELL_HASH_RE` → else `routeFromHash` |
| the backpacks view is never unmounted | `client/src/App.tsx:198` | `<div className={`backpacks-view${route === 'backpacks' ? '' : ' route-hidden'}`}>` |
| `.route-hidden` is `display:none` | `client/src/styles/base.css:691` | `.route-hidden { display: none; }` |
| chrome already hides per-route | `client/src/App.tsx:177-183` | `const onLanding = route === 'landing';` gates `<Nav>` + `<Header>` |
| the rail is a curated list, not "every route" | `client/src/Nav.tsx:44-52` | `NAV_ITEMS` has 9 entries; `artadmin`/`contentadmin` are routes with NO rail entry |
| Monitor is keyed by ROOM, not run | `Monitor.tsx` (0240) `:57-70` | `interface MonitorProps { room: ApiRoom; … }`; `fetchRun(room.id)` |
| the run view is fetched by ROOM id | `client/src/api/schedule.ts:93` | `export function fetchRun(roomId: string): Promise<ApiRunView>` |
| `durationSecs` is the PRESENTATION duration | `server/services/runs.cjs:125-130` (0240) | `durationSecs: paced.durationSecs` + *"the room is occupied for as long as the paced replay lasts"* |
| the SIM duration is stored but NOT served | `server/services/runs.cjs:142` (0240) | `simDurationSecs: computeDurationSecs(result.events)` — in the run DOC; absent from `ApiRunView` |
| the pacing gate is on the WIRE | `server/services/runs.cjs:28-36` + `pacing.cjs:183-203` (0240) | `visibleEvents()` → `decorateVisible(run, clock.elapsedSecs)` → `if (visSecs > elapsedSecs) continue;` |
| `setLayout` exists and flips row/column | `MonitorRenderer.ts:207-218` (0240) | `setLayout(layout: 'row'\|'column')` moves `enemyField` + `renderer.resize(...)` |
| `geom.ts` CELL/PAD | `client/src/board/geom.ts:56-57` | `export const CELL = 80;` / `export const PAD = 38;` |
| reduced-motion is app-owned | `client/src/a11y/motionPrefs.ts:116` | `export function getReducedMotion(): boolean` (REQ-0143); `main.tsx:15` calls `initMotionPrefs()` |

## 3. Route wiring

### 3.1 The two lists — both widen, or it is a bug

`client/src/store/core.ts` carries the route set **twice**: once as a TypeScript union (compile
time) and once as a runtime array. They are not derived from each other.

```ts
export type Route = … | 'contentadmin';                                        // :105-118
const VALID_ROUTES: Route[] = ['landing', …, 'contentadmin'];                    // :120
```

Both gain `'expedition'`. Widening ONLY the union type-checks and then dead-ends: `routeFromHash('#/expedition')`
asks `VALID_ROUTES.includes('expedition')`, gets `false`, and returns `'backpacks'` — the route silently
does not exist, with no error anywhere. Widening ONLY the array fails `tsc` at the `as Route` cast.
The first failure mode is the dangerous one: it is silent.

> This is PROJECT.md's **"a gate that watches one half of a rule watches none of it"** in its
> smallest possible form — two halves of one fact, four lines apart, joined by nothing but
> discipline. This REQ does not fix that (deriving `VALID_ROUTES` from the union needs a const-tuple
> refactor that touches every route consumer, and that is not this REQ's job); it records it, and
> §14 pins it with a test so the NEXT route cannot land half-added.

### 3.2 The deep link — the identity is the ROOM id

`#/expedition` alone is meaningless: the view must know which expedition it is watching. **The
identity to carry is the ROOM id, not the run id.** Evidence, not assumption:

- `Monitor.tsx` (0240) takes `room: ApiRoom` and does `fetchRun(room.id)` — the room id IS the key.
- `client/src/api/schedule.ts:93`: `fetchRun(roomId: string)` → `GET /api/schedule/rooms/:id/run`.
  There is no `GET /api/runs/:runId`. The run is only addressable through its room.
- `room.lastRunId` exists but is only used as a *presence* check (`if (!room.lastRunId) return null`).
- `room.formationId` — which REQ-0261 needs for squad placement — lives on the ROOM, not the run.

So the hash is `#/expedition/<roomId>`, an exact mirror of `DEX_ITEM_HASH_RE`'s `#/dex/<id>` shape,
whose design note in `core.ts:98-104` is the precedent this follows verbatim:

> a deep-link hash carrying an id SEGMENT, distinct from the plain '#/dex' route hash. Checked the
> same way INVITE_HASH_RE is … the route resolves to 'dex' (still a plain Route member, no union
> widening needed) AND dexFocusId is set

Three consequences, each load-bearing:

1. **`EXPEDITION_HASH_RE = /^#\/expedition\/(.+)$/`** in `core.ts`, beside the other four.
2. **A store field `expeditionRoomId: string | null`** + `clearExpeditionRoomId()` in `routing.ts`,
   mirroring `dexFocusId`/`clearDexFocusId()`. **Deviation from the dex precedent, deliberate:** the
   dex focus is a ONE-SHOT (consumed, then cleared, so a later re-render does not re-force a jump).
   The expedition room id is **not** one-shot — it is the view's whole subject and must survive every
   re-render for as long as the route is active. So it is cleared on ROUTE EXIT, not on consumption.
   Say this out loud in the field's doc comment, because a reader who pattern-matches on `dexFocusId`
   will otherwise "fix" it into a one-shot and blank the screen.
3. **Specific-before-generic ordering is mandatory.** `routeFromHash('#/expedition/room_abc')` strips
   `#/` to `expedition/room_abc`, which is not in `VALID_ROUTES`, so it returns **`'backpacks'`**. If
   the regex is checked after the fallback, every expedition deep link lands on the canvas page.
   `routing.ts:150-172` (`initRouting`) and `:174-206` (`onHashChange`) each carry the chain and
   **both** must gain the check — they are two separate copies of the same ladder.

Bare `#/expedition` (no room segment) stays legal and resolves via `VALID_ROUTES` to the route with
`expeditionRoomId === null`. It renders the empty state (§10.3), not a crash. This is what a user
who bookmarks the bare hash, or who lands there after the room is gone, gets.

## 4. REQ-0034 and the new Pixi Application

### 4.1 The rule, quoted

`client/src/App.tsx:21-33`, verbatim:

> REQ-0034 CRITICAL constraint (hard lesson from REQ-0031 Phase A bug 2 — see
> docs/REQ/REQ-0031-e2e-bugfix-squads-ui.md section 2 and docs/REQ/REQ-0034-global-navigation.md):
> the backpacks section (Board + InventoryBoard, each its own PixiJS Application) is rendered
> UNCONDITIONALLY below, exactly like before REQ-0034 — it is NEVER wrapped in
> `{route === 'backpacks' && ...}` or any other conditional that would unmount it. Switching to a
> different nav route only adds `.route-hidden` (display:none, see index.css) to its wrapping
> `<div className="backpacks-view">`; the components themselves, their Pixi Applications, and their
> `<canvas>` elements stay mounted in the DOM at all times. **This is what makes "route away and back
> N times, boards still interactive" hold — there is no remount for a route switch to ever race.**

### 4.2 What the rule actually forbids — read the root cause, not the slogan

The slogan is "always mounted". The **mechanism** is documented at `BoardRenderer.setOps()`
(`BoardRenderer.ts:268-288`), and it is much more specific:

> destroying a PixiJS Application calls `GlContextSystem.destroy()`, which releases the WebGL context
> via the `WEBGL_lose_context` extension's `loseContext()` — per the WebGL spec this is ASYNCHRONOUS
> … InventoryBoard.tsx's old effect called `destroy()` in its cleanup and then, **in the SAME
> effect-flush**, ran a brand new `BoardRenderer.mount()` … before the browser had actually finished
> tearing down the old context. Under this box's software GL path (swiftshader …) that race left the
> driver in a state where every subsequent shader compile failed, which sent PixiJS's
> `checkMaxIfStatementsInShader()` into its `while(true){ compile; if(!ok) maxIfs=maxIfs/2\|0; else
> break; }` loop FOREVER … a real infinite busy-loop, not merely a slow stall.

**The hazard is destroy-then-mount in one flush. It is not "a Pixi Application must exist from boot".**
That distinction is the whole decision below, and reading only the slogan gets it wrong.

### 4.3 The decision: **mount lazily on first visit, then never unmount**

| option | verdict |
|---|---|
| **(a) Always-mounted from boot**, like Board/InventoryBoard | **Rejected.** Costs a WebGL context in every session for a route most sessions never open. Contexts are a hard, small, browser-wide budget (Chrome evicts the least-recently-used past ~16); the app already spends **2** unconditionally (Board, InventoryBoard) **plus one per open room card** (`MonitorRenderer`, `Monitor.tsx:120-135`). A third unconditional context — one that also allocates a 1920x1080-class drawing buffer — to render nothing, on every boot, for a deep-link-only route, is a real cost bought with no benefit. Board/InventoryBoard are always-mounted because they are the BOOT route's content; that is not this route. |
| **(b) Mount per visit, destroy on leave** | **Rejected — this is the REQ-0031 bug.** Route away and back fast enough (or under StrictMode's double-invoke) and destroy+mount land in one flush against the same canvas. This is the exact shape that hung the renderer. |
| **(c) Mount on FIRST visit; keep alive for the App's lifetime; `.route-hidden` on leave** | **ADOPTED.** |

(c) honours REQ-0034 exactly, because the invariant REQ-0034 states is about the **switch**: *"there is
no remount for a route switch to ever race."* Under (c) there is none — after the first mount, every
subsequent enter/leave is a CSS class toggle, identical to `backpacks-view`. The first mount is not a
route switch; it is a cold boot of a surface that did not exist yet, with no old context to race.

**Concretely, in `App.tsx`:**

```
{/* Expedition view: mounted on FIRST visit, then NEVER unmounted (REQ-0034).
    `mountedExpeditionOnce` latches true and never returns to false. */}
{mountedExpeditionOnce ? (
  <div className={`expedition-view${route === 'expedition' ? '' : ' route-hidden'}`}>
    <ExpeditionPage roomId={snapshot.expeditionRoomId} locale={snapshot.locale} />
  </div>
) : null}
```

with `const [mountedExpeditionOnce, setMountedExpeditionOnce] = useState(false)` and an effect that
latches it on `route === 'expedition'`. **The latch is the whole safety property** — a boolean that
only ever goes false→true cannot express the destroy/mount race. `ExpeditionPage` itself follows
`Monitor.tsx`'s proven mount-once shape (`mountedOnce` + `canvasEl` state + `destroy()` only in the
unmount effect), not `Board.tsx`'s (whose effect keys on `snapshot.status === 'ready'`).

**Chrome:** `#/expedition` is full-screen, so it hides the rail and the header, exactly as `landing`
does. `App.tsx:177` becomes:

```ts
// REQ-0069 (landing) + REQ-0260 (expedition): both are full-bleed screens that own
// the whole viewport and carry their own exits, so neither shows the rail/header.
const fullBleed = route === 'landing' || route === 'expedition';
```

`onLanding` is renamed `fullBleed` at all three of its uses (`:181`, `:182`, `:183`). Note this also
means the `app-shell` loses `with-rail` on the expedition route — which is correct and is what makes
the viewport actually full (`base.css:94` `.app-shell.with-rail` reserves the rail's gutter).

**No rail entry.** `Nav.tsx`'s `NAV_ITEMS` is not touched. Precedent: `artadmin` and `contentadmin`
are both real `Route` members with no rail entry, reached only by deep link. The expedition is
reached from the monitor's 全画面 button, and a rail entry would be a dead link whenever no room is
being watched.

## 5. The 全画面 button

### 5.1 Where, exactly

`client/src/schedule/monitor/MonitorHeader.tsx` (REQ-0240 branch — this file does not exist on
master). Its layout, read in full:

```
.mon-header
└ .mon-header-banner            (dungeon 4:1 crop art, or the ᛝ fallback)
  ├ .mon-header-scrim
  └ .mon-header-row
    ├ .mon-header-title.dj      "{dungeonName} · Lv{level}"
    ├ .chip.is-live … | .chip.den.mon-replay-chip
    ├ .mon-header-grow          (aria-hidden spacer — everything after is RIGHT-aligned)
    ├ .mon-header-return        "returns at HH:mm"
    └ .mon-header-menu-wrap
      ├ button.mon-header-menu-btn  "⋯"
      └ .mon-header-menu (admin: seed + copy JSONL)
```

The button goes **between `.mon-header-return` and `.mon-header-menu-wrap`** — i.e. the last item in
the right-aligned cluster before the ⋯ overflow. Rationale: it is a primary action (it must not hide
inside an overflow menu that is `isAdmin`-gated in its useful half), it is not identity (so it does
not belong left of `.mon-header-grow`), and the ⋯ menu must stay the last thing on the row because it
opens a popover anchored to the header's right edge.

```tsx
{onOpenFullscreen ? (
  <button
    type="button"
    className="btn btn-ghost mon-header-fullscreen"
    data-testid="monitor-fullscreen-btn"
    aria-label={t(locale, 'schedule.monitor.fullscreen')}
    onClick={onOpenFullscreen}
  >⛶</button>
) : null}
```

**`MonitorHeader` gets ONE new optional prop, `onOpenFullscreen?: () => void`.** Optional, so the
component renders byte-identically when it is not passed — which keeps every existing REQ-0240 test
green by construction and is the same additive posture `App.tsx`'s REQ-0041 portal note describes
("a STRICT ADDITIVE change … with no slot registered … this file's rendered output is byte-identical
to before").

`Monitor.tsx` passes it:

```tsx
onOpenFullscreen={() => setRoute(`expedition/${room.id}` as Route)}   // WRONG — see §5.2
```

### 5.2 `setRoute()` cannot carry the room id — a real trap

`setRoute()` (`routing.ts:10-19`) writes `location.hash = `#/${route}`` from a `Route` union member.
It has **no** deep-link form. Every existing deep link in this app is produced by something OTHER
than `setRoute`: the Dex card footer is a plain `<a href="#/dex/…">`, and the invite/market links
arrive from outside. `setRoute('expedition/' + room.id as Route)` would type-cast a lie, and while
`onHashChange` would happen to parse it, `snapshot.route` would be set to the literal string
`'expedition/room_abc'` first — which is not a `Route`, matches no `route === …` test in `App.tsx`,
and renders a blank page until the hashchange event catches up. **Do not do it.**

The correct forms, in order of preference:

1. **A plain anchor**, matching the Dex precedent (`schedule-monitor-rewards-hint-link` in
   `Monitor.tsx` is already `<a className="…" href="#/warehouse">`):
   `<a className="btn btn-ghost mon-header-fullscreen" href={`#/expedition/${roomId}`}>⛶</a>`.
   Free middle-click/新しいタブ, no store round-trip, no cast. **ADOPTED.**
2. If a `<button>` is required for styling parity, add `setRouteDeepLink(route: Route, segment: string)`
   to `routing.ts` — sets `snapshot.route` to the real `Route` member AND `location.hash` to the
   segmented form, in that order. Do NOT overload `setRoute`.

So `MonitorHeader`'s new prop is `fullscreenHref?: string | null`, not a callback. `Monitor.tsx`
passes `fullscreenHref={`#/expedition/${room.id}`}`. The button is omitted entirely when the prop is
absent (no run, or a caller that does not want it).

### 5.3 What is NOT touched

`Monitor.tsx`, `MonitorRenderer.ts`, `ExpeditionRail.tsx`, `EventFeed.tsx`, `SquadDock.tsx`,
`useRunPlayhead.ts`, `pacingClient.ts` — none change. The small monitor keeps its 18px cells, its
`row`/`column` breakpoint at 900px, its pacing, its transport. The ONLY edits outside the new
expedition module are: the two lists in `core.ts`, the two ladders in `routing.ts`, the composition +
`fullBleed` in `App.tsx`, the one prop + one anchor in `MonitorHeader.tsx`, the one prop pass in
`Monitor.tsx`, two i18n keys, and §9's server seam.

## 6. Geometry — the logical stage (brief §3 C5)

Constants, in a NEW file `client/src/expedition/expeditionGeom.ts`. **They are NOT edits to
`client/src/board/geom.ts`** — see §6.2.

```ts
export const EXP_CELL = 40;                 // spec (d): half of board/geom.ts CELL=80. LOGICAL.
export const EXP_GAP = 32;                  // gutter between the two planes (brief §3 C5)
export const PLANE_W = FIELD_COLS * EXP_CELL;  // 26 * 40 = 1040
export const PLANE_H = FIELD_ROWS * EXP_CELL;  // 18 * 40 =  720
export const ROW_STAGE_W = PLANE_W * 2 + EXP_GAP;  // 2112
export const ROW_STAGE_H = PLANE_H;                //  720
export const COL_STAGE_W = PLANE_W;                // 1040
export const COL_STAGE_H = PLANE_H * 2 + EXP_GAP;  // 1472
```

`FIELD_COLS`/`FIELD_ROWS` are **imported**, not re-declared — from `client/src/schedule/fieldGeometry.ts:16-17`
(`export const FIELD_COLS = 26; export const FIELD_ROWS = 18;`). REQ-0258 §9.1 documents that the
field dims already exist in three places under forced module boundaries, each pinned by a parity test
(`sim/tests/run.cjs:1823/1830/1840`). **This REQ must not create a fourth copy.** `fieldGeometry.ts`
is same-tree TypeScript and importable; there is no boundary here to force a duplicate.

### 6.1 There is no PAD

The brief §6 describes the board as "`geom.ts` (CELL=80, PAD=38)" and the task framing lists
`PAD=38` among the constants to halve. **Both are wrong for this plane, and the brief's own §3 C5
proves it:** it computes `one plane = 26*40 x 18*40 = 1040 x 720`. That arithmetic has **no PAD term**.
A half-PAD of 19 would make the plane 1078 x 758 and every number in C5 — 1440, 2080, 2112, the 0.909
scale, the 36.4px cell — wrong.

The two are not the same concept, which is why one does not scale into the other:

- `PAD = 38` is the **Backpacks board's canvas margin**: `BoardRenderer.mount()` sizes the app
  `PAD*2 + COLS*CELL` (= 38*2 + 8*80 = **716x716** for the 8x8 canvas), and `cx()/cy()`
  (`geom.ts:63-68`) offset every cell by it. It exists so the MJÖLNIR stage's coordinate rails
  (`CanvasChrome.tsx`'s `BoardCoords`, which mirrors `PAD 38 / CELL 80` — see `App.tsx:233-237`) have
  somewhere to draw. It is **chrome**, in pixels, outside the grid.
- The expedition plane's margin is the **padding-1 ring** (spec (f)): row 1, row 18, col A, col Z —
  **cells inside the 26x18 grid**, where rays are born (`combat_spec` §2.2 entry cells), drawn in a
  distinct colour by REQ-0261 and enforced by REQ-0258's validator. It is **field**, in cells, inside
  the grid.

The ring IS the plane's margin. Adding a pixel PAD on top would draw a margin around a margin.
**`EXP_PAD` does not exist.** `client/src/schedule/fieldGeometry.ts`'s `cellIdToXY(cell, cellPx)` and
`parseBoxToPixelRect(box, cellPx)` already map cell A1 to pixel (0,0) with no pad term — they are
correct for this plane as written, which is a second, independent confirmation.

### 6.2 Why `geom.ts` is not edited

The task framing says "scale constants that must halve: `geom.ts` CELL=80->40". Taken literally that
**halves the Backpacks board**. `CELL`/`PAD` are module constants imported by `BoardRenderer.ts:68`,
`ghosts.ts`, `commits.ts`, `linkTrace.ts`, `CanvasChrome.tsx:43`, and the forecast overlay; changing
them changes the live canvas page, breaks `BoardCoords`' mirrored geometry, and moves REQ-0125a's
golden G7. The expedition gets its **own** constants in its **own** module. "1/2" is a relationship
between two numbers (`EXP_CELL === CELL / 2`), and this REQ pins exactly that with a test (§14) so
the relationship is machine-checked rather than remembered.

## 7. Orientation (ruling Q3)

### 7.1 The ruling

> **Q3 — 横長の画面で表示されている場合は、横並び、縦並びの画面の場合は縦並びで**
> (landscape viewport → side-by-side; portrait viewport → stacked)

Per spec (a), **stacked puts the enemy / monster_pack plane on TOP and the player squads on the
BOTTOM.** Side-by-side puts the player plane LEFT and the enemy plane RIGHT — matching
`MonitorRenderer`'s existing `playerField.x = 0` / `enemyField.x = FIELD_W + FIELD_GAP_PX`
(`MonitorRenderer.ts:172-175`), so the two views never disagree about which side is whose.

Note `MonitorRenderer.setLayout('column')` puts the ENEMY field at `y = FIELD_H + GAP` — i.e. enemy
on the BOTTOM, the opposite of spec (a). That is fine: it is the small monitor's own choice and the
small monitor is untouched. It is called out here only so nobody "harmonises" them later and silently
inverts one of the two.

### 7.2 The exact rule

```ts
/** The viewport aspect at which the row stage and the column stage fit EQUALLY well.
 * DERIVED, never hardcoded: it moves if EXP_GAP or the plane size moves (§7.3). */
export const ROW_COL_ASPECT_THRESHOLD = ROW_STAGE_W / COL_STAGE_H;   // 2112 / 1472 = 33/23 ≈ 1.43478

export function layoutFor(viewportW: number, viewportH: number): 'row' | 'column' {
  return viewportW / viewportH >= ROW_COL_ASPECT_THRESHOLD ? 'row' : 'column';
}
```

Driven by a `ResizeObserver` on the view root, exactly as `Monitor.tsx:139-147` already drives its own
900px breakpoint. Not `window.matchMedia('(orientation: landscape)')` — that reports the DEVICE
orientation, not the element's box, and is wrong inside any embedded/split-screen layout.

### 7.3 CORRECTION to ruling Q3 as literally worded — with the arithmetic

Q3 says "landscape → side-by-side", whose obvious encoding is `W/H >= 1 ? 'row' : 'column'`.
**That is arithmetically wrong on real hardware.** Computed against the real stage sizes (not by eye):

| viewport | aspect | fit-scale, row | fit-scale, column | larger | naive `a>=1` | agree? |
|---|---|---|---|---|---|---|
| 1920x1080 | 1.778 | **0.9091** | 0.7337 | row | row | yes |
| 2560x1440 | 1.778 | **1.2121** | 0.9783 | row | row | yes |
| 1440x900 | 1.600 | **0.6818** | 0.6114 | row | row | yes |
| **1280x1024** | **1.250** | 0.6061 | **0.6957** | **column** | row | **NO** |
| 1080x1920 | 0.563 | 0.5114 | **1.0385** | column | column | yes |
| 820x1180 | 0.695 | 0.3883 | **0.7885** | column | column | yes |

At **1280x1024** — SXGA, a real and common panel — the naive rule picks side-by-side at scale
0.6061 when stacked would give 0.6957. That is a **15% larger battlefield thrown away** on a screen
that is unambiguously "横長".

The crossover is exact and provable. Let `a = W/H`.
- Row is width-limited iff `W/2112 < H/720` ⟺ `a < 2.9333`.
- Column is width-limited iff `W/1040 < H/1472` ⟺ `a < 0.7065`.
- For `0.7065 <= a <= 2.9333` — which covers every viewport anyone will ever use — `S_row = W/2112`
  (width-limited) and `S_col = H/1472` (height-limited). They are equal iff
  `W/2112 = H/1472` ⟺ `a = 2112/1472 = **33/23 ≈ 1.43478**`.
- Outside that band the single threshold still holds: for `a > 2.9333` both are height-limited
  (`H/720` vs `H/1472`) and row always wins; for `a < 0.7065` both are width-limited (`W/2112` vs
  `W/1040`) and column always wins. **One threshold, no edge cases.**

**This REQ therefore reads Q3 as INTENT, not as `a >= 1`.** The intent — match the stage's shape to
the screen's shape so the battle is as large as possible — is exactly what `a >= 33/23` implements,
and `a >= 1` is a lossy approximation of it. `33/23` IS the aspect at which the stage stops being
"横長 enough" for the row layout. **The user must confirm this reading** (Status blocker 3): it is
faithful to the intent and demonstrably better on 1280x1024, but it is not what the words say, and a
1.2-aspect landscape screen will stack — which may surprise someone reading the ruling literally.

The threshold is DERIVED (`ROW_STAGE_W / COL_STAGE_H`) and never written as `1.43478`. If `EXP_GAP`
moves from 32, the threshold moves with it, automatically. A hardcoded 1.43478 would be correct until
the day someone changes the gap, and then wrong forever with nothing to say so.

## 8. Fit-scale (letterbox) — the viewport transform

Neither stage fits 1080p: row is 2112 wide (>1920), column is 1472 tall (>1080). Per C5 the LOGICAL
size stays CELL=40 and the composed stage is **uniformly** scaled into the viewport.

```ts
export function fitStage(viewportW: number, viewportH: number, layout: 'row' | 'column') {
  const w = layout === 'row' ? ROW_STAGE_W : COL_STAGE_W;
  const h = layout === 'row' ? ROW_STAGE_H : COL_STAGE_H;
  const scale = Math.min(viewportW / w, viewportH / h);      // UNIFORM — one factor, both axes
  return { scale, x: (viewportW - w * scale) / 2, y: (viewportH - h * scale) / 2 };
}
```

Applied as `app.renderer.resize(viewportW, viewportH)` + `app.stage.scale.set(scale)` +
`app.stage.position.set(x, y)`. **Not** a CSS `transform: scale()` on the `<canvas>`: CSS scaling
resamples the rendered bitmap (blurry, and it desynchronises `getBoundingClientRect()` from the
backing store, which is exactly what `geom.ts:clientToLocal`'s resolution/CSS-scale correction exists
to fix). Scaling the STAGE re-renders at native density instead.

**No `Math.min(scale, 1)` clamp.** Upscaling is legitimate here (2560x1440 → 1.212) and safe: every
symbol texture is supersampled 2x over a 64-units-per-cell viewBox (§REQ-0261 §5), so a 1x1 icon
carries 128px of texture into a 48.5px cell even at 1.212. Clamping would letterbox a 4K screen for
no reason.

**Worked, 1920x1080, landscape** (this is the brief's own C5 example, and it is CORRECT — verified):
```
a = 1920/1080 = 1.7778 >= 33/23  ->  row
stage = 2112 x 720
scale = min(1920/2112, 1080/720) = min(0.90909, 1.5) = 0.90909      (width-limited)
drawn = 1920.0 x 654.5     effective cell = 40 * 0.90909 = 36.36px
letterbox = 0 px left/right, (1080 - 654.5)/2 = 212.7 px top and bottom
```

**Worked, 1080x1920, portrait:**
```
a = 1080/1920 = 0.5625 < 33/23  ->  column
stage = 1040 x 1472
scale = min(1080/1040, 1920/1472) = min(1.03846, 1.30435) = 1.03846  (width-limited)
drawn = 1080.0 x 1528.6    effective cell = 40 * 1.03846 = 41.54px   (UPSCALED — allowed)
letterbox = 0 px left/right, (1920 - 1528.6)/2 = 195.7 px top and bottom
```

**Worked, a real phone (390x844 CSS px):** column, `scale = min(390/1040, 844/1472) = 0.375`,
effective cell **15.0px**. Honest consequence: at 15px a cell is legible as geometry but a PO icon in
it is not. This REQ does not solve that; it records it as the known floor and leaves any
phone-specific treatment to a future REQ. A 15px cell is still strictly better than the small
monitor's 18px cell showing the same field in a 468px box — this is not a regression, it is just not
a phone UI.

**No scrolling, ever.** The stage always fits by construction: `fitStage` returns a scale that makes
it fit, and the container is `overflow: hidden`. There is no pan, no zoom, no scrollbar. Per C5.

**Resolution.** `app.init({ …, resolution: window.devicePixelRatio, autoDensity: true })`. The
existing boards leave `resolution` at Pixi's default; `geom.ts:clientToLocal` divides by
`app.renderer.resolution`, proving it is already a live concern in this codebase. The expedition view
is full-screen, so a HiDPI panel must render at device density or the whole point of a 3.2x-
supersampled texture is thrown away at the last step.

### 8.1 `setLayout` as the seam — verified, and it is NOT sufficient

The brief §3 C5 says: *"`MonitorRenderer.setLayout('row'|'column')` (REQ-0240) is the existing seam
for the flip."* **Read as "the flip is a solved shape, copy it": TRUE. Read as "reuse
`MonitorRenderer` at CELL=40": FALSE, and this is worth being precise about.**

`setLayout` (`MonitorRenderer.ts:207-218`) does exactly two things — reposition `enemyField` and
`app.renderer.resize(...)` — with no Application teardown. That pattern is correct and this REQ
copies it.

But `MonitorRenderer` **cannot render at CELL=40**: `FIELD_CELL_PX = 18` is a **module constant**
(`:30`), and `FIELD_W`/`FIELD_H` are derived from it **at module load** (`:32-33`). `setLayout` itself
resizes to those module constants. `FIELD_CELL_PX` is referenced at **21 sites** in that one file
(backdrop, grid, `parseBoxToPixelRect`, every marker, flash, pulse, ray step) and is additionally
**exported** and read by the enemy-label fitting logic. There is no cell-size parameter anywhere.

Making it one would edit every draw site in the small monitor — precisely what 「今ある画面は放置して」
forbids. So: **the expedition view gets its own renderer** (REQ-0261) whose cell size is a
constructor parameter from line one, and it reuses `setLayout`'s *shape* (reposition + resize, never
re-init) rather than the class.

## 9. Pacing (brief §3 C4) — the seam

### 9.1 The ruling

> **C4** — `#/expedition` plays the sim clock 1:1 (realtime, tick-accurate). The pacing layer stays
> alive ONLY for the legacy small monitor on `#/schedule`. `pacingVersion` remains on the wire; the
> expedition view ignores `pt` and reads `t`. No deletion of `pacing.cjs` in this program.

Nothing in REQ-0240 is deleted or feature-flagged. `shared/pacing.json`, `server/services/pacing.cjs`,
`client/src/schedule/monitor/pacingClient.ts` and `useRunPlayhead.ts` — with its 2500ms `liveLagTargetMs`,
6000ms `catchupThresholdMs`, [45,300]s clamp and 250ms/4-hit coalescing (`shared/pacing.json`, verified)
— keep serving `#/schedule` unchanged. `#/expedition` simply never imports `useRunPlayhead` or
`pacingClient`.

### 9.2 CORRECTION to the brief: C4 is NOT a client-only change. The pacing gate is on the WIRE.

The brief says the expedition view "ignores `pt` and reads `t`", which reads as a client-side choice.
**It is not.** Verified in the source:

```js
// server/services/runs.cjs:28-36  (REQ-0240 branch)
function visibleEvents(run) {
  const clock = runClock(run);
  return pacing.decorateVisible(run, clock.elapsedSecs);
}
// server/services/pacing.cjs:183-203
function decorateVisible(run, elapsedSecs) {
  …
  const visSecs = typeof ptv === 'number' ? ptv / 1000 : (…);
  if (visSecs > elapsedSecs) continue;      // <-- the gate. SERVER-SIDE.
  …
}
```

and `server/routes/schedule.cjs:236` serves `events: visible`. **The server withholds every event
whose `pt` has not yet arrived.** A client that ignores `pt` and reads `t` is still fed at the paced
cadence — it would simply sit and wait, having read `t` off events it was allowed to have. Ignoring
`pt` on the client is necessary and nowhere near sufficient.

**The seam, precisely — one query param and one field:**

```
GET /api/schedule/rooms/:id/run?clock=sim
```

- Default (`clock` absent, or `clock=presentation`): **byte-identical to today.** Gate on `pt`,
  `durationSecs` = presentation. Every existing caller, test and the whole `#/schedule` monitor are
  unaffected by construction.
- `clock=sim`: gate on `t` (`decorateVisible` already has this exact branch — it is the
  `pacingVersion 0` / legacy path at `pacing.cjs:197-200`, `if (visSecs <= elapsedSecs) out.push(ev)`
  reading `ev.t`), and additionally return **`simDurationSecs`**.

**`simDurationSecs` already exists, for exactly this reason.** `server/services/runs.cjs:142` stores
`simDurationSecs: computeDurationSecs(result.events)` with the comment:

> the LEGACY combat-time duration (max sim `t`) kept for consumers that must stay on **COMBAT TRUTH
> rather than presentation time** (seals' fair-benchmark clearTimeSecs). Presentation `durationSecs`
> above drives room occupancy / settle; this drives seal comparison.

`server/services/seals.cjs:198` already consumes it. It is simply **not on the wire** — `ApiRunView`
(`shared/dto.ts:493-517`) has `durationSecs` and no `simDurationSecs`. So the whole server change is:
one optional query param routing to an EXISTING branch, plus one additive DTO field. `pacing.cjs`
gains no new logic.

**The expedition view must NOT use `ApiRunView.durationSecs`.** It is the presentation duration
(`runs.cjs:125-130`, verbatim: *"durationSecs is now the PRESENTATION duration the player watches
(pt-based) … The sim itself still resolves instantly"*). Using it as the sim length would stretch the
battle by the very factor C4 exists to remove. The expedition reads `simDurationSecs`; a legacy run
(`pacingVersion 0`) has none, and there `durationSecs` already IS max-`t` and is correct to use.

### 9.3 The playhead

`client/src/expedition/useExpeditionClock.ts` — NEW, and deliberately a fraction of `useRunPlayhead`:

```
simElapsedSecs = (Date.now() - Date.parse(run.startedAt)) / 1000        // LIVE: wall == sim, 1:1
releasedIdx    = count of events with ev.t <= simElapsedSecs            // reads `t`. never `pt`.
```

No live lag. No catch-up. No coalescing. No clamp. `run.events` under `?clock=sim` is already
`t`-gated server-side, so `releasedIdx` is a smoothing cursor for sub-poll-interval interpolation,
not a second gate. rAF-driven, not poll-driven — REQ-0262's 25 diagonal-steps/sec ray flight needs a
continuous clock (brief §6: *"interpolated smoothly when the display allows (rAF, not a 25Hz gate)"*).

### 9.4 The consequence the brief does not address — **USER DECISION REQUIRED**

REQ-0240 made **room occupancy = the presentation duration**, deliberately (`runs.cjs:126-127`:
*"this IS the battle wait increase — the room is occupied for as long as the paced replay lasts"*),
and clamps it to **[45, 300] seconds** (`shared/pacing.json`). REQ-0240's own deviation 2 records that
*"generated content stretches UP to the 45s floor"* — i.e. real sim runs are typically **shorter than
45s of sim `t`**.

So for a live run, the two clocks cannot both be obeyed:

| | `#/schedule` (paced) | `#/expedition` (1:1 sim) |
|---|---|---|
| battle ends after | `durationSecs` (≥45s wall) | `simDurationSecs` (often ~10-30s wall) |
| room frees at | `startedAt + durationSecs` | — (the room is not this view's business) |

**The full-screen battle finishes, and then the room stays busy for another 15-35 wall-seconds.** That
is not a bug in this spec — it is the arithmetic of two ratified rulings meeting. Both are the user's:
REQ-0240 was built to user directive #7 (「slow playback, visualization first」) and C4/Q1 now say the
expedition is tick-accurate realtime.

Options, for the user to choose:

- **(A) ADOPTED PROVISIONALLY — accept the divergence.** `#/expedition` is a different view of the
  same run on a different clock. It ends early, shows the settled result, and offers "return to
  room". Truest to C4. Costs: two screens showing the same live run disagree about what has happened
  — open both and the expedition has already killed the boss the monitor is still walking toward.
- **(B) Anchor the expedition to the paced wall clock by inverting `pt`→`t`.** The two views stay in
  sync. But this IS pacing, which C4 forbids by name, and it would stretch the ray flight REQ-0257
  makes physical — desynchronising the ray from its own hits, which is precisely the failure C4
  exists to prevent.
- **(C) Retire pacing for expedition-era runs entirely** — once REQ-0256's tick sim lands, make
  `durationSecs = simDurationSecs` and let room occupancy be combat truth. Cleanest end state, and
  arguably where Q1 points. But it silently reverts user directive #7 and changes room economics
  (rooms free in ~20s instead of ≥45s), so it needs its own ruling and its own REQ.

**This REQ specifies (A) and implements nothing that forecloses (B) or (C)** — the clock lives behind
one hook and one query param. **The user must confirm before implementation starts.**

## 10. Transport controls

| state | `#/schedule` today (REQ-0240 M6) | `#/expedition` |
|---|---|---|
| LIVE | LIVE chip; catch-up button when `needsCatchup` | **LIVE chip only.** No play/pause, no speed, no scrub. |
| SETTLED | ▶/⏸, 0.5/1/2/4×, skip-to-end, clickable scrub | ▶/⏸, 0.5/1/2/4×, skip-to-end, clickable scrub — **on the SIM clock** |

**Live: nothing.** There is no playhead to move — the view IS the sim clock at 1:1. Scrubbing a live
run forward is a spoiler and backward is a replay; both are "not live" by definition. This is also
exactly what the small monitor already does live (`Monitor.tsx:340-346`: the `settled ? … : …`
ternary renders only the LIVE chip + catch-up). **No catch-up button either** — catch-up exists to
re-sync a client playhead that drifted behind the *paced* release cursor (`useRunPlayhead.ts:70-76`);
under 1:1 the playhead is `Date.now() - startedAt`, which cannot drift, because it is not integrated.
A backgrounded tab resumes exactly where the wall clock says, with no state to reconcile.

**Settled: keep all of it**, re-based. Once `clock.isSettled`, `decorateVisible` returns the whole log
regardless of gate (`elapsedSecs >= durationSecs >= every pt`), so **no server change is needed for
settled replay at all** — the expedition can read `t` off the full array today. `speed` multiplies the
SIM clock: `playheadSecs += dt * speed`, `releasedIdx = count(ev.t <= playheadSecs)`, scrub maps
`frac -> frac * simDurationSecs`. Same controls, same testids where they carry over, different clock.

**4× on the sim clock is genuinely fast** — a 20s sim run replays in 5s. That is the honest
consequence of 1:1 and is not a defect; the speed control is doing exactly what it says.

### 10.3 States

| condition | render |
|---|---|
| `expeditionRoomId === null` (bare `#/expedition`) | empty state + a link back to `#/schedule`. Not a crash. |
| room id does not resolve / 404 / not the caller's room | the same empty state with the not-found copy. Never a blank canvas. |
| room resolves, `room.lastRunId === null` | "awaiting run" — mirrors `Monitor.tsx:303-305`'s existing `schedule.monitor.awaitingRun` branch. |
| run resolves | the stage. |

An **exit affordance is mandatory**: the rail and header are hidden (§4.3), so the expedition must
carry its own way out (`←` back to `#/schedule`) plus `Escape`. A full-bleed screen with no exit and
no rail is a trap. `LandingPage` sets the precedent for full-bleed-with-its-own-menu.

## 11. MJÖLNIR skin — `web/redesign/styleguide.html` §6

### 11.1 Tokens and classes (cite, do not invent)

All from `client/src/theme/mjolnir.css:50-89` (verified present):

| use | token |
|---|---|
| stage void behind the letterbox | `--void: #0A0D12` |
| plane backdrop / panel | `--panel: #131820`, `--raised: #1B222D`, `--border-lo: #28313E` |
| player plane accent | `--frost: #6FC4DE` (+ `--frost-hi`, `--frost-lo`, `--frost-glow`) |
| enemy plane accent | `--ember: #E25822` / `--blood: #B0413E` (+ `--ember-hi`, `--ember-glow`) |
| gold rims, formation outlines | `--gold: #C9A959`, `--gold-hi: #EBD9A4`, `--gold-lo: #857038` |
| focus | `--focus-ring: 0 0 0 1px var(--gold), 0 0 8px rgba(201,169,89,.55)` |
| type | `--f-dj` (Shippori Mincho, `.dj`), `--f-den` (Cinzel, `.den`), `.t-micro`, `.tnum` |

The frost/ember split is not invented here: `MonitorRenderer.ts:180-181` (0240) already calls
`drawFieldBackdrop(this.playerField, 0x6fc4de)` / `(this.enemyField, 0xe06b5f)`. Chrome classes
(`.panel.ornate`, the four `<i className="k tl|tr|br|bl"/>` gold knots, `.chip`, `.chip.is-live`)
are reused verbatim from `Monitor.tsx:308-309`.

### 11.2 §6.0 glow discipline — binding

Quoted from `styleguide.html:551-559`:

- **発光は4つの瞬間のみ** — ①focus (hover/selection) ②legendary+ manifestation ③a LIVE link beam
  ④**the instant of a hit**. Static text and idle panels do not glow.
- 外発光は **blur ≤ 8px** (at 1x) · one colour per element · panels get inner shadow only ·
  **≤ 3 simultaneous glow sources per screen**.
- Transitions **120–180ms ease-out**; hover response <100ms; press feedback immediate.
- Notifications: a **single message queue** — one at a time, never stacked.

**For this REQ (the shell) the operative half is the ceiling, not the licence.** The shell draws no
hits and no beams, so the shell's own glow budget is **zero**: the plane backdrops, the padding ring,
the grid, the letterbox and the chrome are all idle surfaces and **must not glow**. The ≤3 budget is
spent by REQ-0262 (hit flashes) and REQ-0261 (live link beams). A glowing frame here would silently
eat a third of the budget for decoration — which is exactly what §6.0 forbids.

**The ≤3 budget is a cross-REQ invariant with no owner today.** This REQ names the shell as its
accountant: the expedition view is the one surface where a ray VFX, a link beam and a focus ring can
all be live at once. §14 pins it.

### 11.3 The two-tier reduced-motion rule — and the reference implementation VIOLATES it

`styleguide.html:737` (§6.6), verbatim:

> 動きを**二段構え**で退ける。①CSS共通の `@media (prefers-reduced-motion: reduce)` が全
> `animation`/`transition` を 0.001s に短絡(ui.css・mjolnir.css)。②粒子・視差・**戦闘再生**など
> **JS生成のもの**は `fx.js`/`particles.ts` が**生成自体を行わない**(rAFループを起動しない)。

Tier ① already exists app-side: `client/src/theme/mjolnir.css:256-258`
(`@media (prefers-reduced-motion: reduce){ *, *::before, *::after{ animation-duration:.001s !important;
transition-duration:.001s !important; } }`). The expedition's DOM chrome inherits it for free.

Tier ② is this REQ's obligation and it is **not** "run the loop and skip the drawing". It is: **do not
construct**. The authority is `client/src/a11y/motionPrefs.ts:116` `getReducedMotion()` (REQ-0143 —
which also forces reduced ON under `navigator.webdriver` so e2e stays byte-identical), **not** a raw
`matchMedia` call. Concretely: under reduced motion the expedition **starts no rAF loop**; the stage
renders once per data change and the clock hook falls back to the poll cadence. Note §6.6 names
**戦闘再生** — battle playback — in tier ② explicitly. That is this screen.

> **The §6.4 `RayMonitor` reference violates both halves of §6.0/§6.6. Do not port the violations.**
> Verified in `web/redesign/assets/fx.js`:
> 1. **No reduced-motion guard.** `initParticles` (`:8`), `countUp` (`:60`) and `initParallax` (`:71`)
>    each open with `if (REDUCED) …`. **`window.RayMonitor` (`:88`) has none** and runs
>    `requestAnimationFrame(tick)` unconditionally (`:277`). The one JS effect the styleguide names by
>    category in tier ② is the one that does not implement it.
> 2. **Glow blur exceeds the §6.0 ceiling.** `ctx.shadowBlur = 10` on the ray trail (`:209`), `14` on
>    the ray head (`:219`), `18` on the hit flash (`:238`) — against a stated ceiling of **≤ 8px**.
>    (Canvas `shadowBlur` and CSS `box-shadow` blur are both ≈2σ, so the comparison is like-for-like;
>    confirm at implementation rather than assuming.)
> 3. **Its geometry approach is the one C5 rejects.** `size()` (`:135-143`) recomputes `cell` from the
>    viewport (`cell = Math.min((w-GAP-8)/(COLS*2), (h-26)/ROWS)`) — the cell size is a *function of
>    the window*. C5 fixes the LOGICAL cell at 40 and scales the STAGE. Porting `size()` would make
>    "1/2" mean nothing.
>
> The brief already says **"port its LOOK, not its code"** (§6) — this is the concrete list of what
> that sentence is protecting against. The look (bounce sparks, hit flash, 5th-bounce nova, the trail)
> is ratified and REQ-0262 should reproduce it. The blur values must come down to ≤8, the rAF must not
> start under reduced motion, and the geometry comes from §6/§8 here.
>
> **These are findings against a ratified reference, and someone should fix `fx.js` itself** — it is
> the mock the styleguide renders live, so today the styleguide demonstrates a rule while breaking it
> two sections lower. Out of scope here (`web/redesign/` is the mock, not the app); recorded so it is
> not rediscovered a fourth time.

## 12. Corrections to the brief

| brief | reality | evidence |
|---|---|---|
| §6: board is "`geom.ts` (CELL=80, **PAD=38**)" and the task framing says PAD halves to 19 | **The expedition plane has no PAD.** The brief's OWN C5 arithmetic (1040x720 = 26*40 x 18*40) has no PAD term; PAD is the Backpacks board's chrome margin, and the padding-1 RING is this plane's margin. §6.1 |
| task framing: "`geom.ts` CELL=80->40" | Editing `geom.ts` **halves the live Backpacks board**. New module, new constants, pinned relationship. §6.2 |
| §3 C5: "`setLayout` is the existing seam for the flip" | True for the flip's SHAPE; false as reuse — `FIELD_CELL_PX=18` is a module const at 21 sites and `setLayout` resizes to it. §8.1 |
| §3 C4: "the expedition view ignores `pt` and reads `t`" | **Not client-only.** The gate is server-side on the wire (`decorateVisible`). Needs `?clock=sim`. §9.2 |
| §3 C4 (silent) | `ApiRunView.durationSecs` is the PRESENTATION duration; the sim duration exists as `run.simDurationSecs` but is **not on the wire**. §9.2 |
| §3 C4 (silent) | 1:1 sim playback makes the battle **end before the room frees**. Unresolved product fork. §9.4 |
| §0 Q3 as worded ("landscape → side-by-side") | Wrong at 1280x1024 by 15% of the battlefield. Exact threshold is 33/23 ≈ 1.435, derived. §7.3 |
| §6: "§6.4's `RayMonitor` … is the ratified reference implementation" | It is — and it has **no reduced-motion guard** and uses **blur 10/14/18** against a ≤8 ceiling. §11.3 |
| §6: route `#/expedition`; the mock `expedition.html` is the SCHEDULE redesign | **Confirmed.** `web/redesign/expedition.html` is 遠征の間 (rooms + small monitor). No collision in code; the route name is the user's. |
| §3 C5: "At 1920x1080 … scale ~0.909 -> effective cell ~36.4px" | **Confirmed exactly** — 0.90909, 36.36px. |

## 13. Scope

**In:**
1. `client/src/store/core.ts` — `Route` union + `VALID_ROUTES` both gain `'expedition'`;
   `EXPEDITION_HASH_RE`; `StoreSnapshot.expeditionRoomId`; snapshot seed.
2. `client/src/store/routing.ts` — the regex in BOTH ladders (`initRouting`, `onHashChange`),
   specific-before-generic; `clearExpeditionRoomId()` (route-exit, not one-shot — §3.2).
3. `client/src/App.tsx` — `fullBleed` (was `onLanding`); the latched, never-unmounted
   `.expedition-view`; `ExpeditionPage`.
4. `client/src/expedition/` — NEW: `ExpeditionPage.tsx` (shell, chrome, exit, empty states),
   `expeditionGeom.ts` (§6, §7.2, §8), `useExpeditionClock.ts` (§9.3), `ExpeditionStage.tsx`
   (canvas host + `ResizeObserver` + fit-scale; **draws two empty planes** — contents are 0261).
5. `client/src/schedule/monitor/MonitorHeader.tsx` — ONE optional prop `fullscreenHref`, one anchor
   between `.mon-header-return` and `.mon-header-menu-wrap`. `Monitor.tsx` — one prop pass.
6. `client/src/styles/expedition.css` — NEW. `client/src/i18n.ts` — `schedule.monitor.fullscreen`,
   `expedition.*`.
7. **Server:** `server/routes/schedule.cjs` — `?clock=sim` routes to `decorateVisible`'s existing
   `t`-branch; `simDurationSecs` added to the run view. `shared/dto.ts` — `ApiRunView.simDurationSecs?: number`.
   Both strictly additive; the default response stays byte-identical.

**Out:**
- **Anything drawn inside a plane** — squads, ring, instances, rays, HP, cooldowns: REQ-0261/0262/0263.
- **Any change to the small monitor's behaviour** — 「今ある画面は放置して」.
- **Deleting/flagging any REQ-0240 pacing code.** C4 says it stays.
- **Deriving `VALID_ROUTES` from `Route`.** Recorded (§3.1), pinned (§14), not fixed here.
- **Fixing `web/redesign/assets/fx.js`.** §11.3 records it; it is the mock, not the app.
- **Resolving §9.4.** User decision.

## 14. Gates

**E2E ports (rule: `5000 + REQ*10 + index`): `7600` static / `7601` api / `7602` proxy.** Reserved by
the numbering rule and enforced by `tools/check_e2e_ports.cjs` (ci step `[0/8]`). **Per ruling Q2
(「e2eを通す必要はない」) E2E is NOT a gate for this program, so no harness is built and the decade is
left unused** — the same posture REQ-0258 §10 takes with 7580/7581/7582.

Unit/typecheck gates that DO apply:

1. **`VALID_ROUTES` ≡ `Route`** — a test asserting every union member is in the array and vice versa
   (`satisfies`-based, or a `const` tuple + `typeof T[number]` pin). Closes §3.1 for good. Given
   today's code it passes; given a half-added route it fails.
2. **`EXP_CELL === CELL / 2`** — importing both `board/geom.ts` and `expedition/expeditionGeom.ts`.
   Pins spec (d)'s "1/2" as a machine-checked relationship (§6.2).
3. **`ROW_COL_ASPECT_THRESHOLD` is derived** — assert `layoutFor` returns `'row'` at 1920x1080 and
   `'column' `at 1280x1024 and 1080x1920, and that the threshold equals `ROW_STAGE_W / COL_STAGE_H`
   rather than a literal (§7.3).
4. **`fitStage` arithmetic** — the two worked examples in §8, to 5dp.
5. **Deep-link ordering** — `routeFromHash('#/expedition/room_abc')` returns `'backpacks'` (proving
   the fallback is the hazard) AND `initRouting()` with that hash yields
   `{route:'expedition', expeditionRoomId:'room_abc'}` (proving the regex wins).
6. **Server:** the run view with no `clock` param is byte-identical to before (deep-equal against the
   pre-change shape minus the additive field); with `?clock=sim` it gates on `t` and carries
   `simDurationSecs`.
7. **`pnpm exec tsc --noEmit`** + lint. `server/tests/api/schedule.cjs` green (it asserts
   `simDurationSecs` exists on the run doc at `:475`).

## 15. Acceptance criteria

1. `#/expedition/<roomId>` resolves to `route === 'expedition'` with `expeditionRoomId === '<roomId>'`,
   from a cold load AND from a `hashchange`; bare `#/expedition` resolves with a null id and renders
   the empty state, not a crash.
2. Both lists in `core.ts` carry `'expedition'`, and gate 14.1 fails if either is reverted.
3. The 全画面 button appears on the REQ-0240 monitor header between the return clock and the ⋯ menu,
   and navigates to `#/expedition/<room.id>`. With `fullscreenHref` absent, `MonitorHeader`'s output
   is byte-identical to REQ-0240's.
4. Navigating expedition→backpacks→expedition **20 times** leaves both boards interactive and the
   expedition stage live; the expedition's `Application` is constructed **exactly once**
   (assert via a construction counter, not by eye) and `destroy()` is never called on a route switch.
5. At 1920x1080 the stage is `row`, scale 0.90909, cell 36.36px, letterboxed 212.7px top and bottom.
   At 1080x1920 it is `column`, scale 1.03846, cell 41.54px. At **1280x1024 it is `column`** (§7.3).
6. No scrollbar appears at any viewport from 390x844 to 3840x2160; the stage always fits.
7. `#/expedition` never imports `useRunPlayhead` or `pacingClient` (assert by import-graph/grep test),
   and never reads `ev.pt`. `#/schedule` still does both and is unchanged.
8. The run view without `?clock=sim` is unchanged for every existing consumer.
9. The rail and header are hidden on `#/expedition`; a back affordance and `Escape` both return to
   `#/schedule`.
10. Under `getReducedMotion() === true` the expedition starts **no rAF loop** (assert the loop is not
    constructed, not merely that it draws nothing).
11. The shell draws **zero** glow sources (§11.2).
12. The user has ruled on §9.4, §9.2's server seam, and §7.3's threshold.
