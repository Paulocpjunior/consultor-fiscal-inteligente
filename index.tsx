
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSentry } from './services/sentry';
import './index.css';

// Inicializa Sentry ANTES de montar — pra capturar erros do proprio mount.
// NO-OP se VITE_SENTRY_DSN nao estiver setado (dev local / build sem secret).
initSentry();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
