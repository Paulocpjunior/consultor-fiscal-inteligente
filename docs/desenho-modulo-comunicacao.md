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

**F2 — Inbox** (a tela da seção 3)
- Aceite: um atendente real resolve uma conversa real de ponta a ponta pelo
  CFI (receber → responder na janela → template fora dela → resolver), com
  atribuição e auditoria. Só DEPOIS disso se discute cancelar a Ultra Fox.

**F3 — Triagem e automação**
- Bot de primeira linha ("1 Fiscal · 2 Contábil · …") roteando pra fila;
  relatórios de atendimento (volume, tempo de resposta, por fila/atendente).

## 10. Decisões em aberto (Paulo)

1. **Retenção de conversas**: guardar para sempre ou expurgo após N anos?
2. **Recepção**: quem enxerga a fila Recepção — todos os atendentes (proposta)
   ou um triador designado?
3. **Notificação de mensagem nova**: sino no app basta na F2, ou já quer
   push/e-mail pro atendente?
4. **Número**: seguimos com o número único do escritório (proposta; a WABA
   aceita somar números depois) ou já nasce um número por departamento?
