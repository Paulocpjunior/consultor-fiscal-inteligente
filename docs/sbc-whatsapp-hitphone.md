# SBC do WhatsApp Calling — a ponte Meta (TLS/SRTP) → HitPhone (UDP/RTP)

> Documento de GOVERNO desta infraestrutura. Estado, decisões e o rito de
> instalação moram AQUI; a próxima sessão retoma daqui.

## Por que ele existe (Paulo, 23/08/2026 — "DA P SEGUIR?")

O caminho 1 da chamada de WhatsApp é: Meta entrega a ligação por SIP e ela cai
no HitPhone (URA/ramal). A investigação de 23/08 — sonda do app, prints do
softphone e a varredura externa (DNS/SRV/porta 5061) — comprovou que a entrada
da HIT **provisionada hoje é SIP/UDP sem SRTP** (`177.107.205.201:21694`), e a
Meta **só fala TLS com SRTP, em hostname com certificado válido** (IP não
serve). Não dá para cadastrar a HIT direto na Meta.

O SBC é a ponte:

```
Meta ──SIP TLS + SRTP──▶ SBC nosso (VM no GCP) ──SIP UDP + RTP──▶ HitPhone
                          hostname + certificado                  INVITE direto
                          NOSSOS (Let's Encrypt)                  (sem registro)
```

Com o SBC, o hostname cadastrado na Meta é o **nosso**, com o **nosso**
certificado — a dependência de a HIT oferecer TLS **some**.

⚠️ **SE A HIT UM DIA FORNECER O FQDN TLS DELA** (o pedido está aberto no
suporte): cadastra-se o endereço dela no bloco 📞 da aba ☎️, apaga-se a VM
(`gcloud compute instances delete sbc-whatsapp`) e este documento é atualizado.
O SBC é ponte, não destino.

## O que está PROVADO e o que NÃO está

- ✅ A HIT aceita **INVITE direto de fora** (sem registro/senha) — visto no
  fragmento de INVITE de 23/08. É assim que o SBC entrega a chamada lá.
- ✅ `calling = ENABLED` no nosso número (sonda de 23/08, build 732).
- 🚧 **NADA da ponta Meta→SBC foi provado contra chamada real** — nem o
  payload de escrita do `sip` nas settings (a rota re-lê e mostra o que a Meta
  guardou), nem o formato do INVITE dela, nem codecs. **A primeira chamada de
  teste é a prova**, e o ajuste fino sai dos logs do Asterisk
  (`asterisk -rvvv`), não de dedução. Mesma régua do CT-e (cStat 239): o
  primeiro erro real vale mais que dez suposições.

## Pré-requisitos (na mão do Paulo)

1. **DNS**: criar um registro `A` — sugestão `sip.spassessoriacontabil.com.br`
   — apontando para o IP estático que o script reserva (ele imprime o IP e
   PAUSA esperando o DNS propagar; o certificado Let's Encrypt só sai com o
   nome resolvendo).
2. **gcloud** logado no projeto `consultorfiscalapp` (o mesmo do app).
3. Decidir o **destino no HitPhone**: o padrão do script é o ramal `221`
   (aceita INVITE direto). Se a HIT criar um DID/rota exclusiva para o
   WhatsApp, troca-se a env `SBC_DESTINO` e reinstala-se a config (idempotente).

## Instalação

```bash
cd ~/consultor-fiscal-inteligente
SBC_HOST=sip.spassessoriacontabil.com.br ./scripts/setup-sbc-whatsapp.sh
```

O script é **idempotente** (rodar de novo atualiza a config sem duplicar nada)
e faz, nesta ordem: IP estático → firewall (80/tcp p/ certificado, 5061/tcp p/
a Meta, RTP 10000–10500/udp) → VM `e2-small` **Ubuntu 24.04** (~US$ 15–20/mês
— ⚠️ NÃO Debian: o Debian 12 removeu o Asterisk dos repositórios oficiais, e a
1ª VM real morreu em *"Package 'asterisk' has no installation candidate"*,
24/08; o script detecta VM com imagem errada e a recria) → Asterisk +
certificado Let's Encrypt (renovação automática com reload) → ponte
TLS/SRTP ⇄ UDP/RTP apontada para `177.107.205.201:21694`.

## Depois da instalação — fechar o circuito

1. Aba **⚙️ → ☎️** do SP Connect → bloco **📞 Destino da chamada** → cadastrar
   `sip.spassessoriacontabil.com.br` + porta `5061` (a rota grava na Meta,
   re-lê e mostra o que ficou).
2. Conferir os **🕒 horários** aplicados (regra do Paulo: os mesmos das
   mensagens) e **👁 mostrar o botão** ☎️ — só nesta ordem: destino primeiro,
   botão depois (chamada sem quem atende é pior que chamada nenhuma).
3. **Chamada de teste**: um celular liga pelo ☎️ do WhatsApp → deve tocar no
   HitPhone (ramal/rota do destino). A linha "☎️ Ligação de WhatsApp…" aparece
   na conversa do Connect (webhook `calls`, no ar desde o deploy 736).
4. Se não tocar: `gcloud compute ssh sbc-whatsapp --zone=us-west1-a` →
   `sudo asterisk -rvvv` e ligar de novo — o log diz em qual perna parou
   (TLS da Meta, SRTP, ou o UDP da HIT). O erro real é a régua.

## Decisões de desenho

- **Asterisk (chan_pjsip)**, não Kamailio+rtpengine: para UM tronco de baixo
  volume, o B2BUA simples resolve TLS/SRTP⇄UDP/RTP nativamente; a opção
  carrier-grade é complexidade sem caso que a peça.
- A porta TLS **5061 só existe para a Meta** (nenhum ramal nosso registra no
  SBC); a identificação inicial é pelo transporte, com a ressalva de apertar
  para as faixas de IP da Meta quando os logs as mostrarem — apertar por
  suposição derrubaria a primeira chamada de teste.
- A **senha do ramal 221 NÃO é usada nem guardada** (a HIT aceita INVITE
  direto); se algum dia for preciso registrar, ela entra no Secret Manager,
  nunca em config em texto puro.
- **Chamada de SAÍDA (colaborador → cliente) fica FORA desta fase**: exige o
  pedido de permissão de ligação na conversa (regra da Meta) e a rota de
  discagem no HitPhone — entra depois que a ENTRADA estiver provada.

## ☎️ A SAÍDA é do TRONCO, não da API — provado em 24/08 (código 131055)

O botão "📞 Ligar para o cliente" foi escrito, subiu e a Meta respondeu:

> **Graph API calls are not allowed for SIP enabled numbers** (131055)

Isso **fecha a dúvida de arquitetura** que estava aberta desde o começo do
caminho 1: com o número em modo SIP, ligação de saída **não sai por API**.
Quem disca é este SBC — o colaborador liga do ramal 221 e o INVITE vai à Meta
pelo mesmo tronco que a entrada usa.

⚠️ **O que ainda NÃO está provado é o DESTINO SIP da Meta**, e ele não se
inventa. Ele aparece nos cabeçalhos do INVITE que ela manda na **primeira
ligação recebida** — por isso o teste de ENTRADA deixou de ser só validação:
ele é o que **destrava a saída**.

```
gcloud compute ssh sbc-whatsapp --zone=us-west1-a
sudo asterisk -rvvv      # e então ligar do celular pelo ☎️ do WhatsApp
```

No INVITE, procurar o host da Meta (linhas `INVITE sip:… SIP/2.0`, `From:`,
`Contact:`). Com ele em mãos:

```
META_SIP_DESTINO=<host:porta> SBC_HOST=sip.spassessoriacontabil.com.br \
  ./scripts/setup-sbc-whatsapp.sh
```

Enquanto `META_SIP_DESTINO` estiver vazio, a saída **recusa com motivo no
log** e o endpoint nem é escrito — endpoint com contato vazio quebraria o
`pjsip.conf` inteiro e derrubaria a **entrada**, que já funciona.

📌 E a **permissão do cliente continua obrigatória** (regra da Meta, provada no
mesmo dia: o cartão "Permitir" foi aceito às 14:34). Ela não é substituída
pelo tronco — sem o aceite, a Meta recusa a chamada de saída seja qual for o
caminho.
