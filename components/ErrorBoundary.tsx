import React from 'react';
import { captureException } from '../services/sentry';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Reporta ao Sentry SE inicializado (services/sentry.ts faz no-op
    // quando VITE_SENTRY_DSN nao esta setada). Antes: stack trace ia so
    // pro console do navegador do colaborador — invisivel em producao.
    captureException(error, { componentStack: errorInfo.componentStack });
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 m-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800">
          <h2 className="text-lg font-bold text-red-700 dark:text-red-400 mb-2">Erro ao carregar modulo</h2>
          <p className="text-sm text-red-600 dark:text-red-300 mb-3">{this.state.error?.message || 'Erro desconhecido'}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
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

export default ErrorBoundary;
