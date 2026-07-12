// React wrapper for BoardRenderer (INVENTORY board) — REQ-0030 Phase 2,
// fixed REQ-0031 Phase A (tab-switch freeze).
//
// Sibling of board/Board.tsx: mounts a SECOND, independent PixiJS
// Application/<canvas>, rendering the ACTIVE tab's inventory page (same
// grid dimensions as canvas, neutral background, dimmed/dormant units,
// no beams/combos/◇/◆ -- all enforced inside BoardRenderer itself via
// `ops.isCanvas===false`, see BoardRenderer.ts's render()).
//
// REQ-0031 Phase A fix -- persistent mount, ops-swap on tab switch (NOT
// remount-per-tab-switch): the original REQ-0030 Phase 2 design destroyed
// and recreated the whole BoardRenderer (a new PixiJS Application, a new
// WebGL context on the SAME <canvas> element) every time `page` changed,
// on the theory that "BoardOps binds a page index at construction time,
// so there is no re-point operation". That theory turned out to be fixable
// rather than fundamental: BoardRenderer now exposes `setOps()` (see its
// doc comment) precisely so a mounted board CAN be re-pointed at a
// different page's ops without touching the Application/canvas/context at
// all. The remount pattern was also the CONFIRMED root cause of a real bug
// (see REQ-0031 Phase A's E2E test `tab-switch-stability.spec.ts` and
// BoardRenderer.setOps's doc comment for the live-reproduced mechanism:
// destroying a WebGL context via WEBGL_lose_context.loseContext() is
// asynchronous, and immediately creating a new context on the same canvas
// before the old one finished tearing down left this box's software GL
// driver (swiftshader -- no real GPU in this server environment) unable to
// ever successfully compile a shader again, spinning PixiJS's
// checkMaxIfStatementsInShader() into a genuine infinite loop -- confirmed
// via a CDP Debugger.pause captured mid-hang). So: mount ONCE (same
// lifecycle shape as Board.tsx's canvas board -- effect deps only depend on
// boot-readiness, never on `page`), and swap ops + re-render via a second,
// separate effect keyed on `page`.
import { useEffect, useRef, useState } from 'react';
import { BoardRenderer } from './BoardRenderer';
import { makeInvOps } from './boardOps';
import { setInventoryRenderer } from './inventoryRenderer';
import { loadBoardTextures } from './sprites';
import { useGameStore } from '../store';

export function InventoryBoard() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const snapshot = useGameStore();
  const page = snapshot.activeInvPage;

  // Mount the Application/<canvas> exactly ONCE per successful boot --
  // same shape as Board.tsx's own effect. Never remounted on a tab
  // switch (see module comment above).
  useEffect(() => {
    if (snapshot.status !== 'ready' || !snapshot.engine || !snapshot.gameData || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const { engine, gameData } = snapshot;
    setReady(false);

    (async () => {
      const textures = await loadBoardTextures();
      if (cancelled) return;
      // Bind to whatever page is currently active AT MOUNT TIME; a later
      // page change is handled by the ops-swap effect below, never by
      // remounting this effect (deps intentionally omit `page`).
      const renderer = await BoardRenderer.mount(canvas, {
        engine,
        items: gameData.ITEMS,
        siDefs: gameData.SI_DEFS,
        textures,
        layout: gameData.LAYOUT,
        ops: makeInvOps(engine, snapshot.activeInvPage),
      });
      if (cancelled) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      // REQ-0041: publish this singleton renderer so WarehouseTab.tsx can
      // call pulseCellsSuccess() on it after a claim placement -- see
      // board/inventoryRenderer.ts's module comment for why this seam
      // exists (the Warehouse tab reuses THIS SAME InventoryBoard
      // instance via a portal, per board/inventorySlot.ts's Pixi-
      // instance decision, rather than mounting its own renderer).
      setInventoryRenderer(renderer);
      setReady(true);
    })();

    return () => {
      cancelled = true;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      setInventoryRenderer(null);
      setReady(false);
    };
    // Mount once per boot -- deliberately NOT keyed on `page` (see module
    // comment: page changes are handled by the effect below via
    // setOps(), never by tearing down/recreating this Application).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.status === 'ready']);

  // Re-point the ALREADY-MOUNTED renderer at the newly-active page's ops
  // whenever the tab changes, then re-render immediately against the new
  // ops+state so the board shows the new page without a blank/stale frame.
  useEffect(() => {
    if (!ready || !rendererRef.current || !snapshot.engine || !snapshot.state) return;
    rendererRef.current.setOps(makeInvOps(snapshot.engine, page));
    rendererRef.current.render(snapshot.state);
  }, [ready, page, snapshot.engine, snapshot.state]);

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
