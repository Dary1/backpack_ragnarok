import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initButtonFx } from './theme/buttonFx'
import { boot, initAutoSaveLifecycle } from './store'

// REQ-0113: entrance/idle-motion gate. The §06 styleguide motions adopted
// here (rise / pulse / toastin) are decorative, so enable them only when
// motion is welcome -- mirrors landing/particles.ts discipline:
//   - navigator.webdriver  -> OFF (Playwright/automation always sets it, so
//     e2e stays byte-identical in behaviour: no entrance/idle motion runs).
//   - prefers-reduced-motion -> OFF (belt-and-suspenders with mjolnir.css's
//     blanket shortcut; here the motions simply never start).
// Every REQ-0113 motion is CSS-scoped under :root[data-motion="on"].
(() => {
  const reduce =
    (typeof navigator !== 'undefined' && navigator.webdriver === true) ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (!reduce) document.documentElement.setAttribute('data-motion', 'on');
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Kick off the live-API load; the store notifies subscribed components
// (via useSyncExternalStore in useGameStore) once it resolves.
boot();
initAutoSaveLifecycle();
initButtonFx();
