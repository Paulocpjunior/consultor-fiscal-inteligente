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

## ☎️ AS DUAS DIREÇÕES SÃO PROBLEMAS DIFERENTES (Paulo, 25/08)

> *"vamos separar bem as 2 vertentes de saída de ligação. A saída de ligação
> via WhatsApp tem CLIENTE CERTO, colaborador já sabe com quem quer falar da
> sua lista, e pronto! Agora a entrada de ligação via WhatsApp, aí sim deve
> passar pela URA, uma vez que não tem como cair no atendente correto."*

Ele está certo, e a diferença é **quem sabe com quem quer falar**:

| | SAÍDA (nós → cliente) | ENTRADA (cliente → nós) |
|---|---|---|
| Quem é o outro lado? | **Sabido** — a conversa está aberta | **Desconhecido** |
| Quem escolhe? | O colaborador, na lista dele | Ninguém escolheu nada |
| Logo | **botão na conversa**, zero digitação | **URA**, para achar o departamento |

🚨 **O erro de desenho que isto corrige era meu.** Eu tratei as duas como uma
coisa só e propus prefixo discado para a saída. Paulo: *"não faz o menor
sentido — uma vez que já mandamos uma aprovação p o cliente, e ele aceita
receber uma ligação via WhatsApp e não ligamos por WhatsApp, causa mais
transtorno do que solução"*.

E ele aponta o custo real: a permissão de ligação é pedida **DENTRO da
conversa**, o cliente autoriza **naquela conversa**, e o app já tem o número.
Mandar a pessoa decorar um prefixo e **redigitar** o número num teclado
reintroduz à mão um dado que o sistema já tem — e é exatamente aí que um
dígito errado liga para um estranho com o WhatsApp do escritório.

### SAÍDA — botão na conversa (click-to-call)

O `131055` continua valendo: **quem disca é o SBC**, nunca a Graph API. Mas
"quem disca" não é "quem escolhe o número". O desenho é:

```
[☎️ Ligar] na conversa → CFI manda o SBC originar →
SBC chama o RAMAL do colaborador → ele atende →
SBC liga a outra perna à Meta → toca no WhatsApp do cliente
```

Sem prefixo, sem teclado, sem redigitar. O colaborador atende o próprio
telefone e a ligação já está a caminho.

🚧 **Ainda não dá para construir a discagem:** ela precisa do
`META_SIP_DESTINO`, que só se lê no INVITE da **primeira ligação recebida**.
**A entrada destrava a saída** — não há como inverter.

### ENTRADA — pela URA, não por um ramal

Quem liga pelo ☎️ do WhatsApp **não escolheu departamento**. Cair direto num
ramal é apostar que a dúvida é sempre daquela pessoa.

Isso já é **um parâmetro**, não código: `SBC_DESTINO`. O `221` era o alvo do
**primeiro teste** (um ramal que aceita INVITE e prova a perna).

✅ **DECIDIDO EM 25/08 — a URA é o ramal `211`** (Paulo: *"Ramal rota ramal 211,
central URA"*). É o default do script desde então; quem já instalou com o 221
roda o script de novo (a reinstalação da config é idempotente) e a chamada
passa a cair na URA.

⚠️ **É a MESMA URA de quem liga no fixo**, e isso é regra, não coincidência:
uma triagem só. Duas divergem no primeiro dia em que alguém mudar uma e
esquecer a outra — a armadilha das duas formas com outra roupa.

⚠️ **E isso NÃO destrava a ligação**: o INVITE da Meta não chega ao tronco
(medido em 25/08, ver o topo deste documento). O 211 é para onde a chamada vai
cair **quando** a Meta passar a entregar — trocar o destino agora é preparar o
terreno, não corrigir o bloqueio.

### Caminho SECUNDÁRIO da saída: teclado com prefixo

Para quem estiver só com o telefone na mão, **sem o app aberto**. Não é o
caminho principal — ver acima.

Pergunta do Paulo (25/08): *"se eu ligar p o cliente do ramal 221, como sair
pelo SIP ou pela Meta?"*.

**Quem decide não é este SBC — é o HitPhone.** Ligação normal do 221 nem passa
por aqui: ela sai pela telefonia deles, como sempre saiu. Este SBC só vê o que
a HIT **escolheu** mandar para o nosso tronco.

```
221 ──┬─ número normal ─────────────► telefonia HitPhone ──► PSTN
      └─ PREFIXO + número ─────────► tronco SIP da SP ──► este SBC ──► Meta ──► WhatsApp do cliente
```

O jeito de a HIT escolher é uma **rota de prefixo**. Ex.: com prefixo `*55`,
`*5511999998888` vai ao WhatsApp e `11999998888` sai como telefone comum —
dois caminhos, um teclado.

### O que pedir ao suporte do HitPhone

> Criar uma **rota de saída por prefixo** (ex.: `*55`) apontando para o nosso
> tronco SIP `sip.spassessoriacontabil.com.br:5061` (TLS), disponível para o
> ramal 221. O prefixo pode vir no INVITE — nós o retiramos.

### O que o SBC faz com isso

`SBC_PREFIXO_WHATSAPP` (env do script). Definido, o dialplan **retira** o
prefixo e disca só o número; **recusa com motivo no log** o que não casa e o
que não parece número (E.164 sem o `+` tem 10 a 15 dígitos).

⚠️ **Vazio, ele aceita o número como veio** — é o comportamento de hoje, e só é
seguro porque a HIT ainda não roteia nada para cá. No dia em que rotear, uma
chamada inesperada iria ao WhatsApp **em silêncio**.

🚧 **E nada disso disca antes de `META_SIP_DESTINO`**, que se lê no INVITE da
primeira ligação RECEBIDA. Ou seja: **a entrada destrava a saída** — não há
como inverter a ordem.

## 🛑 PROVADO EM 25/08: a Meta NÃO ENTREGA a chamada no tronco

Depois de um dia inteiro de rodadas, o caso fechou — e fechou com MEDIÇÃO, não
com dedução. Três hipóteses minhas caíram no caminho (certificado, horário,
interruptores da Meta); a única que sobreviveu veio de olhar a tela real.

### O que está provado do NOSSO lado

| | |
|---|---|
| DNS | `sip.spassessoriacontabil.com.br` → 35.185.197.118 |
| Porta 5061 | aberta |
| TLS | 1.2, certificado **público** (Let's Encrypt), válido até 22/11/2026 |
| SIP | **OPTIONS → 200 OK**, Asterisk 20.6.0 |
| Registro | `full` com VERBOSE + CDR ligados e CONFERIDOS antes do teste |

### O que está provado do lado da META

`GET /settings` devolve, todos ENABLED: `calling.status`, `sip.status`,
`call_hours.status`; `call_icon_visibility = DEFAULT`; um servidor SIP gravado
(`sip.spassessoriacontabil.com.br:5061`); grade em America/Sao_Paulo,
seg–sex 08:00–12:00 e 13:00–17:30.

### O que acontece

A chamada do cliente (do CELULAR — o WhatsApp **Desktop** não liga para número
da Business API, e era isso que produzia *"não pode receber ligações"*) é
ACEITA pela Meta: o cliente vê a tela de chamada, o horário é respeitado, e o
resultado é **"Não atendida"**.

E **nenhum INVITE chega ao SBC**: nem CDR, nem log, com o gravador ligado e
conferido. Teste das 14:52 de 25/08, dentro da janela.

⚠️ Também não chega evento de chamada no WEBHOOK — só o
`call_permission_reply`. Em modo SIP a sinalização É o INVITE, então a ligação
NUNCA vai virar linha na conversa vindo do webhook: quando ela passar a chegar,
o registro tem de sair do CDR do SBC.

### Conclusão

O que falta não está no SBC nem na configuração que o app escreve. **Não há o
que consertar deste lado** — o próximo passo é o suporte da Meta, e o texto do
chamado está abaixo.

📌 **REGRA QUE FICA: infraestrutura de diagnóstico se CONFERE antes do teste.**
As três primeiras rodadas não valeram nada porque o SBC nasceu sem gravar —
o silêncio não distinguia "não chegou" de "chegou e ninguém anotou". Só depois
de provar que o gravador estava ligado é que o vazio virou prova.

### Texto do chamado (Meta / suporte da WABA)

> Número: +55 11 3337-1554 · WABA 1289687319936644 · phone_number_id
> 1167203286473367.
>
> Chamadas de usuário para a empresa (Business Calling API em modo SIP) são
> aceitas e terminam como "Não atendida" — nenhum INVITE chega ao nosso SBC.
>
> Configuração (GET /settings): calling.status=ENABLED, sip.status=ENABLED,
> sip.servers=[sip.spassessoriacontabil.com.br:5061],
> call_icon_visibility=DEFAULT, call_hours.status=ENABLED
> (America/Sao_Paulo, seg–sex 08:00–12:00 e 13:00–17:30).
>
> Nosso SBC: TLS 1.2 na 5061, certificado público válido até 22/11/2026,
> responde SIP OPTIONS com 200 OK (Asterisk 20.6.0). Teste feito de fora da
> rede confirma DNS, porta, handshake TLS e resposta SIP.
>
> Com logging verbose e CDR habilitados e verificados ANTES do teste, uma
> chamada às 14:52 (dentro da janela) não gerou nenhum registro: nenhum
> INVITE, nenhuma entrada de CDR.
>
> Pergunta: o que impede o roteamento das chamadas para o tronco SIP
> configurado? Há alguma etapa de validação/aprovação do servidor SIP, ou
> allowlist de IP, pendente do lado de vocês?
