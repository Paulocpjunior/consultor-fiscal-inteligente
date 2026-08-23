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
SBC_DESTINO="${SBC_DESTINO:-221}"                 # ramal/DID no HitPhone que recebe a chamada
HIT_HOST="${HIT_HOST:-177.107.205.201}"
HIT_PORT="${HIT_PORT:-21694}"
LE_EMAIL="${LE_EMAIL:-junior@spassessoriacontabil.com.br}"

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

# ── A ponte: Meta entra por TLS/SRTP; a HIT recebe INVITE direto em UDP/RTP.
#    ⚠️ Leiaute da perna Meta NÃO provado contra chamada real — o ajuste fino
#    sai do log (asterisk -rvvv), nunca de dedução (docs/sbc-whatsapp-hitphone.md).
cat > /etc/asterisk/pjsip.conf <<CONF
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
CONF

cat > /etc/asterisk/extensions.conf <<CONF
[de-meta]
; Toda chamada da Meta cai no destino do HitPhone (ramal/DID ${SBC_DESTINO}).
exten => _.,1,NoOp(Chamada WhatsApp da Meta -> HIT ${SBC_DESTINO})
 same => n,Dial(PJSIP/${SBC_DESTINO}@hit,60)
 same => n,Hangup()

[de-hit]
; Fase de ENTRADA apenas — saída (colaborador liga) é fase futura, com o
; pedido de permissão de ligação na conversa (regra da Meta).
exten => _.,1,Hangup()
CONF

systemctl enable asterisk
systemctl restart asterisk
echo "SBC pronto: ${SBC_HOST}:5061 (TLS) -> ${HIT_HOST}:${HIT_PORT} (UDP, destino ${SBC_DESTINO})"
EOF

# 4) VM — cria se não existe. O certificado exige o DNS resolvendo, então o
#    script PAUSA aqui até o registro A existir.
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
        --image-family=debian-12 --image-project=debian-cloud \
        --address="$IP" --tags=sbc-whatsapp \
        --metadata-from-file=startup-script="$STARTUP"
    echo "== VM criada — o startup script instala tudo (2–4 min)."
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
