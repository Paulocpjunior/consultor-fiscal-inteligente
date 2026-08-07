import React from 'react';
import { captureException } from '../services/sentry';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /**
   * Nome do módulo protegido. Sem ele, o print que o colaborador manda diz
   * "Erro ao carregar modulo" e a mensagem crua — e descobrir QUAL módulo
   * quebrou vira adivinhação (aconteceu em 07/08: um `reading 'slice'` sem
   * dono, com 261 candidatos no código).
   */
  modulo?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Detecta erro de chunk antigo (deploy invalidou hashes mas o navegador
 * tem o index.html cacheado apontando pros hashes velhos -> 404).
 * Padrao da mensagem do Vite: "Failed to fetch dynamically imported module"
 * ou "Loading chunk N failed" (Webpack-like).
 */
function isChunkLoadError(err: Error | null): boolean {
  if (!err) return false;
  const msg = err.message || '';
  const name = err.name || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Importing a module script failed') ||
    name === 'ChunkLoadError'
  );
}

const RELOAD_FLAG = '__chunk_error_reloaded_v1';

class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    // Auto-reload em chunk error pra pegar o novo index.html. Anti-loop:
    // sessionStorage marca que ja recarregou; se persistir, mostra a tela
    // de erro normal pra usuario clicar manualmente (talvez seja outro
    // problema, ex: network down).
    if (isChunkLoadError(error)) {
      try {
        if (sessionStorage.getItem(RELOAD_FLAG) !== '1') {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          // Reload forcado: cache-bust via query param + reload de verdade.
          const url = new URL(window.location.href);
          url.searchParams.set('_v', String(Date.now()));
          window.location.replace(url.toString());
          // Retorna sem error pra evitar renderizar a tela vermelha antes
          // do reload disparar.
          return { hasError: false, error: null };
        }
      } catch {
        // sessionStorage indisponivel (modo privado) -- segue pro fallback normal.
      }
    }
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Reporta ao Sentry SE inicializado (services/sentry.ts faz no-op
    // quando VITE_SENTRY_DSN nao esta setada). Antes: stack trace ia so
    // pro console do navegador do colaborador — invisivel em producao.
    captureException(error, {
      componentStack: errorInfo.componentStack,
      modulo: this.props.modulo || '(sem nome)',
    });
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 m-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800">
          <h2 className="text-lg font-bold text-red-700 dark:text-red-400 mb-2">
            Erro ao carregar {this.props.modulo ? <span className="font-mono">{this.props.modulo}</span> : 'modulo'}
          </h2>
          <p className="text-sm text-red-600 dark:text-red-300 mb-3">{this.state.error?.message || 'Erro desconhecido'}</p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
              window.location.reload();
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Limpa o flag em boot bem-sucedido: se a app montou OK depois do reload,
// proximo erro de chunk pode acionar auto-reload de novo.
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
  });
}

export default ErrorBoundary;
