# Separação do SP Connect — plano para DEPOIS do corte da Ultra Fox

<!-- Documento de GOVERNO. Decisão do Paulo em 17/08: *"planeja separação de
     verdade depois do corte da Ultra Fox"*. Enquanto o corte não acontecer,
     NADA aqui se executa — e cada fase fechada atualiza este arquivo no MESMO
     PR que a fecha. -->

> **Estado: PLANEJADO, não iniciado.** A ordem do Paulo tem uma condição
> temporal explícita — *depois do corte da Ultra Fox*. Começar antes trocaria
> um risco conhecido (dois apps num container) por um desconhecido (mexer na
> infraestrutura do canal no meio da migração de plataforma).

## 1. Por que separar

Hoje o SP Connect é **casa separada na URL** (`/connect`, tema próprio,
identidade da SP) mas **mesmo repositório e mesmo serviço Cloud Run** do CFI.
O Paulo viu a consequência na lista de runs do GitHub (17/08): *"estamos usando
o projeto do CFI p o SP-Connect, algumas coisas que você cita são do projeto
CFI"*.

O que compartilhar custa, em ordem de gravidade:

1. **Falha do CFI derruba o atendimento.** Mesmo container, mesmo processo. No
   dia em que a equipe estiver 100% no Connect, uma exceção no fiscal cala o
   canal com o cliente — e o cliente não sabe que existe "o fiscal".
2. **Deploy acoplado.** Subir uma correção de DIPAM reinicia o atendimento; e
   uma correção urgente do atendimento espera a bateria inteira do CFI
   (4.100+ testes, lint, build, auditoria).
3. **Um advisory trava os dois.** O gate de dependências é comum.
4. **A operação se mistura**: runs, issues e o painel do Actions falam das duas
   casas na mesma lista — foi exatamente o que gerou esta decisão.

## 2. O que a separação NÃO é

🚨 **Separar SERVIÇO não é separar BANCO.** O precedente da casa é o
📋 Legalização: app próprio, repositório próprio, serviço próprio — e **mesmo
Firestore e mesmo Firebase Auth** do CFI, lendo `users` direto, sem túnel.

Isso importa porque decide o custo do projeto inteiro:

| Se o banco continuar o mesmo | Se o banco fosse separado |
|---|---|
| **zero migração de dados** (`whatsapp_*` fica onde está) | migrar conversas, contatos, mensagens e mídia |
| login único, sem cadastro novo | federar identidade |
| a coluna do cliente (empresa, carteira, guias) continua leitura direta | tudo isso viraria chamada de túnel |
| risco baixo | risco alto, e sem ganho para o problema que motivou a separação |

**Decisão recomendada: mesmo Firestore, mesmo Auth, mesmo projeto GCP.** O que
se separa é **processo, repositório e esteira** — que é onde estão os quatro
custos da §1.

## 3. A inversão que quase ninguém vê

Hoje a regra da casa é *"a credencial da WABA vive SÓ no CFI; os irmãos usam o
túnel"*. Depois da separação, **isso se inverte**: quem passa a ser dono do
canal WhatsApp é o Connect.

E o CFI **usa** o canal — o rito de envio de guia (#293) manda DAS, DARF e DARE
por WhatsApp. Então:

- a credencial da WABA **muda de casa** (envs saem do CFI, entram no Connect);
- o CFI passa a **pedir ao Connect** para enviar, pelo mesmo desenho de túnel
  que os módulos irmãos já usam (`crossProjectAuth`);
- se essa ponte cair, **o CFI não manda guia por WhatsApp** — e isso precisa
  falhar dizendo o que houve, com o caminho do e-mail ao lado, nunca em
  silêncio.

⚠️ Manter a WABA no CFI e o Connect chamando o CFI seria mais fácil e **anula
o motivo da separação**: uma queda do CFI voltaria a calar o atendimento.

## 4. O que amarra hoje (levantado, não suposto — 17/08)

**Frontend** (`components/SpConnect/`, `services/*Connect*`):
`App.tsx` (roteamento `/connect`, login, tema, `ErrorBoundary`, `UpdateBanner`),
`firebaseConfig`, `Logo`, `LoadingSpinner`, `version.ts` e — atenção —
`novidadesService`, de onde o ℹ️ SOBRE **importa a régua do selo**.

**Backend** (`sefaz-backend/whatsapp-*.js`):
`require-admin.js` (auth), `require-cross-project-auth.js` (túnel),
`auditoria-permissoes.js`, `horario-acesso.js`.

**Coleções lidas do CFI**: `users`, `simples_empresas`, `lucro_empresas`,
`carteiras`, `impostos_enviados` — todas **leitura**, todas continuam no mesmo
banco (§2), então nenhuma vira problema.

**Infraestrutura**: webhook da Meta apontando para a URL do CFI · credencial
WABA nas envs do Cloud Run do CFI · Cloud Storage da mídia · FCM do push.

## 5. Fases

### F0 — Pré-requisito (não é trabalho de código)
**O corte da Ultra Fox tem que ter acontecido e assentado.** Critério: uma
semana de atendimento real 100% no Connect, sem retorno à plataforma antiga.

### F1 — Repositório próprio
Mover `components/SpConnect/`, `services/*Connect*`, `services/spConnect*`,
`sefaz-backend/whatsapp-*.js`, `teams-app/`, os guias do Connect e **os testes
que os travam** (`deParaUltrafox`, `sobreConnect`, `spConnectPwa`,
`whatsappEtiquetas`, `whatsappMidia`, `whatsappPush`, `whatsappCanais`,
`whatsappChamadas`, `whatsappCartaoContato`, `whatsappImportUltrafox`).

🚨 **Trava que não pode ser esquecida na mudança**: `novidadesService` é
importado pelo `sobreConnect` **de propósito** — é a régua única do selo. Ao
mover, ou o Connect leva sua própria cópia **e o teste que impede as duas
divergirem morre**, ou ela vira um trecho pequeno duplicado **com o motivo
escrito**. Copiar sem decidir é como o 📣 do CFI passou onze dias apagado.

Critério de aceite: o repo novo builda, roda a bateria e sobe uma revisão sem
tráfego. **O CFI ainda serve `/connect` neste momento** — nada foi cortado.

### F2 — Serviço Cloud Run próprio, sem tráfego
Deploy do novo serviço apontando para o **mesmo** Firestore/Auth/Storage.
Health check próprio. Domínio `app.spassessoriacontabil.com.br` mapeado nele.

Critério: dá para logar no serviço novo e **ver** as conversas (leitura).
Enviar ainda não — o webhook e a WABA seguem no CFI.

### F3 — A virada do canal (é um EVENTO, não uma transição)
O webhook da Meta aponta para **um** lugar só. Reapontar é o momento de risco
do projeto inteiro.

1. Publicar a credencial da WABA nas envs do **serviço novo**
2. Reapontar o webhook no painel da Meta para a URL nova
3. Conferir, com mensagem real, que chega e que responde
4. **Só então** remover a credencial do CFI

⚠️ **Mensagem que chegar entre 2 e 3 pode se perder.** Mitigação: fazer fora do
expediente, e conferir a contagem de mensagens antes/depois. A idempotência por
`wamid` protege duplicata, **não** protege ausência.
⚠️ **Plano de volta escrito antes**: reapontar o webhook para o CFI e
republicar a env. Enquanto o CFI ainda tiver o código, a volta é de minutos.

### F4 — Inversão do envio de guia
O CFI passa a pedir ao Connect (`crossProjectAuth`). Só depois disso o código
do WhatsApp sai do CFI.

Critério: DAS, DARF e DARE saem por WhatsApp pelo caminho novo, e a **falha da
ponte é dita na tela**, com o e-mail como alternativa.

### F5 — Limpeza
Remover do CFI o roteamento `/connect`, os `whatsapp-*.js` e os testes já
movidos. Atualizar o `catalogo-banco.js` (as coleções `whatsapp_*` continuam
existindo, mas o dono passa a ser outro app) e o `deploy-app.yml`.

## 6. Riscos, com a mitigação do lado

| Risco | Por que dói | Mitigação |
|---|---|---|
| **Webhook reapontado com o app novo com defeito** | o canal do escritório fica mudo e o cliente não sabe por quê | F2 prova leitura antes; volta escrita antes de virar |
| **Mensagem perdida na virada** | não se recupera: a Meta não reentrega | janela fora do expediente + contagem antes/depois |
| **Régua duplicada na mudança de repo** (selo, filas, papéis) | duas cópias divergem em silêncio — o defeito que mais mordeu este projeto | decidir cópia × pacote **por régua**, com o motivo escrito |
| **CFI sem canal antes da F4** | guia deixa de sair por WhatsApp | F4 **antes** da F5, nunca junto |
| **Dois deploys para conferir** | print sem versão vira narrativa | cada app com sua versão no rodapé (o Connect já tem) |

## 7. O que fica melhor, e o que fica pior

**Melhor:** falha isolada · deploy do atendimento em minutos · advisory de um
não trava o outro · runs e issues separados · identidade completa no domínio
próprio.

**Pior (e é honesto dizer):** duas esteiras para manter · duas versões para
conferir num incidente · a ponte CFI→Connect é uma peça nova que pode cair ·
e uma correção que hoje é um PR passa a ser dois quando toca os dois lados.

## 8. Estimativa

**F1+F2: um dia.** **F3: uma janela de 30 minutos**, fora do expediente, com o
Paulo por perto. **F4: meio dia.** **F5: duas horas.**

O caminho crítico não é o código — é a F3, que depende de decidir a janela e de
ter alguém conferindo com mensagem real.

## 9. Quem faz o quê

A regra que separa: **é do Paulo tudo que exige decisão, credencial ou clique
em painel externo** (Meta, GCP, GitHub, Microsoft) — coisas que este ambiente
não alcança e que ninguém deve fazer no lugar dele. **É meu todo o resto.**

### Parte do Paulo — 4 decisões e 3 cliques

| # | O quê | Quando | Por que só ele |
|---|---|---|---|
| P1 | **Dizer que a F0 fechou** — uma semana de atendimento assentado no Connect, sem volta à Ultra Fox | gatilho de tudo | é leitura da operação, não do código |
| ~~P2~~ | ✅ **FEITO 17/08** — nome escolhido: **`sp-connect`** | — | — |
| ~~P3~~ | ✅ **FEITO 17/08** — repositório criado: `https://github.com/Paulocpjunior/sp-connect.git` | — | ⚠️ falta só o ACESSO deste ambiente a ele (ver nota abaixo) |
| P4 | **Confirmar a inversão da §3** — o Connect vira dono da WABA e o CFI passa a pedir | antes da F3 | é a decisão que dá sentido ao projeto; sem ela a separação entrega metade |
| P5 | **Escolher a janela da F3** (dia e hora, fora do expediente) e estar por perto | F3 | é o momento de risco: o canal do escritório fica virando |
| P6 | **Reapontar o webhook no painel da Meta** e publicar a credencial da WABA no serviço novo | F3 | credencial e painel externo — não passo por aqui |
| P7 | **Mapear o domínio** `app.spassessoriacontabil.com.br` no serviço novo | F2 | DNS e GCP |

### Minha parte — o resto

| Fase | O que eu faço |
|---|---|
| F1 | mover código, testes e guias para o repo novo; decidir **régua por régua** o que é cópia e o que é import (com o motivo escrito); montar a esteira (lint + jest + build + deploy) e a rede `if: failure()` que vira issue |
| F2 | Dockerfile, workflow, health check, deploy sem tráfego; provar que dá para **ler** as conversas no serviço novo |
| F3 | escrever o **plano de volta ANTES** da virada; preparar a contagem de mensagens antes/depois; ficar de prontidão na janela |
| F4 | a ponte CFI→Connect pelo túnel, com a falha **dita na tela** e o e-mail como alternativa |
| F5 | remover do CFI o `/connect`, os `whatsapp-*.js` e os testes movidos; atualizar `catalogo-banco.js`, `deploy-app.yml` e este documento |

### ⚠️ O acesso do ambiente ao repositório novo

O repositório já existe, mas a sessão que trabalha aqui enxerga **um escopo de
repositórios** — hoje só o `consultor-fiscal-inteligente`. Antes da F1, o
`sp-connect` precisa entrar nesse escopo (a autorização é um passo do Paulo).

**Isso não é urgente e não muda o gatilho**: a F1 só começa depois do P1. Se na
hora o acesso não vier, o caminho alternativo é abrir a sessão apontando
direto para o `sp-connect` — o código a mover está todo neste repositório e é
lido normalmente.

### O que NÃO é de ninguém agora

Nada disso começa antes do **P1**. Se eu adiantar a F1 "porque é barato", o
código do Connect passa a viver em dois lugares durante o corte — que é
exatamente o pior momento para ter duas verdades.

**O repositório criado hoje não antecipa nada** — ele fica vazio esperando, e
isso é o estado correto.
