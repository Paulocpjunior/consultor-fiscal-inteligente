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
# ☎️ A GRADE DE ATENDIMENTO DA META — fora dela a chamada NÃO é entregue, e
# "nenhum INVITE" é a resposta CERTA, não um defeito.
#
# 🚨 23/09: duas rodadas foram gastas por causa disto. O teste saiu às 07:50
# BRT e a janela abre às 08:00 — dez minutos antes. O script disse "nenhum
# INVITE" e deixou a conclusão por conta de quem lia. As QUATRO falhas reais
# do log (21/09 15:43, 22/09 11:07 e 13:52 BRT) caem todas DENTRO da grade.
#
# ⚠️ O valor NÃO é deduzido: é o `call_hours` que o `GET /settings` da Meta
# devolve, registrado em docs/sbc-whatsapp-hitphone.md. Mudou lá, muda aqui
# (ou passa por env) — carimbar horário de memória seria inventar cadastro.
META_GRADE="${META_GRADE:-08:00-12:00,13:00-17:30}"
META_TZ="${META_TZ:-America/Sao_Paulo}"
# 🚩 OS DIAS TAMBÉM SÃO PARÂMETRO, e por um motivo que custou caro: eu cravei
# "seg-sex" no código (`DIA_SEMANA -gt 5`) e com isso a SUÍTE passou a depender
# do relógio da máquina. Ela ficou verde no CI às 17:00 BRT de uma quarta e
# vermelha na manhã seguinte às 06:38 — sem ninguém tocar em código. Teste que
# só passa em horário comercial reprova um deploy de madrugada por um motivo
# que não tem nada a ver com a mudança. 1=segunda … 7=domingo.
META_DIAS="${META_DIAS:-1 2 3 4 5}"
# 🚨 A FLAG NÃO PODE VIRAR FILTRO DE BUSCA — 26/08, na primeira rodada de
# verdade. `JANELA="$1"` engolia o `--ao-vivo`, ele descia até o `grep` e a
# saída trazia TRÊS vezes `grep: unrecognized option '--ao-vivo'`. As buscas
# não rodaram: o veredito daquela rodada foi montado sobre `ACHADOS` vazio, ou
# seja, um "nenhum INVITE" que ninguém procurou. Erro de argumento que vira
# ZERO plausível é a família do campo de valor que recebe default.
JANELA=""
AO_VIVO="nao"
for arg in "$@"; do
    case "$arg" in
        --ao-vivo) AO_VIVO="sim" ;;
        -*) echo "   ⚠️  opção desconhecida ignorada: $arg" >&2 ;;
        *) JANELA="$arg" ;;
    esac
done
HOJE="$(date +%Y-%m-%d)"

# 🚨 E O COMANDO DE RODAR DE NOVO NÃO SAI DE `$0`: o caminho que FUNCIONOU
# manda o script pela conexão (`bash -s`), e ali `$0` é literalmente "bash" —
# a dica saía como `sudo bash bash $(date ...)`, sem arquivo nenhum para
# rodar. É o aviso que aponta lugar inexistente (21/08) em forma de comando.
comando_de_rodar() {  # $1 = janela sugerida (texto literal, pode ser um $(...))
    local janela="$1"
    case "$0" in
        *.sh)
            if [ -f "$0" ]; then
                echo "     sudo bash $0 $janela"
                return
            fi
            ;;
    esac
    echo "     cd ~/consultor-fiscal-inteligente && gcloud compute ssh sbc-whatsapp \\"
    echo "       --project=consultorfiscalapp --zone=us-west1-a \\"
    echo "       --command='sudo bash -s -- $janela' < scripts/sbc-diagnostico.sh"
}

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
# 🚨 23/09 — O GRAVADOR TEM DOIS INTERRUPTORES, E ESTA SEÇÃO SÓ VIA UM.
# O `logger.conf` liga o log VERBOSE; quem escreve as MENSAGENS SIP (as linhas
# de INVITE que a seção 4 conta) é o `pjsip set logger`, que é OUTRO botão e
# some a cada restart. Sem ele, "0 INVITE" não é "não chegou" — é "ninguém
# anotou o SIP", exatamente a armadilha de 25/08 um nível abaixo.
#
# ⚠️ E a pergunta é por RESULTADO, não por status: em vez de perguntar ao
# Asterisk se o botão está ligado (resposta que varia de versão para versão),
# procuro o RASTRO que ele deixa. Log de dias inteiros sem UMA linha de trace
# SIP responde sozinho.
TRACE_SIP="sim"
if [ -f "$LOG_FULL" ]; then
    TRACES=$(grep -cE "(Received|Transmitting) SIP (request|response)" "$LOG_FULL" 2>/dev/null)
    [ "$?" -ge 2 ] && TRACES=""
    if [ -z "$TRACES" ]; then
        echo "   ⚪ não consegui contar as linhas de trace SIP"
    elif [ "$TRACES" = "0" ]; then
        echo "   ✗ ZERO linha de trace SIP no log — o 'pjsip set logger' está"
        echo "     DESLIGADO. O INVITE não é escrito, então contá-lo não mede nada."
        TRACE_SIP="nao"
    else
        echo "   ✓ trace SIP ligado ($TRACES linha(s) de mensagem SIP no log)"
    fi
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
# 🚨 E A CONTAGEM COMEÇA VAZIA, NÃO ZERO — esta é a metade que importa.
# O defeito do `--ao-vivo` foi a INSTÂNCIA; a CLASSE é o veredito ler
# `${ACHADOS:-0}` e tratar "não consegui contar" como "contei e deu zero".
# Foi assim que a rodada de 26/08 concluiu 🟡 "nenhum INVITE" sobre três
# `grep` que nem rodaram. Zero medido e zero por falha mandam fazer coisas
# OPOSTAS — é a régua de 06/08 (campo de valor não recebe default) dentro da
# própria ferramenta que existe para não deixar isso acontecer.
ACHADOS=""
if [ -f "$LOG_FULL" ]; then
    # ⚠️ E a diferença entre "deu zero" e "falhou" é o CÓDIGO DE SAÍDA, não o
    # texto: `grep -c` devolve **1** quando conta zero (achado legítimo) e
    # **≥2** quando erra de verdade. Tratar todo não-zero como falha apagaria
    # justamente o zero que queremos poder afirmar.
    ACHADOS=$(grep -i "INVITE" "$LOG_FULL" 2>/dev/null | grep -c -- "$FILTRO")
    [ "$?" -ge 2 ] && ACHADOS=""
    TEM_LOG="sim"
    echo "   ${ACHADOS:-?} linha(s) com INVITE casando \"$FILTRO\""
    grep -i "INVITE" "$LOG_FULL" 2>/dev/null | grep -- "$FILTRO" | tail -20 | sed 's/^/   /'
    if [ -z "$ACHADOS" ]; then
        echo
        echo "   🚨 NÃO CONSEGUI CONTAR: a busca não rodou (veja o erro acima)."
        echo "      Isto NÃO é 'nenhum INVITE' — é 'ninguém procurou'."
    elif [ "$ACHADOS" = "0" ] && [ "$GRAVANDO" = "nao" ]; then
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
    LINHAS=$(grep -c -- "$FILTRO" "$CDR_CSV" 2>/dev/null || true)
    echo "   $LINHAS linha(s) de CDR casando \"$FILTRO\""
    grep -- "$FILTRO" "$CDR_CSV" 2>/dev/null | tail -10 | sed 's/^/   /'
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
        | grep -- "$FILTRO" | tail -15 | sed 's/^/   /' || true
    echo "   (vazio acima = nenhuma recusa registrada nesta janela)"
else
    echo "   🚨 NÃO CONSEGUI OLHAR: sem o log, não há como ver recusa."
fi

# ── 6b. A HORA DE AGORA ESTÁ DENTRO DA GRADE DA META? ───────────────────────
# Fora dela a Meta não entrega, e o silêncio do log é CORRETO. Sem esta
# pergunta, "nenhum INVITE" às 07:50 parece defeito de entrega — foi o que
# custou duas rodadas em 23/09.
echo
echo "── 6b. A hora de agora está dentro da grade de atendimento da Meta?"
DENTRO_GRADE="indeterminado"
AGORA_BRT=$(TZ="$META_TZ" date +%H:%M 2>/dev/null)
DIA_SEMANA=$(TZ="$META_TZ" date +%u 2>/dev/null)   # 1=segunda ... 7=domingo
DIA_NA_GRADE="nao"
for D in $META_DIAS; do [ "$D" = "$DIA_SEMANA" ] && DIA_NA_GRADE="sim"; done
if [ -z "$AGORA_BRT" ] || [ -z "$DIA_SEMANA" ]; then
    echo "   ⚪ não consegui ler a hora em $META_TZ — grade não conferida."
elif [ "$DIA_NA_GRADE" = "nao" ]; then
    echo "   ✗ HOJE NÃO É DIA DE ATENDIMENTO ($AGORA_BRT em $META_TZ) — a grade"
    echo "     vale nos dias $META_DIAS (1=seg … 7=dom)."
    DENTRO_GRADE="nao"
else
    DENTRO_GRADE="nao"
    # A comparação é de TEXTO "HH:MM", que ordena igual ao relógio — e é a
    # única que não depende de aritmética de fuso (a armadilha de 22/08).
    for FAIXA in $(echo "$META_GRADE" | tr ',' ' '); do
        DE="${FAIXA%%-*}"; ATE="${FAIXA##*-}"
        if [ "$AGORA_BRT" ">" "$DE" ] || [ "$AGORA_BRT" = "$DE" ]; then
            if [ "$AGORA_BRT" "<" "$ATE" ] || [ "$AGORA_BRT" = "$ATE" ]; then
                DENTRO_GRADE="sim"
            fi
        fi
    done
    if [ "$DENTRO_GRADE" = "sim" ]; then
        echo "   ✓ $AGORA_BRT em $META_TZ — DENTRO da grade ($META_GRADE)"
    else
        echo "   ✗ $AGORA_BRT em $META_TZ — FORA da grade ($META_GRADE)."
        echo "     A Meta NÃO entrega fora dela: 'nenhum INVITE' aqui é a"
        echo "     resposta certa, não um defeito. Refaça dentro do horário."
    fi
fi

# ── 7. A MÍDIA NEGOCIOU? ────────────────────────────────────────────────────
# ✅ 23/09: A CHAMADA COMPLETOU (entrou na grade, caiu na URA, teve áudio).
#    Esta seção deixou de ser "onde a chamada morre" e virou **conferência de
#    regressão**: se um dia voltar a falhar, é aqui que aparece.
#
# ⚠️ E AS FALHAS QUE ESTÃO NO LOG SÃO VELHAS, de tentativas fora da grade.
#    Contá-las como se fossem de agora foi o erro que este script já cometeu —
#    por isso o número vem SEMPRE com a data da última ocorrência ao lado.
#
# 📌 A linha `m=audio` continua sendo mostrada porque ela é o que separa
#    TRANSPORTE de CODEC num diagnóstico futuro. O script MOSTRA e não
#    ESCOLHE: trocar `media_encryption` num tronco que funciona é como se
#    quebra o que está de pé.
echo
echo "── 7. A mídia negociou? (conferência de regressão — em 23/09 negociou)"
MIDIA_ERRO=""
if [ -f "$LOG_FULL" ]; then
    # Mesma disciplina da seção 4: exit 1 do grep é "contei e deu zero",
    # exit >= 2 é "não consegui contar" — e os dois NÃO podem virar o mesmo
    # número. Zero inventado aqui diria "a mídia está boa" sobre log nenhum.
    MIDIA_ERRO=$(grep -ic "Couldn't negotiate stream" "$LOG_FULL" 2>/dev/null)
    [ "$?" -ge 2 ] && MIDIA_ERRO=""

    if [ -z "$MIDIA_ERRO" ]; then
        echo "   ⚪ NÃO CONSEGUI CONTAR as falhas de negociação (a busca não rodou)."
    elif [ "$MIDIA_ERRO" = "0" ]; then
        echo "   ✓ nenhuma falha de negociação no log INTEIRO"
    else
        echo "   ${MIDIA_ERRO} falha(s) de negociação de mídia no log INTEIRO"
        # 🚨 A DATA AO LADO DO NÚMERO, SEMPRE. Sem ela, falha de 22/09 (fora
        # da grade, antes de a chamada ser provada) lê-se como defeito de
        # agora — foi exatamente assim que este script apontou para a Meta.
        echo "   ⚠️  Número SEM data não diz nada: a chamada completou em 23/09."
        echo "      Confira se a ÚLTIMA falha é anterior a isso — se for, é"
        echo "      histórico, não defeito de hoje."
        grep -i "negotiate stream" "$LOG_FULL" 2>/dev/null | tail -5 | sed 's/^/   /'
    fi

    # ⚠️ A LINHA VEM DO LOG INTEIRO, não da janela, e é de propósito: o erro de
    # 28/08 é das 11:03 e a varredura daquele dia olhou 08:0 — recortar pela
    # janela esconderia justamente a evidência que inverteu o caso.
    echo
    echo "   O que a Meta OFERECE no SDP (linha m=audio):"
    grep -i "m=audio" "$LOG_FULL" 2>/dev/null | tail -5 | sed 's/^/   /' \
        || echo "   (nenhuma linha m=audio no log)"
    echo "   ↳ UDP/TLS/RTP/SAVPF  ⇒ DTLS-SRTP. O endpoint está em"
    echo "     media_encryption=sdes, que é OUTRO perfil — e o 'optimistic'"
    echo "     NÃO faz ponte para DTLS, ele só afrouxa para texto claro."
    echo "   ↳ RTP/SAVP ou RTP/AVP ⇒ NÃO é transporte. A conta volta para"
    echo "     codec/direção, e aí o SDP INTEIRO é que responde."
    echo "   ↳ nenhuma linha ⇒ o logger do pjsip estava desligado nesta"
    echo "     tentativa. Rode com --ao-vivo, refaça a ligação e volte."
else
    echo "   🚨 NÃO CONSEGUI OLHAR: sem o log, não há como ver a negociação."
fi

# ── 7b. O ENDEREÇO SIP DA META (META_SIP_DESTINO) ───────────────────────────
# 🎯 É O QUE FALTA PARA A SAÍDA, e ele só existe num lugar: no INVITE que a
#    Meta já mandou. O documento diz "a ENTRADA destrava a SAÍDA" — a entrada
#    aconteceu em 23/09, então o dado está no log DESTA VM, esperando ser lido.
#
# ⚠️ ESTE BLOCO NÃO ESCOLHE POR VOCÊ. Ele mostra os candidatos crus e, só
#    quando há UM valor distinto, diz que é aquele. Vários candidatos = a
#    pessoa decide olhando; nenhum = o trace estava desligado. Carimbar um
#    endereço SIP deduzido mandaria a ligação do escritório para um estranho,
#    que é a mesma família do prefixo redigitado à mão que o Paulo recusou.
#
# 🛡️ 29/09 — A 7b LISTOU CENTENAS DE "CANDIDATOS", E NENHUM ERA A META.
#    Eram `sip:<nome>@84.32.32.222:5060` — yahia, yasmin, zach, zoe, zuhair… —
#    um robô testando ramais por NOME (varredura SIP), que o `[meta-identify]`
#    aberto (match=0.0.0.0/0) trata como se fosse a Meta. A versão anterior
#    lia QUALQUER "Contact:" do log sem perguntar de quem era o INVITE; se o
#    Paulo tivesse "escolhido o mais recente", a saída do escritório discaria
#    para um scanner. Agora cada Contact é ATRIBUÍDO ao INVITE recebido que o
#    carrega (transporte, IP e hora da linha "<--- Received SIP request … from
#    TLS:ip:porta --->" que o pjsip logger escreve), e a régua é:
#      · origem que NÃO é TLS não é candidata — a Meta só fala pela 5061/TLS;
#      · origem com mais de LIMITE_VARREDURA usuários DIFERENTES no Contact é
#        VARREDURA: vira alerta de segurança, nunca candidato;
#      · o valor candidato é o HOST do Contact (sip:host:porta): o user é o
#        número de QUEM LIGOU e muda a cada chamada.
LIMITE_VARREDURA="${LIMITE_VARREDURA:-5}"
TEM_VARREDURA="nao"
echo
echo "── 7b. O endereço SIP da Meta (para habilitar a SAÍDA)"
if [ -f "$LOG_FULL" ]; then
    # 📜 OLHO OS LOGS ROTACIONADOS TAMBÉM (full.1, full.2.gz…): a ligação
    #    de 23/09 pode já ter saído do `full` corrente quando alguém vier ler
    #    — o logrotate gira por semana. `gzip -dcf` lê comprimido e texto puro.
    # Cada linha de saída: ORIGEM(transporte:ip) TAB carimbo TAB user TAB host TAB esquema TAB destino
    # 🎯 29/09, 2ª rodada: o DESTINO discado (user do Request-URI do INVITE) é o
    #    que separa a Meta de um robô sem precisar de whois — a Meta disca para
    #    o NOSSO número do WhatsApp; robô disca 100, 1000, 00972…
    ATRIBUIDOS=$(gzip -dcf "$LOG_FULL" "$LOG_FULL".[0-9]* 2>/dev/null | awk '
        /<--- Received SIP request/ {
            origem = ""; carimbo = ""; invite = 0; destino = ""
            if (match($0, /from [A-Za-z]+:[0-9A-Fa-f.:]+:[0-9]+/)) {
                origem = substr($0, RSTART + 5, RLENGTH - 5)
                sub(/:[0-9]+$/, "", origem)
            }
            if (match($0, /^\[[^]]+\]/)) carimbo = substr($0, RSTART + 1, RLENGTH - 2)
            next
        }
        # 🐛 30/09: mensagem TRANSMITIDA (o nosso INVITE para a HIT) vinha logo
        # depois da recebida e herdava a ORIGEM dela — o Contact NOSSO
        # (35.185…:5060, "discou para 211") aparecia como candidato "da Meta".
        # Qualquer outra mensagem zera a origem, não só o flag.
        /<--- / { invite = 0; origem = ""; next }
        /^INVITE / {
            if (origem != "") invite = 1
            destino = "?"
            if (match($0, /^INVITE sips?:[^@ ;>]+@/)) {
                destino = substr($0, RSTART, RLENGTH - 1); sub(/^INVITE sips?:/, "", destino)
            }
            next
        }
        invite && tolower(substr($0, 1, 8)) == "contact:" {
            if (match($0, /sips?:[^>;" ]+/)) {
                uri = substr($0, RSTART, RLENGTH)
                esquema = (substr(uri, 1, 5) == "sips:") ? "sips" : "sip"
                host = uri; sub(/^sips?:/, "", host); user = ""
                if (index(host, "@") > 0) {
                    user = substr(host, 1, index(host, "@") - 1)
                    host = substr(host, index(host, "@") + 1)
                }
                print origem "\t" carimbo "\t" user "\t" host "\t" esquema "\t" destino
            }
            invite = 0
        }')
    # Contacts "soltos" — sem a linha de recebimento na frente (formato de
    # trace diferente). Contam como aviso, nunca como candidato.
    CONTATOS_SOLTOS=$(gzip -dcf "$LOG_FULL" "$LOG_FULL".[0-9]* 2>/dev/null | grep -ic "^Contact:" 2>/dev/null)
    [ "$?" -ge 2 ] && CONTATOS_SOLTOS=0
    ATRIBUIDOS_N=0
    [ -n "$ATRIBUIDOS" ] && ATRIBUIDOS_N=$(printf '%s\n' "$ATRIBUIDOS" | grep -c .)

    # Por ORIGEM: quantos INVITE, quantos usuários distintos, último carimbo,
    # até 3 hosts distintos e até 3 destinos discados (o resto só é contado).
    ORIGENS=""
    if [ -n "$ATRIBUIDOS" ]; then
        ORIGENS=$(printf '%s\n' "$ATRIBUIDOS" | awk -F'\t' '
            {
                n[$1]++
                if (!(($1 SUBSEP $3) in u)) { u[$1 SUBSEP $3] = 1; users[$1]++ }
                if (!(($1 SUBSEP $4) in h)) {
                    h[$1 SUBSEP $4] = 1; hosts[$1]++
                    if (hosts[$1] <= 3) lista[$1] = lista[$1] (lista[$1] == "" ? "" : " ") $5 ":" $4
                }
                if (!(($1 SUBSEP $6) in d)) {
                    d[$1 SUBSEP $6] = 1; dests[$1]++
                    if (dests[$1] <= 3) ldest[$1] = ldest[$1] (ldest[$1] == "" ? "" : " ") $6
                }
                if ($2 > ultimo[$1]) ultimo[$1] = $2
            }
            END { for (o in n) print o "\t" n[o] "\t" users[o] "\t" ultimo[o] "\t" hosts[o] "\t" lista[o] "\t" dests[o] "\t" ldest[o] }' | sort)
    fi
    VARREDURAS=""; OUTRAS=""; CAND_LINHAS=""; CAND_HOSTS=""
    while IFS=$'\t' read -r origem n users ultimo nhosts lista ndests ldest; do
        [ -z "$origem" ] && continue
        DISCOU="discou para: ${ldest:-?}"
        [ "${ndests:-0}" -gt 3 ] && DISCOU="${DISCOU} (… e mais $((ndests - 3)) destino(s))"
        if [ "${users:-0}" -gt "$LIMITE_VARREDURA" ]; then
            VARREDURAS="${VARREDURAS}      ${origem} — ${n} INVITE com ${users} usuários DIFERENTES no Contact (último: ${ultimo:-?}); ${DISCOU}"$'\n'
        elif [ "${origem%%:*}" != "TLS" ]; then
            OUTRAS="${OUTRAS}      ${origem} — ${n} INVITE (último: ${ultimo:-?}): não é TLS, e a Meta só fala pela 5061/TLS; ${DISCOU}"$'\n'
        else
            for h in $lista; do
                CAND_LINHAS="${CAND_LINHAS}       ${h}   ← ${origem}, ${n} INVITE, último ${ultimo:-?}"$'\n'
                CAND_HOSTS="${CAND_HOSTS}${h}"$'\n'
            done
            [ "${nhosts:-0}" -gt 3 ] && CAND_LINHAS="${CAND_LINHAS}       (… e mais $((nhosts - 3)) host(s) da mesma origem)"$'\n'
            CAND_LINHAS="${CAND_LINHAS}         ↳ ${origem} ${DISCOU}"$'\n'
        fi
    done <<< "$ORIGENS"
    if [ -n "$VARREDURAS" ]; then
        TEM_VARREDURA="sim"
        echo "   🛡️ VARREDURA SIP no log — robô testando ramais por nome. NÃO é a Meta:"
        printf '%s' "$VARREDURAS"
        echo "      Nada disto vira META_SIP_DESTINO. E é aviso de SEGURANÇA: o"
        echo "      [meta-identify] está aberto (match=0.0.0.0/0), então esse robô é"
        echo "      tratado como Meta e cai no dialplan. Quando a origem REAL da Meta"
        echo "      aparecer abaixo (TLS), aperte a porta 5061 e o identify para ela:"
        echo "        META_SIP_ORIGENS='<ip-da-meta>/32' SBC_HOST=<host> ./scripts/setup-sbc-whatsapp.sh"
    fi
    if [ -n "$OUTRAS" ]; then
        echo "   ⚪ Origens que NÃO contam como candidato:"
        printf '%s' "$OUTRAS"
    fi
    # 🐛 ARMADILHA DA CASA: `grep -c` SAI COM 1 quando a conta dá zero, então
    # `$(... || echo 0)` imprimia "0" duas vezes e a comparação com "0" dava
    # falso — "nenhum candidato" caía no ramo de "vários". Por isso a contagem
    # nasce vazia e só passa pelo grep quando há o que contar.
    if [ -z "$CAND_HOSTS" ]; then
        QUANTOS=0
    else
        QUANTOS=$(printf '%s' "$CAND_HOSTS" | sort -u | grep -c .)
    fi
    if [ "$QUANTOS" = "0" ]; then
        if [ "$ATRIBUIDOS_N" = "0" ] && [ "${CONTATOS_SOLTOS:-0}" = "0" ]; then
            echo "   ⚪ NENHUM Contact no log (nem nos rotacionados) — e isso é sobre o GRAVADOR, não sobre"
            echo "      a Meta: o cabeçalho só aparece com o trace SIP LIGADO."
        elif [ "$ATRIBUIDOS_N" = "0" ]; then
            echo "   ⚪ Há ${CONTATOS_SOLTOS} linha(s) Contact no log, mas NENHUMA dentro de um INVITE"
            echo "      recebido que eu consiga atribuir a uma origem (a linha '<--- Received"
            echo "      SIP request … from …' não está na frente). Sem origem não há candidato."
        else
            echo "   ⚪ ZERO candidatos da Meta: todo Contact do log veio de origem que não"
            echo "      é TLS ou de varredura (acima). O INVITE dela de 23/09 aconteceu com"
            echo "      o trace SIP DESLIGADO, então não foi escrito."
        fi
        echo "      Rode com --ao-vivo, peça uma ligação DENTRO da grade e volte."
    elif [ "$QUANTOS" = "1" ]; then
        echo "   ✓ UM candidato — este é o valor (host do Contact, sem o user):"
        printf '%s' "$CAND_LINHAS"
        echo "     Para habilitar a saída, rode o setup NO MAC (dentro do clone) com ele:"
        echo "       SBC_SHARED_SECRET=\"\$S\" META_SIP_DESTINO='<o valor acima>' SBC_HOST=sip.spassessoriacontabil.com.br ./scripts/setup-sbc-whatsapp.sh"
    else
        echo "   ⚠️  $QUANTOS candidatos distintos — NÃO vou escolher por você:"
        printf '%s' "$CAND_LINHAS"
        echo "     Vários costumam ser tentativas de épocas diferentes. Pegue o"
        echo "     do INVITE MAIS RECENTE (o carimbo está ao lado) — endereço"
        echo "     velho disca para lugar nenhum, ou pior, para outro."
        echo "     ⚠️  E olhe o 'discou para': a Meta disca para o NOSSO número do"
        echo "     WhatsApp (o do tronco SIP), com o From do cliente. Origem que"
        echo "     disca 100, 1000, 00972… ou vários hosts com porta alta e o MESMO"
        echo "     carimbo é robô de fraude, mesmo em TLS — não é candidata."
    fi
else
    echo "   🚨 NÃO CONSEGUI OLHAR: sem o log não há INVITE, e sem INVITE não"
    echo "      há endereço. Isto tem de rodar DENTRO da VM."
fi

# ── 8. ARMAR A PRÓXIMA ──────────────────────────────────────────────────────
if [ "$AO_VIVO" = "sim" ]; then
    echo
    echo "── 8. Captura ARMADA para a próxima ligação"
    asterisk -rx "pjsip set logger on" 2>/dev/null | sed 's/^/   /'
    echo "   Faça a ligação AGORA pelo celular e depois rode (a janela sai do"
    echo "   relógio DESTA VM, não do Mac — os dois podem estar em fusos diferentes):"
    comando_de_rodar "\$(date +%H:%M | cut -c1-4)"
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
    # ⚠️ AQUI o comando é o do gcloud SEMPRE, e NÃO passa pelo `comando_de_rodar`:
    # este desfecho é justamente o de quem rodou no Mac, onde `$0` É um `.sh`
    # que existe — o helper devolveria `sudo bash scripts/sbc-diagnostico.sh`,
    # exatamente o comando que acabou de falhar. Não unificar.
    echo "     cd ~/consultor-fiscal-inteligente && gcloud compute ssh sbc-whatsapp \\"
    echo "       --project=consultorfiscalapp --zone=us-west1-a \\"
    echo "       --command='sudo bash -s -- ${JANELA:-09:3}' < scripts/sbc-diagnostico.sh"
elif [ "$GRAVANDO" = "nao" ]; then
    echo "  ⚪ NÃO DÁ PARA CONCLUIR — o gravador estava DESLIGADO."
    echo "     Zero INVITE aqui não é 'não chegou', é 'não foi anotado' (lição"
    echo "     de 25/08). Ligue o gravador, refaça a ligação e rode de novo."
elif [ -z "${ACHADOS:-}" ]; then
    echo "  ⚪ NÃO CONSEGUI CONTAR — a busca no log não rodou."
    echo "     Zero aqui seria invenção: ninguém procurou. Veja o erro na"
    echo "     seção 4 e rode de novo."
elif [ "$ACHADOS" != "0" ]; then
    echo "  🔴 A META ENTREGA — chegou INVITE ($ACHADOS linha(s) na janela)."
    echo "     Então o problema é NOSSO. NÃO é caso de Meta."
    if [ -n "${MIDIA_ERRO:-}" ] && [ "$MIDIA_ERRO" != "0" ]; then
        echo "     E a seção 7 diz ONDE: $MIDIA_ERRO falha(s) de negociação de"
        echo "     mídia. A chamada é aceita e morre no áudio — leia o m=audio"
        echo "     da seção 7 ANTES de mexer em qualquer configuração."
    else
        echo "     Olhe a seção 7 (mídia), a 6 (recusas) e a 3 (o endpoint casou?)."
    fi
elif [ "$TRACE_SIP" = "nao" ]; then
    # 🚨 O DESFECHO QUE FALTAVA. Antes, este caso caía no 🟡 e mandava abrir
    # chamado na Meta — sobre um log em que o INVITE não teria sido escrito
    # nem se tivesse chegado. É o "0 INVITEs com o gravador desligado" de
    # 25/08, na metade do gravador que ninguém tinha conferido.
    echo "  ⚪ NÃO DÁ PARA CONCLUIR — o trace SIP estava DESLIGADO."
    echo "     O 'logger.conf' liga o verbose; quem escreve as mensagens SIP é"
    echo "     o 'pjsip set logger', e ele some a cada restart do Asterisk."
    echo "     Zero INVITE aqui não é 'a Meta não entregou': é 'o INVITE não"
    echo "     seria escrito de qualquer jeito'. ⛔ NÃO abra chamado com isto."
    echo "     Arme e refaça a ligação:"
    comando_de_rodar "--ao-vivo"
    if [ -n "${MIDIA_ERRO:-}" ] && [ "$MIDIA_ERRO" != "0" ]; then
        if [ "$TEM_VARREDURA" = "sim" ]; then
            # 🛡️ 29/09: com varredura no log, a falha de mídia pode ser do robô
            # (INVITE com SDP torto, aceito pelo identify aberto) — carimbar
            # "a causa é NOSSA" sobre isso mandaria mexer em config que funciona.
            echo "  ⚠️  E há $MIDIA_ERRO falha(s) de negociação de mídia no log (seção 7),"
            echo "     MAS há varredura SIP no mesmo log (7b): sem o trace não dá para"
            echo "     dizer se foram da Meta ou do robô. A data de cada falha, ao lado"
            echo "     da hora das ligações reais, é o que decide."
        else
            echo "  🔴 E MESMO ASSIM há $MIDIA_ERRO falha(s) de negociação de mídia no"
            echo "     log (seção 7) — esse erro NÃO depende do trace SIP. Houve"
            echo "     INVITE: a causa é NOSSA."
        fi
    fi
elif [ "$DENTRO_GRADE" = "nao" ]; then
    # 🚨 23/09: sem este desfecho, teste às 07:50 BRT saía 🟡 apontando a Meta.
    echo "  ⚪ NÃO DÁ PARA CONCLUIR — a rodada está FORA da grade da Meta."
    echo "     Agora são $AGORA_BRT em $META_TZ, e a grade é $META_GRADE"
    echo "     (seg-sex). Fora dela a Meta NÃO entrega, então zero INVITE é a"
    echo "     resposta CERTA. ⛔ Não é defeito e não vira chamado."
    echo "     Refaça a ligação dentro do horário e rode de novo."
    if [ -n "${MIDIA_ERRO:-}" ] && [ "$MIDIA_ERRO" != "0" ]; then
        echo "  🔴 E o log guarda $MIDIA_ERRO falha(s) de negociação de mídia de"
        echo "     tentativas ANTERIORES (seção 7): quando ela é entregue, ela"
        echo "     chega e morre no áudio. A causa é NOSSA."
    fi
else
    echo "  🟡 NENHUM INVITE na janela, com o gravador LIGADO."
    echo "     ⚠️  E isto NÃO quer mais dizer 'a Meta não entrega': em 28/08 o"
    echo "     log provou INVITE chegando (seção 7). Zero AQUI é zero NESTA"
    echo "     janela — medição de janela não vira conclusão sobre o outro lado."
    echo "     A janela conferida vai de:"
    echo "       ${LOG_DE:-?}"
    echo "       ${LOG_ATE:-?}"
    echo "     Antes de concluir: confira a hora da tentativa e olhe a seção 7,"
    echo "     que varre o log INTEIRO. ⛔ O texto do chamado da Meta em"
    echo "     docs/sbc-whatsapp-hitphone.md está SUSPENSO — não envie."
    if [ -n "${MIDIA_ERRO:-}" ] && [ "$MIDIA_ERRO" != "0" ]; then
        echo "  🔴 E JÁ HÁ PROVA CONTRÁRIA NESTE MESMO LOG: $MIDIA_ERRO falha(s)"
        echo "     de negociação de mídia. Houve INVITE fora desta janela — a"
        echo "     causa é NOSSA, não da entrega."
    fi
    if [ ! -f "$CDR_CSV" ]; then
        echo "  ⚠️  E o CDR NÃO existe nesta VM — ele é a prova que não depende de"
        echo "     verbose, e sem ele o log é a única testemunha. Vale conferir"
        echo "     'cdr show status' no Asterisk antes de fechar a conclusão."
    fi
fi
echo "════════════════════════════════════════════════════════════════"
