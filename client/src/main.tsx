import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initButtonFx } from './theme/buttonFx'
import { boot, initAutoSaveLifecycle, initUndoHotkey } from './store'
import { initGuideController } from './guide/guideController'
import { initMotionPrefs } from './a11y/motionPrefs' // REQ-0143
import { initScalePrefs } from './a11y/scalePrefs' // REQ-0377 item 4
import { initInputShortcuts } from './lib/inputShortcuts' // REQ-0369

// REQ-0143: reduced-motion is now owned by a11y/motionPrefs. It seeds from the
// same platform signals REQ-0113 used (navigator.webdriver -> OFF so e2e stays
// byte-identical; prefers-reduced-motion: reduce -> reduced ON), lets an
// explicit Settings toggle override the seed, and sets :root[data-motion="on"]
// (REQ-0113 CSS scope) iff motion is welcome, plus :root[data-reduced-motion].
initMotionPrefs();

// REQ-0377 item 4: UI scale (S/M/L). Applied BEFORE the first paint, next to
// initMotionPrefs above, so a player who chose 'l' never sees a frame at 'm'.
initScalePrefs();

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
initInputShortcuts(); // REQ-0369: guarded gameplay shortcuts (R / 1..5 / ?)
initGuideController();
initButtonFx();
