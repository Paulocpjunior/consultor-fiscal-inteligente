#!/bin/bash
# ============================================================================
# scripts/setup-cloud-schedulers.sh
#
# Fonte ÚNICA e idempotente dos Cloud Scheduler jobs. Rodar este script
# (cria os que faltam, atualiza os existentes) mantém o agendamento igual a
# esta lista. Todos POST com header x-cron-secret, TZ America/Sao_Paulo.
#
# ── Captura fiscal ──────────────────────────────────────────────────────────
#   sefaz-cron-noturno              0 2 * * 1-5        NFe DistDFe (entrada/saída), noturno
#   sefaz-xml-capture               0 6,12,18 * * 1-5  NFe DistDFe intra-dia
#   manifesto-ciencia-cron          15 */2 * * *       Ciência da Operação (destrava XML completo de entrada)
#   sefaz-drenagem-cron             0 7,10,13,16,19 * * 1-5  Drena pendência NSU (FLANACAR-class)
#   autxml-harvest-cron             15 2,10,16 * * 1-5 Saída NF-e via autXML (cert do escritório)
#   xml-email-ingest-cron           */30 7-21 * * 1-6  Cofre CFI: lê a caixa e importa (saída mod 55)
#   sae-nfce-cron-noturno           30 2 * * 1-5       Saída NFC-e (SAE-NFC-e SP), noturno
#   sae-nfce-cron-intradia          0 7,13,19 * * 1-5  Saída NFC-e (SAE-NFC-e SP), intra-dia
#   nfsesp-cron-noturno             (PAUSADO 22/07)    NFSe SP WS legado — erro 1102; substituído pelo portal CSV
#   nfsesp-portal-cron-noturno      30 3 * * 1-5       NFSe SP (portal CSV)
#   nfse-nacional-dfe-cron-noturno  0 4 * * 1-5        NFSe Nacional ADN (DFe)
# ── Arquivo / SharePoint ────────────────────────────────────────────────────
#   sharepoint-auto-sync            0 8 * * 1-5        Importa XMLs das pastas SharePoint
#   cofre-sharepoint-arquivo-cron   20 8-20 * * 1-6    Arquiva no SharePoint os XMLs do cofre CFI
# ── Tarefas / vencimentos ───────────────────────────────────────────────────
#   tarefas-cron-mensal             20 3 1 * *         Gera obrigações mensais (dia 1)
#   vencimentos-cron-diario         0 8 * * 1-5        Avisa tarefas vencendo (email + in-app)
# ── Alertas / saúde ─────────────────────────────────────────────────────────
#   cofre-email-alerta-cron         0 9,18 * * 1-5     Cofre CFI: erros, pendências, clientes inativos
#   crons-health-alerta             10 9,15,21 * * 1-5 Avisa quando algum cron falha/trava
#   cert-alerta-cron-diario         0 7 * * 1-5        Avisa certificado vencendo
#   sharepoint-cron-alertas         30 8 * * 1-5       Avisa documentos novos no SharePoint
#   captura-resumo-diario           0 9 * * 1-5        Resumo diário das capturas via procuração e-CAC
#
# Idempotente: `describe` → se existe `update`, senão `create`.
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
    local BODY="${5:-}"          # corpo POST; ex: '{"dryRun":false}'
    [ -z "$BODY" ] && BODY='{}'  # default '{}'

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
            --message-body="$BODY" \
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
            --message-body="$BODY" \
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

# DRENAGEM DE PENDÊNCIA NSU (caso FLANACAR: 15.586 na fila, só o noturno
# drenava ~2.500/noite). Roda de dia nas janelas 07/10/13/16/19h BRT úteis;
# descobre sozinho as empresas com pendenciaNSU>0 (piores primeiro, top 10)
# e PARA no primeiro 656. Lock de 1h evita colisão com noturno/manual.
upsert_job \
    "sefaz-drenagem-cron" \
    "0 7,10,13,16,19 * * 1-5" \
    "/api/admin/sefaz/sync-drenagem-cron" \
    "Drena empresas com pendencia NSU na SEFAZ (piores primeiro, para em 656)"

# APOSENTADO 22/07/2026: nfsesp-cron-noturno (webservice legado) — o WS da
# prefeitura devolve erro 1102 "Mensagem XML de Pedido do serviço sem
# conteúdo" para TODAS as empresas (121 falhas/noite no painel). O trilho
# oficial de NFSe SP é o PORTAL CSV (nfsesp-portal-cron-noturno, 03:30).
# Pausa (reversível) em vez de delete — histórico de execuções preservado.
echo "→ pausando job aposentado nfsesp-cron-noturno (WS legado, erro 1102)"
gcloud scheduler jobs pause "nfsesp-cron-noturno" \
    --project="$PROJECT_ID" --location="$REGION" --quiet 2>/dev/null \
    && echo "  ✔ pausado" || echo "  (já pausado ou inexistente — ok)"

upsert_job \
    "nfse-nacional-dfe-cron-noturno" \
    "0 4 * * 1-5" \
    "/api/admin/nfse-nacional-dfe/sync-cron" \
    "Captura NFSe Nacional ADN (DFe) todas empresas habilitadas"

# Captura de SAIDA de NFC-e (mod 65) via SAE-NFC-e (SEFAZ-SP), com o A1 de
# cada empresa do cofre ("frente 2" — atuar como o proprio cliente).
# Roda 2h30 (entre o DistDFe 2h e a NFSe 3h) + reforcos intra-dia 7h/13h/19h
# (deslocados 1h do sefaz-xml-capture pra nao concorrer pelo mesmo container).
# Incremental: cada disparo cobre do ultimo cursor ate agora (estado em
# sae_nfce_state/{cnpj}); o que nao couber no orcamento fica pro proximo.
upsert_job \
    "sae-nfce-cron-noturno" \
    "30 2 * * 1-5" \
    "/api/admin/sefaz/sae-nfce-cron" \
    "Captura saida NFC-e (SAE-NFC-e SP) com A1 de cada empresa do cofre"

upsert_job \
    "sae-nfce-cron-intradia" \
    "0 7,13,19 * * 1-5" \
    "/api/admin/sefaz/sae-nfce-cron" \
    "Captura saida NFC-e (SAE-NFC-e SP) — reforco intra-dia 7h/13h/19h"

# Tarefas/obrigacoes mensais automaticas — dia 1 as 03h BRT. A rota existia
# (/api/tarefas/cron-mensal) mas nao havia job criado (auditoria: cron orfao),
# entao as obrigacoes do mes podiam nunca ser geradas.
upsert_job \
    "tarefas-cron-mensal" \
    "20 3 1 * *" \
    "/api/tarefas/cron-mensal" \
    "Gera tarefas/obrigacoes mensais de todas as empresas (dia 1, deslocado do nfsesp 3h)"

# Alertas de docs novos no SharePoint — 08h30 BRT (apos o auto-sync das 08h).
# Rota /api/admin/sharepoint/cron-alertas existia sem job (cron orfao).
upsert_job \
    "sharepoint-cron-alertas" \
    "30 8 * * 1-5" \
    "/api/admin/sharepoint/cron-alertas" \
    "Alerta admins por email sobre documentos novos no SharePoint"

# Alerta proativo de cron parado — verifica a saude de TODOS os crons e manda
# email se algum entrou em falha/travado (anti-spam: 1x/dia por problema). Roda
# 9h/15h/21h uteis (apos as janelas de captura), pra o painel de saude nao ser
# so passivo. Deslocado :10 pra nao concorrer com jobs de hora cheia.
upsert_job \
    "crons-health-alerta" \
    "10 9,15,21 * * 1-5" \
    "/api/admin/crons/health-alerta" \
    "Alerta por email quando algum cron esta em falha/travado (saude dos crons)"

# Colheita de SAIDA via <autXML> (DistDFe com o cert do escritorio). O cliente
# autoriza o CNPJ do escritorio na emissao (tag autXML) e a SEFAZ distribui o
# XML completo das notas dele para o escritorio, no MESMO fluxo distNSU. Roda
# 3x/dia, deslocado dos demais crons de captura.
upsert_job \
    "autxml-harvest-cron" \
    "15 2,10,16 * * 1-5" \
    "/api/admin/sefaz/autxml-harvest-cron" \
    "Colhe saida NF-e via autXML (DistDFe cert escritorio) e atribui ao cliente"

# Ingestao de XML por E-MAIL — o "cofre" do CFI que substitui o da SIEG. O
# emissor de cada cliente manda o XML de cada nota emitida pra uma caixa nossa
# (XML_INGEST_MAILBOX); o CFI le os anexos e importa (saida mod 55 inclusive,
# que a SEFAZ nao entrega ao emissor). Roda de 30 em 30 min em horario comercial.
upsert_job \
    "xml-email-ingest-cron" \
    "*/30 7-21 * * 1-6" \
    "/api/admin/sefaz/xml-email-ingest-cron" \
    "Le XMLs enviados por email (cofre CFI) e importa (saida/entrada)"

# Alertas do cofre: erros de import, e-mails sem XML (pendencias) e clientes
# que pararam de enviar saida (emissor caiu). Anti-spam por assinatura. Roda
# 2x/dia em dia util (manha e fim de tarde).
upsert_job \
    "cofre-email-alerta-cron" \
    "0 9,18 * * 1-5" \
    "/api/admin/sefaz/xml-email-ingest/alerta-cron" \
    "Alertas do cofre CFI (erros, pendencias, clientes inativos)"

# Arquivo automatico no SharePoint dos XMLs do cofre (Fase 3). Roda deslocado
# da leitura da caixa pra nao competir. So sobe o que ainda nao foi arquivado.
upsert_job \
    "cofre-sharepoint-arquivo-cron" \
    "20 8-20 * * 1-6" \
    "/api/admin/sefaz/xml-email-arquivo-sp-cron" \
    "Arquiva no SharePoint os XMLs capturados pelo cofre CFI"

# Manifestacao automatica (Ciencia da Operacao) das NF-e de ENTRADA — o "CDO"
# que a SIEG faz. Destrava o XML COMPLETO das entradas (a SEFAZ so libera apos
# manifestacao). 22/07: 3.889 resumos presos com 3 janelas/dia-util — passou a
# rodar A CADA 2H TODOS OS DIAS (evita colisao com capturas de 02/03/04h via
# minuto 15). Seguro contra 656: o lote intercala por raiz CNPJ, tem
# circuit-breaker no primeiro 656 da raiz e cooldown de 6h por chave falha.
upsert_job \
    "manifesto-ciencia-cron" \
    "15 */2 * * *" \
    "/api/admin/sefaz/manifest-cron" \
    "Ciencia da Operacao automatica nas NF-e de entrada (destrava XML completo)" \
    '{"dryRun":false,"tipo":"ciencia","limit":500}'

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
echo "    03h30 BRT — nfsesp-portal-cron-noturno (WS legado pausado)"
echo "    04h BRT — nfse-nacional-dfe-cron-noturno"
echo ""
echo "Pra disparar manualmente um job agora:"
echo "  gcloud scheduler jobs run sefaz-cron-noturno --location=$REGION --project=$PROJECT_ID"
