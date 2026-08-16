# De-Para Ultra Fox → SP Connect (documento VIVO da substituição)

> Pedido do Paulo (16/08). Mesma régua do `de-para-efiscal-cfi.md`: **toda
> entrega que fechar (ou abrir) uma lacuna atualiza ESTE arquivo no mesmo
> PR.** É este documento que responde *"dá pra derrubar a Ultra Fox?"* —
> e enquanto houver 🔴 em linha **bloqueante**, a resposta é NÃO.
>
> Legenda: ✅ pronto · 🟡 parcial · 🔴 falta · ⚫ não vale (decisão de não
> fazer) · 🆕 só existe no SP Connect.

## ⚠️ A trava deste documento: o que eu sei da Ultra Fox, e COMO sei

O SP Connect eu conheço pelo código. **A Ultra Fox eu conheço por
evidência indireta** — prints, falas do Paulo e comportamento observado em
produção. Um de-para que finge conhecer a ferramenta antiga faria o corte
acontecer com buraco escondido, que é o pior desfecho possível: o cliente
descobre no dia.

Por isso **cada linha da coluna "Ultra Fox" leva a ORIGEM**:

| marca | significa |
|---|---|
| **[print]** | visto em print real (bot respondendo, tela do app) |
| **[Paulo]** | dito pelo Paulo nesta ou em sessão anterior |
| **[produção]** | observado no comportamento real do número compartilhado |
| **[?]** | **NÃO CONFERIDO** — hipótese minha, precisa da sua confirmação |

Linha marcada **[?]** não conta como coberta nem como faltante: conta como
**pergunta**. Elas estão reunidas no §7.

---

## 1. Atendimento — o núcleo do dia a dia

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Caixa de entrada com lista de conversas | ✔ **[print]** | inbox de 3 colunas (lista · thread · cliente), busca por nome/número/mensagem | ✅ |
| Responder o cliente por texto | ✔ **[produção]** | `/responder` — texto livre dentro da janela de 24h | ✅ |
| Fora da janela de 24h | ✔ (bot próprio responde) **[produção]** | template aprovado (✚ Nova), com a trava no backend e o caminho dito na tela | ✅ — a janela é regra da **Meta**, vale para as duas |
| **Receber foto/documento/áudio e ABRIR** | ✔ **[produção]** | imagem, áudio e vídeo abrem NO balão; documento abre em aba nova. **Stream autenticado**, não link assinado: quem não vê a conversa não abre o anexo dela | ✅ **16/08** |
| **Enviar anexo (PDF, foto) na conversa** | ✔ **[produção]** | 📎 no composer (o texto escrito vira legenda), dentro da janela de 24h e com a mesma guarda de condução do texto | ✅ **16/08** — cópia do enviado fica no Storage, senão o histórico mostraria anexo que não abre depois |
| Enviar áudio | ✔ **[?]** | 🎤 no composer: grava, mostra o tempo, deixa OUVIR antes de enviar e para sozinho no teto. Formato escolhido entre os que a Meta aceita (ogg/opus → mp4 no Safari) | ✅ **16/08** |
| Status de entrega (✓ ✓✓ lido) | ✔ **[print]** | carimbo real vindo do webhook, por mensagem | ✅ |
| Marcar conversa como lida | ✔ **[print]** | abrir É ler (zera o contador) | ✅ |
| Respostas rápidas | ✔ **[?]** | 4 frases fixas no código (⚡), **não configuráveis** | 🟡 |
| Buscar dentro de uma conversa | **[?]** | busca só na LISTA, não dentro da thread | 🟡 |
| Nota interna (o cliente não vê) | **[?]** | ✅ balão âmbar dizendo que o cliente não vê | 🆕 |
| Histórico da conversa preservado | ✔ **[produção]** | toda mensagem gravada (`whatsapp_mensagens`, id = wamid) | ✅ |

## 2. Bot / automação (a triagem)

Régua de paridade: os **prints reais do bot da Ultra Fox de 16/08**.

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Saudação no 1º contato | ✔ **[print]** | `mensagens.saudacao`, editável, com `{nome}` | ✅ |
| Protocolo de atendimento | ✔ (número solto) **[print]** | `gerarProtocolo` no mesmo estilo; formato muda num lugar só | ✅ |
| Menu numérico de departamentos | ✔ 8 opções **[print]** | as mesmas 8 filas, **editáveis** (opção · rótulo · fila) | ✅ |
| Encaminhar pela escolha do menu | ✔ **[print]** | `definirFila` + confirmação com o nome da fila | ✅ |
| `#sair` encerra o atendimento | ✔ **[print]** | encerra, resolve a conversa (`por: cliente`) e — com a pesquisa ligada — pede a nota | ✅ |
| Aviso fora do horário | ✔ **[print]** | `foraDeHorario`, 1×/dia por conversa (anti-metralhadora) | ✅ |
| Horário de funcionamento configurável | ✔ **[?]** | dias + 2 turnos (8-12 / 13-17:30), fuso de SP explícito | ✅ |
| Cliente pedir outro departamento no meio | **[?]** | `#menu` reapresenta o menu em qualquer estado | ✅ |
| Fluxo de bot além do menu (sub-menus, perguntas encadeadas) | **[?]** | só a triagem de um nível | 🟡 depende do §7 |
| **O bot do SP Connect nasce DESLIGADO** | — | chave na ⚙️ | ⚠️ **de propósito**: com a Ultra Fox de pé são DOIS bots no mesmo número — menu em dobro pro cliente. Liga no dia do corte |

## 3. Gestão do atendimento

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Departamentos / filas | ✔ 8 **[print]** | catálogo próprio de 8 (Recepção vê tudo; RH e Jurídico são filas) | ✅ |
| Atendentes vinculados a departamento | ✔ **[Paulo]** | `users.filasAtendimento`, aba 👥 da ⚙️ (só admin grava) | ✅ |
| Transferir atendimento entre departamentos | ✔ **[?]** | ↪️ transferir: limpa o dono, nota automática na thread com recado, selo "↪ de X", aviso opcional ao cliente | ✅ |
| Assumir / liberar conversa | **[?]** | 🙋 assumir, com guarda: responder conversa conduzida por outro é recusado (assumir é 1 clique, auditado) | ✅ |
| Encerrar atendimento | ✔ **[print]** (o `#sair` prova que existe encerramento) | ✅ Encerrar — admin e gestor qualquer um; colaborador só o que conduz; cliente pelo `#sair` | ✅ |
| Perfis de acesso (admin/gestor/colaborador) | **[?]** | 3 papéis com a régua do Paulo (16/08): gestor vê/atende/encerra tudo e não configura | ✅ |
| **Avaliação do atendimento (nota 1-5)** | **[?]** | pesquisa pós-encerramento + painel 📊 (média, distribuição, últimas) | 🆕 (chave nasce desligada) |
| Etiquetas/tags na conversa | **[?]** | — | 🔴 depende do §7 |
| Relatórios de atendimento (volume, tempo de resposta, por fila) | ✔ **[?]** | só avaliações; volume e tempo **não** existem | 🔴 depende do §7 |
| Notificação sonora / pop-up de mensagem nova | ✔ **[Paulo, 16/08]** | **som** (sintetizado, sem arquivo externo), **pop-up do navegador** (clique abre a conversa) e **contador no título da aba** — a mesma mensagem nunca apita duas vezes, a conversa aberta não apita e a 1ª carga aprende sem apitar | ✅ **16/08** |
| Push no CELULAR com o app fechado | ✔ (app instalado) **[Paulo, 16/08]** | **pronto** — service worker, cadastro do aparelho, escolha de quem recebe (a MESMA régua de fila do inbox) e envio pelo FCM; fora do expediente só quem pediu | 🟡 **falta UMA chave**: `VITE_FIREBASE_VAPID_KEY` (Firebase Console → Cloud Messaging → certificados push da Web). Sem ela o app **diz** que o push está pendente — não finge |
| Presença (online/ausente) do atendente | **[?]** | — | 🟡 |

## 4. Contatos e cliente

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Cadastro de contatos | ✔ **[Paulo]** (o backup é dela) | `whatsapp_contatos`, nasce do próprio atendimento | ✅ |
| **Restaurar o backup da Ultra Fox** | — | ⚙️ → 📥: contatos (CSV) e mensagens (CSV/.txt), com preview antes de gravar, sem sobrescrever contato existente e sem duplicar ao reimportar | ✅ **16/08** — falta rodar com o arquivo real |
| Vincular contato ↔ cliente do escritório | **[?]** | 🔗 busca no cadastro central (nome/CNPJ), gravando quem vinculou | 🆕 |
| Ver responsável da carteira do cliente | ✕ (a Ultra Fox não conhece o cadastro) | coluna do cliente, lendo `carteiras` | 🆕 |
| Ver guias já enviadas ao cliente | ✕ | coluna do cliente, lendo a auditoria do rito #293 | 🆕 |
| Ficha de relacionamento (Jotform/CRM) | ✕ | fases no `desenho-modulo-comunicacao.md` §11 | 🔴 planejado |

## 5. Canal e plataforma

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Número do escritório | mesmo (+55 11 3337-1554) **[produção]** | mesmo — **as duas estão no MESMO número hoje** | ⚠️ é isso que torna o corte um evento, não uma transição suave |
| API oficial da Meta | ✔ **[Paulo]** | ✔ (WABA própria, cartão do Paulo na Meta) | ✅ |
| App de celular / tablet | ✔ app próprio **[Paulo]** | **PWA** — instala na tela inicial pelo navegador, e com a chave VAPID publicada avisa com o app fechado (ver §3) | 🟡 **cobre o uso, não é loja** |
| Rodar dentro do Teams | ✕ | app do tenant pronto (`teams-app/`, zip em `/sp-connect-teams.zip`) | 🆕 |
| Vários NÚMEROS de WhatsApp | **[?]** | **apto desde 16/08**: catálogo de canais (o de hoje segue vindo do env e é o padrão), entrada roteada pelo `phone_number_id` da Meta e cadastro na ⚙️ — o token do 2º número vive no Cloud Run, nunca no banco. Falta só o número existir | ✅ apto |
| Outros canais (Instagram, Facebook, site) | **[?]** | só WhatsApp | 🟡 depende do §7.7 |
| **Chamada de voz/vídeo** (liberada pela Meta Brasil) | **[?]** | ⚙️ → ☎️ **SONDA** o estado real na Meta e relata, com o cru da resposta. **Não liga nada de propósito** | 🟡 **decisão do Paulo, não construção**: ligar abre o botão de ligar no WhatsApp de TODOS os clientes, e sem destino que atenda (HitPhone/ramal) é telefone tocando no vazio — o cliente lê como "a SP não me atende", não como recurso desligado |
| Custo | mensalidade da plataforma **[Paulo]** | só o custo de conversa da Meta | 🆕 é o ganho econômico da troca |

## 6. Operação e administração

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Configurar mensagens automáticas | ✔ **[?]** | ⚙️ → 🤖: saudação, menu, confirmação, fora de horário, `#sair`, transferência, avaliação | ✅ |
| Gerenciar templates aprovados | ✔ **[?]** | cadastro por departamento **+** leitura direta dos aprovados na Meta | ✅ |
| Auditoria de quem fez o quê | **[?]** | envio, transferência, vínculo, encerramento e importação carimbam quem e quando | 🆕 |
| Diagnóstico do canal (webhook, assinatura) | **[?]** | painel 📡 na ⚙️ Config Admin do CFI | 🆕 |
| Suporte / dependência de fornecedor | fornecedor externo | código da casa | 🆕 |

## 7. 🙋 PERGUNTAS AO PAULO — o que eu NÃO sei da Ultra Fox

Não vou preencher nenhuma destas por dedução. Cada resposta vira linha
neste documento (e, quando faltar, vira fila de construção):

1. ✅ ~~**Áudio**~~ — **RESPONDIDO/FEITO 16/08**: gravar e enviar áudio sai
   por nós (🎤 no composer).
2. **Respostas rápidas**: existem frases salvas na Ultra Fox que a equipe
   usa direto? Se sim, quero a lista — vira cadastro editável.
3. **Etiquetas/tags**: alguém marca conversa com etiqueta ("aguardando
   documento", "urgente")? Se ninguém usa, é ⚫ e não construo.
4. **Relatórios**: qual relatório da Ultra Fox alguém realmente abre? (não
   quero reproduzir tela que nunca foi lida — a lição do e-Fiscal)
5. ✅ ~~**Notificação**~~ — **RESPONDIDO 16/08**: a Ultra Fox faz **som,
   pop-up e notificação no celular** (quando instalado), e a decisão do
   Paulo é fazer os TRÊS: *"quanto mais notificação melhor, evita desculpa
   que o colaborador não viu, não recebeu, e o cliente reclama"*.
6. **Bot**: o menu tem sub-níveis (opção que abre outro menu) ou é só o de
   8 opções que vi no print?
7. **Outros canais**: a Ultra Fox atende só WhatsApp, ou também Instagram/
   Facebook/site?
8. **Vários números**: existe mais de um número ligado nela?

## 8. O que DECIDE o corte

**Bloqueia derrubar a Ultra Fox hoje** (🔴 nas linhas de uso diário):

1. ✅ ~~Abrir a mídia recebida~~ — **RESOLVIDO 16/08**: imagem, áudio e
   vídeo abrem no balão, documento em aba nova. Stream autenticado (quem
   não vê a conversa não abre o anexo dela), nunca link assinado.
2. ✅ ~~Enviar anexo na conversa~~ — **RESOLVIDO 16/08**: 📎 no composer,
   texto vira legenda, janela de 24h e guarda de condução iguais às do
   texto livre; cópia do enviado guardada pro histórico.
3. ✅ ~~**Notificação de mensagem nova**~~ — **RESOLVIDO 16/08**, nas TRÊS
   camadas que o Paulo pediu: **som** e **pop-up** com o app aberto (no ar),
   e **push no celular com o app fechado** (código no ar, esperando UMA
   chave). ⚠️ **A 3ª camada só liga quando o Paulo publicar a
   `VITE_FIREBASE_VAPID_KEY`** — enquanto isso o app **avisa** que o push
   está pendente dessa chave, em vez de fingir que avisa: colaborador que
   confia num aviso que nunca chega é pior do que colaborador que sabe que
   precisa deixar a aba aberta.

**Não bloqueia** (pode entrar depois do corte, sem prejuízo): etiquetas,
relatórios de volume/tempo, presença, respostas rápidas configuráveis,
busca dentro da thread, CRM/Jotform.

**Sequência recomendada**: fechar os 3 bloqueantes → ligar o bot na ⚙️ (com
a Ultra Fox ainda de pé, um dia de convivência para comparar) → **ensaio com
atendente real resolvendo conversa ponta a ponta** (o aceite que o Paulo
pediu) → só então cancelar a Ultra Fox. E o backup dela entra ANTES do
cancelamento — plataforma cancelada não devolve export.

## 9. Prova de que o SP Connect funciona (o que já rodou em produção)

Não é promessa: em 16/08 o ciclo fechou ponta a ponta no número real —
mensagem do cliente chegando pelo webhook, resposta saindo pelo SP Connect
e chegando no celular, status ✓✓ ao vivo, e um atendimento real conduzido
por uma colaboradora. A Ultra Fox seguiu de pé ao lado o tempo todo.
