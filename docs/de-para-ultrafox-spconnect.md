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
| Respostas rápidas | ✔ **[?]** | chips ⚡ do composer, **editáveis na ⚙️ → 🤖** (uma frase por linha, pra equipe inteira; lista vazia = sem chips, escolha) | ✅ **21/08** |
| Buscar dentro de uma conversa | **[?]** | 🔍 na thread: filtra os balões carregados, sem acento/caixa, acha também pelo NOME do anexo (currículo se procura pelo nome), com contagem "N de M" | ✅ **21/08** |
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
| Aviso fora do horário | ✔ **[print]** | `foraDeHorario`, 1×/dia por conversa (anti-metralhadora). ⚠️ E o encaminhamento fora do horário deixou de prometer *"logo um atendente responderá"* — ele diz que responde quando abrirmos. O encaminhamento CONTINUA acontecendo: travá-lo deixaria a mensagem sem destino e a equipe sem a conversa na fila de manhã | ✅ (a frase honesta, **26/08**) |
| Horário de funcionamento configurável | ✔ **[?]** | dias + 2 turnos (8-12 / 13-17:30), fuso de SP explícito | ✅ |
| Cliente pedir outro departamento no meio | **[?]** | `#menu` reapresenta o menu em qualquer estado **e libera a condução** (volta pra triagem sem dono — pedir outro depto e ficar com o atendente do anterior é conversa torta) | ✅ |
| **O bot não fala por cima de atendimento em andamento** | **[?]** — o bot dela roda no mesmo número e não foi observado invadindo | conversa com atendente (`atribuidoA`) não recebe saudação nem menu; `#sair`/`#menu` do CLIENTE seguem valendo, e o aviso de fora de horário também | 🆕 **17/08** — sem isso, o dia do corte mandaria menu por cima de toda conversa em andamento |
| **Fila do menu sem ninguém do departamento** | **[?]** | a ⚙️ 🤖 lista as opções órfãs ANTES de ligar o alcance 🌐, separando "ninguém do departamento" de "ninguém enxerga"; a ⚙️ 👥 mostra o placar por fila | 🆕 **17/08** — sem isso o cliente é encaminhado para um lugar sem dono e espera, sem ninguém saber |
| **Ler o pedido em texto livre e encaminhar** (sem o cliente digitar número) | ✕ — o bot dela é menu numérico **[print]** | 🤖 a frase do cliente vai ao Gemini (conta paga do escritório) com a lista FECHADA das filas do menu; com confiança ≥70% o app encaminha como se ele tivesse digitado a opção. **Provado em produção 26/08**: *"bom dia, preciso da minha guia de DAS"* → Fiscal, 98% | 🆕 **26/08** — é a primeira coisa que o SP Connect faz e a Ultra Fox não |
| ⚠️ O que a IA **não** faz | — | não responde ao cliente, não dá informação fiscal, não inventa fila fora do menu e não fala por cima de atendimento em andamento. Sem certeza, ilegível, fora do ar ou lenta (>6s) ⇒ **o menu de sempre** — o pior caso dela é o comportamento de ontem | ✅ trava de projeto |
| Rastro de quem encaminhou | ✕ | **nota interna** na conversa com a fila e a confiança, mais o `#menu` de volta oferecido ao cliente que a IA encaminhou (ele nunca viu o menu) | ✅ **26/08** |
| Encerrar SOLTA a conversa | **[?]** | o ✅ do atendente e o `#sair` do cliente chegam ao MESMO estado (sem fila, sem dono); mensagem nova depois disso REABRE e passa pela triagem de novo — a resposta da pesquisa não reabre | 🆕 **26/08** — antes a conversa encerrada ficava presa e o cliente que voltava não recebia resposta nenhuma |
| Fluxo de bot além do menu (sub-menus, perguntas encadeadas) | **[?]** | ↳ sub-menus de UM nível (opção-porta → sub-opções → fila), com "0 - Voltar", editáveis na ⚙️ → 🤖; `#menu` zera tudo | ✅ **22/08** |
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
| Relatórios de atendimento (volume, tempo de resposta, por fila) | ✔ **[?]** | 📈 (admin/gestor): volume por fila/atendente, tempo de 1ª resposta HUMANA (bot não conta) e conversas SEM resposta humana — 7/30/90 dias | ✅ **22/08** — era o último 🔴 |
| Notificação sonora / pop-up de mensagem nova | ✔ **[Paulo, 16/08]** | **som** (sintetizado, sem arquivo externo), **pop-up do navegador** (clique abre a conversa) e **contador no título da aba** — a mesma mensagem nunca apita duas vezes, a conversa aberta não apita e a 1ª carga aprende sem apitar | ✅ **16/08** |
| Push no CELULAR com o app fechado | ✔ (app instalado) **[Paulo, 16/08]** | **pronto** — service worker, cadastro do aparelho, escolha de quem recebe (a MESMA régua de fila do inbox) e envio pelo FCM; fora do expediente só quem pediu | 🟡 a `VITE_FIREBASE_VAPID_KEY` **já viaja no deploy** (`deploy-app.yml`, secret + build-arg — conferido 20/08). Quem responde se o push está DE PÉ é a barra de avisos do próprio app: se ela oferecer "📱 Avisar também no celular", está; se disser pendente, o secret está vazio |
| Presença (online/ausente) do atendente | **[?]** | quem da fila está **no ar agora**, dito na HORA DE TRANSFERIR (é ali que a informação muda a decisão, não numa lista de gente). ⚠️ O app mede o SINAL do inbox, não a pessoa: sem sinal recente ele diz *"sem sinal há N min"*, **nunca "offline"** — aba fechada, computador dormindo e telefone na mão são coisas diferentes, e nenhuma delas foi medida. A transferência funciona de qualquer jeito: barrar seria impedir transferência legítima por uma certeza que não temos | ✅ **26/08** |

## 4. Contatos e cliente

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Cadastro de contatos | ✔ **[Paulo]** (o backup é dela) | **📇 Contatos (17/08)**: agenda com busca por nome/empresa/número, ➕ cadastro à mão, etiquetas e o 📥 Importar no mesmo lugar | ✅ **17/08** — até aqui a coleção era gravada por 4 caminhos e **lida por nenhuma tela** |
| **Compartilhar um contato na conversa** | ✔ **[Paulo]** | cartão do WhatsApp (tipo `contacts`), com `wa_id` — o cliente toca e já conversa | ✅ **17/08** · guardas iguais às do texto livre (janela de 24h + fila visível) |
| **Restaurar o backup da Ultra Fox** | — | ⚙️ → 📥: contatos (CSV) e mensagens (CSV/.txt), com preview antes de gravar, sem sobrescrever contato existente e sem duplicar ao reimportar | ✅ **RODADO COM O ARQUIVO REAL — 21/08 [Paulo]**: *"O backup já foi restaurado inclusive com os contatos"*. ⚠️ No dia do cancelamento vale UM export final incremental (o que chegou depois deste backup) — reimportar não duplica, então custa só o clique |
| Vincular contato ↔ cliente do escritório | **[?]** | 🔗 busca no cadastro central (nome/CNPJ), gravando quem vinculou. **26/08**: o app passou a SUGERIR — cruza o número com o `whatsappCliente`/`telefone` do cadastro e mostra na própria conversa *"pelo cadastro, este número é da X"*, com botão de confirmar; a ⚙️ → 🔗 Vínculos faz a mesma conta em massa. Sugere, nunca vincula sozinho (número de WhatsApp muda de dono, e vincular errado põe a guia de um cliente na conversa de outro); número em dois cadastros mostra os dois e não escolhe | ✅ **26/08** |
| Quanto o cruzamento por telefone alcança | — | **medido em 26/08, produção**: 244 de 424 clientes têm telefone no cadastro — esse é o TETO do método. Achou 25 sugestões + 7 ambíguos. ⚠️ E o "2.216 contatos sem vínculo" da 1ª medição estava inflado: `whatsapp_contatos` guarda também o catálogo importado da Ultra Fox, gente que nunca escreveu aqui. **Decisão do Paulo (26/08): não gastar tempo nisso — "a telefonista acerta"**, ou seja o vínculo se resolve no atendimento, não em fila de preenchimento de cadastro | 📌 decidido |
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
| **Aviso NATIVO do Teams** (sino de Atividade) | ✕ | `sendActivityNotification` do Graph, com a MESMA audiência do push (fila, autor, 📷, horário); chave nasce ligada; 🧪 na ⚙️ → 👥 prova no próprio Teams de quem clica | ✅ **25/08 — o Graph ACEITOU** [Paulo]. O 204 só sai depois de três portas: usuário no tenant, **SP Connect instalado** no Teams dele e `activityType` **declarado no manifest instalado** — ou seja, prova de uma vez o consent da `TeamsActivity.Send` e o pacote com `activities`, que eram os dois atos que faltavam. ⚠️ O aviso aparece no **aplicativo** do Teams (barra da esquerda → Atividade), nunca na aba do navegador: foi essa a confusão do dia, e a frase de sucesso passou a dizer o lugar |
| Vários NÚMEROS de WhatsApp | **[?]** | **apto desde 16/08**: catálogo de canais (o de hoje segue vindo do env e é o padrão), entrada roteada pelo `phone_number_id` da Meta e cadastro na ⚙️ — o token do 2º número vive no Cloud Run, nunca no banco. Falta só o número existir | ✅ apto |
| Outros canais — Instagram | **[?]** | **DMs no MESMO inbox — ✅ PROVADO EM PRODUÇÃO 22/08** (Paulo: *"perfeito, perfeito, entrou e saiu"*): DM de teste chegou com o selo 📷 na Recepção e a resposta por texto voltou entregue (✓). Arquitetura: caso de uso "API do Instagram com login do Instagram" — webhook na tela do caso de uso (seção 3), assinatura pela chave do app do Instagram (env `INSTAGRAM_APP_SECRET`), resposta pelo `graph.instagram.com` com o token da conta (env `INSTAGRAM_ACCESS_TOKEN`); os dois via Secret Manager, ativados por deploy da esteira. O bot NÃO roda nas DMs (triagem humana na Recepção, decisão de projeto) e fora da janela da Meta não há template — espera-se o cliente escrever | ✅ **22/08** — acesso POR USUÁRIO (lista "Quem atende as DMs" na ⚙️ → 📷; decisão do Paulo: juliana.gomes@, rhsp@ e o admin master); anexo/áudio de SAÍDA no IG é fase futura (recusa nomeada na tela) |
| Outros canais — Wix (site) | **[?]** | nenhum | 🔴 depende de saber qual recurso do Wix ele quer dizer (chat widget é API própria, sem nada em comum com a Meta) |
| **Chamada de voz/vídeo** (liberada pela Meta Brasil) | **[?]** | ⚙️ → ☎️ SONDA o estado real na Meta e relata com o cru da resposta; ☎️ pedido de permissão na conversa; SBC próprio (Asterisk, TLS 5061) apontado no tronco da HitPhone | 🔴 **BLOQUEADO NA META, medido em 25/08** — e o bloqueio é dos DOIS lados. **Saída**: código **131055**, *"Graph API calls are not allowed for SIP enabled numbers"* — em modo SIP quem disca é o tronco, então não existe (nem pode existir) botão de ligar no app. **Entrada**: com todos os interruptores da Meta LIGADOS, o 🔌 verde até o SBC e o gravador do Asterisk **provado ligado**, a chamada das 14h52 — dentro da janela — saiu *"Não atendida"* no celular e o tronco **não registrou CDR nem INVITE** em três conferências. A Meta aceita a chamada e **não entrega**. Chamado aberto (texto pronto em `docs/sbc-whatsapp-hitphone.md`). 🆕 **26/08:
a chamada passou a TOCAR uma vez** (antes era recusada de saída) e o caminho
até o SBC foi provado **a partir do endereço que a própria Meta guarda** —
DNS → 35.185.197.118, TLSv1.2, certificado público válido e **SIP OPTIONS 200
OK** do Asterisk. ✅ **E A MEDIÇÃO DO TRONCO SAIU no mesmo dia, 15:53**: o log
do Asterisk cobre de **25/08 17:48 a 26/08 15:53** e traz **ZERO INVITE no dia
inteiro de 26/08** — período que inclui as **DUAS** tentativas do chamador
(09:30 e 14:06, as duas tocando uma vez e terminando "Não atendida", com a
permissão vigente até 02/09). E **nenhuma recusa nossa** (401/403/404/407/488/
603) no mesmo período: não é "chega e o Asterisk derruba", é **não chega**.
⚠️ O que o dado NÃO separa: o log mostra o que o Asterisk VÊ — INVITE barrado
antes dele (firewall/rede) deixaria o log igualmente vazio, e é por isso que a
pergunta dos IPs de origem está no chamado e a captura de pacote SIP cru
(`pjsip set logger on`) ficou armada para a próxima ligação. ⚠️ E o CDR **não
existe nesta VM**, então hoje o log é testemunha única. ⚠️ Em modo SIP **não chega evento de chamada no webhook** (só `call_permission_reply`), então o registro da ligação na conversa sairá do **CDR do SBC**, nunca da Meta |
| Custo | mensalidade da plataforma **[Paulo]** | só o custo de conversa da Meta | 🆕 é o ganho econômico da troca |

## 6. Operação e administração

| Função | Ultra Fox | SP Connect | Status |
|---|---|---|---|
| Configurar mensagens automáticas | ✔ **[?]** | ⚙️ → 🤖: saudação, menu, confirmação, fora de horário, `#sair`, transferência, avaliação | ✅ |
| Gerenciar templates aprovados | ✔ **[?]** | cadastro por departamento **+** leitura direta dos aprovados na Meta **+ criação de template novo pela tela** (submete à aprovação da Meta; status volta na resposta) | ✅ **22/08** |
| Auditoria de quem fez o quê | **[?]** | envio, transferência, vínculo, encerramento e importação carimbam quem e quando | 🆕 |
| Diagnóstico do canal (webhook, assinatura) | **[?]** | painel 📡 na ⚙️ Config Admin do CFI | 🆕 |
| Suporte / dependência de fornecedor | fornecedor externo | código da casa | 🆕 |

## 7. 🙋 PERGUNTAS AO PAULO — o que eu NÃO sei da Ultra Fox

Não vou preencher nenhuma destas por dedução. Cada resposta vira linha
neste documento (e, quando faltar, vira fila de construção):

1. ✅ ~~**Áudio**~~ — **RESPONDIDO/FEITO 16/08**: gravar e enviar áudio sai
   por nós (🎤 no composer).
2. ✅ ~~**Respostas rápidas**~~ — **FECHADA POR CONSTRUÇÃO 21/08**: o
   cadastro editável existe (⚙️ → 🤖, uma frase por linha). A LISTA de
   frases da Ultra Fox, se houver, o admin digita lá — não depende de mim.
3. ✅ ~~**Etiquetas/tags**~~ — **RESPONDIDO/FEITO 17/08**: o Paulo pediu as
   flags nomeando as que quer (*"Leads, Clientes, Marketing, Colaboradores,
   Candidatos, entre outros"*), então alguém usa. Elas são do **CONTATO**,
   não da conversa — classificam a pessoa, não o estado do atendimento.
   ⚠️ Etiqueta de ESTADO da conversa ("aguardando documento", "urgente")
   continua sendo outra coisa, e **não foi construída**: a situação da
   conversa hoje é aberta/resolvida + fila. Se a equipe usa etiqueta de
   estado na Ultra Fox, isso ainda é pergunta aberta.
4. ✅ ~~**Relatórios**~~ — **FECHADA POR ORDEM DIRETA 22/08** ("vamos tocar
   do 1 ao 5"): construído o 📈 mínimo que responde as três perguntas de
   gestão (volume, tempo de 1ª resposta, sem-resposta). Tela que ninguém
   abrir a gente remove — medir antes de inchar.
5. ✅ ~~**Notificação**~~ — **RESPONDIDO 16/08**: a Ultra Fox faz **som,
   pop-up e notificação no celular** (quando instalado), e a decisão do
   Paulo é fazer os TRÊS: *"quanto mais notificação melhor, evita desculpa
   que o colaborador não viu, não recebeu, e o cliente reclama"*.
6. ✅ ~~**Bot / sub-níveis**~~ — **FECHADA POR CONSTRUÇÃO 22/08**: o
   mecanismo de sub-menu (1 nível) existe e é editável; se a Ultra Fox tinha
   árvores mais fundas, o conteúdo o admin monta na ⚙️.
7. ✅ ~~**Outros canais**~~ — **Instagram PROVADO EM PRODUÇÃO 22/08**
   ("entrou e saiu" [Paulo] — ver a linha do §5). Wix ainda é pergunta aberta: **qual recurso do Wix** — o
   chat widget do próprio site (API própria da Wix, projeto do zero) ou os
   botões de WhatsApp/Instagram que o site já usa pra abrir conversa (esses
   já caem nos canais acima, de graça)?
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

🔴 **E a CHAMADA DE VOZ não é bloqueante, apesar do vermelho** — a distinção
importa porque a régua deste documento é *"enquanto houver 🔴 em linha
bloqueante, a resposta é NÃO"*. Ela não bloqueia por dois motivos: **a Ultra
Fox também não faz** (a linha dela é **[?]**, e ninguém do escritório atende
ligação de WhatsApp hoje), e o bloqueio **não é nosso** — é da Meta não
entregar o INVITE no tronco. Esperar por isso seria manter a mensalidade de
uma plataforma por um recurso que ela também não tem.

**Sequência recomendada**: ~~fechar os 3 bloqueantes~~ ✅ 16/08 →
~~ligar o bot no PILOTO, com a Ultra Fox de pé~~ ✅ 17/08 → ~~**ensaio com
atendente real resolvendo conversa ponta a ponta**~~ ✅ **21/08 — teste
real com várias pessoas logadas** (ver §9) → ~~**virar o alcance para 🌐
todos**~~ ✅ **[Paulo, 22/08: "bot ja esta para todos, tudo ligado a
dias"]** → só então cancelar a Ultra Fox. E o backup dela entra ANTES do
cancelamento — plataforma cancelada não devolve export. **Checklist do dia
do cancelamento**: (1) ✅ ~~backup COMPLETO exportado e importado pelo ⚙️ →
📥~~ — **FEITO 21/08 [Paulo]**, inclusive contatos; (2) ✅ ~~alcance 🌐
confirmado e bot respondendo~~ — **[Paulo, 22/08]** ligado "a dias", com a
operação real inteira no SP Connect desde 21/08; (3) ✅ ~~um dia de operação
sem a equipe abrir a Ultra Fox~~ — dias de operação real corridos.
**⇒ SOBRAM DOIS ATOS, os dois no dia do cancelamento**: (a) o **export
incremental FINAL** da Ultra Fox (contatos/mensagens desde 21/08) →
⚙️ → 📥 (reimportar não duplica); (b) **cancelar** — e, cancelada,
conferir no painel de webhook da ⚙️ Config Admin (CFI) que o app DELA
saiu da lista de assinados da WABA: enquanto assinado, o fornecedor
antigo continua RECEBENDO cópia de toda mensagem de cliente, o que depois
do contrato é problema de LGPD, não de conveniência.

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
