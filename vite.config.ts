import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs, so the build works both at the domain root (dev, preview)
  // and under the repository subpath GitHub Pages serves it from.
  base: './',
  plugins: [react()],
})
