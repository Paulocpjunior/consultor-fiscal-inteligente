# Consultor Fiscal Inteligente (CFI) — SP Assessoria Contábil

App de operação do departamento fiscal: captura de documentos (SEFAZ, portal
NFS-e SP, ADN, cofre de e-mail, SharePoint), apuração (Simples, Lucro
Presumido/Real), obrigações (SPED, DCTFWeb, EFD-Reinf pelo gateway), guias
(DAS, DARF, DARE) e o atendimento **SP Connect** (WhatsApp).

O estado do projeto, as regras permanentes e o histórico de decisões vivem em
`CLAUDE.md`. Este README é só o mapa da arquitetura.

## Arquitetura

| Peça | O que é | Onde roda |
|---|---|---|
| **Frontend** | Vite + React 19 + TypeScript (`App.tsx`, `components/`, `services/`) | servido como SPA estática pelo `server.js` |
| **Backend** | Express (`server.js` na raiz + `sefaz-backend/*.js`, ESM) | **mesmo serviço** Cloud Run `consultor-fiscal-inteligente`, projeto `consultorfiscalapp`, região **us-west1** |
| **proxy-backend/** | Proxy do **SharePoint** (Microsoft Graph: listar/baixar/subir XMLs e guias) — credencial própria, token compartilhado | serviço Cloud Run `consultor-fiscal-proxy`, us-west1 |
| **Firebase** | Auth (login da equipe, papéis), Firestore (dados), Storage (XMLs crus, PDFs) | projeto `consultorfiscalapp` |
| **teams-app/** | Pacote do app SP Connect para o Microsoft Teams | zip servido em `/sp-connect-teams.zip` |

Frontend e backend sobem numa imagem só (`Dockerfile`: stage 1 faz o `vite
build`, stage 2 copia `dist/`, `server.js` e `sefaz-backend/`). Um deploy do
app mata captura em andamento — conferir o banner do Diagnóstico antes de
mesclar.

A IA (Gemini) é chamada **pelo backend** (`GEMINI_API_KEY` só no servidor; o
modelo é resolvido em `sefaz-backend/gemini-modelo.js`). Não existe mais um
proxy de Gemini separado.

Apps irmãos (Contábil `plano-contas-iob`, DP/Folha, Legalização, Financeiro)
compartilham o Auth e, no caso da Legalização, o Firestore — por isso as
`firestore.rules` das coleções `legalizacao_*` são publicadas **deste** repo.

## Desenvolvimento local

```bash
npm ci
npm run dev        # Vite em :3000, proxy de /api e /health para :8080
npm start          # server.js em :8080 (precisa das envs do backend)
npm run lint       # tsc --noEmit + scripts/check-backend-nomes.mjs (backend JS)
npm run lint:strict
npx jest           # ~500 suítes (jsdom + módulos puros do backend)
npm run build      # gera dist/ e dist/version.json
```

Envs do backend: credenciais SERPRO (`SERPRO_ACTIVATION.md`,
`DARF_ACTIVATION.md`), Firebase Admin (ADC no Cloud Run), Graph/e-mail
(`GRAPH_*`), `SHAREPOINT_PROXY_URL` + token, `SEFAZ_CRON_SECRET` (crons),
`GEMINI_API_KEY`. Nenhuma vai para o Git.

## Deploy (GitHub Actions)

| Workflow | Publica | Dispara |
|---|---|---|
| `deploy-app.yml` | imagem do app no Cloud Run (build → auditoria `npm audit --omit=dev` → lint + jest → deploy sem tráfego → health check → roteia) | push na `main` (exceto só docs/`*.md`/proxy) |
| `deploy-proxy.yml` | `proxy-backend/` no Cloud Run | push que toca `proxy-backend/` |
| `deploy-firestore.yml` | `firestore.rules`, `firestore.indexes.json`, `storage.rules` | push que toca esses arquivos |
| `audit-deps.yml` | robô diário: `npm audit fix` testado → PR | agenda (dias úteis) |

Cada um tem o job `avisar-falha` que abre/atualiza issue quando o run cai ou é
cancelado. Trabalho vai em PR → squash-merge → acompanhar o deploy até VERDE.

## Scripts úteis

- `scripts/setup-cloud-schedulers.sh` — cria/atualiza os jobs do Cloud
  Scheduler (crons de captura, tarefas, vencimentos, DAS, DCTFWeb, caixa postal).
- `scripts/deploy-manual.sh` — saída de emergência quando o Actions não atribui
  runner (Cloud Build, sobe sem tráfego, health check, roteia).
- `scripts/extract-prod-frontend-config.mjs` — resolve as `VITE_*` no CI.
- `scripts/extrair-leiaute-*.mjs` — extraem as contagens de campos dos Guias
  do SPED em `docs/sped/`.
- `sefaz-backend/scripts/serpro-smoke.js` — smoke de CONSULTA no Integra
  Contador (não emite nada).

## Material da equipe

Guias em `public/guia-*.html` (servidos pelo app) com fonte em
`docs/guia-colaborador-*.md` — as duas metades andam juntas
(`__tests__/guiaParDuplo.test.ts`). Novidades em `/novidades-cfi.html`;
manual em `MANUAL_USUARIO.md`.
