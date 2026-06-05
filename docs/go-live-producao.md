# Runbook — Go-Live Produção Oficial

Procedimento sequenciado pra colocar o app em produção fiscal **oficial** de
forma controlada. A ideia central: **read-only primeiro, emissão depois — uma
operação por vez, cada uma validada antes de liberar.**

> Regra de ouro: **emitir/transmitir é ato legal vinculante** (e custa dinheiro:
> R$ 0,80/DAS etc). Nunca libere um tipo de emissão sem ter validado pelo menos
> uma vez em homologação/smoke.

---

## Fase 0 — Pré-requisitos (bloqueadores)

| # | Item | Como verificar | Responsável |
|---|---|---|---|
| 0.1 | **Cert A1 S&P renovado** e no Secret Manager | `GET /api/admin/sefaz/cert-escritorio-info` → `notAfter` > hoje+30d, CNPJ `44388152000189` | Admin |
| 0.2 | Secrets SERPRO no Cloud Run | `serpro-consumer-key`, `serpro-consumer-secret` populados | Admin |
| 0.3 | Procuração e-CAC ativa por empresa-cliente (pra consulta/emissão via cert do escritório) | e-CAC | Admin/contador |
| 0.4 | `SENTRY_DSN` no GitHub Secrets (observabilidade) | `docs/sentry-setup.md` | Admin |
| 0.5 | Cron de alerta de cert ativado | rodar `scripts/setup-cloud-schedulers.sh` | Admin |

**Não prossiga pra Fase 1 sem o 0.1.** O cert sustenta captura + SERPRO mTLS +
NFSe SP + emissão NFSe Nacional. Vencido = tudo para.

---

## Fase 1 — Subir com EMISSÃO BLOQUEADA (read-only)

Capture, consultas, dashboards e conferências ficam **100% ativos**. Emissão
(escrita no Fisco) fica **travada** pelo kill-switch — mesmo que um colaborador
clique "emitir", recebe HTTP 423 "bloqueada" e nada é enviado.

No deploy do Cloud Run, adicione às env vars:
```
EMISSAO_BLOQUEADA=true
```

Verifique:
```
GET /api/admin/emission/guard-status
→ { "tudoBloqueado": true, "porTipo": { "DAS": true, "DARF": true, "DCTFWEB": true, "NFSE_NAC": true } }
```

**Nesta fase, o que JÁ funciona com segurança em produção:**
- ✅ Captura automática NFe/NFCe/NFSe SP/NFSe Nacional/CTe/MDFe (read-only)
- ✅ Consultas SERPRO (DAS, DCTFWeb, Caixa Postal — leitura)
- ✅ Dashboards, Top Empresas, relatórios PDF/CSV/XLSX
- ✅ Conferências: SPED×XML, PGDAS, **DCTFWeb×Apuração**
- ✅ Análises IA (anomalias, créditos, reforma, CEO)
- ✅ NFP Pro Cloud (situação fiscal, certidões)

Deixe rodando 1-2 dias. Confirme no Sentry que não há erros recorrentes e que
o cron noturno completa (`GET /api/admin/sefaz/sync-cron-health` sem órfãos).

---

## Fase 2 — Validar e liberar emissão, UMA por vez

Para cada tipo, o ciclo é: **validar → liberar → monitorar → próximo**.

### 2.1 SERPRO — confirmar parse antes de liberar DAS/DARF/DCTFWeb

Os providers DAS/DARF têm `TODO[SERPRO_REAL]` (nomes de campo do response
supostos). Rode o smoke pra capturar o response real:
```
node sefaz-backend/scripts/serpro-smoke.js <cnpj-cliente> <YYYYMM>
```
(ver `docs/serpro-smoke-test.md`). Me devolva os JSONs → ajusto os parsers se
algum campo divergir. **Só então libere.**

### 2.2 Liberar DAS
```
remover/zerar EMISSAO_BLOQUEADA   (ou setar EMISSAO_BLOQUEADA=false)
EMISSAO_BLOQUEADA_DARF=true
EMISSAO_BLOQUEADA_DCTFWEB=true
EMISSAO_BLOQUEADA_NFSE_NAC=true
```
Resultado: só DAS liberado. Emita 1 DAS real de uma empresa-piloto, confira o
documento (código de barras, valor, vencimento). OK? Segue.

### 2.3 Liberar DARF
```
EMISSAO_BLOQUEADA_DARF=false   (remover)
```
Emita 1 DARF piloto. Confira.

### 2.4 Liberar DCTFWeb
```
EMISSAO_BLOQUEADA_DCTFWEB=false   (remover)
```
Transmita 1 declaração piloto. ⚠️ Transmissão é vinculante — escolha uma
empresa/competência que realmente precisa transmitir.

### 2.5 NFS-e Nacional (mais novo — extra cuidado)

Nunca foi validado contra o SEFIN real. Procedimento em `docs/nfse-nacional-emissao.md`:
1. `NFSE_NAC_EMISSAO_DRY_RUN=1` + `NFSE_NAC_EMISSAO_AMB=homologacao` — emite "dry",
   retorna o XML assinado sem enviar. Me devolva pra auditar.
2. Tira `DRY_RUN`, mantém `homologacao` — primeiro envio real contra produção
   restrita. Se SEFIN retornar 4xx de schema, ajustamos 1-2 campos.
3. Passou em homologação → `NFSE_NAC_EMISSAO_AMB=producao`.
4. Só então: `EMISSAO_BLOQUEADA_NFSE_NAC=false`.

---

## Kill-switch — referência rápida

Tudo via env var no Cloud Run (sem redeploy de código):

| Env | Efeito |
|---|---|
| `EMISSAO_BLOQUEADA=true` | bloqueia TODA emissão (read-only total) |
| `EMISSAO_BLOQUEADA_DAS=true` | bloqueia só DAS |
| `EMISSAO_BLOQUEADA_DARF=true` | bloqueia só DARF |
| `EMISSAO_BLOQUEADA_DCTFWEB=true` | bloqueia só DCTFWeb (transmitir/gerar-darf/encerrar) |
| `EMISSAO_BLOQUEADA_NFSE_NAC=true` | bloqueia só NFS-e Nacional |

- Ausente ou ≠ `"true"` = **liberado** (default — não muda comportamento).
- Consultas/captura **nunca** são afetadas pelo guard.
- Estado atual: `GET /api/admin/emission/guard-status`.

**Como freio de incidente:** se algo der errado em produção (emissão errada,
SEFAZ retornando lixo), set `EMISSAO_BLOQUEADA=true` e o app vira read-only na
hora, sem derrubar a captura.

---

## Pós go-live — monitoramento contínuo

- **Sentry**: erros de produção (após 0.4).
- **`GET /api/admin/sefaz/sync-cron-health`**: detecta cron órfão (parou no meio).
- **`sefaz_cron_logs`**: sucessos/falhas da captura noturna.
- **Cert**: alerta automático D-30/15/7/3 (após 0.5). Renovar com antecedência.

---

## Mapa de risco por operação

| Operação | Tipo | Risco | Gate |
|---|---|---|---|
| Captura DF-e | leitura | baixo | nenhum (sempre on) |
| Consulta SERPRO | leitura | baixo | nenhum |
| Conferências | leitura | baixo | nenhum |
| Emitir DAS | escrita | médio (R$ + parse TODO) | smoke + EMISSAO_BLOQUEADA_DAS |
| Emitir DARF | escrita | médio (parse TODO) | smoke + EMISSAO_BLOQUEADA_DARF |
| Transmitir DCTFWeb | escrita | **alto** (declaração vinculante) | piloto + EMISSAO_BLOQUEADA_DCTFWEB |
| Emitir NFS-e Nacional | escrita | **alto** (novo, não validado) | dry-run → homolog → prod |
