/** Service worker registration; a no-op in dev and where SW is unavailable. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    // BASE_URL is '/' on Cloudflare and '/eq-analyzer/' on GitHub Pages; the
    // worker must be registered inside the scope it is meant to control.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  });
}
