import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// backpack_ragnarok client (REQ-0026 T0.1).
// Deployed under /app/ on the existing static server (web/ dir @ :8801,
// tunneled at backpack-dev.qtie.jp) -- base must match that mount path so
// built asset URLs resolve correctly. Build output goes straight to
// web/app/ (sibling of client/), which is the directory the static server
// already exposes at /app/ with zero server/ingress changes.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: '../web/app',
    emptyOutDir: true,
  },
})
