// App shell — REQ-0026 T0.1.
// Composition only: Header (data-source badge, JA/EN toggle) + Board
// (PixiJS, read-only) + ItemPanel (hover tooltips). All game data/state
// lives in src/store.ts (module-level, outside React); this component and
// its children only read the store snapshot via useGameStore().
import { Board } from './board/Board';
import { Header } from './Header';
import { ItemPanel } from './ItemPanel';
import { setLocale, useGameStore } from './store';

function App() {
  const snapshot = useGameStore();

  const toggleLocale = () => setLocale(snapshot.locale === 'ja' ? 'en' : 'ja');

  return (
    <div className="app-shell">
      <Header source={snapshot.source} locale={snapshot.locale} onToggleLocale={toggleLocale} />
      <main className="app-main">
        <div className="board-wrap">
          <Board />
        </div>
        {snapshot.status === 'ready' && snapshot.gameData ? (
          <ItemPanel items={snapshot.gameData.ITEMS} siDefs={snapshot.gameData.SI_DEFS} locale={snapshot.locale} />
        ) : null}
      </main>
    </div>
  );
}

export default App;
