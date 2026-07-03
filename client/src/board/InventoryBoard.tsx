// React wrapper for BoardRenderer (INVENTORY board) — REQ-0030 Phase 2.
// Sibling of board/Board.tsx: mounts a SECOND, independent PixiJS
// Application/<canvas>, rendering the ACTIVE tab's inventory page (same
// grid dimensions as canvas, neutral background, dimmed/dormant linkers,
// no beams/combos/◇/◆ -- all enforced inside BoardRenderer itself via
// `ops.isCanvas===false`, see BoardRenderer.ts's render()).
//
// Remount-on-tab-switch: BoardOps binds a page index at construction time
// (see board/boardOps.ts's makeInvOps(engine, page)) -- there is no
// "re-point this renderer at a different page" operation, so switching
// tabs destroys the current BoardRenderer instance and mounts a fresh one
// bound to the new page's ops. This matches the task spec's "switching
// tabs re-renders the inventory board only" -- the canvas board's own
// effect/subscription never depends on activeInvPage, so it is untouched
// by a tab switch. Texture loading is cached (loadSpriteTextures()'s
// module-level promise), so a tab-switch remount never re-decodes sprite
// art -- only a new (cheap) PixiJS Application + a fresh render() call.
import { useEffect, useRef, useState } from 'react';
import { BoardRenderer } from './BoardRenderer';
import { makeInvOps } from './boardOps';
import { loadSpriteTextures } from './sprites';
import { useGameStore } from '../store';

export function InventoryBoard() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const snapshot = useGameStore();
  const page = snapshot.activeInvPage;

  useEffect(() => {
    if (snapshot.status !== 'ready' || !snapshot.engine || !snapshot.gameData || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const { engine, gameData } = snapshot;
    setReady(false);

    (async () => {
      const textures = await loadSpriteTextures();
      if (cancelled) return;
      const renderer = await BoardRenderer.mount(canvas, {
        engine,
        items: gameData.ITEMS,
        siDefs: gameData.SI_DEFS,
        textures,
        layout: gameData.LAYOUT,
        ops: makeInvOps(engine, page),
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
      setReady(false);
    };
    // Remount whenever the active page changes (BoardOps' page index is
    // fixed at construction) or once boot completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.status === 'ready', page]);

  useEffect(() => {
    if (ready && rendererRef.current && snapshot.state) {
      rendererRef.current.render(snapshot.state);
    }
  }, [ready, snapshot.state, snapshot.stateVersion]);

  if (snapshot.status === 'loading') {
    return <div className="board-placeholder">Loading inventory…</div>;
  }
  if (snapshot.status === 'error') {
    return <div className="board-placeholder board-error">Inventory unavailable: {snapshot.error}</div>;
  }

  return <canvas ref={canvasRef} className="board-canvas inventory-board-canvas" />;
}
