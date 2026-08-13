import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {Capacitor} from '@capacitor/core';
import {SupabaseProvider} from './contexts/SupabaseContext';
import App from './App.tsx';
import './index.css';

// Error-reporting (web) initializes lazily after first paint so the heavy
// Sentry chunk never blocks cold-start parsing. On native it's initialized
// lazily via lib/sentry.ts.
if (!Capacitor.isNativePlatform()) {
  window.setTimeout(() => {
    import('./lib/initSentryWeb').then(({initSentryWeb}) => initSentryWeb()).catch(() => {});
  }, 5000);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SupabaseProvider>
      <App />
    </SupabaseProvider>
  </StrictMode>,
);
