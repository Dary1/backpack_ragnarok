import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initButtonFx } from './theme/buttonFx'
import { boot, initAutoSaveLifecycle } from './store'

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
