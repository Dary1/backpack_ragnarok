// React wrapper for BoardRenderer — REQ-0026 T0.1.
// Mounts a <canvas>, boots the PixiJS Application once, then re-renders on
// every store change. All game state lives in src/store.ts (module-level,
// outside React) -- this component only reads the store snapshot and
// forwards it to the framework-free BoardRenderer.
import { useEffect, useRef, useState } from 'react';
import { BoardRenderer } from './BoardRenderer';
import { loadSpriteTextures } from './sprites';
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
      const textures = await loadSpriteTextures();
      if (cancelled) return;
      const renderer = await BoardRenderer.mount(canvas, {
        engine,
        items: gameData.ITEMS,
        textures,
        layout: gameData.LAYOUT,
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
    // Board is (re)mounted once per successful boot; state updates after
    // that are handled by the render effect below, not by remounting Pixi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.status === 'ready']);

  useEffect(() => {
    if (ready && rendererRef.current && snapshot.state) {
      rendererRef.current.render(snapshot.state);
    }
  }, [ready, snapshot.state]);

  if (snapshot.status === 'loading') {
    return <div className="board-placeholder">Loading board…</div>;
  }
  if (snapshot.status === 'error') {
    return <div className="board-placeholder board-error">Board unavailable: {snapshot.error}</div>;
  }

  return <canvas ref={canvasRef} className="board-canvas" />;
}
