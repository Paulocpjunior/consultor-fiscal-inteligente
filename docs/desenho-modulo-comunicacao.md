# 💬 SP CONNECT — Módulo de Comunicação (WhatsApp) — Documento de Desenho

> **NOME OFICIAL: SP Connect** (Paulo, 14/08) — identidade da casa, sem nome
> de ferramenta.
>
> 🚨 **SP CONNECT É APP PRÓPRIO, NÃO CARD DO CFI** (Paulo, 16/08: *"vem pra
> substituir a Ultra Fox, um app totalmente novo que irá rodar dentro do
> Teams — não faz sentido algum ter um card dentro do CFI"*). O CFI é o app
> do FISCAL; o atendimento é de TODOS os departamentos. A casa do SP Connect
> é **`/connect`** (mesma SPA, tela cheia, sem menu do CFI e sem portão de
> empresa ativa) — é essa URL que vira a aba/app do Teams e o PWA. O MOTOR
> (webhook, credencial, banco, rotas) continua no serviço do CFI: a chave
> não trafega; o que é próprio é a CASA do produto, não o backend.

> Estado: **DESENHO** (nada aqui está implementado além do que a seção
> "O que já existe" lista). Aprovação do Paulo pendente nas "Decisões em
> aberto". Este arquivo é o governo do módulo: mudança de regra entra aqui
> NO MESMO PR que a implementa — mesma disciplina do `escopo-mes-fiscal.md`.

## 1. Visão

O WhatsApp é o meio de comunicação do escritório com o cliente — não só o
canal de envio de guias. Hoje o ENVIO já é nosso (Cloud API da Meta, WABA da
própria S&P, `whatsapp-cloud.js`) e o RECEBIMENTO é da Ultra Fox (o webhook
aponta pra ela). O módulo 💬 Comunicação traz o recebimento e o atendimento
para dentro do app e **substitui a Ultra Fox** — cancelamento só depois do
inbox provado com conversa real de cliente (regra da casa: validação por
resultado).

**O dono do canal é o CFI.** A credencial da WABA mora aqui e não trafega
(mesma regra do A1: leva-se a operação, não a chave). Os apps irmãos usam o
canal pelo túnel, como já fazem com os templates por departamento.

O diferencial contra Ultra Fox/SMBot é o dado que só nós temos: o número que
chega casa com o **cadastro central** (CNPJ, razão social), a conversa abre
dizendo **quem cuida da carteira**, o template certo é o do **departamento**
de quem atende, e a guia enviada pelo rito #293 aparece na mesma thread.

## 2. O que já existe (reutilizar, nunca duplicar)

| Peça | Onde | Papel no módulo |
| --- | --- | --- |
| Envio por template + upload de PDF | `whatsapp-cloud.js` | envio fora da janela de 24h |
| Cadastro de templates por departamento | `whatsapp-templates.js` + ⚙️ Config Admin | de-para template × departamento × variáveis |
| Listagem de templates aprovados na Meta | `listarTemplatesAprovados` | tela de escolha de template (status/categoria ao vivo) |
| Departamentos do usuário | `users.departamentos[]` (`cadastro-central-departamentos.js`) | filas que o atendente enxerga |
| Régua de horário | `horario-acesso.js` | fora do expediente = auto-resposta (NUNCA uma segunda régua de horário) |
| Cadastro central de empresas | `cadastro-central.js` | match número → cliente (CNPJ sempre em dígitos) |
| Responsável da carteira | `cadastro-central-responsaveis.js` | sugestão de atribuição da conversa |
| Auditoria de envio de imposto | `impostos_enviados` (rito #293) | guias aparecem na thread do cliente |

## 3. Layout (F2 — o inbox)

Tela de 3 colunas, card 💬 no menu do CFI:

```
┌────────────────┬──────────────────────────────┬────────────────────┐
│ CONVERSAS      │ THREAD                       │ CLIENTE            │
│                │                              │                    │
│ [busca]        │ banner: janela 24h aberta    │ match cadastro     │
│ filtros:       │  até HH:mm / fechada         │ central (CNPJ,     │
│  · minhas      │                              │ razão social)      │
│  · fila (dep.) │ mensagens (texto/mídia)      │                    │
│  · sem fila    │  ✓ enviado ✓✓ entregue       │ carteira: quem     │
│  · sem atrib.  │  ✓✓azul lido ✗ falhou+motivo │ cuida (principal/  │
│  · status      │                              │ backup)            │
│                │ [composer]                   │                    │
│ cada linha:    │  janela aberta → texto livre │ guias enviadas     │
│  nome/CNPJ ou  │  janela fechada → só         │ (rito #293) na     │
│  número cru,   │  template aprovado, dizendo  │ competência        │
│  fila, farol,  │  o porquê na tela            │                    │
│  não-lidas     │  respostas rápidas           │ notas internas     │
└────────────────┴──────────────────────────────┴────────────────────┘
```

Regras de tela que não se afrouxam:

- **Farol honesto do status**: "a Meta aceitou" ≠ entregue. O ✗ de falha sai
  com o MOTIVO traduzido (padrão `interpretarCstat`), incluindo o 131049
  (filtro de marketing) — é ele que hoje ninguém vê.
- **Banner da janela de 24h sempre visível** na thread: aberta (até quando) ou
  fechada (por quê só template). Composer muda de forma conforme o banner —
  a trava é física, não aviso.
- **Contato sem match no cadastro central NÃO some nem trava**: aparece com o
  número cru + pendência "vincular ao cliente" (um clique abre a busca do
  cadastro). Alerta, nunca contorno.
- **Conversa sem fila** entra em "Recepção" e fica visível a todos os
  atendentes até alguém puxar ou transferir — triagem manual na F2, bot na F3.

## 4. Funções e papéis

| Papel | Quem | Pode |
| --- | --- | --- |
| Atendente | colaborador com departamento | ver/assumir conversas das SUAS filas + Recepção; responder; transferir; notas internas |
| Admin | admin do CFI | tudo + configuração (horários, auto-respostas, respostas rápidas, importação de contatos) |

- Atribuição: conversa tem no máximo UM responsável por vez; transferência
  registra quem→quem e quando (auditoria).
- A sugestão de atribuição vem da carteira (responsável da empresa), mas é
  SUGESTÃO carimbada — quem assume é quem clica.
- Atendente sem departamento não some: vê só Recepção e a tela diz "sem
  vínculo, peça ao admin" (regra de 08/08).

## 5. Departamentos = filas

~~As filas são exatamente `DEPARTAMENTOS_WHATSAPP`~~ **SUPERADO 16/08 pela
decisão do Paulo** (*"Recepção podem atender todos departamentos, RH é um
departamento separado como todos os outros"*): **FILA ≠ DEPARTAMENTO do
SaaS**. O catálogo próprio de 8 filas mora em `whatsapp-atendimento.js`
(Recepção, Financeiro, DP, Fiscal, Contábil, Legalização, RH, Jurídico);
o catálogo dos 5 módulos não incha. Visibilidade: Recepção vê TUDO; os
demais veem a(s) própria(s) fila(s) + Recepção; admin vê tudo. A atribuição
é `users.filasAtendimento` (aba 👥 da ⚙️ do Connect; sem atribuição valem os
departamentos de módulo; rules com anti-autoconcessão).

### 5.1 Transferência entre departamentos (16/08)

A conversa de um número é **UMA só** (o cliente tem um chat no celular) —
transferir é trocar o DONO, nunca abrir uma segunda conversa:

- **↪️ Transferir de fila** (qualquer atendente): a atribuição é **LIMPA**
  (chega SEM dono na fila destino — presa no atendente de origem, o destino
  veria uma conversa "ocupada" que ninguém de lá conduz), fica **nota
  automática na thread** (de onde veio, quem mandou, recado opcional — sem
  rastro o destino pergunta tudo de novo ao cliente) e a conversa ganha o
  selo "↪ de X" até alguém assumir.
- **Aviso ao cliente** na transferência é OPCIONAL (chave na ⚙️, nasce
  DESLIGADA) e só sai com a janela de 24h aberta; falha no aviso não desfaz
  a transferência, mas é dita.
- **Guarda de condução**: responder conversa em condução por OUTRO atendente
  é recusado (409) — assumir é UM clique, auditado (mata-burro com caminho,
  não parede). Responder conversa SEM dono te torna o condutor
  (auto-assumir). Duas vozes na mesma conversa confundem o cliente.
- **✚ Nova conversa** para número JÁ em condução é recusada dizendo quem
  conduz e em qual fila — a saída é nota interna pra quem conduz ou pedir a
  transferência.
- **O cliente pede outro departamento**: com o bot ligado, `#menu`
  reapresenta o menu em qualquer estado e a escolha re-roteia (comando
  EXPLÍCITO de propósito — numa conversa triada, um "2" solto é resposta ao
  atendente, nunca menu). Com o bot desligado, é o atendente que transfere.

### 5.2 Papéis, encerramento e avaliação (Paulo, 16/08)

**Papéis do ATENDIMENTO** (`users.papelAtendimento`, ≠ role do CFI; a
atribuição é na aba 👥 da ⚙️, SÓ admin; rules com anti-autoconcessão):

| papel | vê | atende | encerra | ⚙️ (config) |
| --- | --- | --- | --- | --- |
| admin (role do CFI) | tudo | tudo | tudo | SIM |
| gestor | tudo | tudo | **qualquer atendimento** | não |
| colaborador (padrão) | filas linkadas + Recepção | as que vê (transfere) | **só o que ELE conduz** | não |

**Quem encerra**: admin e gestor, qualquer um; colaborador, só o atendimento
atribuído a ele (encerrar o próprio atendimento é parte do atendimento —
exigir gestor pra tudo viraria gargalo); o CLIENTE encerra pelo `#sair`
(bot), que resolve a conversa com `resolvidaPor: 'cliente'`.

**Avaliação (nota 1-5 pelo WhatsApp)**: no encerramento, com a chave
`avaliacaoAtiva` LIGADA (nasce DESLIGADA) e a janela de 24h aberta, o
convite sai; **só a PRIMEIRA resposta do cliente vale** — se for 1-5 vira
nota (gravada em `whatsapp_avaliacoes` com atendente/fila/protocolo) e
recebe agradecimento; qualquer outra coisa limpa a espera (insistir em
avaliação é spam, e nota nunca se deduz de texto livre). A captura roda
ANTES do bot no webhook (a nota não pode virar gatilho de triagem) e é
independente do `botAtivo`. Painel **📊** no cabeçalho do inbox: admin e
gestor veem todas; colaborador vê as próprias — o recorte é do backend.

### 5.3 Cliente 360 na coluna e PWA (16/08)

- **Coluna do cliente viva**: com o contato VINCULADO, a terceira coluna
  mostra a empresa (nome/CNPJ/regime do cadastro central), o **responsável
  da carteira** e as **últimas guias enviadas** pelo rito #293
  (`impostos_enviados`). **NENHUMA conta nova** — a rota só LÊ o que outras
  telas já produzem (mesma regra dos Relatórios: relatório nunca tem conta
  própria). Lista sem envio DIZ que não prova ausência de guia, e lista
  cortada diz "mostrando X de N" (farol honesto vale pra contagem).
- **PWA**: `public/connect.webmanifest` (`start_url`/`scope` = `/connect`,
  standalone, tema azul SP) + ícones 192/512 gerados por
  `scripts/gerar-icones-pwa.py`. O manifest é injetado pelo App **só no modo
  /connect** — declarar no `index.html` faria o CFI se instalar como "SP
  Connect", que é o mesmo erro de identidade do card removido em 14/08.
  ⚠️ `.webmanifest` entra na regra de **no-store** do `server.js` junto com o
  HTML: sem hash no nome, "immutable 1 ano" prenderia o manifest velho no
  celular de quem já instalou. `__tests__/spConnectPwa.test.ts` trava as
  três coisas — e a trava do cache foi **provada revertendo a regra** (a 1ª
  versão dela passava com a regra desfeita, porque casava a palavra
  `.webmanifest` da linha de Content-Type logo abaixo em vez da CONDIÇÃO do
  `if`: sentinela tem que responder a pergunta certa).

## 6. Regras de horário e auto-resposta

- A régua é `horario-acesso.js` — o expediente do ATENDIMENTO é o expediente
  do escritório. Não nasce um segundo cadastro de horário.
- Fora do expediente, mensagem recebida dispara **auto-resposta** (texto
  configurável na ⚙️): "recebemos sua mensagem, retornaremos no horário X".
  É resposta DENTRO da janela de 24h que o cliente abriu — texto livre, sem
  template, sem custo.
- Auto-resposta tem idempotência por conversa+dia (não metralhar quem manda
  5 mensagens seguidas à noite).
- A conversa recebida fora do horário entra na fila normalmente — o que muda
  é só a resposta automática.

## 7. Contatos — importação da Ultra Fox

- Um-shot: export da Ultra Fox (CSV) → botão de importação (admin) →
  `whatsapp_contatos`.
- Cada contato tenta casar com o cadastro central pelo NÚMERO (normalizado
  por `normalizarNumeroBr`) e, quando o export trouxer, pelo CNPJ.
- Resultado da importação conta POR CAUSA (regra do farol): casados ·
  sem match (pendência de vínculo, não somem) · número torto (listados,
  fora da base).
- Contato também nasce espontaneamente: número desconhecido que manda
  mensagem vira contato sem vínculo + pendência.
- O contato guarda `origem` (`ultrafox-import` | `cadastro` | `espontaneo`)
  — dado importado é carimbado com a origem, como tudo na casa.

## 8. Banco de dados

Firestore (mesmo banco), rules `if false` (só backend — mesmo desenho de
`carteira_observacoes`). **Toda coleção nova entra no `catalogo-banco.js` no
MESMO PR que a cria.**

| Coleção | Doc | Conteúdo |
| --- | --- | --- |
| `whatsapp_contatos` | 1 por número (E.164) | nome, empresaId (nullable), origem, criadoEm |
| `whatsapp_conversas` | 1 por número | fila, atribuidoA, status (aberta/pendente/resolvida), janela24hAte, ultimaMensagem (resumo), naoLidas |
| `whatsapp_mensagens` | 1 por mensagem | conversaId, direcao, tipo (texto/documento/imagem/áudio…), corpo, mediaPath (Storage), metaMessageId, statusEntrega + timestamps, quem enviou (uid) |
| `whatsapp_webhook_eventos` | 1 por evento recebido | payload CRU (aprender a forma real — mesmo padrão de `legalizacao_sign_eventos`), processadoEm |

- **Mídia vai pro Cloud Storage** (mesmo padrão do XML cru: `storagePath` no
  doc, binário no bucket). Base64 no Firestore é proibido.
- `metaMessageId` é a chave de idempotência do webhook (a Meta reentrega).
- Status de entrega atualiza a MENSAGEM, nunca cria linha nova.
- LGPD: conversa é dado do cliente — exclusão de empresa (soft-delete) marca
  as conversas vinculadas; retenção definitiva é decisão do Paulo (aberta).

## 9. Fases e critérios de aceite

**F1 — Webhook + status + gravação** (paralelo com a Ultra Fox, risco zero)
- Rota de verificação (GET) + recebimento (POST) com validação de assinatura
  (`X-Hub-Signature-256`, secret do app Meta).
- Grava mensagens recebidas e STATUS de entrega dos envios (entregue/lido/
  falhou+motivo) na auditoria existente.
- Aceite: envio de guia real mostrando "entregue/lido" no painel; mensagem
  de cliente aparecendo em `whatsapp_mensagens`. Ultra Fox intocada.
- ✅ **CÓDIGO NO AR 13/08**: núcleo `whatsapp-webhook.js` (13 testes) + rota
  pública `/api/whatsapp/webhook` + painel 📡 na ⚙️ Config Admin. Decisões:
  evento cru gravado ANTES de processar e falha responde 500 de propósito (a
  Meta reentrega; tudo idempotente pelo wamid — 200 com gravação perdida
  seria sumir com mensagem de cliente); status não regride (lido não vira
  entregue com evento fora de ordem); assinatura usa o `secretsMatch` do
  cron-secret (régua única). **FALTA (Paulo, ~10 min)**: criar as envs
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (valor inventado) e `WHATSAPP_APP_SECRET`
  (App da Meta → Configurações → Básico) no Cloud Run, e cadastrar no painel
  da Meta (App → WhatsApp → Configuration) a Callback URL
  `<url do app>/api/whatsapp/webhook` + o mesmo verify token, assinando o
  campo **messages**. O painel 📡 mostra quando o primeiro evento chegar —
  configuração salva não é webhook funcionando (regra da casa).
- ✅ **F1.5 no mesmo dia — mídia recebida baixa pro NOSSO Storage**: a Meta
  guarda a mídia por tempo limitado; esperar a F2 perderia anexo de cliente
  (comprovante de pagamento é o caso típico). Download em `setImmediate`
  DEPOIS do 200 (a Meta quer resposta rápida) e best-effort: falha fica
  NOMEADA no doc (`downloadErro`), nunca derruba o webhook nem vira
  pendência muda. Caminho `whatsapp/{numero}/{wamid}_{arquivo}` — o wamid
  na frente impede colisão de dois clientes mandando "comprovante.pdf".

**F2 — Inbox** (a tela da seção 3)
- Aceite: um atendente real resolve uma conversa real de ponta a ponta pelo
  CFI (receber → responder na janela → template fora dela → resolver), com
  atribuição e auditoria. Só DEPOIS disso se discute cancelar a Ultra Fox.

**F3 — Triagem e automação** (escopo detalhado em 16/08, com os prints do
bot da Ultra Fox como RÉGUA DE PARIDADE — Paulo: *"temos que criar os
atendentes, departamentos, mensagens automáticas, definição de horário de
funcionamento e todas as outras utilidades"*)
- **Atendentes**: são os usuários que JÁ existem (login unificado +
  `users.departamentos[]`) — o que nasce é PRESENÇA (online/ausente) e
  atribuição de conversa; cadastro novo de atendente seria a segunda cópia
  do Gerenciar Usuários.
- **Filas/menu de triagem**: "Digite uma das opções: 1 - Recepção · 2 -
  Financeiro · …" roteando pra fila.
  ✅ **DECIDIDO (Paulo, 16/08)**: **RH é departamento separado como todos os
  outros** — entra no catálogo de departamentos de ATENDIMENTO (`rh`, e
  `juridico` idem, espelhando o menu atual; nenhum dos dois abre app irmão,
  são filas). E **a Recepção atende TODOS os departamentos**: a régua de
  visibilidade é *atendente vê a fila do(s) seu(s) departamento(s) +
  Recepção; atendente da Recepção vê TODAS as filas*.
  O menu de triagem (número → fila) é CONFIGURÁVEL na ⚙️ do Connect, com o
  default espelhando o menu de 8 opções em uso hoje — mudar item de menu é
  config, nunca deploy.
- **Mensagens automáticas**: saudação com Nº DE PROTOCOLO ("Ju, aguarde um
  momento… Protocolo: 576695860"), instrução #sair, mensagem de fora de
  horário ("não temos atendentes online, deixe sua mensagem"), rodapé com
  site/redes. Textos CONFIGURÁVEIS na ⚙️ do Connect, nunca cravados no
  código.
- **Horário de FUNCIONAMENTO do atendimento**: cadastro PRÓPRIO — o print
  do bot prova que o horário do atendimento (Seg–Sex 8:00–12:00/13:00–17:30)
  é DIFERENTE do horário de acesso da casa (07:00–20:00), então reusar o
  `horario-acesso` aqui estaria ERRADO (revisão da §6 deste doc: a régua de
  acesso continua valendo pro LOGIN; o funcionamento do atendimento é outro
  cadastro, com almoço).
- Relatórios de atendimento (volume, tempo de resposta, por fila/atendente).

**F4 — Voz (Calling API da Meta) — DESENHADA, NÃO HABILITADA**
- Decisão de 13/08: NÃO habilitar agora. Habilitar acende o botão de ligar no
  WhatsApp do cliente, e chamada que toca no vazio é pior que botão ausente.
  Enquanto desabilitada, o cliente nem vê a opção — nenhuma expectativa.
- Modelo Meta (conferido 13/08): receber ligação do cliente é GRÁTIS; fazer
  ligação paga por minuto (pulsos de 6s). Beta no Brasil desde Q2/2026.
- **Hipótese que muda o custo da fase**: a Calling API fala SIP, e a telefonia
  do escritório é o **HitPhone dentro do Teams**. Se o HitPhone aceitar tronco
  SIP externo, a ligação de WhatsApp toca onde a equipe JÁ atende telefone —
  a F4 vira integração, não construção de softphone. VERIFICAR com o
  fornecedor antes de desenhar tela: "aceitam tronco SIP de terceiros?".
- O IVR da chamada usa as MESMAS filas por departamento do inbox (régua
  única); gravação só com opt-in; o registro da ligação entra na thread.

## 10. A teia externa — CFI dentro do Teams

O escritório VIVE no Teams (telefonia HitPhone inclusa). Colocar o CFI lá
dentro é ferramenta na mão de quem já está com o Teams aberto o dia todo.

- **Nível 1 — aba de canal**: qualquer dono de canal adiciona uma aba
  "Website" com a URL do CFI. Zero código NOSSO de app, mas EXIGE o ajuste de
  frame (abaixo).
- **Nível 2 — app do tenant**: manifest no Developer Portal da Microsoft
  (nome, logo SP, static tabs) publicado em "Apps da organização"; o admin
  fixa na barra lateral de todo mundo por política. Os 5 módulos podem ser 5
  abas do mesmo app. É a forma "app de verdade" — instalável, com identidade.
- **Requisito técnico (os dois níveis)**: ✅ **FEITO 13/08** — o `server.js`
  libera o embutimento SÓ pros domínios do Teams (`teams.microsoft.com`,
  `*.cloud.microsoft`, `*.office.com`) via `frameAncestors`, com o
  `X-Frame-Options` do helmet desligado (dois cabeçalhos com regras
  diferentes = navegador antigo obedece o errado e a aba abre em branco).
  `__tests__/teamsFrameAncestors.test.ts` trava a lista NOS DOIS sentidos.
  A aba de canal já pode ser criada.
- **App do tenant**: ✅ **PACOTE PRONTO 16/08** — `teams-app/` (manifest
  v1.16 com aba estática pessoal → `/connect`, ícones gerados por
  `scripts/gerar-icones-teams.py`, zip por `scripts/gerar-pacote-teams.sh`).
  O zip também é servido pelo app em **`/sp-connect-teams.zip`**. Upload e
  liberação são no Admin Center do Teams (passo a passo no
  `teams-app/README.md`). O `contentUrl` aponta pra URL do Cloud Run
  (funciona hoje); quando o domínio `app.spassessoriacontabil.com.br`
  entrar no ar, troca-se a URL no manifest e reenviam-se (o domínio já está
  em `validDomains`). ⚠️ O `id` (GUID) do manifest NUNCA muda entre versões
  — mudar cria OUTRO app e a equipe perde o fixado.
- **Login funciona embutido**: o CFI autentica por e-mail/senha do Firebase
  (`signInWithEmailAndPassword`), sem popup de terceiro — o caso que quebra
  dentro de iframe não existe aqui. SSO com a conta Microsoft do tenant é
  melhoria futura, não pré-requisito.

## 11. CRM em camadas — e o Jotform é a fonte do relacionamento

Paulo, 14/08: *"hoje nosso CRM é o Jotform — ali estão todos os detalhes de
cada cliente, separado por departamentos: se tem folha, se vai impresso, por
e-mail ou WhatsApp, o que gosta"*. Isso define a incorporação:

- **Inbox ≠ CRM**: o inbox é a conversa de AGORA; o CRM é a memória do
  relacionamento. A vantagem estrutural da casa é que metade do "cliente
  360" já existe espalhada (cadastro central, carteira, Rotina do Mês,
  auditoria de envios, Legalização, Financeiro) — falta a linha do tempo
  unificada e o dado de RELACIONAMENTO, que mora no Jotform.
- **O Jotform NÃO se substitui — se LÊ** (trilho provado: Legalização e
  Financeiro já leem por API, parser casando campo pelo TEXTO da pergunta,
  `PARSER_VERSAO` + re-sync no boot; a chave já está no Secret Manager).
  A equipe continua preenchendo lá; o ecossistema espelha por CNPJ num
  bloco `relacionamento` com **origem carimbada `jotform`**. Regras de
  06/08 valem inteiras: divergência entre Jotform e cadastro central é
  ALERTA (nunca escolha silenciosa), espelho não sobrescreve digitação, e
  campo ausente não vira default.
- **O OURO imediato: a preferência de envio é ROTEAMENTO.** "Vai impresso /
  por e-mail / por WhatsApp" decide qual botão o rito #293 sugere na hora de
  enviar guia, e o SP Connect (F2) nasce sabendo o canal que o cliente
  escolheu. "Tem folha de pagamentos" liga o cliente à fila do DP.
- **Fases (segundo plano, sem atrapalhar a F2)**: (a) mapear os campos
  reais dos formulários (de-para escrito, como o da Legalização); (b) sync
  diário → bloco `relacionamento` no espelho central + painel de
  divergências; (c) ligar a preferência no rito de envio e no inbox;
  (d) só DEPOIS discutir migrar a digitação pra dentro do app — hoje o
  Jotform é a UI de entrada e trocá-la sem necessidade é retrabalho.

## 12. Decisões em aberto (Paulo)

1. **Retenção de conversas**: guardar para sempre ou expurgo após N anos?
2. **Recepção**: quem enxerga a fila Recepção — todos os atendentes (proposta)
   ou um triador designado?
3. **Notificação de mensagem nova**: sino no app basta na F2, ou já quer
   push/e-mail pro atendente?
4. **Número**: seguimos com o número único do escritório (proposta; a WABA
   aceita somar números depois) ou já nasce um número por departamento?
