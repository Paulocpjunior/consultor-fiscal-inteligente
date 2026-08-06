#!/usr/bin/env bash
# ============================================================================
# scripts/deploy-manual.sh — SAÍDA DE EMERGÊNCIA do deploy.
# ----------------------------------------------------------------------------
# POR QUE EXISTE (06/08): o GitHub Actions parou de atribuir runner — três
# deploys seguidos entraram na fila, ficaram com `runner_id: 0` e foram
# cancelados aos 15 minutos cravados. Nenhum passo chegou a rodar. Com o CI
# fora, a entrega ficou 100% bloqueada e não havia outro caminho.
#
# Este script faz o MESMO que o workflow, sem depender do GitHub:
#   1. resolve a config do frontend (VITE_*) do bundle JÁ publicado;
#   2. constrói a imagem no CLOUD BUILD — não precisa de Docker na máquina
#      (o Mac do Paulo não tem, e foi onde a 1ª tentativa parou);
#   3. sobe a revisão SEM TRÁFEGO, confere o /ready dela e só então roteia.
#
# O passo 3 é o que importa: deploy manual sem health check é como o workflow
# era ANTES — roteava primeiro e descobria depois. Aqui a revisão velha segue
# servindo 100% se a nova subir quebrada.
#
# USO:  ./scripts/deploy-manual.sh
# ============================================================================
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-consultorfiscalapp}"
SERVICE_NAME="${SERVICE_NAME:-consultor-fiscal-inteligente}"
REGION="${REGION:-us-west1}"
IMAGE="${IMAGE:-us-central1-docker.pkg.dev/consultorfiscalapp/cloud-run-deploy/consultor-fiscal-inteligente}"

cd "$(dirname "$0")/.."

command -v gcloud >/dev/null || { echo "❌ gcloud não encontrado. Instale o Google Cloud SDK."; exit 1; }
command -v node   >/dev/null || { echo "❌ node não encontrado."; exit 1; }

TAG="manual-$(git rev-parse --short HEAD)-$(date +%s)"
COMMIT="$(git rev-parse HEAD)"
echo "▸ Repositório em $(git rev-parse --abbrev-ref HEAD) · commit ${COMMIT:0:7}"

# ── 1. Config do frontend ───────────────────────────────────────────────────
# A config web do Firebase é PÚBLICA por design (vai pro navegador de quem
# abre o app); extrair do bundle publicado não expõe nada novo.
CFG="$(mktemp)"
trap 'rm -f "$CFG" "${CFG}.yaml"' EXIT
echo "▸ Resolvendo VITE_* do bundle em produção…"
CONFIG_OUT="$CFG" node scripts/extract-prod-frontend-config.mjs

# ── 2. Build no Cloud Build ─────────────────────────────────────────────────
# Os build-args entram INLINE num cloudbuild gerado, em vez de --substitutions:
# valor com '=' ou ',' quebra a substituição e o erro é obscuro.
{
    echo "steps:"
    echo "  - name: gcr.io/cloud-builders/docker"
    echo "    args:"
    echo "      - build"
    while IFS='=' read -r k v; do
        [ -z "$k" ] && continue
        echo "      - --build-arg"
        echo "      - ${k}=${v}"
    done < "$CFG"
    echo "      - --build-arg"
    echo "      - APP_COMMIT=${COMMIT}"
    # Sem número de run do GitHub, o rodapé mostra 'local' (rotuloVersao) — e é
    # HONESTO: build manual não tem número de esteira, e fingir que tem
    # esconderia justamente que esta entrega saiu por fora.
    echo "      - -t"
    echo "      - ${IMAGE}:${TAG}"
    echo "      - ."
    echo "images:"
    echo "  - ${IMAGE}:${TAG}"
    echo "options:"
    echo "  machineType: E2_HIGHCPU_8"
} > "${CFG}.yaml"

echo "▸ Construindo no Cloud Build (sem Docker local)…"
gcloud builds submit --config "${CFG}.yaml" --project "$PROJECT_ID" --quiet .

# ── 3. Revisão candidata SEM tráfego ────────────────────────────────────────
echo "▸ Subindo revisão candidata (sem tráfego)…"
for attempt in 1 2 3; do
    if gcloud run deploy "$SERVICE_NAME" \
        --image "${IMAGE}:${TAG}" \
        --platform managed --region "$REGION" --project "$PROJECT_ID" \
        --no-traffic --tag candidate --quiet; then
        break
    fi
    [ "$attempt" = 3 ] && { echo "❌ Deploy da candidata falhou 3×."; exit 1; }
    echo "  conflito transitório — repetindo em $((attempt * 15))s…"
    sleep $((attempt * 15))
done

# ── 4. Health check ANTES de rotear ─────────────────────────────────────────
CANDIDATE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --platform managed --region "$REGION" --project "$PROJECT_ID" --format=json \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).status?.traffic||[];const c=t.find(x=>x.tag==="candidate");console.log(c?c.url:"")})')

[ -n "$CANDIDATE_URL" ] || { echo "❌ Não achei a URL da candidata (tag=candidate)."; exit 1; }
echo "▸ Candidata: $CANDIDATE_URL"

ok=0
for attempt in 1 2 3 4 5; do
    if curl -sSf "$CANDIDATE_URL/ready" >/dev/null 2>&1; then ok=1; break; fi
    echo "  /ready ainda não respondeu (tentativa ${attempt}/5)…"
    sleep $((attempt * 10))
done
if [ "$ok" != 1 ]; then
    echo "❌ A candidata NÃO ficou pronta. O tráfego NÃO foi roteado —"
    echo "   a revisão anterior segue servindo 100%. Nada quebrou pro usuário."
    exit 1
fi
echo "✓ /ready OK na candidata (processo + Firestore)"

# ── 5. Rotear ───────────────────────────────────────────────────────────────
echo "▸ Roteando 100% do tráfego para a candidata…"
gcloud run services update-traffic "$SERVICE_NAME" \
    --platform managed --region "$REGION" --project "$PROJECT_ID" \
    --to-latest --quiet

PROD_URL="${PROD_URL:-https://consultor-fiscal-inteligente-631239634290.us-west1.run.app}"
curl -sSf "$PROD_URL/ready" >/dev/null && echo "✓ Produção respondendo /ready"
echo "▸ Versão publicada:"; curl -sS "$PROD_URL/version.json" || true
echo ""
echo "✅ Deploy manual concluído — commit ${COMMIT:0:7}"
