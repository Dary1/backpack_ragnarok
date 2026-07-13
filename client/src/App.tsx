// App shell — REQ-0026 T0.1, extended REQ-0027 T0.2 (Save/Load wiring,
// retired REQ-0031 Phase B), extended REQ-0030 Phase 2 (tabbed inventory
// board replaces the old list-panel inventory UI), extended REQ-0034
// (global nav + hash routing) and REQ-0035 (Dex route). Composition only:
// Header (title, Nav, data-source badge, JA/EN toggle, auto-save
// indicator) + route content. All game data/state lives in src/store.ts
// (module-level, outside React); this component and its children only
// read the store snapshot via useGameStore().
//
// REQ-0031 Phase B UI restructure (verbatim user change requests):
//  - Inventory: tabs move INTO the "Inventory" label row (right-aligned,
//    same block -- see .board-column-header below); "items parked here
//    take no effect" moves BELOW the inventory board container,
//    left-aligned (was above the tabs/board before).
//  - Canvas: "Canvas" title block gains Squad tabs (1-5, dynamic count)
//    right-aligned in the same row + a "Squad+" button (SquadTabs.tsx).
//
// REQ-0034 CRITICAL constraint (hard lesson from REQ-0031 Phase A bug 2 --
// see docs/REQ/REQ-0031-e2e-bugfix-squads-ui.md section 2 and
// docs/REQ/REQ-0034-global-navigation.md): the backpacks section (Board +
// InventoryBoard, each its own PixiJS Application) is rendered
// UNCONDITIONALLY below, exactly like before REQ-0034 -- it is NEVER
// wrapped in `{route === 'backpacks' && ...}` or any other conditional
// that would unmount it. Switching to a different nav route only adds
// `.route-hidden` (display:none, see index.css) to its wrapping
// <div className="backpacks-view">; the components themselves, their
// Pixi Applications, and their <canvas> elements stay mounted in the DOM
// at all times. This is what makes "route away and back N times, boards
// still interactive" hold -- there is no remount for a route switch to
// ever race.
//
// REQ-0037: #/settings now renders the dedicated Settings component
// (account block + logout, REQ-0037; bot-mode placeholder, REQ-0039
// "Now") instead of the generic PlaceholderPage. An InviteBanner renders
// at the top level (outside the route switch, like Header) so the
// welcome toast can appear regardless of which route the invite flow
// redirected onto.
//
// REQ-0038: chrome strings below (Canvas/Inventory titles, inventory
// note, placeholder titles) now go through ./i18n.ts's t() instead of
// inline locale ternaries.
//
// REQ-0032: the Canvas column's .board-wrap gets a second modifier class
// (.board-wrap-canvas, position:relative) so SquadTrashZone can center
// itself over exactly this box via CSS absolute positioning -- the
// inventory column's own .board-wrap is untouched (inventory tabs never
// show a trash zone, so there is nothing to position there).
//
// REQ-0041: the inventory column (Tabs + InventoryBoard + its note) now
// renders via a PORTAL (react-dom's createPortal) instead of always
// rendering directly here -- see board/inventorySlot.ts's module comment
// for the full Pixi-instance decision writeup ("reuse the existing
// InventoryBoard/Tabs instance via a portal" vs "stand up a second Pixi
// Application", and why the former was chosen). useInventorySlot()
// returns null by DEFAULT (nothing has claimed the slot), in which case
// the inventory column renders in its NORMAL Backpacks-page position
// exactly as before (a portal with a null target is simply "render
// nowhere else", so createPortal is only actually invoked once some
// consumer -- WarehouseTab.tsx -- registers a slot element). This is a
// STRICT ADDITIVE change to this component's existing behavior: with no
// slot registered (the common case, including every existing E2E spec),
// this file's rendered output is byte-identical to before.
//
// REQ-0069: adds the 'landing' (title) route + the MJOLNIR chrome. The
// global nav moved OUT of Header into the fixed left rail (Nav.tsx,
// composed directly here now); BOTH the rail and the HUD header hide on
// the landing route, which renders the full-bleed title screen
// (landing/LandingPage.tsx) instead. The REQ-0034 hard rule above is
// untouched by all of this: the backpacks-view stays UNCONDITIONALLY
// mounted on every route (including 'landing') and only ever toggles
// .route-hidden.
//
// REQ-0070: the backpacks view is re-skinned to the MJOLNIR canvas mock
// (web/redesign/canvas.html): page key art, stagehead title rows, ornate
// board stages around BOTH always-mounted Pixi boards, the squad tabs
// relocated from the canvas title row into the stage's boardfoot (same
// SquadTabs component and classes -- only the render slot moved), a
// boardfoot auto-save seal, live board-content stats in the stagehead,
// and the fixed embark dock (all in CanvasChrome.tsx). The REQ-0034
// always-mounted rule above is untouched: both boards keep their Pixi
// Applications through all of this; the new chrome is plain DOM around
// the same <canvas> elements.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Board } from './board/Board';
import { InventoryBoard } from './board/InventoryBoard';
import { useInventorySlot } from './board/inventorySlot';
import { BoardCoords, CanvasStatsChip, EmbarkDock, SaveSeal } from './CanvasChrome';
import { DexRoot } from './dex/DexRoot';
import { DexCardProvider } from './dex/DexCardWindow'; // REQ-0052
import { Header } from './Header';
import { t } from './i18n';
import { FloatingItemTip } from './FloatingItemTip';
// REQ-0142: the link-trace panel, mounted app-level for the same reason the
// item tip is -- it floats over whichever board the pointer is interrogating.
import { BeamTracePanel } from './BeamTracePanel';
import { InviteBanner } from './InviteBanner';
import { LandingPage } from './landing/LandingPage';
import { Nav } from './Nav';
import { PlaceholderPage } from './PlaceholderPage';
import { SchedulePage } from './schedule/SchedulePage';
import { WarehousePage } from './warehouse/WarehousePage'; // REQ-0086
import { WorkshopPage } from './schedule/WorkshopPage'; // REQ-0042
import { MarketPage } from './market/MarketPage'; // REQ-0064
import { RagnarokPage } from './ragnarok/RagnarokPage'; // REQ-0066
import { SquadTabs } from './SquadTabs';
import { SquadTrashZone } from './SquadTrashZone';
import { Settings } from './Settings';
import { Tabs } from './Tabs';
import { initRouting, setLocale, useGameStore } from './store';

/** The inventory column's actual content (Tabs + board-wrap +
 * InventoryBoard + note) -- extracted to its own function so it can be
 * rendered EITHER inline (normal Backpacks-page position, default) OR
 * via createPortal into a WarehouseTab-registered slot, with the exact
 * same JSX either way (no behavior fork -- see module comment above). */
function InventoryColumn({ locale, ready }: { locale: ReturnType<typeof useGameStore>['locale']; ready: boolean }) {
  // REQ-0070: stagehead title row (ja shows the mock's EN sub-caption; the
  // key is empty for EN, so nothing doubles up) + the ornate MJOLNIR board
  // stage around the SAME always-mounted InventoryBoard. Structure-only
  // restyle: Tabs/board/note keep their classes and relative order (the
  // E2E suite selects .inv-tab / canvas.inventory-board-canvas).
  const sub = t(locale, 'app.inventorySub');
  return (
    <div className="board-column">
      <div className="board-column-header">
        <h2 className="board-column-title">{t(locale, 'app.inventoryTitle')}</h2>
        {sub ? <span className="stagehead-en">{sub}</span> : null}
        {ready ? <Tabs /> : null}
      </div>
      <div className="board-wrap board-stage ornate">
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />
        <div className="board-gridbox">
          <InventoryBoard />
        </div>
      </div>
      <div className="inventory-note">{t(locale, 'app.inventoryNote')}</div>
    </div>
  );
}

function App() {
  const snapshot = useGameStore();

  useEffect(() => {
    const unsubscribe = initRouting();
    return unsubscribe;
  }, []);

  const toggleLocale = () => setLocale(snapshot.locale === 'ja' ? 'en' : 'ja');
  const route = snapshot.route;
  // REQ-0041: null (default) unless WarehouseTab.tsx has registered its
  // own slot element -- see board/inventorySlot.ts / InventoryColumn doc
  // above. When non-null, the inventory column portals THERE instead of
  // rendering in its normal spot below (a single physical DOM subtree
  // can only be in one place at a time, which is correct: the Warehouse
  // tab and the Backpacks page are never both the current route).
  const inventorySlot = useInventorySlot();
  const inventoryReady = snapshot.status === 'ready';
  // REQ-0069: the app chrome (nav rail + HUD header) hides on the landing
  // (title) route -- the landing is a full-bleed screen with its own menu.
  // Hiding it is a plain conditional on two leaf components that own no
  // game state and no Pixi surface; everything below (crucially the
  // always-mounted backpacks-view) renders exactly as before.
  const onLanding = route === 'landing';

  return (
    <DexCardProvider locale={snapshot.locale}>
    <div className={`app-shell${onLanding ? '' : ' with-rail'}`}>
      {onLanding ? null : <Nav active={route} locale={snapshot.locale} />}
      {onLanding ? null : (
        <Header
          source={snapshot.source}
          locale={snapshot.locale}
          onToggleLocale={toggleLocale}
          autoSaveStatus={snapshot.autoSaveStatus}
        />
      )}
      <InviteBanner text={snapshot.welcomeBanner} locale={snapshot.locale} />
      <main className="app-main">
        {/* Backpacks view: ALWAYS mounted (see module comment above). Only
            visibility (CSS) changes with route. */}
        <div className={`backpacks-view${route === 'backpacks' ? '' : ' route-hidden'}`}>
          {/* REQ-0070: full-viewport key art behind the canvas page (mock
              .bgart, served from /redesign/assets -- referenced, never
              bundled). position:fixed, but nested INSIDE this view so the
              route's .route-hidden (display:none on the ancestor) hides it
              along with everything else. */}
          <div className="canvas-bgart" aria-hidden="true" />
          <div className="board-column">
            <div className="board-column-header">
              <h2 className="board-column-title">{t(snapshot.locale, 'app.canvasTitle')}</h2>
              {t(snapshot.locale, 'app.canvasSub') ? (
                <span className="stagehead-en">{t(snapshot.locale, 'app.canvasSub')}</span>
              ) : null}
              <CanvasStatsChip />
            </div>
            {/* REQ-0070: the mock's ornate board stage. The Pixi <canvas>
                (Board) is untouched inside -- only the chrome around it is
                new (gold-knot corners, coordinate rails, boardfoot). The
                squad tabs moved from the title row above into the mock's
                boardfoot INSIDE the stage: same SquadTabs component, same
                classes/gestures (click/long-press-rename/drag-reorder/
                trash-drop), only the render slot changed. */}
            <div className="board-wrap board-wrap-canvas board-stage ornate">
              <i className="k tl" />
              <i className="k tr" />
              <i className="k br" />
              <i className="k bl" />
              <div className="board-gridbox">
                <Board />
                <BoardCoords />
              </div>
              <div className="boardfoot">
                {snapshot.status === 'ready' ? <SquadTabs /> : null}
                <SaveSeal locale={snapshot.locale} status={snapshot.autoSaveStatus} />
              </div>
              {/* REQ-0032: trash-drop-zone overlay, ONLY visible while a
                  SQUAD tab is being dragged (see SquadTrashZone.tsx's own
                  module comment -- inventory-tab drags never satisfy its
                  kind==='squad' gate). Centered over the Canvas board via
                  CSS (.squad-trash-zone, absolutely positioned within
                  this relatively-positioned .board-wrap-canvas). */}
              <SquadTrashZone />
            </div>
          </div>
          {/* REQ-0041: render the inventory column INLINE here only when
              no slot has claimed it (see InventoryColumn's doc above) --
              otherwise it portals into the Warehouse tab's slot instead,
              and THIS position renders nothing (not even an empty
              .board-column -- when the Warehouse tab is open, this
              backpacks-view is itself route-hidden anyway, so there is no
              visible gap either way). */}
          {inventorySlot === null ? <InventoryColumn locale={snapshot.locale} ready={inventoryReady} /> : null}
          {/* REQ-0114: the ItemList (the ItemPanel item/SI catalog) is
              intentionally NOT rendered on the backpacks view, per user
              request. The Canvas and Inventory columns above are unchanged;
              only this third panel is removed, and its import above is
              dropped accordingly (noUnusedLocals). */}
          {/* REQ-0070: the mock's embark dock -- fixed bottom-right CTA to
              the real expedition page. Inside backpacks-view so
              route-hidden hides it (fixed positioning does not escape an
              ancestor's display:none). */}
          <EmbarkDock locale={snapshot.locale} />
        </div>

        {/* REQ-0041: portal target -- when WarehouseTab.tsx has registered
            a slot, the SAME InventoryColumn (same Tabs/InventoryBoard/
            canvas/Pixi Application instance -- see inventorySlot.ts's doc)
            renders there instead, via createPortal. Rendered OUTSIDE the
            backpacks-view/route-hidden switch above (a portal's physical
            DOM location is wherever its target element lives -- always
            somewhere inside SchedulePage's own tree here -- so its
            visibility already naturally follows the Schedule/Warehouse
            tab being on-screen; no additional route-hidden bookkeeping is
            needed for the portaled copy). */}
        {inventorySlot !== null ? createPortal(<InventoryColumn locale={snapshot.locale} ready={inventoryReady} />, inventorySlot) : null}

        {route === 'landing' ? <LandingPage locale={snapshot.locale} me={snapshot.me} /> : null}
        {route === 'schedule' ? <SchedulePage locale={snapshot.locale} /> : null}
        {route === 'warehouse' ? <WarehousePage locale={snapshot.locale} /> : null}
        {route === 'workshop' ? <WorkshopPage locale={snapshot.locale} /> : null}
        {/* REQ-0069: mock-rail routes whose real pages land in later REQs. */}
        {route === 'market' ? <MarketPage locale={snapshot.locale} /> : null}
        {route === 'ragnarok' ? <RagnarokPage locale={snapshot.locale} /> : null}
        {route === 'friends' ? <PlaceholderPage titleKey="nav.friends" locale={snapshot.locale} /> : null}
        {route === 'settings' ? <Settings locale={snapshot.locale} /> : null}
        {route === 'dex' ? <DexRoot locale={snapshot.locale} dexFocusId={snapshot.dexFocusId} /> : null}

        {/* REQ-0119: one global floating item-tooltip overlay. Fixed-
            positioned and driven by board/itemTip.ts's pub-sub, so this
            single instance serves the canvas board AND every inventory-page
            board (including the warehouse/expedition portal reuse) with no
            per-page wiring. */}
        <FloatingItemTip />
        <BeamTracePanel />
      </main>
    </div>
    </DexCardProvider>
  );
}

export default App;
