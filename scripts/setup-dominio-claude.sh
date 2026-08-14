#!/usr/bin/env bash
# ============================================================================
# scripts/setup-dominio-claude.sh — claude.spassessoriacontabil.com.br → CFI
# ----------------------------------------------------------------------------
# Mapeia o subdomínio ao serviço Cloud Run do CFI (Paulo, 13/08: "uma URL que
# identifique o Claude, no nosso domínio"). IDEMPOTENTE: rodar de novo só
# confere e mostra o estado — mesmo padrão do setup-cloud-schedulers.sh.
#
# O QUE ESTE SCRIPT FAZ:
#   1. confere se o domínio está verificado no Google (senão, diz como);
#   2. cria (ou confere) o domain mapping no Cloud Run;
#   3. imprime o registro DNS que falta criar no provedor do domínio.
#
# O QUE ELE NÃO FAZ (passos manuais, ditos no final):
#   - criar o CNAME no DNS (é no painel do provedor do domínio);
#   - autorizar o domínio no Firebase Auth (sem isso o LOGIN recusa);
#   - trocar a Callback URL na Meta (opcional, depois do TLS ativo).
# ============================================================================
set -euo pipefail

PROJECT="${PROJECT:-consultorfiscalapp}"
REGION="${REGION:-us-west1}"
SERVICE="${SERVICE:-consultor-fiscal-inteligente}"
DOMINIO="${DOMINIO:-claude.spassessoriacontabil.com.br}"
DOMINIO_RAIZ="spassessoriacontabil.com.br"

echo "── Domínio ${DOMINIO} → ${SERVICE} (${PROJECT}/${REGION}) ──"

# 1) Verificação de propriedade do domínio (exigência do Cloud Run).
if ! gcloud domains list-user-verified --format='value(id)' 2>/dev/null | grep -q "${DOMINIO_RAIZ}"; then
    echo ""
    echo "⚠️  O domínio ${DOMINIO_RAIZ} ainda não está verificado nesta conta Google."
    echo "    Rode:  gcloud domains verify ${DOMINIO_RAIZ}"
    echo "    (abre o Search Console; a verificação é por registro TXT no DNS.)"
    echo "    Depois rode este script de novo."
    exit 1
fi
echo "✓ domínio ${DOMINIO_RAIZ} verificado"

# 2) Domain mapping (idempotente: descreve; se não existe, cria).
if gcloud beta run domain-mappings describe --domain "${DOMINIO}" \
    --project "${PROJECT}" --region "${REGION}" >/dev/null 2>&1; then
    echo "✓ domain mapping já existe — conferindo estado…"
else
    echo "… criando domain mapping"
    gcloud beta run domain-mappings create \
        --service "${SERVICE}" --domain "${DOMINIO}" \
        --project "${PROJECT}" --region "${REGION}"
fi

# 3) O registro DNS que o provedor do domínio precisa ter.
echo ""
echo "── Registro DNS exigido (crie no painel onde o domínio é gerenciado) ──"
gcloud beta run domain-mappings describe --domain "${DOMINIO}" \
    --project "${PROJECT}" --region "${REGION}" \
    --format='table(status.resourceRecords[].name, status.resourceRecords[].type, status.resourceRecords[].rrdata)'
echo ""
echo "Na prática: CNAME  claude  →  ghs.googlehosted.com."
echo ""
echo "── Depois do DNS propagar (15 min a algumas horas) ──"
echo "1. O certificado TLS é emitido SOZINHO pelo Google — nada a fazer."
echo "2. Firebase Console → Authentication → Settings → Authorized domains →"
echo "   adicionar ${DOMINIO}  (SEM isso o login recusa no endereço novo)."
echo "3. Prova por resultado: abrir https://${DOMINIO}/ready e fazer um login."
echo "4. Só ENTÃO (opcional) trocar a Callback URL do webhook na Meta para"
echo "   https://${DOMINIO}/api/whatsapp/webhook — a URL run.app continua"
echo "   funcionando em paralelo; não há janela de apagão."
