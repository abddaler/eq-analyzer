import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
/**
 * `base` has to match where the site is actually served from.
 *
 * Cloudflare Pages and a *.pages.dev domain serve from the root, so the
 * default is '/'. GitHub Pages serves a project site from
 * /<repo>/, and every absolute URL in the bundle would 404 there - so the
 * deploy workflow passes BASE_PATH=/eq-analyzer/.
 */
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  build: {
    // Vite's default target assumes a browser from the last couple of years.
    // This is a tool for whatever phone the engineer already owns, so the
    // bundle is compiled down far enough to run on an older iPhone rather
    // than failing to parse and showing a black screen.
    target: ['es2020', 'safari14', 'chrome87', 'firefox78'],
  },
})
