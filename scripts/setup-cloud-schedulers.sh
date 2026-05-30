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
        gcloud scheduler jobs update http "$JOB_NAME" \
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

upsert_job \
    "nfsesp-cron-noturno" \
    "0 3 * * 1-5" \
    "/api/admin/sefaz/nfsesp-cron" \
    "Captura NFSe SP (tomados + prestados) todas empresas com ccmSp"

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
