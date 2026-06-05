# Telemetria Frontend — Sentry

O frontend já está integrado ao [Sentry](https://sentry.io) — falta só ativar.
Enquanto não houver DSN configurado, `services/sentry.ts` opera como **NO-OP**:
o app roda normal, erros vão pro `console.error` como antes, sem dependência de
rede pra Sentry.

## Por que

Antes: 74 `console.error` em `services/` e `components/` ficavam **invisíveis em
produção**. A única forma de saber que um colaborador caiu em uma tela com erro
era ele reportar. Agora qualquer exceção capturada pelo `ErrorBoundary` (ou
chamada manualmente via `captureException`) chega no Sentry com contexto:

- **release** = `__APP_RELEASE__` (versão + timestamp do build — já existe
  desde o PR de versionamento)
- **environment** = `production` (default no deploy CI) ou o que vier em
  `VITE_SENTRY_ENV`
- **user** = quando você chamar `setUser({ id, email })` no login

## Como ativar (você precisa fazer uma vez)

1. **Criar projeto no Sentry**
   - Acesse https://sentry.io → New Project → **React** → nome
     `consultor-fiscal-inteligente`.
   - Copie o **DSN** (formato: `https://abc123@o12345.ingest.sentry.io/67890`).

2. **Cadastrar como GitHub Actions secret**
   - GitHub repo → **Settings** → **Secrets and variables** → **Actions** →
     **New repository secret**.
   - Nome: `SENTRY_DSN`. Valor: o DSN do passo 1.

3. **Trigger um deploy** (qualquer push na main, ou `Re-run workflow`).
   - O step "Build Docker image" passa o DSN como `--build-arg` → Vite injeta
     no bundle → app já sobe com Sentry ativo.

4. **Verificar**
   - Abra o console do navegador no app — deve aparecer
     `[sentry] inicializado release=<versão>+<timestamp>`.
   - No Sentry dashboard, o projeto deve mostrar a primeira release dentro de
     poucos minutos.
   - Pra testar: peça pra um usuário forçar um erro (ou rode no DevTools
     `throw new Error('teste-sentry')` numa tela qualquer) — deve aparecer
     no Issues do Sentry com stack trace, breadcrumbs e o `release`.

## O que **não** é capturado

- **Performance/tracing** (Web Vitals, transactions): `tracesSampleRate: 0`.
  Liga depois se quiser, ajustando `services/sentry.ts`.
- **Session replay**: idem, custa quota.
- **Erros do backend Node** (`server.js` e `sefaz-backend/*`): não estão
  integrados ainda. Quando quiser, adicione `@sentry/node` separadamente — o
  wrapper `services/sentry.ts` aqui é só do frontend.
- **Erros que vêm de extensões do navegador** (chrome-extension://): filtrados
  no `beforeSend`.
- **Ruído conhecido**: `ResizeObserver loop`, `AbortError`, `Failed to fetch`
  (quando o Firebase fica offline brevemente).

## Como reportar um erro manualmente

```ts
import { captureException } from '@/services/sentry';

try {
    await algoQuePodeFalhar();
} catch (e) {
    console.error('contexto humano:', e);  // continua valendo
    captureException(e, { telaAtual: 'XMLs NFe', filtroAtivo: '44388' });
}
```

`captureException` é NO-OP quando Sentry não está inicializado — pode chamar à
vontade sem se preocupar com o ambiente.

## Identificar o usuário

O app já identifica automaticamente o usuário no Sentry pelo listener global de
autenticação (`App.tsx`): login, refresh de sessão e logout chamam
`setUser(...)`/`setUser(null)`.

Para capturas manuais fora desse fluxo, use o mesmo helper:

```ts
import { setUser } from '@/services/sentry';

// após auth completar:
setUser({ id: user.uid, email: user.email, username: user.displayName });
```

Isso correlaciona erros por usuário no Sentry — útil pra reproduzir o caminho
específico que causou o problema.
