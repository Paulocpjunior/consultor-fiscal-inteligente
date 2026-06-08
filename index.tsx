
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/dialog/DialogProvider';
import ErrorBoundary from './components/ErrorBoundary';
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
    {/* ErrorBoundary RAIZ: pega erros do proprio App.tsx (login, header, providers).
        Sem ele, erro no boot mostra tela branca e nao reporta ao Sentry.
        DialogProvider por dentro fornece useConfirm/usePrompt globalmente
        (a11y, role=alertdialog, Esc/Enter, trap de foco). */}
    <ErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
