# Runbook Técnico — Captura SEFAZ

**Última atualização:** 06/05/2026
**Responsável:** Equipe TI / SP Assessoria Contábil
**Sistema:** Consultor Fiscal Inteligente · Cloud Run `consultor-fiscal-inteligente`

---

## 1. Visão geral da arquitetura

```
┌─────────────────┐
│   Frontend SPA  │  React/Vite, hospedado no mesmo Cloud Run service
│  (XmlEmpresas-  │
│   Monitoradas)  │
└────────┬────────┘
         │ Bearer token Firebase
         ▼
┌──────────────────────────────────────────────┐
│  Cloud Run: consultor-fiscal-inteligente     │
│  ┌─────────────────────────────────────────┐ │
│  │  Express (server.js raiz)               │ │
│  │  ├── /api/admin/sefaz/cert (Fase 1)     │ │
│  │  └── /api/admin/sefaz/* (Fase 2)        │ │
│  │      ├── POST /sync-one    (botão UI)   │ │
│  │      ├── POST /sync-cron   (Scheduler)  │ │
│  │      ├── POST /toggle/:cnpj (admin)     │ │
│  │      ├── GET  /state/:cnpj              │ │
│  │      └── GET  /window                   │ │
│  └─────┬───────────────────────────────────┘ │
└────────┼─────────────────────────────────────┘
         │ mTLS (cert PFX)        │ admin
         ▼                        ▼
   SEFAZ Nacional         Firestore
   (NFeDistribuicao       - simples_empresas
    DFe.asmx)             - lucro_empresas
                          - documentos_fiscais
                          - sefaz_state
                          - sefaz_locks
                          - xml_capturas
                          - xml_erros
                          - sefaz_cron_logs
                                  │
                                  ▼
                          Firebase Storage
                          xmls/{empresaId}/{chave}.xml
```

**Componentes externos:**
- `Cloud Scheduler` — job `sefaz-cron-noturno` (02:00 BRT seg-sex, schedule `0 2 * * 1-5`)
- `Secret Manager` — secrets `sefaz-cert-a1`, `sefaz-cert-password`, `sefaz-cron-secret`
- `Cloud Monitoring` — alert policy `SEFAZ Cron - Erro Fatal` → e-mail Alexandre + Sandra

---

## 2. Identidades e permissões

| Recurso | Valor |
|---|---|
| Projeto GCP | `consultorfiscalapp` |
| Region | `us-west1` |
| Service account dedicada | `sefaz-capture-sa@consultorfiscalapp.iam.gserviceaccount.com` |
| Roles da SA | `roles/secretmanager.secretAccessor`, `roles/datastore.user`, `roles/storage.objectAdmin` |
| Cert digital A1 | CNPJ 44.388.152/0001-89 (SP Assessoria Contábil) |
| Validade do cert | 10/06/2026 (renovar antes) |

---

## 3. Variáveis de ambiente do Cloud Run

| Variável | Origem | Uso |
|---|---|---|
| `GCP_PROJECT_ID` | env literal | `consultorfiscalapp` |
| `SEFAZ_CERT_NAME` | env literal | `sefaz-cert-a1` |
| `SEFAZ_PASS_NAME` | env literal | `sefaz-cert-password` |
| `SEFAZ_CRON_SECRET` | secret `sefaz-cron-secret:latest` | Auth do Cloud Scheduler |
| `STORAGE_BUCKET` | default | `consultorfiscalapp.appspot.com` |

Verificar:
```bash
gcloud run services describe consultor-fiscal-inteligente \
  --region=us-west1 --project=consultorfiscalapp \
  --format="value(spec.template.spec.containers[0].env)"
```

---

## 4. Fluxo de captura sob demanda (manual)

1. Colaborador clica "↓ Sincronizar SEFAZ" na empresa X
2. Frontend (`dfeCaptureService.captureFromSefaz`) → `POST /api/admin/sefaz/sync-one`
3. Backend valida:
   - Token Firebase (`requireAuth`)
   - Janela operacional 07-20h BRT seg-sex (`statusJanelaOperacional`)
4. `sync-orchestrator.sincronizarEmpresa`:
   - Acquire lock TTL 1h em `sefaz_locks/{cnpj}` (transação)
   - Lê cursor NSU de `sefaz_state/{cnpj}`
   - Loop até 50 páginas (~2500 docs — cobre backlog de 90 dias numa tacada): `consultaDistDFe` → mTLS → SEFAZ
   - Para cada `docZip`: `importarXmlSefaz` → upload Storage + set Firestore
   - `resNFe` importado → dispara Ciência da Operação (210210) automática assinada com o **A1 da própria empresa** (nunca o do escritório — SEFAZ rejeita evento cujo autor tem raiz CNPJ diferente do cert). Ciência aceita → re-download imediato da `procNFe` completa via `consChNFe` → upgrade resumo→completa
   - Persiste novo `ultNSU` em `sefaz_state`
5. Frontend mostra resultado + recarrega `getSefazState`

**Notas de SAÍDA (emitidas pela empresa) NÃO vêm pela Distribuição DF-e** — a SEFAZ só distribui documentos onde o CNPJ consultado é destinatário/interessado, além de eventos. XML de NF-e emitida entra no sistema via Importação Manual ou SharePoint.

---

## 5. Fluxo de cron noturno

1. Cloud Scheduler dispara HTTP POST → `/api/admin/sefaz/sync-cron` com header `X-Sefaz-Cron-Secret`
2. Backend valida secret, retorna `200 OK` imediato
3. Em background (`setImmediate`):
   - `listarEmpresasParaCron`: scaneia `simples_empresas` + `lucro_empresas`, filtra `capturarSefaz !== false` e `ultimoAcessoXml > now-30d`, dedup por CNPJ
   - Para cada empresa, chama `sincronizarEmpresa` sequencialmente
   - Lock por CNPJ é respeitado (se humano sincronizou nas últimas 1h, cron pula)
   - Registra resumo em `sefaz_cron_logs` (sucessos, falhas, novos, ms)

**Tempo médio:** ~8s por empresa. Para 300 empresas: ~40min.

---

## 6. Comandos operacionais

### Disparar cron manualmente (sem esperar 02:00)
```bash
gcloud scheduler jobs run sefaz-cron-noturno \
  --location=us-west1 --project=consultorfiscalapp
```

### Ver logs do cron
```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="consultor-fiscal-inteligente" AND (textPayload:"sync-cron" OR textPayload:"orchestrator")' \
  --limit=100 --project=consultorfiscalapp \
  --format="value(timestamp,textPayload)" \
  --order="asc" --freshness=1d
```

### Ver logs de uma sync manual específica
```bash
gcloud logging read 'resource.type="cloud_run_revision" AND textPayload:"sync-one"' \
  --limit=20 --project=consultorfiscalapp --freshness=1h \
  --format="value(timestamp,textPayload)"
```

### Quebrar lock manual de uma empresa (se travou)
```bash
# Pelo Console: https://console.firebase.google.com/project/consultorfiscalapp/firestore/data/~2Fsefaz_locks
# Ou via gcloud:
gcloud firestore documents delete \
  "sefaz_locks/44388152000189" \
  --project=consultorfiscalapp
```

### Forçar re-sync completo de uma empresa (zerar cursor NSU)
```bash
# Apaga sefaz_state/{cnpj} no Console Firestore.
# Próxima sincronização parte do NSU=0 e baixa todos os documentos disponíveis.
```

### Verificar status de uma empresa
```bash
curl -sS "https://consultor-fiscal-inteligente-631239634290.us-west1.run.app/api/admin/sefaz/state/44388152000189" \
  -H "Authorization: Bearer <ID_TOKEN>"
```

---

## 7. Renovação de certificado A1

**Antes do dia 10/06/2026:**

1. Solicitar renovação à AC SyngularID Multipla (ICP-Brasil)
2. Obter novo `.pfx` + senha
3. Login admin no app → Central de Documentos Fiscais → Configurações → "Substituir certificado"
4. Upload do novo `.pfx` + senha
5. Verificar status no card que o CNPJ e validade atualizaram
6. Backend invalida cache automaticamente (`invalidateCertificateCache()` no próximo erro)

Versões antigas ficam preservadas no Secret Manager pra auditoria. Zero downtime.

---

## 8. Códigos de status SEFAZ relevantes

| cStat | Significado | Comportamento |
|---|---|---|
| `138` | Documento(s) localizado(s) | OK — XMLs vêm em `<docZip>` |
| `137` | Nenhum documento localizado | OK — sem docs no momento |
| `656` | Consumo Indevido | Rate limit. Aguardar 1h. Sistema retorna `rateLimited: true` |
| `280` | Certificado Transmissor inválido | Cert sem permissão. Falta procuração e-CAC do CNPJ alvo |
| `252` | Ambiente de homologação inválido | Não deve ocorrer (`tpAmb=1` fixo) |
| `108`/`109` | Serviço fora do ar | SEFAZ indisponível. Cron noturno tenta amanhã |

---

## 9. Coleções Firestore — schema essencial

### `documentos_fiscais/{chave}` (44 dígitos)
```ts
{
  id: string,                    // chave NFe
  chave: string,
  empresaId: string,
  empresaCnpj: string,           // CNPJ destino/origem
  cnpjEmit: string,
  cnpjDest: string,
  xNomeEmit: string,
  dhEmi: string,
  valorTotal: number,
  tpNF: string,                  // 0=entrada, 1=saída
  tipoDoc: 'NFe' | 'resNFe' | 'eventoNFe' | 'resEvento',
  schema: string,                // 'procNFe_v4.00' etc
  nsu: string,
  storagePath: string,           // 'xmls/{empresaId}/{chave}.xml'
  xmlHash: string,               // SHA-256
  origem: 'sefaz' | 'manual' | 'sharepoint',
  createdAt: Timestamp,
  createdBy: string,
  capturadoPor: { uid, email, fonte }
}
```

### `sefaz_state/{cnpj}` (14 dígitos)
```ts
{
  cnpj: string,
  ultNSU: string,                // cursor da próxima consulta
  ultimaSync: Timestamp,
  cStatUltimaSync: string,
  xMotivoUltimaSync: string,
  paginas: number,
  ultimoColaborador: string,
  fonteUltimaSync: 'manual' | 'cron'
}
```

### `sefaz_locks/{cnpj}`
```ts
{
  startedAt: Timestamp,
  expiresAt: Timestamp,           // TTL 1h
  lockedBy: string                // email ou 'cron-system'
}
```

### `xml_capturas` (audit log)
1 doc por XML capturado — origem, schema, captured by, timestamp.

### `xml_erros`
Falhas de captura — motivo, contexto (NSU, schema), timestamp.

### `sefaz_cron_logs`
1 doc por execução do cron noturno — totais, falhas, duração ms.

---

## 10. Troubleshooting

### Cron não rodou às 02:00
1. Verificar Cloud Scheduler:
   ```bash
   gcloud scheduler jobs describe sefaz-cron-noturno --location=us-west1 --project=consultorfiscalapp
   ```
   Esperar `state: ENABLED`.
2. Verificar última execução em `sefaz_cron_logs` (Firestore Console)
3. Verificar logs de Cloud Run no horário 02:00-03:00 BRT

### Botão "Sincronizar SEFAZ" não responde
1. F12 → Network → clicar no botão
2. Procurar request `sync-one`. Status code:
   - `401` → token Firebase expirou (relogar)
   - `403` → fora da janela operacional (07-20h BRT seg-sex)
   - `409` → lock ativo (1h desde última sync)
   - `429` → SEFAZ rate limit (cStat 656)
   - `500` → erro interno (ver logs Cloud Run)

### Empresa nunca captura nenhum XML
1. Confirmar procuração e-CAC ativa (cliente outorgou no portal Receita?)
2. Confirmar que serviço autorizado é "NFe-Distribuição de DFe" ou "Todos os Serviços"
3. Verificar nos logs: `cStat=137` = sem docs, `cStat=280` = sem permissão

### "Saída" mostra 0 documentos
Comportamento esperado da Distribuição DF-e: a SEFAZ só entrega notas onde a
empresa é **destinatária** (entrada) + eventos. NF-e **emitidas** pela empresa
não são redistribuídas ao próprio emitente — importe o XML do sistema emissor
via **Importação Manual** ou SharePoint.

### Nota fica como "Resumo" (sem valor/itens) e nunca vira completa
1. Ver `manifestacoes_log` — a Ciência foi aceita (`cStat=135/136`)?
2. Rejeição por autor ≠ certificado: a empresa precisa de A1 **da própria raiz
   CNPJ** (o cert do escritório não assina evento de cliente)
3. Aceita mas sem upgrade: campo `baixaCompleta` no log mostra o resultado do
   re-download via `consChNFe`; se falhou, a completa chega no próximo DistDFe
4. Resumos antigos presos: o cron noturno agora manifesta `resNFe` (antes só
   olhava `tipoDoc='NFe'`, que já era completa — bug corrigido em 07/2026)

### Certificado deu erro de TLS
1. Backend tenta recarregar cert do Secret Manager 1x automaticamente
2. Se persistir: invalidar cache forçando deploy + verificar arquivo PFX está íntegro
3. Tentar upload de novo via UI

### `gcloud config` aponta projeto errado
```bash
gcloud config set project consultorfiscalapp
```

---

## 11. Deploy

```bash
cd ~/consultor-fiscal-inteligente
npm run build                                            # validar build local
git add -A && git commit -m "..." && git push origin xml-refactor-on-prod-base
# Deploy normal: merge na main dispara .github/workflows/deploy-app.yml.
# Saída de EMERGÊNCIA (Actions fora): scripts/deploy-manual.sh — Cloud Build +
# health check antes de rotear; NÃO roda o gate (só depois do gate verde local).
bash scripts/deploy-manual.sh
```

Health check pós-deploy:
```bash
curl -sS https://consultor-fiscal-inteligente-631239634290.us-west1.run.app/health
# Esperado: {"status":"ok","ai":true,"timestamp":"..."}
```

Se `traffic` ficar em 0% após deploy:
```bash
gcloud run services update-traffic consultor-fiscal-inteligente \
  --to-latest --region=us-west1 --project=consultorfiscalapp
```

---

## 12. Alertas Cloud Monitoring

**Policy ativa:** `SEFAZ Cron - Erro Fatal`

Dispara quando: log com `[sync-cron] erro fatal` aparece em qualquer execução.

Notifica: `alexandre@spassessoriacontabil.com.br`, `sandra@spassessoriacontabil.com.br`

Console: https://console.cloud.google.com/monitoring/alerting?project=consultorfiscalapp

---

## 13. Histórico de revisões

| Data | Revisão | Mudança |
|---|---|---|
| 06/05/2026 | `00119-4bs` | Fase 1 — upload de cert via Secret Manager |
| 06/05/2026 | `00120-wr8` | Fase 2 — captura SEFAZ (sync-one + sync-cron) |
| 06/05/2026 | `00122-27t` | Cloud Scheduler vinculado |
| 06/05/2026 | `00123-xxx` | Fix: collections corretas + default ativo |
| 06/05/2026 | `00124-45q` | Toggle admin-only (UI engrenagem + endpoint) |

---

## 14. Pendências pós-Fase 2

- [ ] Confirmação de e-mail dos canais Cloud Monitoring (Alexandre + Sandra)
- [ ] Identificar 1ª empresa-cliente com procuração e-CAC e validar captura real (não-zero NF-e)
- [ ] Eventos NFe (cancelamento, CC-e) — schema já vem mas hoje só persiste como `eventoNFe`
- [ ] Renovação cert A1 antes de 10/06/2026
- [ ] Limpar banner âmbar antigo "captura automática habilitada... importação manual" em XmlEmpresasMonitoradas.tsx (texto da Fase 0)
- [ ] Limpar branches `claude/*` legadas
- [ ] ~12 erros TS pré-existentes (`tsc --noEmit`)

---

*Atualize este documento sempre que mudar arquitetura, schema ou fluxo operacional.*
