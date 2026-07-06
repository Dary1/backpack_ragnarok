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
//  - Canvas: "Canvas" title block gains Preset tabs (1-5, dynamic count)
//    right-aligned in the same row + a "Preset+" button (PresetTabs.tsx).
//
// REQ-0034 CRITICAL constraint (hard lesson from REQ-0031 Phase A bug 2 --
// see docs/REQ/REQ-0031-e2e-bugfix-presets-ui.md section 2 and
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
// (.board-wrap-canvas, position:relative) so PresetTrashZone can center
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
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Board } from './board/Board';
import { InventoryBoard } from './board/InventoryBoard';
import { useInventorySlot } from './board/inventorySlot';
import { DexRoot } from './dex/DexRoot';
import { Header } from './Header';
import { t } from './i18n';
import { InviteBanner } from './InviteBanner';
import { ItemPanel } from './ItemPanel';
import { LandingPage } from './landing/LandingPage';
import { Nav } from './Nav';
import { PlaceholderPage } from './PlaceholderPage';
import { SchedulePage } from './schedule/SchedulePage';
import { WorkshopPage } from './schedule/WorkshopPage'; // REQ-0042
import { PresetTabs } from './PresetTabs';
import { PresetTrashZone } from './PresetTrashZone';
import { Settings } from './Settings';
import { Tabs } from './Tabs';
import { initRouting, setLocale, useGameStore } from './store';

/** The inventory column's actual content (Tabs + board-wrap +
 * InventoryBoard + note) -- extracted to its own function so it can be
 * rendered EITHER inline (normal Backpacks-page position, default) OR
 * via createPortal into a WarehouseTab-registered slot, with the exact
 * same JSX either way (no behavior fork -- see module comment above). */
function InventoryColumn({ locale, ready }: { locale: ReturnType<typeof useGameStore>['locale']; ready: boolean }) {
  return (
    <div className="board-column">
      <div className="board-column-header">
        <h2 className="board-column-title">{t(locale, 'app.inventoryTitle')}</h2>
        {ready ? <Tabs /> : null}
      </div>
      <div className="board-wrap">
        <InventoryBoard />
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
          <div className="board-column">
            <div className="board-column-header">
              <h2 className="board-column-title">{t(snapshot.locale, 'app.canvasTitle')}</h2>
              {snapshot.status === 'ready' ? <PresetTabs /> : null}
            </div>
            <div className="board-wrap board-wrap-canvas">
              <Board />
              {/* REQ-0032: trash-drop-zone overlay, ONLY visible while a
                  PRESET tab is being dragged (see PresetTrashZone.tsx's own
                  module comment -- inventory-tab drags never satisfy its
                  kind==='preset' gate). Centered over the Canvas board via
                  CSS (.preset-trash-zone, absolutely positioned within
                  this relatively-positioned .board-wrap-canvas). */}
              <PresetTrashZone />
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
          {snapshot.status === 'ready' && snapshot.gameData ? (
            <ItemPanel items={snapshot.gameData.ITEMS} siDefs={snapshot.gameData.SI_DEFS} locale={snapshot.locale} />
          ) : null}
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
        {route === 'workshop' ? <WorkshopPage locale={snapshot.locale} /> : null}
        {/* REQ-0069: mock-rail routes whose real pages land in later REQs. */}
        {route === 'market' ? <PlaceholderPage titleKey="nav.market" locale={snapshot.locale} /> : null}
        {route === 'ragnarok' ? <PlaceholderPage titleKey="nav.ragnarok" locale={snapshot.locale} /> : null}
        {route === 'friends' ? <PlaceholderPage titleKey="nav.friends" locale={snapshot.locale} /> : null}
        {route === 'settings' ? <Settings locale={snapshot.locale} /> : null}
        {route === 'dex' ? <DexRoot locale={snapshot.locale} /> : null}
      </main>
    </div>
  );
}

export default App;
