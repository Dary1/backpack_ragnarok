// App shell — REQ-0026 T0.1, extended REQ-0027 T0.2 (Save/Load wiring),
// extended REQ-0030 Phase 2 (tabbed inventory board replaces the old
// list-panel inventory UI). Composition only: Header (data-source badge,
// JA/EN toggle, Save/Load) + Board (canvas, PixiJS) + Tabs + InventoryBoard
// (the active page, a SECOND independent PixiJS board) + ItemPanel
// (read-only catalog + tooltips, drag-source list retired). All game
// data/state lives in src/store.ts (module-level, outside React); this
// component and its children only read the store snapshot via
// useGameStore().
import { Board } from './board/Board';
import { InventoryBoard } from './board/InventoryBoard';
import { Header } from './Header';
import { ItemPanel } from './ItemPanel';
import { Tabs } from './Tabs';
import { setLocale, useGameStore } from './store';

function App() {
  const snapshot = useGameStore();

  const toggleLocale = () => setLocale(snapshot.locale === 'ja' ? 'en' : 'ja');

  return (
    <div className="app-shell">
      <Header
        source={snapshot.source}
        locale={snapshot.locale}
        onToggleLocale={toggleLocale}
        autoSaveStatus={snapshot.autoSaveStatus}
      />
      <main className="app-main">
        <div className="board-column">
          <h2 className="board-column-title">{snapshot.locale === 'ja' ? 'キャンバス' : 'Canvas'}</h2>
          <div className="board-wrap">
            <Board />
          </div>
        </div>
        <div className="board-column">
          <h2 className="board-column-title">{snapshot.locale === 'ja' ? 'インベントリ' : 'Inventory'}</h2>
          <div className="inventory-note">
            {snapshot.locale === 'ja' ? '格納中のアイテムは効果を発揮しません' : 'items parked here take no effect'}
          </div>
          {snapshot.status === 'ready' ? <Tabs /> : null}
          <div className="board-wrap">
            <InventoryBoard />
          </div>
        </div>
        {snapshot.status === 'ready' && snapshot.gameData ? (
          <ItemPanel items={snapshot.gameData.ITEMS} siDefs={snapshot.gameData.SI_DEFS} locale={snapshot.locale} />
        ) : null}
      </main>
    </div>
  );
}

export default App;
