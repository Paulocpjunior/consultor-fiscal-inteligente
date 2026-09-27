# Auditoria completa do CFI — 26/09/2026

Medido no repositório em `main` (deploy 1041), com dependências instaladas. Três frentes em paralelo (backend, frontend, testes/operação) mais medições diretas. Cada achado aponta arquivo e linha.

## Inventário

| Item | Medida |
|---|---|
| Rotas HTTP | 451 (50 em `server.js`, 400 em 72 arquivos `*routes*.js`) |
| Módulos backend | 430 arquivos em `sefaz-backend/` |
| Componentes React | 221 arquivos, 79.210 linhas |
| Services (front) | 225 arquivos |
| Testes | 574 arquivos (552 `.ts`, 22 `.tsx`), 8.642 casos, todos verdes |
| Vulnerabilidades em produção | 0 (`npm audit --omit=dev`) |
| Bundle | 6,1 MB em 189 arquivos JS (dividido; maior chunk 481 KB, Excel) |
| Node | 20 na imagem (fim de suporte abr/2026) |
| Crons no Scheduler | 22 ativos + 1 pausado de propósito |

## 1. Defeitos (corrigir)

Ordenados por gravidade. "Classe" indica que o mesmo defeito já derrubou algo antes.

### Alta

1. **Limite de requisições furável.** A chave do rate limit é o fim do header `Authorization` (`server.js:274`). Qualquer Bearer inventado ganha um balde novo. O limite só protege contra quem não tenta. Correção: chave por `uid` depois de validar o token, e IP quando não há token válido.
2. **Rota HTTP lê `documentos_fiscais` inteiro, documento completo.** `health-consolidado-routes.js:73` e `diagnostico-docs-fiscais-routes.js:43,136`. Classe do 500 da Central de DAS (03/08) e do travamento da NFS-e (25/09). Correção: `.select()` dos campos usados e agregação por competência.
3. **13 crons sem heartbeat nem log.** sae-nfce (2), tarefas-cron-mensal, sharepoint-cron-alertas, crons-health-alerta, autxml-harvest, cofre-sharepoint-arquivo, nfsesp-portal, vencimentos, sharepoint-auto-sync, cert-alerta, captura-resumo. Se morrerem no meio, ninguém vê. Os códigos 13 (das-cron) e 4 (sharepoint-auto-sync) de ontem são sintoma: 18 rotas respondem e continuam em `setImmediate`, e o Cloud Run pode congelar a CPU depois da resposta (não há `--no-cpu-throttling` no deploy). Correção: `withCronHeartbeat` nos 13 e CPU sempre alocada no serviço.
4. **19 leituras diretas do Firestore no navegador sem teto ou sem período.** `xmlFiscalService.ts:849,874` (documentos_fiscais), `simplesNacionalService.ts:338` (simples_notas por empresa sem período), `nfpProCloudService.ts:153`, `nfseSpCapturadasService.ts:174` (estatística da base inteira no cliente), `tarefasService.ts:162`. Só 5 de 24 chamadas passam `maxDocs`. Classe do travamento de 25/09.
5. **10 telas desenham listas inteiras sem paginação.** `Tarefas.tsx:476` (até 20 mil), `SimplesNacionalDashboard.tsx:209`, `LucroPresumidoReal/ListView.tsx:149`, `EmpresasStatusCapturaPanel.tsx:756`, `NfseNacional/index.tsx:186`, `RecuperacaoTributaria/index.tsx:438`, `AnaliseRetencoesNfseSP.tsx:413`, `DipamProdutorRuralPanel.tsx:226`, `DifalPanel.tsx:170`, `UserManagementModal.tsx:536`.

### Média

6. **Histórico de envios devolve 200 registros arbitrários, não os mais recentes.** `envio-imposto-routes.js:415` aplica `limit` sem `orderBy` e ordena depois.
7. **Rota pública lê até 2.000 documentos.** `nfse-nacional-routes.js:49` (`/nbs`) sem auth. Mais 7 rotas `/status` públicas (inofensivas, mas expõem configuração).
8. **Data em UTC onde a regra é local.** 57 usos de `toISOString().slice(0,7|10)` e 15 offsets fixos de -3h no backend, contra 15 helpers próprios de BRT. Classe da suíte que ficava vermelha das 21h à meia-noite.
9. **Polling sem checar se a aba está visível.** `SpConnect/index.tsx:253` a cada 30 s, `CapturaDiagnosticoPanel.tsx:477` a cada 60 s, `VencimentosBanner.tsx:64` a cada 5 min montado globalmente. Com 10 abas abertas na equipe vira rajada.
10. **Regras do Firestore: 15 coleções aceitam escrita de qualquer usuário autenticado**, entre elas `tarefas` (`firestore.rules:392`), `invoices_manuais` (`:369`), `notas_ocultas` (`:358`), `sped_arquivos` (`:608`). Um colaborador consegue alterar tarefa de carteira alheia pelo console do navegador. Documentado como escolha de escritório único, mas é um risco interno.
11. **Node 20 na imagem** (`Dockerfile:2,46`), fim de suporte em abril/2026. O comentário na linha 101 fala em Node 22.
12. **Truncamento silencioso.** `envio-imposto-routes.js:520` e `rotina-fiscal-routes.js:295` leem `impostos_enviados` com `limit(2000/3000)` sem filtro e sem dizer que cortaram.

### Baixa

13. `express.json` com limite global de 20 MB (`server.js:264`); só o upload de XML/PDF precisa disso.
14. `PROJECT_ID` com dois defaults diferentes (`secret-loader.js:10` = consultorfiscalapp; `cofre-sharepoint-arquivo.js:32` = consultor-fiscal-inteligente).
15. 3 rotas de cron protegidas por segredo sem nenhum job no Scheduler: `/api/admin/darf/cron`, `/api/admin/notificacoes/cron-resumo`, `/api/internal/cron/health-alerta-cron`. Ou ganham job, ou saem.
16. Assinatura XML-DSig do ABRASF não implementada (`sefaz-backend/abrasf/cliente.js:7`). Único TODO real do código.

## 2. Ajustes (dívida que custa tempo todo dia)

- **Leitura integral das coleções de empresas: 68 vezes em 40 arquivos**, sem cache. `carregarEmpresas()` reimplementado em 6 arquivos. Um cache de 60 s no servidor corta a maior parte do custo do Firestore.
- **`initializeApp` em 116 arquivos, `getDb`/`fa` redefinidos 107 vezes.** Um módulo `db.js` único.
- **Formatadores duplicados no front:** 32 de CNPJ, 45 de moeda, 20 de data. **Helpers de CNPJ no backend:** 83 definições em 57 arquivos. O CNPJ do escritório está literal em 20 lugares.
- **Tipagem:** 1.027 `any` (412 + 232 em components, 220 + 163 em services). Piores: `xmlFiscalService.ts` 52, `XmlDocumentoDetalhe.tsx` 51, `Relatorios/index.tsx` 49.
- **Tamanho:** `whatsapp-routes.js` 3.668 linhas, `server.js` 3.315, `SpConnect/index.tsx` 5.163 (166 `useState`), `Relatorios/index.tsx` 3.738 (71 `useState`), `App.tsx` 1.640. Doze funções com mais de 300 linhas; `prevalidarSpedFiscal` tem 1.821.
- **Erros crus:** 257 handlers devolvem `{ error: e.message }`; o `respondeErro` que sanitiza só é usado em `server.js`. No front, 79 `console.warn` engolem erro e devolvem lista vazia (ex.: `getEmpresasDisponiveis`, chamado em 17 telas: falha vira "nenhuma empresa").
- **Diálogos nativos:** 69 `confirm`/`alert`/`prompt` mesmo com `DialogProvider` pronto.
- **URLs e e-mails fixos:** 12 URLs `run.app` no código, `junior@` como padrão em 12 pontos.
- **Sem ESLint.** `lint` é só `tsc`. O tsconfig estrito cobre 104 de 226 services e nenhum componente.
- **README desatualizado:** descreve o proxy Gemini e o deploy manual; não cita os 11 scripts, o `server.js` nem os crons.
- **Código morto:** `sefaz-backend/logger.js` (ninguém importa), 59 exports sem referência nem em teste (ex.: `manifesto-client.js`, `sharepoint-provider.js` uploads, `multa-calculator.js`).

## 3. Melhorias (o que falta para o app ser confiável sem depender de ninguém olhar)

- **CI em pull request.** Hoje lint, strict e jest só rodam depois do merge, dentro do deploy. Todo push em `main` vai para produção sem aprovação. O proxy do SharePoint sobe sem teste.
- **Cobertura:** 69 módulos backend e 70 services sem teste. Os maiores: `nfp-compliance-provider` (1.051 linhas), `sped-fiscal-validador` (521), `recuperacao-tributaria-orchestrator` (451), `nfse-sp-portal-client` (401), `analiseCreditoExtratoService` (381).
- **Padrão único de acesso a dados no front:** ou pela API (com `select` e paginação) ou pelo Firestore direto com teto e período. Hoje são os dois, sem regra.
- **Virtualização de listas** (uma biblioteca, uma vez) para as 10 telas do item 5.
- **Observabilidade:** `@sentry/react` está instalado; confirmar que o backend reporta exceções e que os crons sem log entram no vigia de saúde.

## 4. Plano proposto

**Onda 1 (1 semana, 4 PRs):** itens 1, 2, 3, 6, 7 e 12. Rate limit por uid; `select` nas três rotas; heartbeat nos 13 crons + CPU sempre alocada; `orderBy` no histórico; auth no `/nbs`; truncamento dito.

**Onda 2 (2 semanas, 6 PRs):** itens 4, 5, 8, 9, 11. Teto e período nas 19 leituras; paginação nas 10 telas; helper único de data BRT e varredura dos 57 `toISOString`; visibilidade no polling; Node 22.

**Onda 3 (contínua):** cache de empresas, `db.js` único, formatadores únicos, ESLint, CI em PR, testes nos 25 módulos maiores sem cobertura, regras do Firestore por carteira.

## 5. Do lado do Paulo (pendente desde antes)

- Trocar o `sefaz-cron-secret` (vazou 2 vezes), rodar de novo o script de scheduler e conferir o tráfego da revisão.
- Conferir `SISTEMA_DEV_EMAILS` entrando como outro admin.
- NOVA ERA (6 produtores do FUNRURAL), EXPERTE (captura bloqueada), JOAO EVANGELISTA e WALDESA (duplicatas), PS VIDROS (IPI = Não).
- Cofre: "Recuperar histórico (180 dias)" e liberar o domínio do ERP da Ludus.
- Equipe: preencher `sharePointConfig` das empresas; o cron de arquivo só sobe empresa configurada.
- Decidir: alguém usa "Simples Paulista DIFAL" e "CAT 17/99"? Bloco K pode ser descartado?

## O que já foi corrigido nesta semana (fora da lista)

Janela de 1 h da captura, retomada só do agendado, motivos em toda rodada, banner e Diagnóstico dizendo qual rodada foi, lista de NFS-e com teto e paginação, 0500 do EFD-Contribuições, M400/M800, CST padrão 49, ECD/ECF fora do Fiscal, ADN E999 catalogado, DAS "já enviei por fora" em lote, vigia da credencial do e-mail.
