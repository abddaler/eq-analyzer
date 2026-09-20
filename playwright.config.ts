import { defineConfig } from '@playwright/test';

/**
 * Smoke tests against a real browser.
 *
 * The microphone is served by Chromium's fake capture device, so the whole
 * chain - getUserMedia, the AudioWorklet, the ring buffer, the engine and the
 * canvas - is exercised without hardware. It does not replace listening on a
 * phone; it catches the crashes that would waste that trip.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      // The image ships one Chromium build; point at it instead of letting
      // Playwright look for the exact revision its own version expects.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
