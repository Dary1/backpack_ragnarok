// React wrapper for BoardRenderer — REQ-0026 T0.1, extended REQ-0027 T0.2.
// Mounts a <canvas>, boots the PixiJS Application once, then re-renders on
// every store change. All game state lives in src/store.ts (module-level,
// outside React) -- this component only reads the store snapshot and
// forwards it to the framework-free BoardRenderer.
//
// REQ-0027 T0.2 additions:
//  - `getBoardRenderer()`: a tiny module-level accessor (same pattern as
//    store.ts's own module-level state) so the React inventory panel
//    (ItemPanel.tsx), which lives in a SEPARATE DOM subtree from this
//    canvas, can call `renderer.startExternalDrag(...)` when a drag starts
//    on an inventory entry -- the ghost/ legality-preview must render on
//    the BOARD canvas even though the drag originates in a React panel.
//  - `setInventoryPanelEl(el)`: registers the inventory panel's DOM node so
//    BoardRenderer's isOverInventory callback can do viewport-space
//    bounding-rect containment against it. This is the REQ-0027 T0.2
//    adaptation for "inventory drop-zone detection" called out in the task
//    spec: the mock computes this via one SVG-local x threshold (its
//    inventory panel lives inside the same big SVG as the board); here the
//    board is a separate <canvas> from the React-rendered inventory panel
//    (different DOM element entirely), so viewport bounding-rect
//    containment is the natural equivalent -- documented here rather than
//    silently reusing the mock's coordinate math, since the DOM structure
//    genuinely differs.
import { useEffect, useRef, useState } from 'react';
import { BoardRenderer } from './BoardRenderer';
import { loadSpriteTextures } from './sprites';
import { useGameStore } from '../store';

let activeRenderer: BoardRenderer | null = null;
let inventoryPanelEl: HTMLElement | null = null;

/** Registers (or clears, pass null) the inventory panel's DOM node --
 * called by ItemPanel.tsx on mount/unmount. */
export function setInventoryPanelEl(el: HTMLElement | null): void {
  inventoryPanelEl = el;
}

function isOverInventory(clientX: number, clientY: number): boolean {
  if (!inventoryPanelEl) return false;
  const r = inventoryPanelEl.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** Returns the currently-mounted BoardRenderer, or null before Board has
 * finished mounting -- used by ItemPanel.tsx to start a drag whose ghost
 * must render on the canvas even though the pointerdown happened in React
 * DOM. */
export function getBoardRenderer(): BoardRenderer | null {
  return activeRenderer;
}

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
      const textures = await loadSpriteTextures();
      if (cancelled) return;
      const renderer = await BoardRenderer.mount(
        canvas,
        {
          engine,
          items: gameData.ITEMS,
          siDefs: gameData.SI_DEFS,
          textures,
          layout: gameData.LAYOUT,
        },
        { isOverInventory }
      );
      if (cancelled) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      activeRenderer = renderer;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      if (activeRenderer === rendererRef.current) activeRenderer = null;
      setReady(false);
    };
    // Board is (re)mounted once per successful boot; state updates after
    // that are handled by the render effect below, not by remounting Pixi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.status === 'ready']);

  useEffect(() => {
    if (ready && rendererRef.current && snapshot.state) {
      rendererRef.current.render(snapshot.state);
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
