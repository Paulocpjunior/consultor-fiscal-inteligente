#!/bin/bash
# ============================================================================
# scripts/setup-cloud-schedulers.sh
# Cria/atualiza os 3 Cloud Scheduler jobs que disparam as capturas noturnas:
#   1. sefaz-cron-noturno              — NFe DistDFe (entrada/saída)
#   2. nfsesp-cron-noturno             — NFSe SP (tomados + prestados)
#   3. nfse-nacional-dfe-cron-noturno  — NFSe Nacional ADN (DFe)
#
# Idempotente: tenta `update`, se job não existe faz `create`.
#
# Pré-requisitos:
#   - gcloud autenticado (gcloud auth login)
#   - APIs habilitadas: cloudscheduler.googleapis.com, run.googleapis.com
#   - Secret `sefaz-cron-secret` no Secret Manager
#   - Service account com role Cloud Run Invoker
# ============================================================================

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-consultorfiscalapp}"
REGION="${REGION:-us-west1}"
SERVICE_URL="${SERVICE_URL:-https://consultor-fiscal-inteligente-631239634290.us-west1.run.app}"
SA_EMAIL="${SA_EMAIL:-sefaz-capture-sa@consultorfiscalapp.iam.gserviceaccount.com}"
SECRET_NAME="${SECRET_NAME:-sefaz-cron-secret}"
TZ="America/Sao_Paulo"

# ─── CPU sempre alocada no Cloud Run ────────────────────────────────────────
# Os crons respondem 200 imediato e fazem TODO o trabalho em background
# (setImmediate). Com CPU throttling (default), o Cloud Run corta a CPU após a
# resposta e a captura noturna morre no meio sem retry — o attempt-deadline do
# Scheduler não ajuda porque o 200 já foi devolvido. `--no-cpu-throttling`
# mantém a CPU alocada entre requisições (incidente de 01/06/2026).
echo "→ garantindo --no-cpu-throttling no serviço Cloud Run…"
gcloud run services update consultor-fiscal-inteligente \
    --no-cpu-throttling \
    --region="$REGION" --project="$PROJECT_ID" --quiet \
    && echo "✓ CPU sempre alocada" \
    || echo "⚠ não foi possível atualizar o serviço (rode manualmente: gcloud run services update consultor-fiscal-inteligente --no-cpu-throttling --region=$REGION)"

# ─── Pega o secret ─────────────────────────────────────────────────────────
echo "→ lendo secret '$SECRET_NAME' do Secret Manager…"
CRON_SECRET=$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT_ID")
if [ -z "$CRON_SECRET" ]; then
    echo "✗ secret '$SECRET_NAME' vazio ou inacessível"
    exit 1
fi
echo "✓ secret carregado (${#CRON_SECRET} chars)"

# ─── Função: cria ou atualiza um job ───────────────────────────────────────
upsert_job() {
    local JOB_NAME="$1"
    local SCHEDULE="$2"          # ex: "0 2 * * 1-5"
    local PATH_URL="$3"          # ex: "/api/admin/sefaz/sync-cron"
    local DESCRICAO="$4"

    local URL="${SERVICE_URL}${PATH_URL}"
    echo ""
    echo "═══ $JOB_NAME ═══"
    echo "  schedule : $SCHEDULE ($TZ)"
    echo "  url      : $URL"

    # Tenta describe primeiro pra saber se existe
    if gcloud scheduler jobs describe "$JOB_NAME" \
        --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
        echo "  → job existe, atualizando…"
        # Atenção: no gcloud atual a flag pra atualizar headers é
        # --update-headers (não --headers que só existe no create).
        gcloud scheduler jobs update http "$JOB_NAME" \
            --location="$REGION" --project="$PROJECT_ID" \
            --schedule="$SCHEDULE" \
            --time-zone="$TZ" \
            --uri="$URL" \
            --http-method=POST \
            --update-headers="x-cron-secret=${CRON_SECRET},Content-Type=application/json" \
            --message-body='{}' \
            --description="$DESCRICAO" \
            --oidc-service-account-email="$SA_EMAIL" \
            --attempt-deadline=900s \
            --max-retry-attempts=2 \
            --min-backoff=60s \
            --max-backoff=300s
    else
        echo "  → job não existe, criando…"
        gcloud scheduler jobs create http "$JOB_NAME" \
            --location="$REGION" --project="$PROJECT_ID" \
            --schedule="$SCHEDULE" \
            --time-zone="$TZ" \
            --uri="$URL" \
            --http-method=POST \
            --headers="x-cron-secret=${CRON_SECRET},Content-Type=application/json" \
            --message-body='{}' \
            --description="$DESCRICAO" \
            --oidc-service-account-email="$SA_EMAIL" \
            --attempt-deadline=900s \
            --max-retry-attempts=2 \
            --min-backoff=60s \
            --max-backoff=300s
    fi
    echo "  ✓ $JOB_NAME pronto"
}

# ─── Cria os 3 jobs ────────────────────────────────────────────────────────
upsert_job \
    "sefaz-cron-noturno" \
    "0 2 * * 1-5" \
    "/api/admin/sefaz/sync-cron" \
    "Captura NFe DistDFe (entrada/saída) todas empresas elegíveis"

# WS SOAP legado da NFSe SP retorna erro 1102 desde a Reforma 2026 — o job
# noturno era falha garantida poluindo nfsesp_cron_logs e mascarando falhas
# reais. O caminho vigente é o portal CSV (nfsesp-portal-cron-noturno abaixo).
echo "→ removendo job legado nfsesp-cron-noturno (WS 1102, substituído pelo portal CSV)…"
gcloud scheduler jobs delete "nfsesp-cron-noturno" \
    --location="$REGION" --project="$PROJECT_ID" --quiet 2>/dev/null \
    && echo "  ✓ job legado removido" \
    || echo "  ✓ job legado já não existe"

upsert_job \
    "nfse-nacional-dfe-cron-noturno" \
    "0 4 * * 1-5" \
    "/api/admin/nfse-nacional-dfe/sync-cron" \
    "Captura NFSe Nacional ADN (DFe) todas empresas habilitadas"

# NFSe SP via PORTAL CSV — substitui o WS legacy que retornava erro 1102.
# 1 login do escritório baixa CSV de TODAS empresas autorizadas no portal.
upsert_job \
    "nfsesp-portal-cron-noturno" \
    "30 3 * * 1-5" \
    "/api/admin/sefaz/nfsesp-portal-cron" \
    "Captura NFSe SP via portal CSV (todas empresas autorizadas no mês anterior)"

# Alertas de vencimento de obrigações — D-3, D-1, D-0, atrasadas.
# Envia email + cria notificação in-app + banner topo do app.
upsert_job \
    "vencimentos-cron-diario" \
    "0 8 * * 1-5" \
    "/api/admin/vencimentos/cron" \
    "Verifica tarefas vencendo e dispara emails + notificações in-app"

# Captura NFe extra durante o dia (alem do noturno) — 6h/12h/18h.
# Mesmo endpoint do cron noturno; reforca captura intra-dia.
upsert_job \
    "sefaz-xml-capture" \
    "0 6,12,18 * * 1-5" \
    "/api/admin/sefaz/sync-cron" \
    "Captura NFe DistDFe intra-dia (6h/12h/18h)"

# SharePoint auto-sync — importa XMLs das pastas SharePoint das empresas.
# Protegido por x-cron-secret (alinhado aos demais crons).
upsert_job \
    "sharepoint-auto-sync" \
    "0 8 * * 1-5" \
    "/api/admin/sharepoint/auto-sync" \
    "Importa XMLs das pastas SharePoint (empresas com autoSyncEnabled)"

# Alerta de vencimento de CERTIFICADO digital — escritório + por empresa.
# Dispara email (Graph) UMA vez por faixa (30/15/7/3/1 dias e expirado).
# Roda 7h BRT, antes do cron de vencimentos de obrigações (8h).
# Critico: o cert do escritorio e usado por 54+ empresas via fallback.
upsert_job \
    "cert-alerta-cron-diario" \
    "0 7 * * 1-5" \
    "/api/admin/sefaz/cert-alerta-cron" \
    "Alerta por email quando certificado (escritorio ou empresa) esta vencendo"

# Resumo diario das capturas NFe via procuracao e-CAC.
# Roda 9h BRT (1h depois do cron noturno de NFe terminar) e dispara email
# com KPIs + tabela por empresa + acoes sugeridas pra erros (cStat 280/593/etc).
# Util pra detectar quais das 74 empresas com procuracao=true REALMENTE
# tem procuracao ativa no e-CAC (cStat=280 = procuracao nao cadastrada).
upsert_job \
    "captura-resumo-diario" \
    "0 9 * * 1-5" \
    "/api/admin/sefaz/captura-resumo-cron" \
    "Resumo diario por email das capturas NFe via procuracao e-CAC"

# ─── Verifica ──────────────────────────────────────────────────────────────
echo ""
echo "═══ Jobs ativos em $REGION ═══"
gcloud scheduler jobs list \
    --location="$REGION" --project="$PROJECT_ID" \
    --filter="name~cron-noturno" \
    --format="table(name.basename(),schedule,state,lastAttemptTime)"

echo ""
echo "✓ setup concluído. Próxima execução:"
echo "    02h BRT — sefaz-cron-noturno"
echo "    03h BRT — nfsesp-cron-noturno"
echo "    04h BRT — nfse-nacional-dfe-cron-noturno"
echo ""
echo "Pra disparar manualmente um job agora:"
echo "  gcloud scheduler jobs run sefaz-cron-noturno --location=$REGION --project=$PROJECT_ID"
