import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initButtonFx } from './theme/buttonFx'
import { initBgm } from './audio/bgm' // REQ-0370
import { boot, initAutoSaveLifecycle, initUndoHotkey } from './store'
import { initGuideController } from './guide/guideController'
import { initMotionPrefs } from './a11y/motionPrefs' // REQ-0143

// REQ-0143: reduced-motion is now owned by a11y/motionPrefs. It seeds from the
// same platform signals REQ-0113 used (navigator.webdriver -> OFF so e2e stays
// byte-identical; prefers-reduced-motion: reduce -> reduced ON), lets an
// explicit Settings toggle override the seed, and sets :root[data-motion="on"]
// (REQ-0113 CSS scope) iff motion is welcome, plus :root[data-reduced-motion].
initMotionPrefs();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Kick off the live-API load; the store notifies subscribed components
// (via useSyncExternalStore in useGameStore) once it resolves.
boot();
initAutoSaveLifecycle();
initUndoHotkey(); // REQ-0367: global Ctrl+Z -> single-step undo
initGuideController();
initButtonFx();
initBgm(); // REQ-0370: BGM (first-gesture start, hidden-pause, webdriver hard-off)
