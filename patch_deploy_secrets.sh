#!/usr/bin/env bash
# ============================================================
# Patch: adiciona --update-secrets a etapa "Deploy to Cloud Run"
# do .github/workflows/deploy.yml
#
# Objetivo: tornar o CI a fonte da verdade dos secrets que sao
# montados como env var (GEMINI_API_KEY, GRAPH_CLIENT_SECRET),
# para que nenhum deploy futuro derrube a IA ou o Graph.
#
# Seguro: backup timestamped + auto-revert em caso de falha.
# NAO commita nem faz deploy - apenas edita o arquivo local.
# ============================================================
set -euo pipefail

WORKFLOW=".github/workflows/deploy.yml"
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP="${WORKFLOW}.bak.${TS}"

# --- 0. Sanidade: estamos no diretorio certo? -----------------
if [[ ! -f "$WORKFLOW" ]]; then
  echo "ERRO: $WORKFLOW nao encontrado. Rode este script da raiz do projeto."
  exit 1
fi

# --- 1. git fetch + compara HEAD vs origin --------------------
echo "==> git fetch e comparacao HEAD vs origin..."
git fetch origin --quiet
LOCAL="$(git rev-parse @)"
REMOTE="$(git rev-parse @{u} 2>/dev/null || echo 'sem-upstream')"
if [[ "$REMOTE" != "sem-upstream" && "$LOCAL" != "$REMOTE" ]]; then
  echo "AVISO: HEAD local ($LOCAL) difere de origin ($REMOTE)."
  echo "       Resolva a divergencia (pull/rebase) antes de patchar."
  echo "       Abortando para evitar regressao."
  exit 1
fi
echo "    OK - local em sincronia com origin."

# --- 2. Backup ------------------------------------------------
cp "$WORKFLOW" "$BACKUP"
echo "==> Backup criado: $BACKUP"

# --- 3. Aplica o patch via Python -----------------------------
cat > /tmp/patch_deploy_${TS}.py << 'ENDPY'
import sys

path = ".github/workflows/deploy.yml"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Idempotencia: se ja tem --update-secrets, nao faz nada.
if "--update-secrets" in content:
    print("SKIP: --update-secrets ja presente no workflow. Nada a fazer.")
    sys.exit(0)

# Alvo: a linha "--max-instances 10" dentro da etapa de deploy.
# Ela e a ultima flag do bloco "gcloud run deploy".
old = "            --max-instances 10\n"
new = (
    "            --max-instances 10 \\\n"
    "            --update-secrets=GEMINI_API_KEY=gemini-api-key:latest,"
    "GRAPH_CLIENT_SECRET=graph-client-secret:latest\n"
)

count = content.count(old)
if count != 1:
    print("ERRO: esperava exatamente 1 ocorrencia de '--max-instances 10', "
          "encontrou %d. Abortando para nao corromper o arquivo." % count)
    sys.exit(2)

content = content.replace(old, new)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("OK: --update-secrets adicionado a etapa de deploy.")
ENDPY

if python3 /tmp/patch_deploy_${TS}.py; then
  echo "==> Patch aplicado com sucesso."
else
  echo "ERRO no patch. Revertendo a partir do backup..."
  cp "$BACKUP" "$WORKFLOW"
  echo "    Arquivo restaurado. Nada foi alterado."
  rm -f /tmp/patch_deploy_${TS}.py
  exit 1
fi

rm -f /tmp/patch_deploy_${TS}.py

# --- 4. Mostra o diff para conferencia ------------------------
echo ""
echo "==> Diff resultante:"
echo "------------------------------------------------------------"
git --no-pager diff "$WORKFLOW" || true
echo "------------------------------------------------------------"
echo ""
echo "Backup preservado em: $BACKUP"
echo "Confira o diff acima. Se estiver OK:"
echo "  git add $WORKFLOW"
echo "  git commit -m 'ci: garante GEMINI_API_KEY e GRAPH_CLIENT_SECRET no deploy'"
echo "  git push"
echo ""
echo "Para reverter: cp $BACKUP $WORKFLOW"
