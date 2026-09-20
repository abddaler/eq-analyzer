import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { EngineProvider } from './ui/useEngine';
import { LibraryProvider } from './ui/useLibrary';
import { registerServiceWorker } from './pwa';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <EngineProvider>
        <LibraryProvider>
          <App />
        </LibraryProvider>
      </EngineProvider>
    </I18nProvider>
  </StrictMode>,
);
