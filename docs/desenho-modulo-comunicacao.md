# 💬 Módulo Comunicação (WhatsApp) — Documento de Desenho

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

As filas são exatamente `DEPARTAMENTOS_WHATSAPP` (fiscal, contabil, dp-folha,
legalizacao, financeiro) + **Recepção** (conversa nova sem triagem). Não
existe cadastro de fila separado — fila nova só existe se nascer departamento
novo no catálogo (régua única).

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

**F3 — Triagem e automação**
- Bot de primeira linha ("1 Fiscal · 2 Contábil · …") roteando pra fila;
  relatórios de atendimento (volume, tempo de resposta, por fila/atendente).

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
  A aba de canal já pode ser criada; o app do tenant (manifest) fica pra
  quando o Paulo quiser dar esse passo.
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
  enviar guia, e o SP Conecta (F2) nasce sabendo o canal que o cliente
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
