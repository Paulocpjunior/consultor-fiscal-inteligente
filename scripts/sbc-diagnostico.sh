#!/usr/bin/env bash
# ============================================================================
# ☎️ O INVITE CHEGOU? — o diagnóstico do SBC em UM comando
# ----------------------------------------------------------------------------
# 26/08. A ligação do WhatsApp passou a TOCAR uma vez e terminar em "Não
# atendida", e o painel do app já provou tudo o que ele consegue provar: os
# quatro interruptores da Meta ENABLED, e o caminho até o SBC de pé (DNS, TLS,
# certificado público e SIP OPTIONS 200 OK) — testado a partir do endereço que
# a PRÓPRIA META guarda em `sip.servers[]`.
#
# Sobrou UMA pergunta, e ela só se responde DENTRO do SBC: **chegou INVITE?**
#
# 🚨 POR QUE ISTO EXISTE COMO SCRIPT: hoje a resposta depende de alguém saber
# Asterisk — caminhos de log, nome do CSV do CDR, comandos do pjsip. Enquanto
# depender disso, a medição não acontece, e a conversa com a Meta fica parada
# esperando um dado que ninguém coleta. Aqui é um comando, e a saída já sai
# pronta para colar no chamado.
#
# 🚨 E A REGRA QUE MANDA NELE É A DE 25/08: **silêncio só vale se o gravador
# estava LIGADO.** As três primeiras rodadas de teste daquele dia não valeram
# nada porque o SBC nasceu sem gravar — e "nenhum INVITE" ficava idêntico a
# "chegou e ninguém anotou". Por isso este script CONFERE o gravador ANTES, e
# se recusa a concluir "não chegou" quando não pode.
#
# 🚨 SÃO DUAS MÁQUINAS: este script mora no REPO (no Mac) e roda DENTRO da VM
# do SBC. Rodá-lo no Mac devolve "No such file or directory" — aconteceu em
# 26/08, e a culpa foi da instrução que dizia só "dentro do SBC".
#
# USO — do clone do repo, no Mac (manda o script pela conexão, sem copiar nada):
#   cd ~/consultor-fiscal-inteligente && git pull
#   gcloud compute ssh sbc-whatsapp --project=consultorfiscalapp \
#     --zone=us-west1-a --command='sudo bash -s -- 09:3' < scripts/sbc-diagnostico.sh
#
# Já DENTRO da VM (se você já entrou por ssh):
#   sudo bash sbc-diagnostico.sh              # olha o dia de hoje
#   sudo bash sbc-diagnostico.sh 09:3         # a janela da tentativa
#   sudo bash sbc-diagnostico.sh --ao-vivo    # arma a captura da PRÓXIMA
# ============================================================================
set -uo pipefail

# Caminhos sobrescrevíveis por env — é o que permite PROVAR os quatro
# desfechos do veredito sem um Asterisk na mão. Em produção ninguém passa nada
# e valem os padrões.
LOG_FULL="${LOG_FULL:-/var/log/asterisk/full}"
CDR_CSV="${CDR_CSV:-/var/log/asterisk/cdr-csv/Master.csv}"
LOGGER_CONF="${LOGGER_CONF:-/etc/asterisk/logger.conf}"
ASTERISK_CONF="${ASTERISK_CONF:-/etc/asterisk/asterisk.conf}"
JANELA="${1:-}"
HOJE="$(date +%Y-%m-%d)"

echo "════════════════════════════════════════════════════════════════"
echo "☎️  DIAGNÓSTICO DO SBC — $(date '+%d/%m/%Y %H:%M:%S %Z')"
echo "════════════════════════════════════════════════════════════════"

# ── 1. O GRAVADOR ESTÁ LIGADO? ──────────────────────────────────────────────
# Esta é a PRIMEIRA pergunta de propósito: sem ela, tudo o que vem depois é
# ambíguo. Um "0 INVITEs" com o gravador desligado não é evidência de nada.
GRAVANDO="sim"
echo
echo "── 1. O gravador está ligado? (sem isto, silêncio não prova nada)"
if [ -f "$LOG_FULL" ]; then
    echo "   ✓ log existe: $LOG_FULL ($(du -h "$LOG_FULL" 2>/dev/null | cut -f1))"
else
    echo "   ✗ NÃO existe $LOG_FULL — o Asterisk não está escrevendo log completo."
    GRAVANDO="nao"
fi
if grep -qs '^full =>.*verbose' "$LOGGER_CONF"; then
    echo "   ✓ logger.conf manda verbose para o 'full'"
else
    echo "   ✗ logger.conf SEM verbose no 'full' — a linha do dialplan não é escrita."
    GRAVANDO="nao"
fi
if grep -qs '^verbose' "$ASTERISK_CONF"; then
    echo "   ✓ verbose persistido no asterisk.conf (sobrevive a restart)"
else
    echo "   ⚠ verbose NÃO está no asterisk.conf — 'core set verbose' some no restart."
fi
if [ -f "$CDR_CSV" ]; then
    echo "   ✓ CDR existe: $CDR_CSV"
else
    echo "   ⚠ sem $CDR_CSV — o CDR é a prova que NÃO depende de verbose."
fi

# ── 2. ATÉ ONDE O LOG ALCANÇA ───────────────────────────────────────────────
# Mesma régua do painel de eventos crus (26/08): recorte que não se declara
# vira afirmação sobre o que não foi medido. Se o log começa DEPOIS da hora da
# tentativa, "0 INVITEs" responde outra pergunta.
echo
echo "── 2. Até onde este log alcança"
LOG_DE=""; LOG_ATE=""
if [ -f "$LOG_FULL" ]; then
    LOG_DE="$(head -n 1 "$LOG_FULL" 2>/dev/null | cut -c1-30)"
    LOG_ATE="$(tail -n 1 "$LOG_FULL" 2>/dev/null | cut -c1-30)"
    echo "   de : $LOG_DE"
    echo "   até: $LOG_ATE"
    echo "   ⚠️  Se a hora da ligação estiver FORA desta janela, o resultado"
    echo "      abaixo não responde nada — houve rotação de log."
fi

# ── 3. O TRONCO ESTÁ ESCUTANDO NA 5061? ─────────────────────────────────────
echo
echo "── 3. O Asterisk está escutando onde a Meta aponta?"
if command -v asterisk >/dev/null 2>&1; then
    asterisk -rx "pjsip show transports" 2>/dev/null | sed 's/^/   /'
    echo
    echo "   Endpoints e identificação por IP:"
    asterisk -rx "pjsip show endpoints" 2>/dev/null | sed 's/^/   /' | head -20
    asterisk -rx "pjsip show identifies" 2>/dev/null | sed 's/^/   /' | head -10
else
    echo "   ✗ comando 'asterisk' não encontrado — rode DENTRO do SBC."
fi

# ── 4. CHEGOU INVITE? ───────────────────────────────────────────────────────
echo
echo "── 4. Chegou INVITE${JANELA:+ na janela \"$JANELA\"}?"
FILTRO="${JANELA:-$HOJE}"
if [ -f "$LOG_FULL" ]; then
    ACHADOS=$(grep -i "INVITE" "$LOG_FULL" 2>/dev/null | grep -c "$FILTRO" || true)
    TEM_LOG="sim"
    echo "   $ACHADOS linha(s) com INVITE casando \"$FILTRO\""
    grep -i "INVITE" "$LOG_FULL" 2>/dev/null | grep "$FILTRO" | tail -20 | sed 's/^/   /'
    if [ "$ACHADOS" = "0" ] && [ "$GRAVANDO" = "nao" ]; then
        echo
        echo "   🚨 NÃO DÁ PARA CONCLUIR: zero INVITEs COM O GRAVADOR DESLIGADO não"
        echo "      é 'não chegou' — é 'não foi anotado'. Ligue o gravador"
        echo "      (logger.conf + verbose), refaça a ligação e rode de novo."
    fi
else
    # 🚨 Seção MUDA se lê como "não achou". Sem o log, a resposta não é zero:
    # é "não consegui olhar" — e as duas mandam fazer coisas opostas.
    echo "   🚨 NÃO CONSEGUI OLHAR: não existe $LOG_FULL nesta máquina."
    echo "      Rode DENTRO do SBC (sip.spassessoriacontabil.com.br)."
fi

# ── 5. E O CDR? ─────────────────────────────────────────────────────────────
# O CDR não depende de verbose nem de alguém estar com o console aberto: se a
# chamada existiu para o Asterisk, ela deixou linha aqui.
echo
echo "── 5. A chamada virou registro de CDR?"
if [ -f "$CDR_CSV" ]; then
    LINHAS=$(grep -c "$FILTRO" "$CDR_CSV" 2>/dev/null || true)
    echo "   $LINHAS linha(s) de CDR casando \"$FILTRO\""
    grep "$FILTRO" "$CDR_CSV" 2>/dev/null | tail -10 | sed 's/^/   /'
else
    echo "   🚨 NÃO CONSEGUI OLHAR: não existe $CDR_CSV nesta máquina."
fi

# ── 6. RECUSAS ──────────────────────────────────────────────────────────────
# "Tocou uma vez e caiu" é o sintoma de INVITE que CHEGA e é RECUSADO. Se
# houver 401/403/488 aqui, a causa deixou de ser da Meta e passou a ser nossa.
echo
echo "── 6. Alguma recusa nossa? (401/403/404/488 — 'tocou e caiu' mora aqui)"
if [ -f "$LOG_FULL" ]; then
    grep -iE "SIP/2\.0 (401|403|404|407|488|603)" "$LOG_FULL" 2>/dev/null \
        | grep "$FILTRO" | tail -15 | sed 's/^/   /' || true
    echo "   (vazio acima = nenhuma recusa registrada nesta janela)"
else
    echo "   🚨 NÃO CONSEGUI OLHAR: sem o log, não há como ver recusa."
fi

# ── 7. ARMAR A PRÓXIMA ──────────────────────────────────────────────────────
if [ "${1:-}" = "--ao-vivo" ]; then
    echo
    echo "── 7. Captura ARMADA para a próxima ligação"
    asterisk -rx "pjsip set logger on" 2>/dev/null | sed 's/^/   /'
    echo "   Faça a ligação AGORA pelo celular e depois rode:"
    echo "     sudo bash $0 \$(date +%H:%M | cut -c1-4)"
    echo "   Para desarmar:  sudo asterisk -rx 'pjsip set logger off'"
fi

# ── VEREDITO ────────────────────────────────────────────────────────────────
# 🚨 ELE FICA NO FIM, E CONCLUI SOZINHO — não ensina a concluir. Em 26/08 a
# saída chegou por print com as seções 1-3 fora da tela, e sem elas o "0
# INVITEs" é exatamente a armadilha de 25/08. O fim é o que sobrevive ao
# print e à rolagem, então é lá que a resposta tem de estar — junto do que
# ela ASSUME, para ninguém carimbar prova que não foi medida.
echo
echo "════════════════════════════════════════════════════════════════"
echo "VEREDITO"
if [ "${TEM_LOG:-nao}" != "sim" ]; then
    echo "  ⚪ NÃO CONSEGUI OLHAR — não há log do Asterisk nesta máquina."
    echo "     Você rodou no lugar errado: isto tem de rodar DENTRO da VM."
    echo "     cd ~/consultor-fiscal-inteligente && gcloud compute ssh sbc-whatsapp \\"
    echo "       --project=consultorfiscalapp --zone=us-west1-a \\"
    echo "       --command='sudo bash -s -- ${JANELA:-09:3}' < scripts/sbc-diagnostico.sh"
elif [ "$GRAVANDO" = "nao" ]; then
    echo "  ⚪ NÃO DÁ PARA CONCLUIR — o gravador estava DESLIGADO."
    echo "     Zero INVITE aqui não é 'não chegou', é 'não foi anotado' (lição"
    echo "     de 25/08). Ligue o gravador, refaça a ligação e rode de novo."
elif [ "${ACHADOS:-0}" != "0" ]; then
    echo "  🔴 A META ENTREGA — chegou INVITE ($ACHADOS linha(s) na janela)."
    echo "     Então o problema é NOSSO: roteamento até o ramal. Olhe a seção 6"
    echo "     (recusas) e a seção 3 (o endpoint casou?). NÃO é caso de Meta."
else
    echo "  🟡 NENHUM INVITE na janela, com o gravador LIGADO."
    echo "     Isso aponta para a Meta não entregar — MAS só vale se a hora da"
    echo "     tentativa estiver dentro do log, que vai de:"
    echo "       ${LOG_DE:-?}"
    echo "       ${LOG_ATE:-?}"
    echo "     Estando dentro, é ESTE o fato que falta no chamado da Meta"
    echo "     (texto pronto em docs/sbc-whatsapp-hitphone.md)."
    if [ ! -f "$CDR_CSV" ]; then
        echo "  ⚠️  E o CDR NÃO existe nesta VM — ele é a prova que não depende de"
        echo "     verbose, e sem ele o log é a única testemunha. Vale conferir"
        echo "     'cdr show status' no Asterisk antes de fechar a conclusão."
    fi
fi
echo "════════════════════════════════════════════════════════════════"
