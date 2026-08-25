#!/usr/bin/env bash
# ============================================================================
# setup-sbc-whatsapp.sh — SBC da chamada de WhatsApp (Meta TLS/SRTP ⇄ HIT UDP)
# ----------------------------------------------------------------------------
# O Paulo roda no Mac dele, logado no gcloud do projeto consultorfiscalapp —
# o MESMO rito do setup-cloud-schedulers.sh. IDEMPOTENTE: rodar de novo
# atualiza a config sem duplicar recurso.
#
# Governo e contexto: docs/sbc-whatsapp-hitphone.md (por que existe, o que
# está provado, como se aposenta quando a HIT fornecer TLS).
#
# Uso:
#   SBC_HOST=sip.spassessoriacontabil.com.br ./scripts/setup-sbc-whatsapp.sh
#
# Envs opcionais (defaults abaixo): SBC_DESTINO, HIT_HOST, HIT_PORT, ZONE.
# ============================================================================
set -euo pipefail

PROJECT="${PROJECT:-consultorfiscalapp}"
ZONE="${ZONE:-us-west1-a}"
REGION="${ZONE%-*}"
VM="sbc-whatsapp"
IP_NAME="sbc-whatsapp-ip"
SBC_HOST="${SBC_HOST:?Defina SBC_HOST (ex.: SBC_HOST=sip.spassessoriacontabil.com.br $0)}"
# 🎯 ENTRADA — onde a ligação do WhatsApp CAI no HitPhone (Paulo, 25/08: "a
# entrada de ligação via WhatsApp aí sim deve passar pela URA, uma vez que não
# tem como cair no atendente correto"). Ele está certo, e este parâmetro é o
# ponto exato disso: quem liga pelo ☎️ do WhatsApp não escolheu departamento —
# mandar direto para UM ramal é apostar que a dúvida é sempre daquela pessoa.
# ✅ DESTINO DE HOJE: 211, a TELEFONISTA (Paulo, 25/08: "O ramal 211 é
# telefonista ou seja 1 opção quando recebemos ligação"). O default deixou de
# ser o 221, que era o alvo do PRIMEIRO TESTE — o ramal de uma pessoa.
# ⚠️ O 211 NÃO é a URA: é uma opção DENTRO dela. E é justamente por isso que
# ele serve: DTMF na chamada SIP da Meta NÃO está provado aqui, e URA de menu
# numérico sem teclado é beco (o cliente ouve as opções e não escolhe). A
# telefonista é a URA humana — pergunta com quem falar e transfere.
# 📌 Isso se revisa quando a primeira chamada real chegar e o DTMF for medido.
SBC_DESTINO="${SBC_DESTINO:-211}"                 # telefonista do HitPhone (URA humana)
HIT_HOST="${HIT_HOST:-177.107.205.201}"
HIT_PORT="${HIT_PORT:-21694}"
LE_EMAIL="${LE_EMAIL:-junior@spassessoriacontabil.com.br}"
# ☎️ Destino SIP da Meta para a SAÍDA (ex.: host.da.meta:5061). NASCE VAZIO de
# propósito: o endereço se LÊ no INVITE que ela manda na primeira ligação
# recebida (asterisk -rvvv). Chutá-lo faria o colaborador ouvir silêncio.
META_SIP_DESTINO="${META_SIP_DESTINO:-}"
# ☎️ SAÍDA PELO TECLADO — CAMINHO SECUNDÁRIO, e o motivo está registrado.
#
# 🚨 PAULO CORRIGIU O DESENHO (25/08): "não faz o menor sentido — uma vez que
# já mandamos uma aprovação p o cliente, e ele aceita receber uma ligação via
# WhatsApp e não ligamos por WhatsApp, causa mais transtorno do que solução.
# A saída de ligação via WhatsApp tem CLIENTE CERTO, colaborador já sabe com
# quem quer falar da sua lista, e pronto!".
#
# Ele está certo. Na saída, o app SABE o número (a conversa está aberta e a
# permissão foi concedida NELA) — obrigar a pessoa a decorar prefixo e digitar
# o número num teclado é reintroduzir à mão um dado que o sistema já tem, e é
# justamente onde o erro de digitação manda a ligação para um estranho.
# O caminho PRINCIPAL é o BOTÃO na conversa (click-to-call: o app manda o SBC
# originar a chamada). O 131055 continua valendo — quem disca é o SBC —, mas
# quem ESCOLHE o número é o app, não o dedo.
#
# O prefixo abaixo fica como caminho SECUNDÁRIO: quem estiver só com o
# telefone na mão, sem o app aberto.
#
# 🚨 QUEM DECIDE NÃO É ESTE SBC — é o HITPHONE. Ligação normal do 221 nem passa
# por aqui: ela sai pela telefonia da HIT direto. Este SBC só vê o que a HIT
# ESCOLHEU mandar para o nosso tronco, e o jeito de ela escolher é um PREFIXO
# discado. Ex.: com prefixo *55, `*5511999998888` vai ao WhatsApp e
# `11999998888` sai como telefone comum — dois caminhos, um teclado.
#
# ⚠️ O PREFIXO É COMBINAÇÃO COM A HIT, não invenção nossa: eles criam a rota
# "prefixo X ⇒ tronco SIP da SP". Enquanto ele estiver VAZIO, a saída aceita o
# número como veio (é o comportamento de hoje) — e isso só é seguro porque a
# HIT ainda não roteia nada para cá. No dia em que rotear, chamada inesperada
# iria ao WhatsApp em SILÊNCIO; por isso, definido o prefixo, o que NÃO casa é
# RECUSADO com o motivo no log, nunca discado por engano.
SBC_PREFIXO_WHATSAPP="${SBC_PREFIXO_WHATSAPP:-}"

echo "== SBC WhatsApp → HitPhone =="
echo "   projeto=$PROJECT zona=$ZONE host=$SBC_HOST destino=$SBC_DESTINO hit=$HIT_HOST:$HIT_PORT"

# 0) API do Compute Engine — o projeto só rodava Cloud Run, então ela pode
#    nunca ter sido habilitada. 🐛 Na 1ª versão isto travava MUDO (23/08): o
#    gcloud perguntava "enable and retry? y/N" com a saída jogada em
#    /dev/null, e o script ficava parado esperando um teclado que ninguém
#    via. Pergunta interativa engolida é a pior forma de espera.
echo "== Conferindo a API do Compute Engine (1ª vez pode levar ~1 min)…"
gcloud services enable compute.googleapis.com --project="$PROJECT"

# 1) IP estático — o DNS aponta para ele, então ele nasce ANTES da VM.
if ! gcloud compute addresses describe "$IP_NAME" --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
    gcloud compute addresses create "$IP_NAME" --project="$PROJECT" --region="$REGION"
fi
IP=$(gcloud compute addresses describe "$IP_NAME" --project="$PROJECT" --region="$REGION" --format='value(address)')
echo "== IP estático: $IP"

# 2) Firewall: 80/tcp (só o Let's Encrypt), 5061/tcp (a Meta), RTP 10000-10500/udp.
#    A porta 5060/udp NÃO abre para fora: a perna HIT é iniciada por nós e o
#    firewall do GCP deixa a resposta voltar (connection tracking).
for regra in "sbc-wa-cert:tcp:80" "sbc-wa-tls:tcp:5061" "sbc-wa-rtp:udp:10000-10500"; do
    nome="${regra%%:*}"; resto="${regra#*:}"; proto="${resto%%:*}"; portas="${resto#*:}"
    if ! gcloud compute firewall-rules describe "$nome" --project="$PROJECT" >/dev/null 2>&1; then
        gcloud compute firewall-rules create "$nome" --project="$PROJECT" \
            --allow="${proto}:${portas}" --target-tags=sbc-whatsapp --direction=INGRESS
    fi
done

# 3) O provisionamento da VM (startup script). Ele também roda na REINSTALAÇÃO
#    de config (passo 5), então tudo aqui é idempotente.
if [ -n "$META_SIP_DESTINO" ]; then
    BLOCO_META_SAIDA="[meta-saida]
type=endpoint
transport=transport-tls
aors=meta-saida-aor
disallow=all
allow=opus
allow=alaw
allow=ulaw
media_encryption=sdes
media_encryption_optimistic=yes
direct_media=no
rtp_symmetric=yes
force_rport=yes

[meta-saida-aor]
type=aor
contact=sip:${META_SIP_DESTINO}"
    echo "== Saída HABILITADA: 221 -> ${META_SIP_DESTINO}"
else
    # Endpoint com contato vazio quebraria o pjsip INTEIRO (e derrubaria a
    # ENTRADA, que já funciona) — por isso ele nem é escrito.
    BLOCO_META_SAIDA="; saída desligada: META_SIP_DESTINO vazio — ver [de-hit]"
    echo "== Saída DESLIGADA (META_SIP_DESTINO vazio) — a entrada não é afetada."
fi

STARTUP=$(mktemp)
cat > "$STARTUP" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y asterisk certbot

# Certificado Let's Encrypt no NOSSO hostname — é ele que a Meta valida.
if [ ! -d "/etc/letsencrypt/live/${SBC_HOST}" ]; then
    systemctl stop asterisk || true
    certbot certonly --standalone -d "${SBC_HOST}" --agree-tos -m "${LE_EMAIL}" -n
fi
# Renovação recarrega o transporte TLS sem derrubar chamada em andamento.
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-asterisk.sh <<'HOOK'
#!/usr/bin/env bash
cp /etc/letsencrypt/live/${SBC_HOST}/fullchain.pem /etc/asterisk/keys/sbc.crt
cp /etc/letsencrypt/live/${SBC_HOST}/privkey.pem  /etc/asterisk/keys/sbc.key
chown asterisk:asterisk /etc/asterisk/keys/sbc.*
asterisk -rx 'module reload res_pjsip.so' || true
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-asterisk.sh
mkdir -p /etc/asterisk/keys
cp "/etc/letsencrypt/live/${SBC_HOST}/fullchain.pem" /etc/asterisk/keys/sbc.crt
cp "/etc/letsencrypt/live/${SBC_HOST}/privkey.pem"  /etc/asterisk/keys/sbc.key
chown -R asterisk:asterisk /etc/asterisk/keys

cat > /etc/asterisk/rtp.conf <<'CONF'
[general]
rtpstart=10000
rtpend=10500
CONF

# ── 🚨 O SBC NASCEU SEM DEIXAR RASTRO (25/08). A primeira ligação REAL entrou
#    ("Não atendida" no celular do cliente, 14:17) e não havia como provar se
#    ela chegou aqui: /var/log/asterisk/full não existia (o pacote do Ubuntu
#    só escreve messages, sem verbose) e o Master.csv do CDR também não.
#    Ou seja: o log ficou mudo e o silêncio não distinguia "não chegou" de
#    "chegou e ninguém anotou" — que é a pior forma de silêncio, e a mesma
#    classe que este projeto persegue em toda tela. Infraestrutura de
#    diagnóstico que não registra é farol apagado.
cat > /etc/asterisk/logger.conf <<'CONF'
[general]
dateformat = %F %T
[logfiles]
console => notice,warning,error
messages => notice,warning,error
; O 'full' é o que guarda o VERBOSE — é dele que sai o INVITE da Meta, e é ele
; que faltava. Sem verbose, a linha do dialplan (NoOp) não é escrita em lugar
; nenhum e a chamada não deixa marca.
full => notice,warning,error,verbose
CONF

# Verbose PERSISTE no arquivo: 'core set verbose' some no primeiro restart, e
# foi exatamente assim que a ligação de hoje passou sem registro.
if ! grep -q '^verbose' /etc/asterisk/asterisk.conf; then
    sed -i 's/^\[options\]/[options]\nverbose = 3/' /etc/asterisk/asterisk.conf
fi

# CDR: UMA LINHA POR CHAMADA, sempre. É a prova barata de "chegou ou não
# chegou" — não depende de logger, de verbose nem de alguém estar com o
# console aberto na hora.
cat > /etc/asterisk/cdr.conf <<'CONF'
[general]
enable = yes
unanswered = yes
congestion = yes
CONF
cat > /etc/asterisk/cdr_csv.conf <<'CONF'
[csv]
usegmtime = no
loguniqueid = yes
CONF

# ── A ponte: Meta entra por TLS/SRTP; a HIT recebe INVITE direto em UDP/RTP.
#    ⚠️ Leiaute da perna Meta NÃO provado contra chamada real — o ajuste fino
#    sai do log (asterisk -rvvv), nunca de dedução (docs/sbc-whatsapp-hitphone.md).
cat > /etc/asterisk/pjsip.conf <<'CONF'
[transport-tls]
type=transport
protocol=tls
bind=0.0.0.0:5061
cert_file=/etc/asterisk/keys/sbc.crt
priv_key_file=/etc/asterisk/keys/sbc.key
method=tlsv1_2
external_signaling_address=${IP}
external_media_address=${IP}

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_signaling_address=${IP}
external_media_address=${IP}

; A Meta não se registra: identifica-se pelo TRANSPORTE (a 5061 só existe pra
; ela). Apertar para as faixas de IP dela quando os logs as mostrarem.
[meta]
type=endpoint
transport=transport-tls
context=de-meta
disallow=all
allow=opus
allow=alaw
allow=ulaw
media_encryption=sdes
media_encryption_optimistic=yes
direct_media=no
rtp_symmetric=yes
force_rport=yes

[meta-identify]
type=identify
endpoint=meta
match=0.0.0.0/0

[hit]
type=endpoint
transport=transport-udp
context=de-hit
aors=hit-aor
disallow=all
allow=alaw
allow=ulaw
direct_media=no
rtp_symmetric=yes
force_rport=yes

[hit-aor]
type=aor
contact=sip:${HIT_HOST}:${HIT_PORT}

${BLOCO_META_SAIDA}
CONF

cat > /etc/asterisk/extensions.conf <<'CONF'
[de-meta]
; Toda chamada da Meta cai no destino do HitPhone (ramal/DID ${SBC_DESTINO}).
exten => _.,1,NoOp(Chamada WhatsApp da Meta -> HIT ${SBC_DESTINO})
 same => n,Dial(PJSIP/${SBC_DESTINO}@hit,60)
 same => n,Hangup()

[de-hit]
; ☎️ SAÍDA — o colaborador disca do ramal 221 e a ligação vai ao WhatsApp do
; cliente por ESTE tronco. Não é escolha de desenho: a Meta RECUSA ligação
; iniciada por API em número SIP — "Graph API calls are not allowed for SIP
; enabled numbers" (código 131055, provado em 24/08 com o botão do Connect).
; Em modo SIP quem disca é o nosso SBC.
;
; ⚠️ O destino SIP da Meta NÃO está provado, e não se inventa: ele aparece nos
; cabeçalhos do INVITE que ELA manda na PRIMEIRA ligação recebida
; (asterisk -rvvv). Enquanto META_SIP_DESTINO estiver vazio, a saída RECUSA
; com o motivo no log — melhor que discar para um endereço chutado e o
; colaborador ouvir silêncio sem saber por quê.
; 🚨 QUAL CHAMADA VEM PARAR AQUI: só o que o HITPHONE ESCOLHEU mandar para o
; nosso tronco. Ligação normal do 221 sai pela telefonia da HIT e nem passa
; por este SBC — a escolha é DELES, por uma rota de PREFIXO discado.
; Com SBC_PREFIXO_WHATSAPP definido, o prefixo é RETIRADO aqui e o que sobra é
; o número do cliente; sem ele, o número vai como veio.
exten => _.,1,NoOp(Saida 221 -> WhatsApp | discado=\${EXTEN})
 same => n,Set(ALVO=\${FILTER(0-9,\${EXTEN})})
 same => n,GotoIf(\$["${SBC_PREFIXO_WHATSAPP}" = ""]?semprefixo)
 same => n,GotoIf(\$["\${EXTEN:0:${#SBC_PREFIXO_WHATSAPP}}" != "${SBC_PREFIXO_WHATSAPP}"]?naoemeu)
 same => n,Set(ALVO=\${FILTER(0-9,\${EXTEN:${#SBC_PREFIXO_WHATSAPP}})})
 same => n(semprefixo),GotoIf(\$["${META_SIP_DESTINO}" = ""]?semdestino)
 ; Número implausível não vira ligação: E.164 sem o + tem 10 a 15 dígitos.
 ; Discar lixo faria o colaborador ouvir silêncio sem saber por quê.
 same => n,GotoIf(\$[\${LEN(\${ALVO})} < 10 | \${LEN(\${ALVO})} > 15]?numeroruim)
 same => n,Dial(PJSIP/\${ALVO}@meta-saida,60)
 same => n,Hangup()
 same => n(naoemeu),Verbose(1, RECUSADA: \${EXTEN} nao tem o prefixo ${SBC_PREFIXO_WHATSAPP} - esta chamada nao era para o WhatsApp e a rota do HitPhone mandou para ca)
 same => n,Hangup()
 same => n(numeroruim),Verbose(1, RECUSADA: \${ALVO} nao parece numero de telefone - confira a rota de prefixo no HitPhone)
 same => n,Hangup()
 same => n(semdestino),Verbose(1, SAIDA BLOQUEADA: META_SIP_DESTINO vazio - leia o INVITE da Meta numa ligacao recebida e rode o script com ele)
 same => n,Hangup()
CONF

systemctl enable asterisk
systemctl restart asterisk
echo "SBC pronto: ${SBC_HOST}:5061 (TLS) -> ${HIT_HOST}:${HIT_PORT} (UDP, destino ${SBC_DESTINO})"
EOF

# 4) VM — cria se não existe. O certificado exige o DNS resolvendo, então o
#    script PAUSA aqui até o registro A existir.
#    🐛 A imagem é UBUNTU 24.04, não Debian: o Debian 12 REMOVEU o Asterisk
#    dos repositórios oficiais ("Package 'asterisk' has no installation
#    candidate", 24/08, na 1ª VM real). Uma VM antiga criada com Debian é
#    detectada e RECRIADA — ela só contém o que este script instala, e o IP
#    estático (reservado à parte) e o DNS sobrevivem à troca.
IMG_FAMILY="ubuntu-2404-lts-amd64"
IMG_PROJECT="ubuntu-os-cloud"
if gcloud compute instances describe "$VM" --project="$PROJECT" --zone="$ZONE" >/dev/null 2>&1; then
    licenca=$(gcloud compute instances describe "$VM" --project="$PROJECT" --zone="$ZONE" --format='value(disks[0].licenses[0])' 2>/dev/null || true)
    if [[ "$licenca" != *ubuntu-2404* ]]; then
        echo "== ⚠️ A VM existente não é Ubuntu 24.04 (o Debian 12 não tem o pacote asterisk)."
        echo "   Recriando — ela só contém o que este script instala; IP e DNS ficam."
        gcloud compute instances delete "$VM" --project="$PROJECT" --zone="$ZONE" --quiet
    fi
fi
if ! gcloud compute instances describe "$VM" --project="$PROJECT" --zone="$ZONE" >/dev/null 2>&1; then
    echo ""
    echo "== ⚠️ ANTES DE CONTINUAR: crie o registro DNS =="
    echo "   ${SBC_HOST}  →  A  →  ${IP}"
    read -r -p "   Registro criado e propagado? [enter para continuar] "
    # 🐛 A conferência pergunta à FONTE (o NS autoritativo do domínio), não ao
    # resolvedor local: em 23/08 o Wix já respondia o IP e o cache NEGATIVO do
    # provedor do Paulo (que guardou o "não existe" de antes do registro) segurou
    # o laço à toa. O certbot valida pela fonte também — é ela que decide.
    consultaDns() {
        local ns
        ns=$(dig +short NS "${SBC_HOST#*.}" 2>/dev/null | head -1)
        if [ -n "$ns" ]; then dig +short "$SBC_HOST" @"$ns" 2>/dev/null | tail -1
        else dig +short "$SBC_HOST" 2>/dev/null | tail -1; fi
    }
    until [ "$(consultaDns)" = "$IP" ]; do
        echo "   ${SBC_HOST} ainda não resolve para ${IP} na FONTE (NS do domínio) — aguardando 30s (Ctrl-C para abortar)…"
        sleep 30
    done
    gcloud compute instances create "$VM" \
        --project="$PROJECT" --zone="$ZONE" \
        --machine-type=e2-small \
        --image-family="$IMG_FAMILY" --image-project="$IMG_PROJECT" \
        --address="$IP" --tags=sbc-whatsapp \
        --metadata-from-file=startup-script="$STARTUP"
    # A frase "SBC pronto" sai DENTRO da VM (startup script) — sem esta
    # espera, o terminal do Paulo terminava antes do provisionamento e não
    # havia como saber se deu certo. O log serial é a fonte.
    echo "== VM criada — aguardando o provisionamento terminar (2–4 min)…"
    pronto=""
    for _ in $(seq 1 60); do
        serial=$(gcloud compute instances get-serial-port-output "$VM" --project="$PROJECT" --zone="$ZONE" 2>/dev/null || true)
        if grep -q "SBC pronto" <<< "$serial"; then pronto=sim; break; fi
        if grep -q "no installation candidate\|certbot: error\|Some challenges have failed" <<< "$serial"; then
            echo "== ❌ O provisionamento FALHOU dentro da VM — últimas linhas do log:"
            grep -E "no installation candidate|certbot|error|E: " <<< "$serial" | tail -5
            exit 1
        fi
        sleep 15
    done
    if [ -n "$pronto" ]; then
        echo "== ✅ SBC pronto: ${SBC_HOST}:5061 (TLS) → ${HIT_HOST}:${HIT_PORT} (destino ${SBC_DESTINO})"
    else
        echo "== ⚠️ 15 min sem a frase 'SBC pronto' no log — confira:"
        echo "   gcloud compute instances get-serial-port-output $VM --zone=$ZONE | tail -40"
        exit 1
    fi
else
    # 5) Reinstalação idempotente da config (mudou SBC_DESTINO/HIT_*): manda o
    #    script pra VM e executa.
    echo "== VM já existe — reaplicando a configuração…"
    gcloud compute scp "$STARTUP" "$VM:/tmp/sbc-setup.sh" --project="$PROJECT" --zone="$ZONE"
    gcloud compute ssh "$VM" --project="$PROJECT" --zone="$ZONE" --command="sudo bash /tmp/sbc-setup.sh"
fi
rm -f "$STARTUP"

echo ""
echo "== PRÓXIMOS PASSOS (docs/sbc-whatsapp-hitphone.md) =="
echo "   1. Aba ⚙️ → ☎️ do SP Connect → 📞 cadastrar: ${SBC_HOST} porta 5061"
echo "   2. 🕒 aplicar horários + 👁 mostrar o botão (nesta ordem)"
echo "   3. Chamada de teste pelo ☎️ do WhatsApp → deve tocar no HitPhone (${SBC_DESTINO})"
echo "   4. Não tocou? gcloud compute ssh $VM --zone=$ZONE → sudo asterisk -rvvv"
