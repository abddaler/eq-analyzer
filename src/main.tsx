import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { EngineProvider } from './ui/useEngine';
import { LibraryProvider } from './ui/useLibrary';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

declare global {
  interface Window {
    __eqScopeBooted?: boolean;
  }
}

// Tells the boot screen in index.html that the bundle ran.
window.__eqScopeBooted = true;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <EngineProvider>
          <LibraryProvider>
            <App />
          </LibraryProvider>
        </EngineProvider>
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
