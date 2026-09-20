import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Vite's default target assumes a browser from the last couple of years.
    // This is a tool for whatever phone the engineer already owns, so the
    // bundle is compiled down far enough to run on an older iPhone rather
    // than failing to parse and showing a black screen.
    target: ['es2020', 'safari14', 'chrome87', 'firefox78'],
  },
})
