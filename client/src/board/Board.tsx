// React wrapper for BoardRenderer (CANVAS board) — REQ-0026 T0.1, extended
// REQ-0027 T0.2, extended REQ-0030 Phase 2. Mounts a <canvas>, boots the
// PixiJS Application once, then re-renders on every store change. All game
// state lives in src/store.ts (module-level, outside React) -- this
// component only reads the store snapshot and forwards it to the
// framework-free BoardRenderer, bound to CANVAS ops (see board/boardOps.ts)
// -- the sibling InventoryBoard.tsx mounts a SECOND, independent
// BoardRenderer instance bound to inventory-page ops for the active tab.
//
// REQ-0030 Phase 2 changes from T0.2:
//  - BoardDeps now requires `ops` (makeCanvasOps(engine) here); the old
//    isOverInventory callback (React DOM inventory panel drop-zone
//    detection) is gone -- the inventory is a real second PixiJS board
//    now, and cross-board drag resolution is handled by drag.ts's board
//    registry + centralized pointerup commit (see drag.ts's module
//    comment), not by viewport bounding-rect containment against a panel
//    DOM node.
//  - `getBoardRenderer()`/`setInventoryPanelEl()` (T0.2's React-panel drag
//    plumbing) are retired along with ItemPanel.tsx's old drag-source
//    inventory list.
import { useEffect, useRef, useState } from 'react';
import { BoardRenderer } from './BoardRenderer';
import { makeCanvasOps } from './boardOps';
import { loadBoardTextures } from './sprites';
import { useGameStore } from '../store';

export function Board() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const snapshot = useGameStore();

  useEffect(() => {
    if (snapshot.status !== 'ready' || !snapshot.engine || !snapshot.gameData || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const { engine, gameData } = snapshot;

    (async () => {
      const textures = await loadBoardTextures();
      if (cancelled) return;
      const renderer = await BoardRenderer.mount(canvas, {
        engine,
        items: gameData.ITEMS,
        siDefs: gameData.SI_DEFS,
        textures,
        layout: gameData.LAYOUT,
        ops: makeCanvasOps(engine),
      });
      if (cancelled) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      // REQ-0331 (F4): the readiness marker dies with the renderer.
      canvasRef.current?.removeAttribute('data-board-ready');
      setReady(false);
    };
    // Board is (re)mounted once per successful boot; state updates after
    // that are handled by the render effect below, not by remounting Pixi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.status === 'ready']);

  useEffect(() => {
    if (ready && rendererRef.current && snapshot.state) {
      rendererRef.current.render(snapshot.state);
      // REQ-0331 (F4): e2e used to approximate "the board has painted" with
      // a fixed 400ms sleep at the end of helpers.ts bootApp() -- the most-
      // executed wall-clock wait in the suite (~180 runs) and a load-
      // sensitive one. Publish the fact instead, set AFTER the first real
      // render() so it is true exactly when the sleep was trying to be true.
      // Purely additive: a data attribute nothing in the app itself reads.
      canvasRef.current?.setAttribute('data-board-ready', '1');
    }
  }, [ready, snapshot.state, snapshot.stateVersion]);

  if (snapshot.status === 'loading') {
    return <div className="board-placeholder">Loading board…</div>;
  }
  if (snapshot.status === 'error') {
    return <div className="board-placeholder board-error">Board unavailable: {snapshot.error}</div>;
  }

  return <canvas ref={canvasRef} className="board-canvas" />;
}
