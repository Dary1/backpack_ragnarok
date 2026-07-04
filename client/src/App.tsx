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
import { useEffect } from 'react';
import { Board } from './board/Board';
import { InventoryBoard } from './board/InventoryBoard';
import { DexRoot } from './dex/DexRoot';
import { Header } from './Header';
import { ItemPanel } from './ItemPanel';
import { PlaceholderPage } from './PlaceholderPage';
import { PresetTabs } from './PresetTabs';
import { Tabs } from './Tabs';
import { initRouting, setLocale, useGameStore } from './store';

function App() {
  const snapshot = useGameStore();

  useEffect(() => {
    const unsubscribe = initRouting();
    return unsubscribe;
  }, []);

  const toggleLocale = () => setLocale(snapshot.locale === 'ja' ? 'en' : 'ja');
  const route = snapshot.route;

  return (
    <div className="app-shell">
      <Header
        source={snapshot.source}
        locale={snapshot.locale}
        onToggleLocale={toggleLocale}
        autoSaveStatus={snapshot.autoSaveStatus}
        route={route}
      />
      <main className="app-main">
        {/* Backpacks view: ALWAYS mounted (see module comment above). Only
            visibility (CSS) changes with route. */}
        <div className={`backpacks-view${route === 'backpacks' ? '' : ' route-hidden'}`}>
          <div className="board-column">
            <div className="board-column-header">
              <h2 className="board-column-title">{snapshot.locale === 'ja' ? 'キャンバス' : 'Canvas'}</h2>
              {snapshot.status === 'ready' ? <PresetTabs /> : null}
            </div>
            <div className="board-wrap">
              <Board />
            </div>
          </div>
          <div className="board-column">
            <div className="board-column-header">
              <h2 className="board-column-title">{snapshot.locale === 'ja' ? 'インベントリ' : 'Inventory'}</h2>
              {snapshot.status === 'ready' ? <Tabs /> : null}
            </div>
            <div className="board-wrap">
              <InventoryBoard />
            </div>
            <div className="inventory-note">
              {snapshot.locale === 'ja' ? '格納中のアイテムは効果を発揮しません' : 'items parked here take no effect'}
            </div>
          </div>
          {snapshot.status === 'ready' && snapshot.gameData ? (
            <ItemPanel items={snapshot.gameData.ITEMS} siDefs={snapshot.gameData.SI_DEFS} locale={snapshot.locale} />
          ) : null}
        </div>

        {route === 'schedule' ? (
          <PlaceholderPage titleJa="スケジュール" titleEn="Schedule" locale={snapshot.locale} />
        ) : null}
        {route === 'friends' ? (
          <PlaceholderPage titleJa="フレンズ" titleEn="Friends" locale={snapshot.locale} />
        ) : null}
        {route === 'settings' ? (
          <PlaceholderPage titleJa="設定" titleEn="Settings" locale={snapshot.locale} />
        ) : null}
        {route === 'dex' ? <DexRoot locale={snapshot.locale} /> : null}
      </main>
    </div>
  );
}

export default App;
