// App shell — REQ-0026 T0.1, extended REQ-0027 T0.2 (Save/Load wiring).
// Composition only: Header (data-source badge, JA/EN toggle, Save/Load) +
// Board (PixiJS, now interactive) + ItemPanel (live inventory drag source +
// catalog tooltips). All game data/state lives in src/store.ts (module-
// level, outside React); this component and its children only read the
// store snapshot via useGameStore().
import { Board } from './board/Board';
import { Header } from './Header';
import { ItemPanel } from './ItemPanel';
import { loadGame, saveGame, setLocale, useGameStore } from './store';

function App() {
  const snapshot = useGameStore();

  const toggleLocale = () => setLocale(snapshot.locale === 'ja' ? 'en' : 'ja');

  return (
    <div className="app-shell">
      <Header
        source={snapshot.source}
        locale={snapshot.locale}
        onToggleLocale={toggleLocale}
        onSave={() => void saveGame()}
        onLoad={() => void loadGame()}
        ioStatus={snapshot.ioStatus}
        canEdit={snapshot.status === 'ready'}
      />
      <main className="app-main">
        <div className="board-wrap">
          <Board />
        </div>
        {snapshot.status === 'ready' && snapshot.gameData ? (
          <ItemPanel
            items={snapshot.gameData.ITEMS}
            siDefs={snapshot.gameData.SI_DEFS}
            locale={snapshot.locale}
            state={snapshot.state}
          />
        ) : null}
      </main>
    </div>
  );
}

export default App;
