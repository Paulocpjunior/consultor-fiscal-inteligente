
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/dialog/DialogProvider';
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
    {/* DialogProvider fornece useConfirm/usePrompt globalmente. Substitui
        window.confirm/prompt por dialog acessivel com Esc/Enter, trap de
        foco e role=alertdialog (a11y). */}
    <DialogProvider>
      <App />
    </DialogProvider>
  </React.StrictMode>
);
