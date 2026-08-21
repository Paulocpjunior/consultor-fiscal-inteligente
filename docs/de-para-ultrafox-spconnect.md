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
| Cliente pedir outro departamento no meio | **[?]** | `#menu` reapresenta o menu em qualquer estado **e libera a condução** (volta pra triagem sem dono — pedir outro depto e ficar com o atendente do anterior é conversa torta) | ✅ |
| **O bot não fala por cima de atendimento em andamento** | **[?]** — o bot dela roda no mesmo número e não foi observado invadindo | conversa com atendente (`atribuidoA`) não recebe saudação nem menu; `#sair`/`#menu` do CLIENTE seguem valendo, e o aviso de fora de horário também | 🆕 **17/08** — sem isso, o dia do corte mandaria menu por cima de toda conversa em andamento |
| **Fila do menu sem ninguém do departamento** | **[?]** | a ⚙️ 🤖 lista as opções órfãs ANTES de ligar o alcance 🌐, separando "ninguém do departamento" de "ninguém enxerga"; a ⚙️ 👥 mostra o placar por fila | 🆕 **17/08** — sem isso o cliente é encaminhado para um lugar sem dono e espera, sem ninguém saber |
| Fluxo de bot além do menu (sub-menus, perguntas encadeadas) | **[?]** | só a triagem de um nível | 🟡 depende do §7 |
| **O bot do SP Connect nasce DESLIGADO** | — | chave na ⚙️, com **alcance**: 🧪 só os números de teste × 🌐 todos | ⚠️ **de propósito**: os dois apps ficam assinados na WABA (decisão do Paulo) e recebem a MESMA mensagem, então o alcance é quem evita menu em dobro. **No teste real de 17/08 o bot da Ultra Fox NÃO respondeu** [produção] — observado num número, não é garantia |

## 3. Gestão do atendimento

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Departamentos / filas | ✔ 8 **[print]** | catálogo próprio de 8 (Recepção vê tudo; RH e Jurídico são filas) | ✅ |
| Atendentes vinculados a departamento | ✔ **[Paulo]** | `users.filasAtendimento`, aba 👥 da ⚙️ (só admin grava) | ✅ |
| Transferir atendimento entre departamentos | ✔ **[?]** | ↪️ transferir: limpa o dono, nota automática na thread com recado, selo "↪ de X", aviso opcional ao cliente | ✅ |
| Assumir / liberar conversa | **[?]** | 🙋 assumir, com guarda: responder conversa conduzida por outro é recusado (assumir é 1 clique, auditado) | ✅ |
| Encerrar atendimento | ✔ **[print]** (o `#sair` prova que existe encerramento) | ✅ Encerrar — admin e gestor qualquer um; colaborador só o que conduz; cliente pelo `#sair` | ✅ |
| Perfis de acesso (admin/gestor/colaborador) | **[?]** | 3 papéis com a régua do Paulo (16/08): gestor vê/atende/encerra tudo e não configura | ✅ |
| **Avaliação do atendimento (nota)** | **[?]** | pesquisa pós-encerramento + painel 📊 (média, distribuição, últimas) | 🆕 (chave nasce desligada) |
| Etiquetas/tags | **[?]** | **📇 → 🏷 (17/08)**: catálogo Lead · Cliente · Marketing · Colaborador · Candidato · Fornecedor · Parceiro · Ex-cliente, editável pelo admin. Filtro por etiqueta com a contagem de cada uma, e "sem etiqueta" como fila de trabalho | ✅ **respondeu a pergunta 3 do §7** — o Paulo pediu, então alguém usa |
| Relatórios de atendimento (volume, tempo de resposta, por fila) | ✔ **[?]** | só avaliações; volume e tempo **não** existem | 🔴 depende do §7 |
| Notificação sonora / pop-up de mensagem nova | ✔ **[Paulo, 16/08]** | **som** (sintetizado, sem arquivo externo), **pop-up do navegador** (clique abre a conversa) e **contador no título da aba** — a mesma mensagem nunca apita duas vezes, a conversa aberta não apita e a 1ª carga aprende sem apitar | ✅ **16/08** |
| Push no CELULAR com o app fechado | ✔ (app instalado) **[Paulo, 16/08]** | **pronto** — service worker, cadastro do aparelho, escolha de quem recebe (a MESMA régua de fila do inbox) e envio pelo FCM; fora do expediente só quem pediu | 🟡 a `VITE_FIREBASE_VAPID_KEY` **já viaja no deploy** (`deploy-app.yml`, secret + build-arg — conferido 20/08). Quem responde se o push está DE PÉ é a barra de avisos do próprio app: se ela oferecer "📱 Avisar também no celular", está; se disser pendente, o secret está vazio |
| Presença (online/ausente) do atendente | **[?]** | — | 🟡 |

## 4. Contatos e cliente

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Cadastro de contatos | ✔ **[Paulo]** (o backup é dela) | **📇 Contatos (17/08)**: agenda com busca por nome/empresa/número, ➕ cadastro à mão, etiquetas e o 📥 Importar no mesmo lugar | ✅ **17/08** — até aqui a coleção era gravada por 4 caminhos e **lida por nenhuma tela** |
| **Compartilhar um contato na conversa** | ✔ **[Paulo]** | cartão do WhatsApp (tipo `contacts`), com `wa_id` — o cliente toca e já conversa | ✅ **17/08** · guardas iguais às do texto livre (janela de 24h + fila visível) |
| **Restaurar o backup da Ultra Fox** | — | ⚙️ → 📥: contatos (CSV) e mensagens (CSV/.txt), com preview antes de gravar, sem sobrescrever contato existente e sem duplicar ao reimportar | ✅ **RODADO COM O ARQUIVO REAL — 21/08 [Paulo]**: *"O backup já foi restaurado inclusive com os contatos"*. ⚠️ No dia do cancelamento vale UM export final incremental (o que chegou depois deste backup) — reimportar não duplica, então custa só o clique |
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
| Outros canais — Instagram | **[?]** | ⚙️ → 📷 **SONDA** se o token alcança Página+Instagram vinculado (18/08). **Não linka nada** de propósito — achar a conta não prova permissão de mensagem, só identidade | 🟡 **fase 1 no ar**: falta rodar a sonda em produção e ver o veredito real |
| Outros canais — Wix (site) | **[?]** | nenhum | 🔴 depende de saber qual recurso do Wix ele quer dizer (chat widget é API própria, sem nada em comum com a Meta) |
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
3. ✅ ~~**Etiquetas/tags**~~ — **RESPONDIDO/FEITO 17/08**: o Paulo pediu as
   flags nomeando as que quer (*"Leads, Clientes, Marketing, Colaboradores,
   Candidatos, entre outros"*), então alguém usa. Elas são do **CONTATO**,
   não da conversa — classificam a pessoa, não o estado do atendimento.
   ⚠️ Etiqueta de ESTADO da conversa ("aguardando documento", "urgente")
   continua sendo outra coisa, e **não foi construída**: a situação da
   conversa hoje é aberta/resolvida + fila. Se a equipe usa etiqueta de
   estado na Ultra Fox, isso ainda é pergunta aberta.
4. **Relatórios**: qual relatório da Ultra Fox alguém realmente abre? (não
   quero reproduzir tela que nunca foi lida — a lição do e-Fiscal)
5. ✅ ~~**Notificação**~~ — **RESPONDIDO 16/08**: a Ultra Fox faz **som,
   pop-up e notificação no celular** (quando instalado), e a decisão do
   Paulo é fazer os TRÊS: *"quanto mais notificação melhor, evita desculpa
   que o colaborador não viu, não recebeu, e o cliente reclama"*.
6. **Bot**: o menu tem sub-níveis (opção que abre outro menu) ou é só o de
   8 opções que vi no print?
7. ✅ ~~**Outros canais**~~ — **RESPONDIDO PARCIALMENTE 18/08**: Paulo quer
   Instagram (DM) e o site no Wix. Instagram entrou como SONDA (não linka
   nada ainda — primeiro se confirma se o token alcança a conta, depois vem
   a implementação de verdade). Wix ainda é pergunta aberta: **qual recurso
   do Wix** — o chat widget do próprio site (API própria da Wix, projeto do
   zero) ou os botões de WhatsApp/Instagram que o site já usa pra abrir
   conversa (esses já caem nos canais acima, de graça)?
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

**Sequência recomendada**: ~~fechar os 3 bloqueantes~~ ✅ 16/08 →
~~ligar o bot no PILOTO, com a Ultra Fox de pé~~ ✅ 17/08 → ~~**ensaio com
atendente real resolvendo conversa ponta a ponta**~~ ✅ **21/08 — teste
real com várias pessoas logadas** (ver §9) → **virar o alcance para 🌐
todos** (se ainda estiver em 🧪 piloto — conferir na ⚙️ → 🤖) → só então
cancelar a Ultra Fox. E o backup dela entra ANTES do cancelamento —
plataforma cancelada não devolve export. **Checklist do dia do
cancelamento**: (1) ✅ ~~backup COMPLETO exportado e importado pelo ⚙️ →
📥~~ — **FEITO 21/08 [Paulo]**, inclusive contatos (no dia do corte, um
export final incremental do que chegou depois — reimportar não duplica);
(2) alcance 🌐 confirmado e bot respondendo; (3) um dia de operação sem a
equipe abrir a Ultra Fox — se ninguém sentiu falta, corta.

⚠️ **O que fica ENTRE o piloto e o 🌐 todos**: o piloto prova o bot na
conversa de UMA pessoa que começa do zero; o 🌐 solta o bot sobre as
conversas **que já existem**, e essas têm estado (dono, histórico, sem
fila). Foi ao olhar exatamente isso que apareceu o defeito de 17/08 — o bot
triando por cima de atendimento em andamento (§2). Quem for virar a chave
olha primeiro se há conversa em condução: agora ela não é invadida, mas
continua sendo o estado em que o dia do corte é mais barulhento.

## 9. Prova de que o SP Connect funciona (o que já rodou em produção)

Não é promessa: em 16/08 o ciclo fechou ponta a ponta no número real —
mensagem do cliente chegando pelo webhook, resposta saindo pelo SP Connect
e chegando no celular, status ✓✓ ao vivo, e um atendimento real conduzido
por uma colaboradora. A Ultra Fox seguiu de pé ao lado o tempo todo.

**17/08 — o bot rodou ponta a ponta em produção, no piloto.** Paulo pôs o
próprio número na lista e conduziu o ciclo inteiro: saudação com protocolo,
menu, escolha de departamento, atendente assumindo, encerramento e pesquisa
de avaliação. Nota dele: **10**. Dois fatos importam junto com o resultado:
a Ultra Fox continuava assinada na WABA e **o bot dela não respondeu** (não
houve menu em dobro), e a nota 10 só foi capturada porque a escala virou
DADO no mesmo dia — na régua antiga ela teria sido descartada em silêncio.

**21/08 — TESTE REAL com várias pessoas logadas ao mesmo tempo** (Paulo:
*"Começamos o teste real! Várias pessoas logadas!"*). Clientes de verdade
passando pelo bot (saudação, menu, encaminhamento por fila), transferência
Recepção → RH em produção, conversa encerrada e avaliada. O dia também
provou o valor do ensaio: o **teto de 100 conversas** da lista apareceu no
primeiro dia de volume real ("Todas · 100") e foi corrigido no mesmo dia —
leitura paginada até 2000, com o corte NOMEADO na tela quando bater.
